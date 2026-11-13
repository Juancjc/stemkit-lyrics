import { useTranslate } from '../lib/i18n'

export type BackgroundStyle = 'aurora' | 'equalizer' | 'milkdrop' | 'ferrofluid' | 'stainedGlass' | 'tunnel'

export interface BackgroundStyleProps {
  backgroundStyle: BackgroundStyle
  onBackgroundStyleChange: (style: BackgroundStyle) => void
}

export function BackgroundStyleSelect({ backgroundStyle, onBackgroundStyleChange }: BackgroundStyleProps): React.ReactElement {
  const t = useTranslate()
  return (
    <label className="no-drag inline-flex min-h-10 items-center gap-2 rounded-full bg-zinc-900 px-3 text-sm text-white">
      {t('Background style')}
      <select value={backgroundStyle} onChange={event => onBackgroundStyleChange(event.target.value as BackgroundStyle)}
        className="cursor-pointer rounded-md bg-zinc-800 px-2 py-1">
        <option value="aurora">{t('Aurora')}</option>
        <option value="equalizer">{t('Equalizer bars')}</option>
        <optgroup label="MilkDrop">
          <option value="milkdrop">Spectrum Bubble Field</option>
          <option value="ferrofluid">Ferrofluid</option>
          <option value="stainedGlass">Stained Glass Majesty</option>
          <option value="tunnel">Kevlar Tunnel</option>
        </optgroup>
      </select>
    </label>
  )
}
