import { readFileSync } from 'fs'

export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    if (!key) continue
    let value = line.slice(eq + 1).trim()
    const isQuoted =
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    if (isQuoted) value = value.slice(1, -1)
    result[key] = value
  }
  return result
}

export function loadDotEnvFile(path: string): Record<string, string> {
  try {
    return parseEnvFile(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }
}

export function applyEnvFile(target: NodeJS.ProcessEnv, parsed: Record<string, string>): void {
  for (const [key, value] of Object.entries(parsed)) {
    if (target[key] === undefined) target[key] = value
  }
}
