export interface LrcLine {
  time: number
  text: string
}

const LINE_TAG = /\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g

// parses standard synced-lyrics LRC tags ([mm:ss.xx]text) into sorted,
// playback-seekable lines; a line can carry more than one timestamp tag
export function parseLrc(text: string): LrcLine[] {
  const lines: LrcLine[] = []
  for (const raw of text.split(/\r?\n/)) {
    const tags = [...raw.matchAll(LINE_TAG)]
    if (tags.length === 0) continue
    const content = raw.replace(LINE_TAG, '').trim()
    for (const tag of tags) {
      const minutes = Number(tag[1])
      const seconds = Number(tag[2])
      const frac = tag[3] ? Number(tag[3].padEnd(3, '0')) / 1000 : 0
      lines.push({ time: minutes * 60 + seconds + frac, text: content })
    }
  }
  return lines.filter((l) => l.text.length > 0).sort((a, b) => a.time - b.time)
}

export function activeLrcIndex(lines: LrcLine[], position: number): number {
  let idx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= position) idx = i
    else break
  }
  return idx
}
