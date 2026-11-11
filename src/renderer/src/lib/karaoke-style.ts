import type { KaraokeStyle } from '../../../shared/types'

const colors = { yellow: '#ffdf36', cyan: '#67e8f9', pink: '#f9a8d4' }

export function karaokeColor(highlight: KaraokeStyle['karaokeHighlight']): string {
  return colors[highlight] ?? colors.yellow
}

export function karaokeHighlighted(index: number, active: number, mode: KaraokeStyle['karaokeHighlightMode']): boolean {
  return active >= 0 && (mode === 'progressive' ? index <= active : index === active)
}
