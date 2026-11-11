import type { KaraokeTrack } from '../shared/types'
import type { LrcLine } from '../renderer/src/lib/lrc'

export interface TimingInput {
  id: number
  words: string[]
  duration: number
  knownStarts?: (number | null)[]
  quiet?: number[][]
}

type Anchor = { start: number; words: string[]; known: (number | null)[] }

function timedWords(text: string): { words: string[]; known: (number | null)[] } {
  const words: string[] = []
  const known: (number | null)[] = []
  const tags = /<(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?>/g
  let offset = 0
  let onset: number | null = null
  function append(part: string): void {
    const tokens = part.match(/\S+/gu) ?? []
    words.push(...tokens)
    known.push(...tokens.map((_, i) => i === 0 ? onset : null))
  }
  for (const tag of text.matchAll(tags)) {
    append(text.slice(offset, tag.index))
    onset = Number(tag[1]) * 60 + Number(tag[2]) + Number((tag[3] ?? '').padEnd(3, '0')) / 1000
    offset = tag.index + tag[0].length
  }
  append(text.slice(offset))
  return { words, known }
}

export function karaokeAnchors(lines: LrcLine[], duration: number): Anchor[] {
  const anchors: Anchor[] = []
  for (const { time, text } of lines) {
    if (time >= duration) continue
    const { words, known } = timedWords(text)
    if (!words.length) continue
    const previous = anchors.at(-1)
    if (previous?.start === time) {
      previous.words.push(...words)
      previous.known.push(...known)
    } else anchors.push({ start: time, words, known })
  }
  if (!anchors.length) throw new Error('Choose synchronized lyrics for this song first.')
  return anchors
}

export function timingInput(anchors: Anchor[], duration: number, quiet: number[][]): TimingInput[] {
  return anchors.map(({ start, words, known }, id) => {
    const end = anchors[id + 1]?.start ?? duration
    const span = Math.round((end - start) * 1000) / 1000
    const intervals = quiet.filter(([a, b]) => b > start && a < end)
      .map(([a, b]) => [Math.max(0, a - start), Math.min(span, b - start)].map(n => Math.round(n * 100) / 100))
      .filter(([a, b]) => b > a)
    let previous = -Infinity
    const knownStarts = known.map(t => {
      if (t === null || t < start || t >= end || t <= previous) return null
      previous = t
      return Math.round((t - start) * 1000) / 1000
    })
    return { id, words, duration: span, ...(intervals.length ? { quiet: intervals } : {}),
      ...(knownStarts.some(n => n !== null) ? { knownStarts } : {}) }
  })
}

export function validateKaraoke(track: KaraokeTrack, duration: number): void {
  if (!Array.isArray(track?.lines) || !track.lines.length) throw new Error('Add at least one karaoke line.')
  let previousEnd = 0
  for (const [i, line] of track.lines.entries()) {
    const label = 'Line ' + (i + 1)
    if (!line || !Number.isFinite(line.start) || !Number.isFinite(line.end) ||
      line.start < previousEnd || line.end <= line.start || line.end > duration) {
      throw new Error(label + ' must fit inside the song and follow the previous line.')
    }
    if (!Array.isArray(line.words) || !line.words.length) throw new Error(label + ' needs at least one word.')
    let previousStart = -Infinity
    for (const word of line.words) {
      if (!word || typeof word.text !== 'string' || !/^\S+$/u.test(word.text) ||
          !Number.isFinite(word.start) || word.start < line.start || word.start >= line.end ||
          word.start <= previousStart) {
        throw new Error(label + ' needs individual words with increasing start times inside the line.')
      }
      previousStart = word.start
    }
    previousEnd = line.end
  }
}

export function decodeTiming(reply: string, inputs: TimingInput[], anchors: Anchor[]): KaraokeTrack['lines'] {
  const message = '9Router returned incomplete or invalid word timing. Try preparing karaoke again.'
  const content = reply.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let decoded: unknown
  try { decoded = JSON.parse(content) } catch { throw new Error(message) }
  if (!Array.isArray(decoded) || decoded.length !== inputs.length) throw new Error(message)
  const rows = new Map(decoded.map(row => [row?.id, row]))
  return inputs.map(input => {
    const row = rows.get(input.id)
    if (!row || !Array.isArray(row.starts) || row.starts.length !== input.words.length ||
        !Number.isFinite(row.end) || row.end <= 0 || row.end > input.duration) throw new Error(message)
    const { start } = anchors[input.id]
    const absolute = (seconds: number): number => Math.round((start + seconds) * 1000) / 1000
    const line = {
      start, end: absolute(row.end),
      words: input.words.map((text, i) => {
        if (!Number.isFinite(row.starts[i])) throw new Error(message)
        return { text, start: absolute(input.knownStarts?.[i] ?? row.starts[i]) }
      })
    }
    try { validateKaraoke({ lines: [line] }, absolute(input.duration)) } catch { throw new Error(message) }
    return line
  })
}
