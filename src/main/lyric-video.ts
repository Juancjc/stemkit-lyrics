import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdtemp, rename, rm, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import type { KaraokeMix, LyricFrame, Song, SongBackground, StemId } from '../shared/types'
import { isLocalId } from '../shared/local'
import { venvYtDlp, ytDlpRuntimeArgs } from './env'
import { mixWavPath, stemsDir, stemsFor } from './library'

const run = promisify(execFile)

function audioInputs(song: Song, mix?: KaraokeMix) {
  if (!mix) return { inputs: ['-i', mixWavPath(song.videoId)], filters: [], map: '1:a:0' }

  const inputs: string[] = []
  const filters: string[] = []
  const streams: string[] = []
  if (!Number.isFinite(mix.master) || mix.master < 0 || mix.master > 1) {
    throw new Error('Invalid master volume.')
  }
  for (const name of stemsFor(song)) {
    if (!['vocals', 'drums', 'bass', 'other', 'piano', 'guitar'].includes(name)) {
      throw new Error('Unknown audio stem.')
    }
    const id = name as StemId
    const gain = mix.gains[id] ?? 0
    const pan = mix.pans[id] ?? 0
    if (!Number.isFinite(gain) || gain < 0 || gain > 1 || !Number.isFinite(pan) || Math.abs(pan) > 1) {
      throw new Error('Invalid stem volume or pan.')
    }
    // Match the stereo equal-power algorithm used by Web Audio's StereoPannerNode.
    const angle = (pan <= 0 ? pan + 1 : pan) * Math.PI / 2
    const cos = Math.cos(angle).toFixed(8)
    const sin = Math.sin(angle).toFixed(8)
    const stereo = pan <= 0 ? `c0=c0+${cos}*c1|c1=${sin}*c1` : `c0=${cos}*c0|c1=c1+${sin}*c0`
    const stream = `[stem${streams.length}]`
    inputs.push('-i', join(stemsDir(song.videoId), name + '.wav'))
    filters.push(`[${streams.length + 1}:a:0]aformat=sample_fmts=fltp:channel_layouts=stereo,pan=stereo|${stereo},volume=${gain}${stream}`)
    streams.push(stream)
  }
  filters.push(`${streams.join('')}amix=inputs=${streams.length}:duration=longest:normalize=0,volume=${mix.master}[audio]`)
  return { inputs, filters, map: '[audio]' }
}

export async function exportLyricVideo(song: Song, frames: LyricFrame[], background: SongBackground | null,
  ffmpeg: string, destination: string, mix?: KaraokeMix): Promise<void> {
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
    const audio = audioInputs(song, mix)
    const captionInput = 1 + audio.inputs.length / 2
    const videoFilter = `[0:v:0]fps=25,scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1,tpad=stop_mode=clone:stop=-1[bg];[bg][${captionInput}:v]overlay=0:(H-h)/2:repeatlast=1[v]`
    const filter = [videoFilter, ...audio.filters].join(';')
    await run(ffmpeg, ['-nostdin', '-loglevel', 'error', ...visual, ...audio.inputs,
      '-f', 'concat', '-i', 'lyrics.txt', '-filter_complex', filter, '-map', '[v]', '-map', audio.map,
      '-c:v', 'mpeg4', '-q:v', '3', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k',
      '-shortest', '-movflags', '+faststart', 'output.mp4'], options)
    await rename(join(cwd, 'output.mp4'), destination)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}
