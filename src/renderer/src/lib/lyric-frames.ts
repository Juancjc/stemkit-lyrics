import type { LrcLine } from './lrc'
import { karaokeColor, karaokeHighlighted } from './karaoke-style'
import type { KaraokeStyle, KaraokeTrack, LyricFrame } from '../../../shared/types'

interface Caption {
  time: number
  words: string[]
  active?: number
}

function captionFrames(cues: Caption[], style?: KaraokeStyle): LyricFrame[] {
  const canvas = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 260
  const ctx = canvas.getContext('2d')!
  const fontSize = style?.karaokeTextSize === 'large' ? 60 : 48
  const highlight = karaokeColor(style?.karaokeHighlight ?? 'yellow')
  const frames = new Map<string, Uint8Array>()
  function render({ words, active }: Caption): Uint8Array {
    const key = JSON.stringify([words, active])
    const cached = frames.get(key)
    if (cached) return cached
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.font = `bold ${fontSize}px system-ui, sans-serif`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 7
    ctx.strokeStyle = 'rgba(0,0,0,0.9)'
    const rows: string[][] = []
    let row: string[] = []
    for (const word of words) {
      if (row.length && ctx.measureText([...row, word].join(' ')).width > 1160) {
        rows.push(row)
        row = []
      }
      row.push(word)
    }
    rows.push(row)
    const spacing = Math.min(fontSize * 1.25, 240 / rows.length)
    ctx.font = 'bold ' + Math.min(fontSize, spacing * 0.8) + 'px system-ui, sans-serif'
    const space = ctx.measureText(' ').width
    let index = 0
    rows.forEach((words, i) => {
      const y = 130 + (i - (rows.length - 1) / 2) * spacing
      const widths = words.map(word => Math.min(1160, ctx.measureText(word).width))
      const width = widths.reduce((sum, w) => sum + w, 0) + space * (words.length - 1)
      let x = (canvas.width - width) / 2
      words.forEach((word, j) => {
        ctx.strokeText(word, x, y, 1160)
        ctx.fillStyle = karaokeHighlighted(index, active ?? -1, style?.karaokeHighlightMode ?? 'word') ? highlight : 'white'
        ctx.fillText(word, x, y, 1160)
        x += widths[j] + space
        index++
      })
    })
    const png = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), c => c.charCodeAt(0))
    frames.set(key, png)
    return png
  }

  return cues.filter((cue, i) => cue.time !== cues[i + 1]?.time)
    .map(cue => ({ time: cue.time, png: render(cue) }))
}

export function lyricFrames(lines: LrcLine[]): LyricFrame[] {
  const cues = lines.map(line => ({ time: line.time, words: line.text.split(/\s+/) }))
  return captionFrames([{ time: 0, words: [] }, ...cues])
}

export function karaokeFrames(track: KaraokeTrack, style?: KaraokeStyle): LyricFrame[] {
  const cues: Caption[] = [{ time: 0, words: [] }]
  for (const line of track.lines) {
    const words = line.words.map(word => word.text)
    cues.push({ time: line.start, words })
    line.words.forEach((word, active) => cues.push({ time: word.start, words, active }))
    cues.push({ time: line.end, words: [] })
  }
  return captionFrames(cues, style)
}
