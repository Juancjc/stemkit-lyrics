import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseEnvFile, applyEnvFile } from './env-file.ts'

test('parses KEY=VALUE pairs', () => {
  const parsed = parseEnvFile('NINE_ROUTER_ENABLED=true\nNINE_ROUTER_MODEL=default')
  assert.deepEqual(parsed, { NINE_ROUTER_ENABLED: 'true', NINE_ROUTER_MODEL: 'default' })
})

test('skips comments and blank lines', () => {
  const parsed = parseEnvFile('# a comment\n\nNINE_ROUTER_ENABLED=true\n  # indented comment\n')
  assert.deepEqual(parsed, { NINE_ROUTER_ENABLED: 'true' })
})

test('strips matching single or double quotes around the value', () => {
  const parsed = parseEnvFile('A="double"\nB=\'single\'\nC=bare')
  assert.deepEqual(parsed, { A: 'double', B: 'single', C: 'bare' })
})

test('ignores lines with no "=" separator', () => {
  const parsed = parseEnvFile('not-a-valid-line\nNINE_ROUTER_ENABLED=true')
  assert.deepEqual(parsed, { NINE_ROUTER_ENABLED: 'true' })
})

test('applyEnvFile only fills keys missing from the target', () => {
  const target: NodeJS.ProcessEnv = { NINE_ROUTER_MODEL: 'already-set' }
  applyEnvFile(target, { NINE_ROUTER_MODEL: 'from-file', NINE_ROUTER_TIMEOUT: '120' })
  assert.equal(target.NINE_ROUTER_MODEL, 'already-set')
  assert.equal(target.NINE_ROUTER_TIMEOUT, '120')
})
