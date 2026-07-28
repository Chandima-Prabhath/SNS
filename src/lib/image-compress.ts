/**
 * Client-side image compression using the Canvas API.
 *
 * Why: mobile photos can easily be 5-10MB. Uploading raw wastes bandwidth
 * and time. We downscale to a max dimension and re-encode as JPEG at
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
 * Compress an image File using canvas. Returns a new File (or Blob) with the
 * compressed image. If compression fails or the input is already small,
 * returns the original file unchanged.
 *
 * Returns a Blob (not File) for maximum browser compatibility — the File
 * constructor isn't available in all environments, but Blob is universal
 * and FormData accepts both.
 */
export async function compressImage(file: File, opts: CompressOptions = {}): Promise<Blob> {
  const { maxDimension = 1280, quality = 0.82, mimeType = 'image/jpeg' } = opts

  // Only compress raster images
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') {
    return file
  }

  try {
    // Load the image into an HTMLImageElement via createImageBitmap (faster)
    // with fallback to the classic Image element.
    let bitmap: ImageBitmap | HTMLImageElement
    try {
      bitmap = await createImageBitmap(file)
    } catch {
      bitmap = await loadImage(file)
    }

    const width = 'width' in bitmap ? bitmap.width : (bitmap as HTMLImageElement).naturalWidth
    const height = 'height' in bitmap ? bitmap.height : (bitmap as HTMLImageElement).naturalHeight

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
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0, scaledW, scaledH)

    // Release bitmap memory if it's an ImageBitmap
    if ('close' in bitmap && typeof (bitmap as ImageBitmap).close === 'function') {
      ;(bitmap as ImageBitmap).close()
    }

    // Convert to blob
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, mimeType, quality)
    })
    if (!blob) return file

    // Return the blob with a proper filename if possible
    const ext = mimeType === 'image/webp' ? 'webp' : 'jpg'
    const baseName = (file.name || 'image').replace(/\.[^.]+$/, '')
    const filename = `${baseName}.${ext}`
    try {
      return new File([blob], filename, { type: mimeType })
    } catch {
      // File constructor not available — return the blob directly
      return blob
    }
  } catch (e) {
    console.error('[compressImage] failed, returning original:', e)
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
