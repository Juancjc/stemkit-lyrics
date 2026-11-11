import { useEffect, useState } from 'react'
import type { KaraokeTrack } from '../../../shared/types'

function lastStarted(items: { start: number }[], time: number): number {
  let low = 0
  let high = items.length
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (items[mid].start <= time) low = mid + 1
    else high = mid
  }
  return low - 1
}

export function useKaraokeCue(track: KaraokeTrack | null | undefined, getPosition: () => number): { line: number; word: number } {
  const [cue, setCue] = useState({ line: -1, word: -1 })
  useEffect(() => {
    if (!track) {
      setCue({ line: -1, word: -1 })
      return
    }
    let frame = 0
    let previousLine = -2
    let previousWord = -2
    const tick = (): void => {
      const time = getPosition()
      const i = lastStarted(track.lines, time)
      const line = i >= 0 && time < track.lines[i].end ? i : -1
      const word = line >= 0 ? lastStarted(track.lines[line].words, time) : -1
      if (line !== previousLine || word !== previousWord) {
        setCue({ line, word })
        previousLine = line
        previousWord = word
      }
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [track, getPosition])

  return cue
}
