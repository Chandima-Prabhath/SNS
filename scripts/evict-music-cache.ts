/**
 * Music Cache Eviction Script
 * ============================
 *
 * Evicts old cached music files when the total cache size exceeds a threshold.
 * Uses LRU (Least Recently Used) — files with the oldest access time are
 * deleted first.
 *
 * Usage:
 *   bunx tsx scripts/evict-music-cache.ts [--max-size-gb=1]
 *
 * Recommended: run as a cron job every hour:
 *   0 * * * * cd /path/to/SNS && bunx tsx scripts/evict-music-cache.ts --max-size-gb=1
 */

import { readdir, stat, unlink } from 'fs/promises'
import { join } from 'path'

const CACHE_DIR = join(process.cwd(), 'public', 'cache', 'music')
const DEFAULT_MAX_SIZE_GB = 1

async function main() {
  // Parse args
  const args = process.argv.slice(2)
  let maxSizeGb = DEFAULT_MAX_SIZE_GB
  for (const arg of args) {
    const match = arg.match(/--max-size-gb=(\d+)/)
    if (match) maxSizeGb = parseInt(match[1], 10)
  }
  const maxBytes = maxSizeGb * 1024 * 1024 * 1024

  try {
    const files = await readdir(CACHE_DIR)
    if (files.length === 0) {
      console.log('[evict] cache is empty, nothing to do')
      return
    }

    // Get stats for all files
    const fileStats = await Promise.all(
      files.map(async (filename) => {
        const filePath = join(CACHE_DIR, filename)
        const stats = await stat(filePath)
        return { filename, filePath, size: stats.size, atime: stats.atime }
      })
    )

    // Sort by access time — oldest first (LRU)
    fileStats.sort((a, b) => a.atime.getTime() - b.atime.getTime())

    const totalSize = fileStats.reduce((sum, f) => sum + f.size, 0)
    const totalMB = (totalSize / (1024 * 1024)).toFixed(1)
    console.log(`[evict] cache: ${fileStats.length} files, ${totalMB} MB (max: ${maxSizeGb} GB)`)

    if (totalSize <= maxBytes) {
      console.log('[evict] under limit, no eviction needed')
      return
    }

    // Evict oldest files until under limit
    let evictedCount = 0
    let evictedBytes = 0
    let currentSize = totalSize

    for (const file of fileStats) {
      if (currentSize <= maxBytes) break
      try {
        await unlink(file.filePath)
        currentSize -= file.size
        evictedBytes += file.size
        evictedCount++
      } catch (e) {
        // File might be in use — skip
      }
    }

    const evictedMB = (evictedBytes / (1024 * 1024)).toFixed(1)
    const remainingMB = (currentSize / (1024 * 1024)).toFixed(1)
    console.log(`[evict] deleted ${evictedCount} files (${evictedMB} MB), remaining: ${remainingMB} MB`)
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      console.log('[evict] cache directory does not exist yet, nothing to evict')
    } else {
      console.error('[evict] error:', e.message)
      process.exit(1)
    }
  }
}

main().then(() => process.exit(0))
