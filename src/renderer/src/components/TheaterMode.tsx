import { useEffect, useRef, useState } from 'react'
import type { LrcLine } from '../lib/lrc'
import { parseLrc, activeLrcIndex } from '../lib/lrc'
import { FALLBACK_PALETTE } from '../lib/palette'
import { XIcon } from './Icons'

interface Props {
  videoId: string
  getPosition: () => number
  onClose: () => void
}

export function TheaterMode({ videoId, getPosition, onClose }: Props): React.ReactElement {
  const [lines, setLines] = useState<LrcLine[]>([])
  const [activeIndex, setActiveIndex] = useState(-1)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const paletteRef = useRef<string[]>(FALLBACK_PALETTE)

  // Theater Mode fetches and parses its own copy of the cached synced
  // lyrics rather than receiving it from the Lyrics panel, so the two
  // stay independently usable — at the cost of one extra (cheap,
  // already-on-disk) IPC round trip per open
  useEffect(() => {
    let cancelled = false
    setLines([])
    setActiveIndex(-1)
    window.stemkit.getLyrics(videoId).then((c) => {
      if (cancelled || !c?.syncedLyrics) return
      setLines(parseLrc(c.syncedLyrics))
    })
    return () => {
      cancelled = true
    }
  }, [videoId])

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
  }, [])

  const text = activeIndex >= 0 ? (lines[activeIndex]?.text ?? '') : ''

  return (
    <div className="fixed inset-0 z-[60] bg-black">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      <div className="absolute inset-0 flex items-center justify-center px-16">
        <p
          key={activeIndex}
          className="theater-line text-center text-white text-5xl font-bold leading-tight drop-shadow-[0_2px_24px_rgba(0,0,0,0.6)]"
        >
          {text}
        </p>
      </div>
      <button
        onClick={onClose}
        title="Close Theater Mode"
        className="no-drag absolute top-6 right-6 w-10 h-10 rounded-full bg-black/40 hover:bg-black/60 text-white/70 hover:text-white flex items-center justify-center transition-colors"
      >
        <XIcon className="w-5 h-5" />
      </button>
    </div>
  )
}
