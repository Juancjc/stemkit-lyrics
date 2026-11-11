export interface NineRouterConfig {
  baseUrl: string
  apiKey: string
  model: string
  timeoutMs: number
}

export type NineRouterConfigResult =
  | { status: 'disabled' }
  | { status: 'misconfigured'; reason: string }
  | { status: 'ok'; config: NineRouterConfig }

const DEFAULT_MODEL = 'default'
const DEFAULT_TIMEOUT_SECONDS = 120

export function resolveNineRouterConfig(env: NodeJS.ProcessEnv): NineRouterConfigResult {
  if (env.NINE_ROUTER_ENABLED?.trim().toLowerCase() !== 'true') return { status: 'disabled' }

  const baseUrl = env.NINE_ROUTER_BASE_URL?.trim()
  if (!baseUrl) return { status: 'misconfigured', reason: 'NINE_ROUTER_BASE_URL is missing' }

  const apiKey = env.NINE_ROUTER_API_KEY?.trim()
  if (!apiKey) return { status: 'misconfigured', reason: 'NINE_ROUTER_API_KEY is missing' }

  const model = env.NINE_ROUTER_MODEL?.trim() || DEFAULT_MODEL

  const timeoutSeconds = Number(env.NINE_ROUTER_TIMEOUT)
  const timeoutMs =
    Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
      ? timeoutSeconds * 1000
      : DEFAULT_TIMEOUT_SECONDS * 1000

  return { status: 'ok', config: { baseUrl, apiKey, model, timeoutMs } }
}

export type AiGatewayErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'bad_request'
  | 'unavailable'
  | 'timeout'
  | 'network'
  | 'unknown'

export function classifyHttpStatus(status: number): AiGatewayErrorKind {
  if (status === 401) return 'auth'
  if (status === 429) return 'rate_limit'
  if (status === 400) return 'bad_request'
  if (status === 500 || status === 502 || status === 503 || status === 504) return 'unavailable'
  return 'unknown'
}

export function friendlyMessage(kind: AiGatewayErrorKind, status?: number): string {
  switch (kind) {
    case 'auth':
      return '9Router rejected the API key (401) — check NINE_ROUTER_API_KEY.'
    case 'rate_limit':
      return '9Router rate-limited this request (429) — wait and retry later.'
    case 'bad_request':
      return '9Router rejected the request (400) — check the model/message payload.'
    case 'unavailable':
      return `9Router or the upstream provider is unavailable (${status ?? 'unknown status'}) — try again later.`
    case 'timeout':
      return '9Router did not respond within NINE_ROUTER_TIMEOUT seconds.'
    case 'network':
      return 'Could not reach 9Router — check NINE_ROUTER_BASE_URL and network connectivity.'
    default:
      return status
        ? `Unexpected response from 9Router (status ${status}).`
        : 'Unexpected response from 9Router.'
  }
}

export class AiGatewayError extends Error {
  kind: AiGatewayErrorKind
  status?: number
  cause?: unknown

  constructor(kind: AiGatewayErrorKind, message: string, status?: number, cause?: unknown) {
    super(message)
    this.name = 'AiGatewayError'
    this.kind = kind
    this.status = status
    this.cause = cause
  }
}
