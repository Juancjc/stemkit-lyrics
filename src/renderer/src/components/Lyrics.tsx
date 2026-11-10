import { useEffect, useMemo, useRef, useState } from 'react'
import type { CachedLyrics, LyricsTrack } from '../../../shared/types'
import { parseLrc, activeLrcIndex } from '../lib/lrc'
import { fmtTime } from '../lib/format'
import { ExpandIcon } from './Icons'

interface Props {
  videoId: string
  title: string
  getPosition: () => number
  onSeek: (seconds: number) => void
  onOpenTheater: () => void
}

type Status = 'loading' | 'found' | 'not-found' | 'error'

export function Lyrics({ videoId, title, getPosition, onSeek, onOpenTheater }: Props): React.ReactElement {
  const [status, setStatus] = useState<Status>('loading')
  const [cached, setCached] = useState<CachedLyrics | null>(null)
  const [query, setQuery] = useState(title)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [results, setResults] = useState<LyricsTrack[]>([])
  const [activeIndex, setActiveIndex] = useState(-1)
  const listRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<Array<HTMLDivElement | null>>([])

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setCached(null)
    setResults([])
    setSearchError(null)
    setQuery(title)
    window.stemkit
      .getLyrics(videoId)
      .then((c) => {
        if (cancelled) return
        setCached(c)
        setStatus(c ? 'found' : 'not-found')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [videoId, title])

  const lines = useMemo(
    () => (cached?.syncedLyrics ? parseLrc(cached.syncedLyrics) : []),
    [cached]
  )

  useEffect(() => {
    if (lines.length === 0) return
    let raf = 0
    const tick = (): void => {
      const idx = activeLrcIndex(lines, getPosition())
      setActiveIndex((prev) => (prev === idx ? prev : idx))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [lines, getPosition])

  useEffect(() => {
    lineRefs.current[activeIndex]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeIndex])

  const runSearch = async (): Promise<void> => {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setSearchError(null)
    try {
      const res = await window.stemkit.searchLyrics(q)
      setResults(res)
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : String(err))
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  const pick = async (track: LyricsTrack): Promise<void> => {
    try {
      const saved = await window.stemkit.setLyrics(videoId, track)
      setCached(saved)
      setStatus('found')
      setResults([])
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : String(err))
    }
  }

  const forget = async (): Promise<void> => {
    await window.stemkit.clearLyrics(videoId)
    setCached(null)
    setStatus('not-found')
  }

  return (
    <div className="glass rounded-2xl px-5 py-4 rise-in">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-white/30">
          Lyrics
        </span>
        <span className="flex items-center gap-2">
          {status === 'found' && lines.length > 0 && (
            <button
              onClick={onOpenTheater}
              title="Open Theater Mode"
              className="no-drag w-6 h-6 rounded-md hover:bg-white/10 text-white/40 hover:text-white flex items-center justify-center transition-colors"
            >
              <ExpandIcon className="w-3.5 h-3.5" />
            </button>
          )}
          {status === 'found' && (
            <button
              onClick={() => void forget()}
              className="no-drag text-[11px] text-white/35 hover:text-white/70 transition-colors"
            >
              Search again
            </button>
          )}
        </span>
      </div>

      {status === 'loading' && (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="glass rounded-lg h-5 animate-pulse"
              style={{ animationDelay: `${i * 120}ms` }}
            />
          ))}
        </div>
      )}

      {status === 'error' && (
        <p className="text-[13px] text-rose-200">Could not load lyrics.</p>
      )}

      {status === 'found' && cached && (
        <>
          {cached.instrumental ? (
            <p className="text-[13px] text-white/40 italic">Instrumental track</p>
          ) : lines.length > 0 ? (
            <div ref={listRef} className="max-h-72 overflow-y-auto space-y-1.5 pr-1">
              {lines.map((line, i) => (
                <div
                  key={i}
                  ref={(el) => {
                    lineRefs.current[i] = el
                  }}
                  onClick={() => onSeek(line.time)}
                  className={`no-drag cursor-pointer rounded-md px-2 py-1 text-[14px] transition-colors ${
                    i === activeIndex
                      ? 'text-white font-semibold bg-white/[0.06]'
                      : 'text-white/40 hover:text-white/70'
                  }`}
                >
                  {line.text}
                </div>
              ))}
            </div>
          ) : cached.plainLyrics ? (
            <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap text-[13px] text-white/60 font-sans leading-relaxed">
              {cached.plainLyrics}
            </pre>
          ) : (
            <p className="text-[13px] text-white/40">No lyrics text available for this match.</p>
          )}
        </>
      )}

      {status === 'not-found' && (
        <div>
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void runSearch()}
              placeholder="Track title, or title and artist…"
              spellCheck={false}
              className="no-drag flex-1 glass rounded-lg px-3 py-2 text-[13px] outline-none placeholder:text-white/25 focus:ring-2 focus:ring-violet-400/60 transition-shadow"
            />
            <button
              onClick={() => void runSearch()}
              disabled={searching || !query.trim()}
              className="no-drag px-4 rounded-lg bg-white text-black text-[13px] font-semibold hover:bg-white/90 transition-colors disabled:opacity-40"
            >
              {searching ? '…' : 'Search'}
            </button>
          </div>

          {searchError && (
            <p className="mt-2 text-[12px] text-rose-200">Search failed: {searchError}</p>
          )}

          {!searching && results.length > 0 && (
            <div className="mt-3 space-y-1 max-h-60 overflow-y-auto">
              {results.map((r) => (
                <button
                  key={r.id}
                  onClick={() => void pick(r)}
                  className="no-drag w-full flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.06] transition-colors"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] truncate text-white/85">{r.trackName}</span>
                    <span className="block text-[11px] text-white/35 truncate">
                      {r.artistName}
                      {r.albumName ? ` · ${r.albumName}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] font-mono text-white/30">
                    {r.duration ? fmtTime(r.duration) : ''}
                  </span>
                </button>
              ))}
            </div>
          )}

          {!searching && results.length === 0 && !searchError && (
            <p className="mt-2 text-[12px] text-white/30">
              No lyrics cached for this song yet — search to find a match.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
