/**
 * Media Service — unified file handling for uploads, TTS, ASR, and music.
 *
 * All file operations (save, serve path, delete, validate) go through this
 * module. This ensures consistent:
 *   - Validation (extension allowlist, MIME detection, size limits)
 *   - Storage paths (public/uploads/ for user media, public/cache/ for generated)
 *   - URL patterns (/api/uploads/<filename> for serving)
 *   - Cleanup (eviction for cache, retention for uploads)
 *
 * Used by:
 *   - /api/upload (user-uploaded files: images, voice messages, documents)
 *   - /api/tts (TTS-generated audio)
 *   - /lib/bot/framework.ts (bot-generated TTS audio)
 *   - /lib/asr.ts (temp audio conversion for ASR)
 *   - /lib/ytdlp-download.ts (cached music files — separate cache dir)
 */

import { writeFile, mkdir, unlink, stat } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import crypto from 'crypto'

// ─── Constants ──────────────────────────────────────────────────────────────

export const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads')
export const CACHE_DIR = path.join(process.cwd(), 'public', 'cache')
export const MUSIC_CACHE_DIR = path.join(CACHE_DIR, 'music')

export const MAX_UPLOAD_SIZE = 25 * 1024 * 1024 // 25 MB

// Extension allowlist — blocks SVG (XSS), HTML, JS, executables
export const ALLOWED_EXTENSIONS = new Set([
  // Images
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico',
  // Audio
  '.mp3', '.wav', '.ogg', '.webm', '.m4a', '.flac', '.aac',
  // Video
  '.mp4', '.mov', '.avi',
  // Documents
  '.pdf', '.txt',
  // Data
  '.safetensors', '.bin',
])

// MIME type map for serving files with correct Content-Type
export const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.safetensors': 'application/octet-stream',
  '.bin': 'application/octet-stream',
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Validate and sanitize a file extension.
 * Returns the sanitized extension (e.g. '.JPG' → '.jpg') or null if not allowed.
 */
export function validateExtension(ext: string): string | null {
  const safeExt = ext.toLowerCase().slice(0, 8)
  if (!/^[\w.-]+$/.test(safeExt)) return null
  if (!ALLOWED_EXTENSIONS.has(safeExt)) return null
  return safeExt
}

/**
 * Get the MIME type for a file extension.
 * Falls back to 'application/octet-stream' for unknown types.
 */
export function getMimeType(ext: string): string {
  return MIME_TYPES[ext.toLowerCase()] || 'application/octet-stream'
}

/**
 * Detect if a file is an audio file based on extension or MIME type.
 */
export function isAudioFile(filename: string, mimeType?: string): boolean {
  if (mimeType?.startsWith('audio')) return true
  const ext = path.extname(filename).toLowerCase()
  return ['.mp3', '.wav', '.ogg', '.webm', '.m4a', '.flac', '.aac'].includes(ext)
}

/**
 * Detect if a file is an image based on extension or MIME type.
 */
export function isImageFile(filename: string, mimeType?: string): boolean {
  if (mimeType?.startsWith('image')) return true
  const ext = path.extname(filename).toLowerCase()
  return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico'].includes(ext)
}

// ─── Storage ────────────────────────────────────────────────────────────────

/**
 * Ensure the upload directory exists.
 */
export async function ensureUploadDir(): Promise<void> {
  if (!existsSync(UPLOAD_DIR)) {
    await mkdir(UPLOAD_DIR, { recursive: true })
  }
}

/**
 * Save a file to the upload directory with a unique filename.
 *
 * @param buffer - File contents
 * @param originalName - Original filename (used to detect extension)
 * @param mimeType - MIME type from the upload (used as fallback for extension)
 * @returns { url, filename, ext, mimeType, size }
 */
export async function saveUpload(
  buffer: Buffer | Uint8Array,
  originalName: string,
  mimeType?: string,
): Promise<{
  url: string
  filename: string
  ext: string
  mimeType: string
  size: number
}> {
  await ensureUploadDir()

  // Determine extension — prefer from originalName, fall back to MIME
  let ext = path.extname(originalName).toLowerCase() || ''
  if (!ext && mimeType) {
    // Reverse-lookup MIME → extension
    for (const [e, m] of Object.entries(MIME_TYPES)) {
      if (m === mimeType) { ext = e; break }
    }
  }

  const safeExt = validateExtension(ext) || '.bin'
  const detectedMime = getMimeType(safeExt)

  // Generate unique filename: <timestamp>-<uuid>.<ext>
  const filename = `${Date.now()}-${crypto.randomUUID()}${safeExt}`
  const filePath = path.join(UPLOAD_DIR, filename)

  await writeFile(filePath, buffer)

  return {
    url: `/api/uploads/${filename}`,
    filename,
    ext: safeExt,
    mimeType: detectedMime,
    size: buffer.byteLength,
  }
}

/**
 * Delete a file from the upload directory.
 * Safe to call with a URL path (/api/uploads/filename) or just a filename.
 */
export async function deleteUpload(fileOrUrl: string): Promise<boolean> {
  const filename = fileOrUrl.replace(/^\/api\/uploads\//, '').replace(/^\//, '')
  if (!filename || !/^[\w.-]+$/.test(filename)) return false

  const filePath = path.join(UPLOAD_DIR, filename)
  if (!existsSync(filePath)) return false

  // Prevent path traversal
  if (!filePath.startsWith(UPLOAD_DIR + path.sep)) return false

  await unlink(filePath)
  return true
}

/**
 * Get the absolute filesystem path for an upload URL.
 * Returns null if the file doesn't exist or the path is invalid.
 */
export async function resolveUploadPath(url: string): Promise<string | null> {
  const filename = url.replace(/^\/api\/uploads\//, '').replace(/^\//, '')
  if (!filename || !/^[\w.-]+$/.test(filename)) return null

  const filePath = path.join(UPLOAD_DIR, filename)
  if (!filePath.startsWith(UPLOAD_DIR + path.sep)) return null
  if (!existsSync(filePath)) return null

  return filePath
}

/**
 * Get file stats (size, modified time) for an upload.
 */
export async function getUploadStats(url: string): Promise<{ size: number; mtime: Date } | null> {
  const filePath = await resolveUploadPath(url)
  if (!filePath) return null

  const stats = await stat(filePath)
  return { size: stats.size, mtime: stats.mtime }
}
