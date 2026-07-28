/**
 * Client-side image compression using the Canvas API.
 *
 * Why: mobile photos can easily be 5-10MB. Uploading raw wastes bandwidth
 * and time. We downscale to a max dimension and re-encode as JPEG/WebP at
 * a quality that keeps the image looking good while shrinking it 5-10x.
 *
 * For videos we can't easily compress client-side without ffmpeg.wasm
 * (which is heavy), so we just enforce a size limit and let the server
 * handle it.
 */

interface CompressOptions {
  /** Max width or height in pixels. Default 1280. */
  maxDimension?: number
  /** JPEG quality 0-1. Default 0.82. */
  quality?: number
  /** Target MIME type. Default 'image/jpeg'. */
  mimeType?: 'image/jpeg' | 'image/webp'
}

/**
 * Compress an image File using canvas. Returns a new File with the
 * compressed image. If the input is already small or not an image, returns
 * the original file unchanged.
 */
export async function compressImage(file: File, opts: CompressOptions = {}): Promise<File> {
  const { maxDimension = 1280, quality = 0.82, mimeType = 'image/jpeg' } = opts

  // Only compress raster images
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') {
    return file
  }

  try {
    // Load the image into an HTMLImageElement
    const img = await loadImage(file)
    const { width, height } = img

    // Skip if already small enough
    if (width <= maxDimension && height <= maxDimension && file.size < 1024 * 1024) {
      return file
    }

    // Calculate scaled dimensions
    let scaledW = width
    let scaledH = height
    if (width > height) {
      if (width > maxDimension) {
        scaledH = Math.round((height * maxDimension) / width)
        scaledW = maxDimension
      }
    } else {
      if (height > maxDimension) {
        scaledW = Math.round((width * maxDimension) / height)
        scaledH = maxDimension
      }
    }

    // Draw to canvas
    const canvas = document.createElement('canvas')
    canvas.width = scaledW
    canvas.height = scaledH
    const ctx = canvas.getContext('2d')
    if (!ctx) return file

    // High-quality downscaling
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, scaledW, scaledH)

    // Convert to blob
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, mimeType, quality)
    })
    if (!blob) return file

    // Generate filename
    const ext = mimeType === 'image/webp' ? 'webp' : 'jpg'
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'image'
    return new File([blob], `${baseName}.${ext}`, { type: mimeType })
  } catch (e) {
    console.error('[compressImage] failed:', e)
    return file
  }
}

/**
 * Load a File into an HTMLImageElement.
 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = (e) => {
      URL.revokeObjectURL(url)
      reject(e)
    }
    img.src = url
  })
}

/**
 * Format bytes as a human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
