import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { dialog } from 'electron'
import { songDir } from './library'
import { inferKind, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from './background-kind'
import type { SongBackground } from '../shared/types'

function backgroundPath(videoId: string): string {
  return join(songDir(videoId), 'background.json')
}

export function loadBackground(videoId: string): SongBackground | null {
  try {
    const data = JSON.parse(readFileSync(backgroundPath(videoId), 'utf8')) as SongBackground
    // a transient missing file (unmounted drive, temporarily renamed) should
    // fall back to the gradient for this session without losing the saved
    // reference — so this returns null here but never deletes background.json
    if (typeof data.path !== 'string' || !existsSync(data.path)) return null
    return data
  } catch {
    return null
  }
}

export async function pickBackground(videoId: string): Promise<SongBackground | null> {
  const dir = songDir(videoId)
  if (!existsSync(dir)) throw new Error('Unknown song')
  const result = await dialog.showOpenDialog({
    title: 'Choose a Theater Mode background',
    buttonLabel: 'Use as background',
    properties: ['openFile'],
    filters: [
      { name: 'Images', extensions: IMAGE_EXTENSIONS },
      { name: 'Videos', extensions: VIDEO_EXTENSIONS }
    ]
  })
  if (result.canceled || !result.filePaths[0]) return null
  const picked: SongBackground = { kind: inferKind(result.filePaths[0]), path: result.filePaths[0] }
  writeFileSync(backgroundPath(videoId), JSON.stringify(picked, null, 2))
  return picked
}

export function clearBackground(videoId: string): void {
  rmSync(backgroundPath(videoId), { force: true })
}
