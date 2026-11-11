import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveNineRouterConfig, classifyHttpStatus, friendlyMessage } from './nine-router.ts'

test('resolveNineRouterConfig: disabled when NINE_ROUTER_ENABLED is not "true"', () => {
  assert.deepEqual(resolveNineRouterConfig({}), { status: 'disabled' })
  assert.deepEqual(resolveNineRouterConfig({ NINE_ROUTER_ENABLED: 'false' }), { status: 'disabled' })
})

test('resolveNineRouterConfig: misconfigured when base URL is missing', () => {
  const result = resolveNineRouterConfig({ NINE_ROUTER_ENABLED: 'true', NINE_ROUTER_API_KEY: 'key' })
  assert.deepEqual(result, { status: 'misconfigured', reason: 'NINE_ROUTER_BASE_URL is missing' })
})

test('resolveNineRouterConfig: misconfigured when API key is missing', () => {
  const result = resolveNineRouterConfig({
    NINE_ROUTER_ENABLED: 'true',
    NINE_ROUTER_BASE_URL: 'https://example.com/v1'
  })
  assert.deepEqual(result, { status: 'misconfigured', reason: 'NINE_ROUTER_API_KEY is missing' })
})

test('resolveNineRouterConfig: ok with defaults for model and timeout', () => {
  const result = resolveNineRouterConfig({
    NINE_ROUTER_ENABLED: 'true',
    NINE_ROUTER_BASE_URL: 'https://example.com/v1',
    NINE_ROUTER_API_KEY: 'key'
  })
  assert.deepEqual(result, {
    status: 'ok',
    config: { baseUrl: 'https://example.com/v1', apiKey: 'key', model: 'default', timeoutMs: 120_000 }
  })
})

test('resolveNineRouterConfig: ok with explicit model and timeout', () => {
  const result = resolveNineRouterConfig({
    NINE_ROUTER_ENABLED: 'true',
    NINE_ROUTER_BASE_URL: 'https://example.com/v1',
    NINE_ROUTER_API_KEY: 'key',
    NINE_ROUTER_MODEL: 'custom',
    NINE_ROUTER_TIMEOUT: '30'
  })
  assert.deepEqual(result, {
    status: 'ok',
    config: { baseUrl: 'https://example.com/v1', apiKey: 'key', model: 'custom', timeoutMs: 30_000 }
  })
})

test('resolveNineRouterConfig: falls back to the default timeout when NINE_ROUTER_TIMEOUT is invalid', () => {
  const result = resolveNineRouterConfig({
    NINE_ROUTER_ENABLED: 'true',
    NINE_ROUTER_BASE_URL: 'https://example.com/v1',
    NINE_ROUTER_API_KEY: 'key',
    NINE_ROUTER_TIMEOUT: 'not-a-number'
  })
  assert.equal(result.status, 'ok')
  assert.equal(result.status === 'ok' && result.config.timeoutMs, 120_000)
})

test('classifyHttpStatus maps known codes', () => {
  assert.equal(classifyHttpStatus(401), 'auth')
  assert.equal(classifyHttpStatus(429), 'rate_limit')
  assert.equal(classifyHttpStatus(400), 'bad_request')
  assert.equal(classifyHttpStatus(500), 'unavailable')
  assert.equal(classifyHttpStatus(502), 'unavailable')
  assert.equal(classifyHttpStatus(503), 'unavailable')
  assert.equal(classifyHttpStatus(504), 'unavailable')
})

test('classifyHttpStatus falls back to unknown for unmapped codes', () => {
  assert.equal(classifyHttpStatus(418), 'unknown')
})

test('friendlyMessage returns a distinct sentence per kind', () => {
  const kinds = ['auth', 'rate_limit', 'bad_request', 'unavailable', 'timeout', 'network', 'unknown'] as const
  const messages = kinds.map((k) => friendlyMessage(k, 500))
  assert.equal(new Set(messages).size, kinds.length)
})
