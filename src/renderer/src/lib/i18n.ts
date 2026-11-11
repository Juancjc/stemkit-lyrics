import { createContext, useContext } from 'react'
import type { AppSettings } from '../../../shared/types'
import { ptBR } from './pt-BR'
import { karaokePt } from './karaoke-pt'

export const LanguageContext = createContext<AppSettings['language']>('en')

type Values = Record<string, string | number>
export type Translate = (source: string, values?: Values) => string

const portuguese = { ...ptBR, ...karaokePt }
const translate = (catalog: Record<string, string>): Translate => (source, values) => {
  const template = Object.hasOwn(catalog, source) ? catalog[source] : source
  return values ? template.replace(/\{(\w+)\}/g, (token, key) => String(values[key] ?? token)) : template
}
const translations = { en: translate({}), 'pt-BR': translate(portuguese) }

export function useTranslate(): Translate {
  return translations[useContext(LanguageContext)]
}
