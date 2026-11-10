// a handful of violet/emerald tones matching the rest of the StemKit UI —
// used when there's no thumbnail to extract colors from (local files with
// no cover art), or while extraction hasn't resolved yet
export const FALLBACK_PALETTE = ['#7c3aed', '#34d399', '#4c1d95']

// buckets RGBA pixel data into `count` representative hex colors by
// averaging over a fixed grid of regions — simple and fast rather than a
// true k-means, which is plenty for a blurred animated-gradient background
export function quantize(pixels: Uint8ClampedArray, count: number): string[] {
  const pixelCount = pixels.length / 4
  if (pixelCount === 0 || count <= 0) return []
  const bucketSize = Math.max(1, Math.floor(pixelCount / count))
  const colors: string[] = []
  for (let b = 0; b < count; b++) {
    const start = b * bucketSize
    const end = b === count - 1 ? pixelCount : start + bucketSize
    if (start >= pixelCount) break
    let r = 0
    let g = 0
    let bl = 0
    let n = 0
    for (let i = start; i < end; i++) {
      r += pixels[i * 4]
      g += pixels[i * 4 + 1]
      bl += pixels[i * 4 + 2]
      n++
    }
    if (n === 0) continue
    const toHex = (v: number): string => Math.round(v / n).toString(16).padStart(2, '0')
    colors.push(`#${toHex(r)}${toHex(g)}${toHex(bl)}`)
  }
  return colors
}

const cache = new Map<string, Promise<string[]>>()

// draws the image into a small offscreen canvas and quantizes it; results
// are cached per videoId since Theater Mode may be opened/closed repeatedly
export function extractPalette(videoId: string, imageUrl: string): Promise<string[]> {
  const cached = cache.get(videoId)
  if (cached) return cached
  const promise = new Promise<string[]>((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const size = 24
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) return resolve(FALLBACK_PALETTE)
        ctx.drawImage(img, 0, 0, size, size)
        const { data } = ctx.getImageData(0, 0, size, size)
        const colors = quantize(data, 3)
        resolve(colors.length > 0 ? colors : FALLBACK_PALETTE)
      } catch {
        resolve(FALLBACK_PALETTE)
      }
    }
    img.onerror = () => resolve(FALLBACK_PALETTE)
    img.src = imageUrl
  })
  cache.set(videoId, promise)
  return promise
}
