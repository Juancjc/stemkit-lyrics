import type { LrcLine } from './lrc'
import type { LyricFrame } from '../../../shared/types'

// Rasterize each distinct line using the same system fonts available to the player.
export function lyricFrames(lines: LrcLine[]): LyricFrame[] {
  const canvas = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 260
  const ctx = canvas.getContext('2d')!
  const frames = new Map<string, Uint8Array>()
  function render(text: string): Uint8Array {
    const cached = frames.get(text)
    if (cached) return cached
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.font = 'bold 48px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 7
    ctx.strokeStyle = 'rgba(0,0,0,0.9)'
    ctx.fillStyle = 'white'
    const rows: string[] = []
    let row = ''
    for (const word of text.split(/\s+/)) {
      const next = row ? row + ' ' + word : word
      if (row && ctx.measureText(next).width > 1160) {
        rows.push(row)
        row = word
      } else row = next
    }
    rows.push(row)
    const spacing = Math.min(60, 240 / rows.length)
    ctx.font = 'bold ' + Math.min(48, spacing * 0.8) + 'px system-ui, sans-serif'
    rows.forEach((value, i) => {
      const y = 130 + (i - (rows.length - 1) / 2) * spacing
      ctx.strokeText(value, 640, y, 1160)
      ctx.fillText(value, 640, y, 1160)
    })
    const png = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), c => c.charCodeAt(0))
    frames.set(text, png)
    return png
  }
  const cues = [{ time: 0, text: '' }, ...lines]
  return cues.filter((cue, i) => cue.time !== cues[i + 1]?.time)
    .map(cue => ({ time: cue.time, png: render(cue.text) }))
}
