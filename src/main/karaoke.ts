import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { KaraokeActivity, KaraokeTrack } from '../shared/types'
import { parseLrc } from '../renderer/src/lib/lrc'
import timingSkill from '../../.agents/skills/karaoke-timing/SKILL.md?raw'
import { getAiGateway } from './ai-gateway'
import { getStatus } from './env'
import { loadSongs, songDir, stemsDir } from './library'
import { loadLyrics } from './lyrics'
import { decodeTiming, karaokeAnchors, timingInput, validateKaraoke } from './karaoke-timing'

function source(videoId: string) {
  const song = loadSongs().find(s => s.videoId === videoId)
  if (!song || !/^[\w-]+$/.test(videoId)) throw new Error('Unknown song.')
  const lyrics = loadLyrics(videoId)?.syncedLyrics?.trim()
  if (!lyrics) return null
  const duration = song.duration
  if (!(duration > 0 && Number.isFinite(duration))) throw new Error('Song duration is unavailable.')
  const sourceHash = createHash('sha256').update(JSON.stringify([duration, lyrics])).digest('hex')
  return { duration, lyrics, sourceHash, path: join(songDir(videoId), 'karaoke.json') }
}

type Source = NonNullable<ReturnType<typeof source>>

function readCache(src: Source): KaraokeTrack | null {
  let content: string
  try {
    content = readFileSync(src.path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  try {
    const cache = JSON.parse(content)
    if (cache.version !== 1 || cache.track?.sourceHash !== src.sourceHash) return null
    validateKaraoke(cache.track, src.duration)
    return cache.track
  } catch {
    return null
  }
}

function writeCache(src: Source, track: KaraokeTrack): KaraokeTrack {
  validateKaraoke(track, src.duration)
  const result = { sourceHash: src.sourceHash, lines: track.lines }
  const tmp = src.path + '.' + randomUUID() + '.tmp'
  try {
    writeFileSync(tmp, JSON.stringify({ version: 1, track: result }), { flag: 'wx' })
    renameSync(tmp, src.path)
  } finally {
    rmSync(tmp, { force: true })
  }
  return result
}

export function getKaraoke(videoId: string): KaraokeTrack | null {
  const src = source(videoId)
  return src ? readCache(src) : null
}

export function saveKaraoke(videoId: string, track: KaraokeTrack): KaraokeTrack {
  const src = source(videoId)
  if (!src || track?.sourceHash !== src.sourceHash) {
    throw new Error('The selected lyrics changed. Reopen karaoke before saving.')
  }
  return writeCache(src, track)
}

const run = promisify(execFile)

// The model receives quiet intervals rather than the voice recording itself.
async function vocalSilences(videoId: string, duration: number): Promise<number[][]> {
  const path = join(stemsDir(videoId), 'vocals.wav')
  const ffmpeg = getStatus().ffmpeg.path
  if (!ffmpeg || !existsSync(path)) return []
  const { stderr } = await run(ffmpeg, ['-nostdin', '-hide_banner', '-nostats', '-i', path,
    '-af', 'silencedetect=noise=-40dB:d=0.12', '-f', 'null', '-'],
  { windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
  const quiet: number[][] = []
  let start: number | undefined
  for (const match of stderr.matchAll(/silence_(start|end):\s*([\d.e+-]+)/gi)) {
    const time = Number(match[2])
    if (!Number.isFinite(time)) continue
    if (match[1] === 'start') start = time
    else if (start !== undefined) {
      quiet.push([start, time])
      start = undefined
    }
  }
  if (start !== undefined) quiet.push([start, duration])
  return quiet
}

type Report = (activity: KaraokeActivity) => void
const pending = new Map<string, { result: Promise<KaraokeTrack>; history: KaraokeActivity[]; listeners: Set<Report> }>()

async function generate(videoId: string, src: Source, report: Report): Promise<KaraokeTrack> {
  const gateway = getAiGateway()
  if (!gateway) throw new Error('Enable and configure 9Router to prepare karaoke.')
  const anchors = karaokeAnchors(parseLrc(src.lyrics), src.duration)
  report({ phase: 'analyzing' })
  const inputs = timingInput(anchors, src.duration, await vocalSilences(videoId, src.duration))
  const lines: KaraokeTrack['lines'] = []
  for (let i = 0; i < inputs.length; i += 16) {
    const batch = inputs.slice(i, i + 16)
    const position = { batch: i / 16 + 1, total: Math.ceil(inputs.length / 16) }
    const text = JSON.stringify(batch)
    report({ phase: 'request', ...position, text })
    const reply = await gateway.sendChat([
      { role: 'system', content: timingSkill },
      { role: 'user', content: text }
    ])
    report({ phase: 'response', ...position, text: reply })
    lines.push(...decodeTiming(reply, batch, anchors))
  }
  if (source(videoId)?.sourceHash !== src.sourceHash) {
    throw new Error('The selected lyrics changed while preparing karaoke. Try again.')
  }
  return readCache(src) ?? writeCache(src, { lines })
}

export async function prepareKaraoke(videoId: string, report: Report): Promise<KaraokeTrack> {
  const src = source(videoId)
  if (!src) throw new Error('Choose synchronized lyrics for this song first.')
  const cached = readCache(src)
  if (cached) {
    report({ phase: 'cached' })
    return cached
  }
  const key = videoId + ':' + src.sourceHash
  const active = pending.get(key)
  if (active) {
    active.history.forEach(report)
    active.listeners.add(report)
    return active.result
  }
  const history: KaraokeActivity[] = []
  const listeners = new Set([report])
  const generation = generate(videoId, src, activity => {
    history.push(activity)
    for (const listener of listeners) listener(activity)
  }).finally(() => pending.delete(key))
  pending.set(key, { result: generation, history, listeners })
  return generation
}
