import { useEffect, useState } from 'react'
import type { KaraokeStyle, KaraokeTrack } from '../../../shared/types'
import { useKaraokeCue } from '../lib/karaoke-position'
import { karaokeColor, karaokeHighlighted } from '../lib/karaoke-style'
import { useTranslate } from '../lib/i18n'
import { fmtTime } from '../lib/format'
import { DownloadIcon, MicIcon } from './Icons'

type Line = KaraokeTrack['lines'][number]

interface Props {
  videoId: string
  getPosition: () => number
  onSing: (track: KaraokeTrack) => void
  onDownload: (track: KaraokeTrack, instrumental: boolean) => Promise<void>
  onChooseLyrics: () => void
  style: KaraokeStyle
  ready: boolean
}

const button = 'no-drag inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-white'
const secondary = button + ' bg-white/10 text-white hover:bg-white/15'
const field = 'no-drag min-w-0 rounded-md bg-black/30 px-2 py-1.5 text-sm text-white ring-1 ring-white/15 focus:ring-violet-400'

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (?:[\w.]*Error: )?/, '')
}

function translatedError(message: string, t: ReturnType<typeof useTranslate>): string {
  const line = /^Line (\d+) (.+)$/.exec(message)
  if (line) return t('Line {n} ' + line[2], { n: line[1] })
  const status = /\((?:status )?(\d+)\)/.exec(message)
  if (status && (message.startsWith('Unexpected response from 9Router') || message.startsWith('9Router or the upstream provider'))) {
    return t(message.replace(status[1], '{status}'), { status: status[1] })
  }
  return t(message)
}

function KaraokePreview({ track, getPosition, style }: Pick<Props, 'getPosition' | 'style'> & { track: KaraokeTrack }): React.ReactElement {
  const t = useTranslate()
  const cue = useKaraokeCue(track, getPosition)

  return (
    <div aria-label={t('Karaoke preview')} className="grid min-h-28 place-items-center rounded-xl bg-black/40 px-5 py-6">
      <p className={`text-center font-bold leading-snug text-white ${style.karaokeTextSize === 'large' ? 'text-5xl' : 'text-3xl'}`}>
        {track.lines[cue.line]?.words.map((word, i) => (
          <span key={i} style={karaokeHighlighted(i, cue.word, style.karaokeHighlightMode) ? { color: karaokeColor(style.karaokeHighlight) } : undefined}>{word.text}{' '}</span>
        ))}
      </p>
    </div>
  )
}

function LineEditor({ line, index, busy, onSave, onCancel }: {
  line: Line
  index: number
  busy: boolean
  onSave: (line: Line) => void
  onCancel: () => void
}): React.ReactElement {
  const t = useTranslate()
  return (
    <form className="space-y-3 rounded-xl bg-black/20 p-4" onSubmit={event => {
      event.preventDefault()
      const values = new FormData(event.currentTarget)
      const starts = values.getAll('word-start')
      onSave({
        start: Number(values.get('start')),
        end: Number(values.get('end')),
        words: values.getAll('word').map((value, i) => ({ text: String(value).trim(), start: Number(starts[i]) }))
      })
    }}>
      <fieldset disabled={busy} className="space-y-3">
        <legend className="font-semibold">{t('Edit line {n}', { n: index + 1 })}</legend>
        <div className="flex flex-wrap gap-4 text-xs text-white/75">
          <label className="grid gap-1">{t('Line start (s)')}
            <input required name="start" type="number" min="0" step="any" defaultValue={line.start} className={field} />
          </label>
          <label className="grid gap-1">{t('Line end (s)')}
            <input required name="end" type="number" min="0" step="any" defaultValue={line.end} className={field} />
          </label>
        </div>
        <div className="grid max-h-64 grid-cols-[7rem_minmax(0,1fr)] gap-2 overflow-y-auto p-1">
          <span className="text-xs text-white/65">{t('Word start (s)')}</span>
          <span className="text-xs text-white/65">{t('Word')}</span>
          {line.words.map((word, i) => (
            <div key={i} className="contents">
              <input required aria-label={t('Start of word {n}', { n: i + 1 })} name="word-start" type="number" min="0" step="any" defaultValue={word.start} className={field} />
              <input required pattern={String.raw`\S+`} title={t('One word per timing')} aria-label={t('Word {n}', { n: i + 1 })} name="word" defaultValue={word.text} className={field} />
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <button type="submit" className={button + ' bg-white text-black'}>{t(busy ? 'Saving…' : 'Save changes')}</button>
          <button type="button" onClick={onCancel} className={secondary}>{t('Cancel')}</button>
        </div>
      </fieldset>
    </form>
  )
}

export function Karaoke({ videoId, getPosition, onSing, onDownload, onChooseLyrics, ready, style }: Props): React.ReactElement {
  const t = useTranslate()
  const [track, setTrack] = useState<KaraokeTrack | null>(null)
  const [busy, setBusy] = useState<'loading' | 'preparing' | 'saving' | 'exporting' | null>('loading')
  const [instrumental, setInstrumental] = useState(true)
  const [editing, setEditing] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let current = true
    window.stemkit.getKaraoke(videoId)
      .then(saved => { if (current) setTrack(saved) })
      .catch(err => { if (current) setError(errorMessage(err)) })
      .finally(() => { if (current) setBusy(null) })
    return () => { current = false }
  }, [videoId])

  async function prepare(): Promise<void> {
    setBusy('preparing')
    setError('')
    try {
      setTrack(await window.stemkit.prepareKaraoke(videoId))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  async function saveLine(line: Line): Promise<void> {
    if (!track || editing === null) return
    setBusy('saving')
    setError('')
    try {
      const lines = [...track.lines]
      lines[editing] = line
      setTrack(await window.stemkit.saveKaraoke(videoId, { ...track, lines }))
      setEditing(null)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  async function download(): Promise<void> {
    if (!track) return
    setBusy('exporting')
    setError('')
    try {
      await onDownload(track, instrumental)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-label={t('Karaoke')} className="glass space-y-4 rounded-2xl p-5">
      <h3 className="text-lg font-semibold">{t('Karaoke')}</h3>
      {busy === 'loading' ? <p role="status" className="text-sm text-white/70">{t('Loading saved karaoke…')}</p> : track ? (
        <>
          <KaraokePreview track={track} getPosition={getPosition} style={style} />
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={!ready || !!busy || editing !== null} onClick={() => onSing(track)} className={button + ' bg-yellow-300 text-black hover:bg-yellow-200'}>
              <MicIcon className="h-4 w-4" /> {t('Time to sing')}
            </button>
            <label className="flex items-center gap-2 text-sm text-white/70">
              {t('Export audio')}
              <select value={instrumental ? 'instrumental' : 'mix'} disabled={!!busy}
                onChange={event => setInstrumental(event.target.value === 'instrumental')} className={field}>
                <option value="instrumental">{t('Instrumental')}</option>
                <option value="mix">{t('Current mix')}</option>
              </select>
            </label>
            <button disabled={!ready || !!busy || editing !== null} onClick={() => void download()} className={secondary}>
              <DownloadIcon className="h-4 w-4" /> {t(busy === 'exporting' ? 'Exporting…' : "Let's download karaoke")}
            </button>
          </div>
          <p className="text-sm text-white/65">{t('Time to sing mutes the vocal track. Adjust the mixer below to choose what goes into your karaoke video.')}</p>
          <details className="rounded-lg border border-white/10 p-3">
            <summary className="no-drag cursor-pointer text-sm font-medium">{t('Lyrics and timing')} · {t(track.lines.length === 1 ? '{n} line' : '{n} lines', { n: track.lines.length })}</summary>
            <ol className="mt-3 max-h-56 space-y-1 overflow-y-auto">
              {track.lines.map((line, i) => (
                <li key={i}>
                  <button disabled={!!busy || editing !== null} onClick={() => { setEditing(i); setError('') }}
                    aria-label={t('Edit line {n}', { n: i + 1 }) + ': ' + line.words.map(word => word.text).join(' ')}
                    className="no-drag flex w-full items-baseline gap-3 rounded-md px-2 py-1 text-left text-sm hover:bg-white/10">
                    <span className="shrink-0 font-mono text-xs text-white/55">{fmtTime(line.start)}</span>
                    <span className={editing === i ? 'text-violet-300' : 'text-white/85'}>{line.words.map(word => word.text).join(' ')}</span>
                  </button>
                </li>
              ))}
            </ol>
          </details>
          {editing !== null && (
            <LineEditor key={editing} index={editing} line={track.lines[editing]} busy={busy === 'saving'}
              onSave={line => void saveLine(line)} onCancel={() => { setEditing(null); setError('') }} />
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-white/70">{t('Prepare word timings once with 9Router. Your karaoke lyrics and edits are saved with this song.')}</p>
          <div className="flex flex-wrap gap-2">
            <button disabled={!!busy} onClick={() => void prepare()} className={button + ' bg-violet-200 text-violet-950 hover:bg-violet-100'}>
              {t(busy === 'preparing' ? 'Preparing karaoke…' : 'Prepare karaoke')}
            </button>
            <button disabled={!!busy} onClick={onChooseLyrics} className={secondary}>{t('Choose lyrics')}</button>
          </div>
        </>
      )}
      {error && <p role="alert" className="break-words text-sm text-rose-200">{translatedError(error, t)}</p>}
    </section>
  )
}
