import { useTranslate } from '../lib/i18n'
import { useEffect, useRef, useState } from 'react'
import type { LrcLine } from '../lib/lrc'
import { parseLrc, activeLrcIndex } from '../lib/lrc'
import { FALLBACK_PALETTE, extractPalette } from '../lib/palette'
import { karaokeColor, karaokeHighlighted } from '../lib/karaoke-style'
import { useKaraokeCue } from '../lib/karaoke-position'
import { XIcon } from './Icons'
import type { KaraokeStyle, KaraokeTrack, SongBackground } from '../../../shared/types'

interface Props {
  videoId: string
  getPosition: () => number
  onClose: () => void
  karaokeStyle: KaraokeStyle
  karaoke?: KaraokeTrack | null
  showVideo: boolean
}

export function TheaterMode({ videoId, getPosition, onClose, showVideo, karaoke, karaokeStyle }: Props): React.ReactElement {
  const t = useTranslate()
  const [lines, setLines] = useState<LrcLine[]>([])
  const [activeIndex, setActiveIndex] = useState(-1)
  const cue = useKaraokeCue(karaoke, getPosition)
  const singingLine = karaoke?.lines[cue.line]
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const paletteRef = useRef<string[]>(FALLBACK_PALETTE)
  const [background, setBackground] = useState<SongBackground | null>(null)
  const [bgFailed, setBgFailed] = useState(false)

  // Theater Mode fetches and parses its own copy of the cached synced
  // lyrics rather than receiving it from the Lyrics panel, so the two
  // stay independently usable — at the cost of one extra (cheap,
  // already-on-disk) IPC round trip per open
  useEffect(() => {
    let cancelled = false
    setLines([])
    setActiveIndex(-1)
    if (karaoke) return
    window.stemkit.getLyrics(videoId).then((c) => {
      if (cancelled || !c?.syncedLyrics) return
      setLines(parseLrc(c.syncedLyrics))
    })
    return () => {
      cancelled = true
    }
  }, [videoId, karaoke])

  useEffect(() => {
    paletteRef.current = FALLBACK_PALETTE
    let cancelled = false
    window.stemkit.getThumb(videoId).then((thumb) => {
      if (cancelled || !thumb) return
      void extractPalette(videoId, thumb).then((colors) => {
        if (!cancelled) paletteRef.current = colors
      })
    })
    return () => {
      cancelled = true
    }
  }, [videoId])

  useEffect(() => {
    let cancelled = false
    setBackground(null)
    setBgFailed(false)
    window.stemkit.getBackground(videoId).then((bg) => {
      if (!cancelled) setBackground(bg)
    })
    return () => {
      cancelled = true
    }
  }, [videoId])

  const pickBg = async (): Promise<void> => {
    const picked = await window.stemkit.pickBackground(videoId)
    if (picked) {
      setBackground(picked)
      setBgFailed(false)
    }
  }

  const clearBg = async (): Promise<void> => {
    await window.stemkit.clearBackground(videoId)
    setBackground(null)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
    const canvas = canvasRef.current
    if (!canvas) return
    let raf = 0
    const draw = (time: number): void => {
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      const dpr = window.devicePixelRatio || 1
      if (w > 0 && (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr))) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      const ctx = canvas.getContext('2d')
      if (ctx && w > 0 && h > 0) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.fillStyle = '#0b0b10'
        ctx.fillRect(0, 0, w, h)
        const t = time / 1000
        const colors = paletteRef.current
        colors.forEach((color, i) => {
          const angle = t * 0.15 + (i * (Math.PI * 2)) / colors.length
          const cx = w / 2 + Math.cos(angle) * w * 0.3
          const cy = h / 2 + Math.sin(angle * 1.3) * h * 0.3
          const radius = Math.max(w, h) * 0.5
          const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
          grad.addColorStop(0, `${color}aa`)
          grad.addColorStop(1, `${color}00`)
          ctx.fillStyle = grad
          ctx.fillRect(0, 0, w, h)
        })
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [showVideo])

  const text = activeIndex >= 0 ? (lines[activeIndex]?.text ?? '') : ''

  return (
    <div className="fixed inset-0 z-[60]">
      {background && !bgFailed ? (
        background.kind === 'video' ? (
          <video
            key={background.path}
            src={`file://${background.path}`}
            className="absolute inset-0 w-full h-full object-cover"
            autoPlay
            muted
            loop
            onError={() => setBgFailed(true)}
          />
        ) : (
          <img
            key={background.path}
            src={`file://${background.path}`}
            className="absolute inset-0 w-full h-full object-cover"
            onError={() => setBgFailed(true)}
          />
        )
      ) : (
        !showVideo && <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      )}
      <div className="absolute inset-0 bg-black/30" />
      <div className="absolute inset-0 flex items-center justify-center px-16">
        <p
          style={karaoke && karaokeStyle.karaokeTextSize === 'large' ? { fontSize: '4rem' } : undefined}
          key={karaoke ? cue.line : activeIndex}
          className="theater-line text-center text-white text-5xl font-bold leading-tight drop-shadow-[0_2px_24px_rgba(0,0,0,0.6)]"
        >
          {karaoke ? singingLine?.words.map((word, i) => (
            <span key={i} style={karaokeHighlighted(i, cue.word, karaokeStyle.karaokeHighlightMode) ? { color: karaokeColor(karaokeStyle.karaokeHighlight) } : undefined}>
              {i > 0 && ' '}{word.text}
            </span>
          )) : text}
        </p>
      </div>
      <div className="no-drag absolute bottom-6 left-6 flex items-center gap-2 opacity-0 hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <button
          onClick={() => void pickBg()}
          className="rounded-full bg-black/40 hover:bg-black/60 text-white/70 hover:text-white text-[11px] font-medium px-3 py-1.5 transition-colors"
        >
          {t(background ? 'Change background' : 'Set background')}
        </button>
        {background && (
          <button
            onClick={() => void clearBg()}
            className="rounded-full bg-black/40 hover:bg-black/60 text-white/70 hover:text-white text-[11px] font-medium px-3 py-1.5 transition-colors"
          >
            {t('Reset')}
          </button>
        )}
      </div>
      <button
        onClick={onClose}
        title={t('Close Theater Mode')}
        className="no-drag absolute top-6 right-6 w-10 h-10 rounded-full bg-black/40 hover:bg-black/60 text-white/70 hover:text-white flex items-center justify-center transition-colors"
      >
        <XIcon className="w-5 h-5" />
      </button>
    </div>
  )
}
