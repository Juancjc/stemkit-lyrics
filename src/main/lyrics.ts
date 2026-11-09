import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { app, net } from 'electron'
import { songDir } from './library'
import type { LyricsTrack, CachedLyrics } from '../shared/types'

const LRCLIB_BASE = 'https://lrclib.net/api'

// LRCLIB asks integrators to send a descriptive User-Agent (name, version,
// a link) so they can tell real clients apart from generic http libraries
function userAgent(): string {
  return `StemKit/${app.getVersion()} (+https://github.com/Juancjc/stemkit-lyrics)`
}

function lyricsPath(videoId: string): string {
  return join(songDir(videoId), 'lyrics.json')
}

function toTrack(raw: Record<string, unknown>): LyricsTrack {
  return {
    id: typeof raw.id === 'number' ? raw.id : 0,
    trackName: typeof raw.trackName === 'string' ? raw.trackName : '',
    artistName: typeof raw.artistName === 'string' ? raw.artistName : '',
    albumName: typeof raw.albumName === 'string' ? raw.albumName : '',
    duration: typeof raw.duration === 'number' ? raw.duration : 0,
    instrumental: !!raw.instrumental,
    plainLyrics: typeof raw.plainLyrics === 'string' ? raw.plainLyrics : null,
    syncedLyrics: typeof raw.syncedLyrics === 'string' ? raw.syncedLyrics : null
  }
}

export function loadLyrics(videoId: string): CachedLyrics | null {
  try {
    const data = JSON.parse(readFileSync(lyricsPath(videoId), 'utf8'))
    return { ...toTrack(data), source: 'lrclib' }
  } catch {
    return null
  }
}

export function saveLyrics(videoId: string, track: LyricsTrack): CachedLyrics {
  const dir = songDir(videoId)
  if (!existsSync(dir)) throw new Error('Unknown song')
  const cached: CachedLyrics = { ...toTrack(track as unknown as Record<string, unknown>), source: 'lrclib' }
  writeFileSync(lyricsPath(videoId), JSON.stringify(cached, null, 2))
  return cached
}

export function clearLyrics(videoId: string): void {
  rmSync(lyricsPath(videoId), { force: true })
}

export async function searchLyrics(query: string): Promise<LyricsTrack[]> {
  const q = query.trim()
  if (!q) return []
  const res = await net.fetch(`${LRCLIB_BASE}/search?q=${encodeURIComponent(q)}`, {
    headers: { 'User-Agent': userAgent() },
    signal: AbortSignal.timeout(15000)
  })
  if (!res.ok) return []
  const data = await res.json()
  if (!Array.isArray(data)) return []
  return data.map((raw) => toTrack(raw as Record<string, unknown>))
}
