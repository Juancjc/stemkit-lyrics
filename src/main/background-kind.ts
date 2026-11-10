import { extname } from 'path'
import type { BackgroundKind } from '../shared/types'

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif']
export const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov']

// pure: picks 'image' vs 'video' from a file's extension, defaulting to
// 'image' for anything unrecognized — the open-file dialog's filters
// already keep the user from picking something outside this list
export function inferKind(path: string): BackgroundKind {
  const ext = extname(path).slice(1).toLowerCase()
  return VIDEO_EXTENSIONS.includes(ext) ? 'video' : 'image'
}
