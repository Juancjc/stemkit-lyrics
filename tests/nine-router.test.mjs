import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { loadDotEnvFile, applyEnvFile } from '../src/main/env-file.ts'
import { resolveNineRouterConfig, sendChatCompletion } from '../src/main/nine-router.ts'

applyEnvFile(process.env, loadDotEnvFile(join(process.cwd(), '.env')))
const config = resolveNineRouterConfig(process.env)

test('9Router integration: sends a fixed message through the "default" model', async (t) => {
  if (config.status === 'disabled') {
    t.skip('NINE_ROUTER_ENABLED is not "true" — set it in .env to run this test')
    return
  }
  if (config.status === 'misconfigured') {
    t.skip(`9Router is misconfigured: ${config.reason}`)
    return
  }

  try {
    const result = await sendChatCompletion(config.config, [
      { role: 'user', content: 'Responda apenas: Integração com 9Router funcionando!' }
    ])
    console.log('9Router responded:', result.content)
    assert.ok(result.content.trim().length > 0)
  } catch (err) {
    console.error('9Router integration failed:', err instanceof Error ? err.message : err)
    throw err
  }
})
