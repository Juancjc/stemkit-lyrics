import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdtemp, rename, rm, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import type { LyricFrame, Song, SongBackground } from '../shared/types'
import { isLocalId } from '../shared/local'
import { venvYtDlp, ytDlpRuntimeArgs } from './env'
import { mixWavPath } from './library'

const run = promisify(execFile)

export async function exportLyricVideo(song: Song, frames: LyricFrame[], background: SongBackground | null,
  ffmpeg: string, destination: string): Promise<void> {
  if (!frames.length || frames[0].time !== 0 || frames.some((frame, i) =>
    !Number.isFinite(frame.time) || (i > 0 && frame.time <= frames[i - 1].time))) {
    throw new Error('Choose synchronized lyrics to export a video.')
  }
  // Keep the unfinished movie on the destination volume for an atomic rename.
  const cwd = await mkdtemp(join(dirname(destination), '.stemkit-'))
  const options = { cwd, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
  try {
    let visual: string[]
    if (background) {
      visual = [...(background.kind === 'image' ? ['-loop', '1'] : ['-stream_loop', '-1']), '-i', background.path]
    } else if (song.source === 'local' || isLocalId(song.videoId)) {
      visual = ['-f', 'lavfi', '-i', 'color=c=0x211b35:s=1280x720:r=25']
    } else {
      await run(venvYtDlp(), [...ytDlpRuntimeArgs(), '--quiet', '--no-playlist', '-f',
        'bestvideo[height<=720]/best[height<=720]/best', '-o', 'source.video',
        'https://www.youtube.com/watch?v=' + song.videoId], options)
      visual = ['-i', 'source.video']
    }

    const manifest: string[] = []
    for (const [i, frame] of frames.entries()) {
      const filename = 'line-' + i + '.png'
      await writeFile(join(cwd, filename), frame.png)
      manifest.push('file ' + filename)
      if (i + 1 < frames.length) manifest.push('duration ' + (frames[i + 1].time - frame.time).toFixed(6))
    }
    await writeFile(join(cwd, 'lyrics.txt'), manifest.join('\n') + '\n')
    const filter = '[0:v:0]fps=25,scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1,tpad=stop_mode=clone:stop=-1[bg];[bg][2:v]overlay=0:(H-h)/2:repeatlast=1[v]'
    await run(ffmpeg, ['-nostdin', '-loglevel', 'error', ...visual, '-i', mixWavPath(song.videoId),
      '-f', 'concat', '-i', 'lyrics.txt', '-filter_complex', filter, '-map', '[v]', '-map', '1:a:0',
      '-c:v', 'mpeg4', '-q:v', '3', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k',
      '-shortest', '-movflags', '+faststart', 'output.mp4'], options)
    await rename(join(cwd, 'output.mp4'), destination)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}
