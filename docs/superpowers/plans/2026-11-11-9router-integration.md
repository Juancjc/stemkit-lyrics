# 9Router Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable main-process service layer that lets StemKit talk to the user's self-hosted 9Router AI gateway, with no consuming UI feature yet.

**Architecture:** A small chain of main-process-only modules — a dependency-free `.env` parser, a 9Router HTTP client with typed/classified errors, and a thin facade (`getAiGateway()`) that is the only thing a future feature would import. Nothing in `preload`/`shared/types`/the renderer changes.

**Tech Stack:** TypeScript (Node's native type-stripping, no transpile step), `node:test` for unit and integration tests, Node's built-in global `fetch`/`AbortSignal` (not Electron's `net` module, so the client runs identically inside Electron and in a plain `node` script).

## Global Constraints

- No new npm dependencies (no `dotenv`) — config loading is a small hand-written parser.
- Main-process only. Do not touch `src/preload/index.ts`, `src/shared/types.ts`, or any file under `src/renderer/`.
- No automatic retries anywhere in the client — a single attempt per call; 9Router's panel owns fallback.
- Always send `"model": "default"` unless `NINE_ROUTER_MODEL` overrides it — never hardcode or reorder the underlying model list.
- Code style: match existing `src/main/*.ts` files exactly — no semicolons, single quotes, explicit function return types, relative imports without extensions in source files (but **with** explicit `.ts` extensions in test files, since `node:test` resolves raw TypeScript via Node's native loader — see `src/main/background.test.ts` for the existing pattern).
- `tsconfig.node.json` has `"noUnusedLocals": true` — no dead imports/vars.
- After each task, run `npm run typecheck:node` in addition to the task's own test command.

---

### Task 1: `.env` parsing (`env-file.ts`)

**Files:**
- Create: `src/main/env-file.ts`
- Create: `src/main/env-file.test.ts`
- Modify: `package.json:14`

**Interfaces:**
- Produces: `parseEnvFile(content: string): Record<string, string>`, `loadDotEnvFile(path: string): Record<string, string>`, `applyEnvFile(target: NodeJS.ProcessEnv, parsed: Record<string, string>): void` — all exported from `src/main/env-file.ts`, consumed by Task 4.

- [ ] **Step 1: Write the failing tests**

Create `src/main/env-file.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --experimental-strip-types src/main/env-file.test.ts`
Expected: FAIL — `Cannot find module './env-file.ts'` (or similar resolution error), since `env-file.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/main/env-file.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test --experimental-strip-types src/main/env-file.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Wire the new test file into `npm test`**

In `package.json`, change line 14 from:

```json
    "test": "node --test --experimental-strip-types src/main/data-dir.test.ts src/main/background.test.ts src/renderer/src/lib/palette.test.ts",
```

to:

```json
    "test": "node --test --experimental-strip-types src/main/data-dir.test.ts src/main/background.test.ts src/renderer/src/lib/palette.test.ts src/main/env-file.test.ts",
```

Run: `npm test`
Expected: PASS (all existing tests plus the 5 new ones)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck:node`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/main/env-file.ts src/main/env-file.test.ts package.json
git commit -m "feat: add a dependency-free .env file parser"
```

---

### Task 2: 9Router config resolution and error classification (`nine-router.ts`)

**Files:**
- Create: `src/main/nine-router.ts`
- Create: `src/main/nine-router.test.ts`
- Modify: `package.json` (the `test` script, as updated by Task 1)

**Interfaces:**
- Consumes: nothing from Task 1 directly (this task is independent config/error logic).
- Produces (from `src/main/nine-router.ts`, consumed by Tasks 3 and 4): `interface NineRouterConfig { baseUrl: string; apiKey: string; model: string; timeoutMs: number }`, `type NineRouterConfigResult = { status: 'disabled' } | { status: 'misconfigured'; reason: string } | { status: 'ok'; config: NineRouterConfig }`, `resolveNineRouterConfig(env: NodeJS.ProcessEnv): NineRouterConfigResult`, `type AiGatewayErrorKind = 'auth' | 'rate_limit' | 'bad_request' | 'unavailable' | 'timeout' | 'network' | 'unknown'`, `classifyHttpStatus(status: number): AiGatewayErrorKind`, `friendlyMessage(kind: AiGatewayErrorKind, status?: number): string`, `class AiGatewayError extends Error { kind: AiGatewayErrorKind; status?: number; cause?: unknown }`.

- [ ] **Step 1: Write the failing tests**

Create `src/main/nine-router.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --experimental-strip-types src/main/nine-router.test.ts`
Expected: FAIL — `./nine-router.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/main/nine-router.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test --experimental-strip-types src/main/nine-router.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Wire the new test file into `npm test`**

In `package.json`, change the `test` script from:

```json
    "test": "node --test --experimental-strip-types src/main/data-dir.test.ts src/main/background.test.ts src/renderer/src/lib/palette.test.ts src/main/env-file.test.ts",
```

to:

```json
    "test": "node --test --experimental-strip-types src/main/data-dir.test.ts src/main/background.test.ts src/renderer/src/lib/palette.test.ts src/main/env-file.test.ts src/main/nine-router.test.ts",
```

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck:node`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/main/nine-router.ts src/main/nine-router.test.ts package.json
git commit -m "feat: add 9Router config resolution and HTTP error classification"
```

---

### Task 3: 9Router HTTP client (`sendChatCompletion`)

**Files:**
- Modify: `src/main/nine-router.ts`
- Create: `src/main/nine-router-client.test.ts`
- Modify: `package.json` (the `test` script, as updated by Task 2)

**Interfaces:**
- Consumes: `NineRouterConfig`, `AiGatewayError`, `classifyHttpStatus`, `friendlyMessage` from Task 2 (same file).
- Produces: `interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }`, `sendChatCompletion(config: NineRouterConfig, messages: ChatMessage[]): Promise<{ content: string; raw: unknown }>` — both exported from `src/main/nine-router.ts`, consumed by Task 4 and the integration test in Task 6.

This task's test spins up a local `http` server (no real network, no credentials needed) to deterministically exercise success, every error classification, a timeout, and a malformed body.

- [ ] **Step 1: Write the failing tests**

Create `src/main/nine-router-client.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type RequestListener } from 'node:http'
import { sendChatCompletion, AiGatewayError, type NineRouterConfig } from './nine-router.ts'

function startServer(handler: RequestListener): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r()))
      })
    })
  })
}

function testConfig(baseUrl: string, overrides: Partial<NineRouterConfig> = {}): NineRouterConfig {
  return { baseUrl, apiKey: 'test-key', model: 'default', timeoutMs: 2000, ...overrides }
}

test('sendChatCompletion returns the message content on a 200 response', async () => {
  const { url, close } = await startServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      assert.equal(req.headers['x-api-key'], 'test-key')
      assert.equal(JSON.parse(body).model, 'default')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: 'hello back' } }] }))
    })
  })
  try {
    const result = await sendChatCompletion(testConfig(url), [{ role: 'user', content: 'hi' }])
    assert.equal(result.content, 'hello back')
  } finally {
    await close()
  }
})

test('sendChatCompletion classifies a 401 as an auth AiGatewayError', async () => {
  const { url, close } = await startServer((_req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'invalid key' }))
  })
  try {
    await assert.rejects(
      sendChatCompletion(testConfig(url), [{ role: 'user', content: 'hi' }]),
      (err: unknown) => err instanceof AiGatewayError && err.kind === 'auth'
    )
  } finally {
    await close()
  }
})

test('sendChatCompletion classifies a 429 as a rate_limit AiGatewayError', async () => {
  const { url, close } = await startServer((_req, res) => {
    res.writeHead(429, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'slow down' }))
  })
  try {
    await assert.rejects(
      sendChatCompletion(testConfig(url), [{ role: 'user', content: 'hi' }]),
      (err: unknown) => err instanceof AiGatewayError && err.kind === 'rate_limit'
    )
  } finally {
    await close()
  }
})

test('sendChatCompletion classifies a 503 as an unavailable AiGatewayError', async () => {
  const { url, close } = await startServer((_req, res) => {
    res.writeHead(503, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'down for maintenance' }))
  })
  try {
    await assert.rejects(
      sendChatCompletion(testConfig(url), [{ role: 'user', content: 'hi' }]),
      (err: unknown) => err instanceof AiGatewayError && err.kind === 'unavailable'
    )
  } finally {
    await close()
  }
})

test('sendChatCompletion raises a timeout error when the server is too slow', async () => {
  const { url, close } = await startServer((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: 'too late' } }] }))
    }, 500)
  })
  try {
    await assert.rejects(
      sendChatCompletion(testConfig(url, { timeoutMs: 50 }), [{ role: 'user', content: 'hi' }]),
      (err: unknown) => err instanceof AiGatewayError && err.kind === 'timeout'
    )
  } finally {
    await close()
  }
})

test('sendChatCompletion raises an unknown error on a malformed success body', async () => {
  const { url, close } = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ nope: true }))
  })
  try {
    await assert.rejects(
      sendChatCompletion(testConfig(url), [{ role: 'user', content: 'hi' }]),
      (err: unknown) => err instanceof AiGatewayError && err.kind === 'unknown'
    )
  } finally {
    await close()
  }
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --experimental-strip-types src/main/nine-router-client.test.ts`
Expected: FAIL — `sendChatCompletion` is not exported from `./nine-router.ts` yet.

- [ ] **Step 3: Write the implementation**

Append to `src/main/nine-router.ts` (after the `AiGatewayError` class):

```ts
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export async function sendChatCompletion(
  config: NineRouterConfig,
  messages: ChatMessage[]
): Promise<{ content: string; raw: unknown }> {
  let res: Response
  try {
    res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'x-api-key': config.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.model, messages, stream: false }),
      signal: AbortSignal.timeout(config.timeoutMs)
    })
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new AiGatewayError('timeout', friendlyMessage('timeout'), undefined, err)
    }
    throw new AiGatewayError('network', friendlyMessage('network'), undefined, err)
  }

  const raw: unknown = await res.json().catch(() => null)

  if (!res.ok) {
    const kind = classifyHttpStatus(res.status)
    throw new AiGatewayError(kind, friendlyMessage(kind, res.status), res.status, raw)
  }

  const content = (raw as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message
    ?.content
  if (typeof content !== 'string') {
    throw new AiGatewayError('unknown', friendlyMessage('unknown', res.status), res.status, raw)
  }

  return { content, raw }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test --experimental-strip-types src/main/nine-router-client.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Wire the new test file into `npm test`**

In `package.json`, change the `test` script from:

```json
    "test": "node --test --experimental-strip-types src/main/data-dir.test.ts src/main/background.test.ts src/renderer/src/lib/palette.test.ts src/main/env-file.test.ts src/main/nine-router.test.ts",
```

to:

```json
    "test": "node --test --experimental-strip-types src/main/data-dir.test.ts src/main/background.test.ts src/renderer/src/lib/palette.test.ts src/main/env-file.test.ts src/main/nine-router.test.ts src/main/nine-router-client.test.ts",
```

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck:node`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/main/nine-router.ts src/main/nine-router-client.test.ts package.json
git commit -m "feat: add the 9Router chat completions HTTP client"
```

---

### Task 4: Gateway facade (`ai-gateway.ts`)

**Files:**
- Create: `src/main/ai-gateway.ts`

**Interfaces:**
- Consumes: `resolveNineRouterConfig`, `sendChatCompletion`, `type ChatMessage` from `src/main/nine-router.ts` (Tasks 2/3); `loadDotEnvFile`, `applyEnvFile` from `src/main/env-file.ts` (Task 1).
- Produces: `interface AiGateway { sendChat(messages: ChatMessage[]): Promise<string> }`, `getAiGateway(): AiGateway | null` — the only export any future feature should import.

This is thin orchestration (loads `.env`, resolves config, picks an implementation) with no branching logic of its own to unit test — per the approved design, it's verified manually instead.

- [ ] **Step 1: Write the implementation**

Create `src/main/ai-gateway.ts`:

```ts
import { join } from 'path'
import { loadDotEnvFile, applyEnvFile } from './env-file'
import { resolveNineRouterConfig, sendChatCompletion, type ChatMessage } from './nine-router'

export interface AiGateway {
  sendChat(messages: ChatMessage[]): Promise<string>
}

let cached: AiGateway | null | undefined

function createGateway(): AiGateway | null {
  applyEnvFile(process.env, loadDotEnvFile(join(process.cwd(), '.env')))
  const result = resolveNineRouterConfig(process.env)
  if (result.status !== 'ok') return null
  const config = result.config
  return {
    sendChat: async (messages) => (await sendChatCompletion(config, messages)).content
  }
}

export function getAiGateway(): AiGateway | null {
  if (cached === undefined) cached = createGateway()
  return cached
}
```

- [ ] **Step 2: Manually verify the disabled path**

Run:

```bash
node --experimental-strip-types -e "process.env.NINE_ROUTER_ENABLED = 'false'; import('./src/main/ai-gateway.ts').then(({ getAiGateway }) => console.log('result:', getAiGateway()))"
```

Expected output: `result: null`

- [ ] **Step 3: Manually verify the enabled path**

Run (fake base URL — this only checks that `getAiGateway()` returns a non-null object when configured, not that a real network call succeeds):

```bash
node --experimental-strip-types -e "process.env.NINE_ROUTER_ENABLED = 'true'; process.env.NINE_ROUTER_BASE_URL = 'https://example.invalid/v1'; process.env.NINE_ROUTER_API_KEY = 'x'; import('./src/main/ai-gateway.ts').then(({ getAiGateway }) => console.log('result:', typeof getAiGateway()?.sendChat))"
```

Expected output: `result: function`

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck:node`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/main/ai-gateway.ts
git commit -m "feat: add getAiGateway() facade over the 9Router client"
```

---

### Task 5: `.env.example`

**Files:**
- Create: `.env.example`

- [ ] **Step 1: Write the file**

Create `.env.example` at the repo root:

```dotenv
# 9Router - Gateway de IA
# Enables/disables the 9Router integration entirely (ai-gateway.ts
# returns null when this isn't exactly "true")
NINE_ROUTER_ENABLED=true

# Base URL of your 9Router instance, including its API version path
NINE_ROUTER_BASE_URL=https://9router.example.com/v1

# API key generated in the 9Router panel — never commit a real value here
NINE_ROUTER_API_KEY=

# Model combo configured in the 9Router panel (fallback order lives there,
# not in this project) — leave as "default" unless you created another combo
NINE_ROUTER_MODEL=default

# Request timeout in seconds
NINE_ROUTER_TIMEOUT=120
```

- [ ] **Step 2: Verify it's not ignored by git (it must be committed, unlike `.env`)**

Run: `git check-ignore -v .env.example`
Expected: no output (not ignored) — if this prints a match, stop and check `.gitignore` before continuing.

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "docs: add .env.example for the 9Router integration"
```

---

### Task 6: Integration test (`tests/nine-router.test.mjs`)

**Files:**
- Create: `tests/nine-router.test.mjs`
- Modify: `package.json` (add a new `test:9router` script)

**Interfaces:**
- Consumes: `loadDotEnvFile`, `applyEnvFile` from `src/main/env-file.ts`; `resolveNineRouterConfig`, `sendChatCompletion` from `src/main/nine-router.ts`.

- [ ] **Step 1: Write the test**

Create `tests/nine-router.test.mjs`:

```js
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
```

- [ ] **Step 2: Run it without a configured `.env` and confirm it skips cleanly**

Run: `node --test --experimental-strip-types tests/nine-router.test.mjs`
Expected: the single test reports as skipped (no `.env` present yet in the repo), overall run passes with 0 failures.

- [ ] **Step 3: Add the `test:9router` npm script**

In `package.json`, change:

```json
    "test:audio": "node scripts/run.cjs test:audio",
```

to:

```json
    "test:audio": "node scripts/run.cjs test:audio",
    "test:9router": "node --test --experimental-strip-types tests/nine-router.test.mjs",
```

- [ ] **Step 4: Run the new script**

Run: `npm run test:9router`
Expected: same skip behavior as Step 2 (no `.env` yet) — confirms the script wiring works.

- [ ] **Step 5: Commit**

```bash
git add tests/nine-router.test.mjs package.json
git commit -m "test: add a runnable 9Router integration check"
```

---

### Task 7: Documentation (`docs/9router.md`)

**Files:**
- Create: `docs/9router.md`

- [ ] **Step 1: Write the file**

Create `docs/9router.md`:

```markdown
# 9Router integration

StemKit can talk to [9Router](https://9router.juancjc.com.br), an
OpenAI-compatible AI gateway, through a small main-process service layer
(`src/main/nine-router.ts`, `src/main/ai-gateway.ts`). As of this writing
nothing in the app's UI calls it yet — this is infrastructure for a future
feature, verifiable on its own via the test described below.

## Environment variables

Copy `.env.example` to `.env` in the repo root and fill in the values:

| Variable | Purpose |
|---|---|
| `NINE_ROUTER_ENABLED` | Must be exactly `true` to enable the integration; any other value (including unset) disables it — `getAiGateway()` returns `null`. |
| `NINE_ROUTER_BASE_URL` | Base URL of your 9Router instance, including the API version path (e.g. `https://9router.example.com/v1`). |
| `NINE_ROUTER_API_KEY` | The API key generated in the 9Router panel. Never commit a real value, log it, or send it to the renderer. |
| `NINE_ROUTER_MODEL` | The model combo to request — leave as `default` unless you created another combo in the panel. |
| `NINE_ROUTER_TIMEOUT` | Request timeout in seconds (default `120` if unset or invalid). |

`.env` is already in `.gitignore`.

## Generating an API key

1. Open your 9Router panel (the URL you access it at, e.g.
   `https://9router.example.com`).
2. Go to the API keys section and create a new key.
3. Paste it into `NINE_ROUTER_API_KEY` in your local `.env`. Keys are
   shown once — if you lose it, generate a new one and revoke the old.

## Configuring the `default` combo

The `default` combo is a model list with a **Fallback** strategy
configured entirely in the 9Router panel — this project never selects a
model itself; every request sends `"model": "default"` and lets 9Router
try the next model in the combo's list when one fails (unavailable,
rate-limited, etc). To change which models are tried or their order, edit
the combo in the panel — no code change needed here. Don't assume the
gateway pre-checks token balance or reserves a fallback model until quota
renews; a model can still fail mid-chain.

## Testing the integration

With `.env` configured:

```bash
npm run test:9router
```

This sends `"Responda apenas: Integração com 9Router funcionando!"` to the
`default` model and prints the response. If `NINE_ROUTER_ENABLED` isn't
`true` or required variables are missing, the test reports itself as
skipped with the specific reason instead of failing.

## Common errors

| Error | Meaning | What to do |
|---|---|---|
| `9Router rejected the API key (401)` | `NINE_ROUTER_API_KEY` is wrong, revoked, or missing. | Generate a new key in the panel and update `.env`. |
| `9Router rate-limited this request (429)` | Too many requests against your key/quota. | Wait and retry; consider raising limits in the panel. |
| `9Router rejected the request (400)` | Malformed request or an invalid model name was sent. | Check the message payload; confirm the combo name matches `NINE_ROUTER_MODEL`. |
| `9Router or the upstream provider is unavailable (5xx)` | The gateway or every model in the fallback chain failed. | Retry later; check the combo's model list in the panel. |
| `9Router did not respond within NINE_ROUTER_TIMEOUT seconds` | The request took longer than the configured timeout. | Raise `NINE_ROUTER_TIMEOUT`, or check 9Router/VPS health. |
| `Could not reach 9Router` | DNS/connection failure reaching `NINE_ROUTER_BASE_URL`. | Check the URL, your network, and that the VPS/service is up. |
| `Unexpected response from 9Router` | The response didn't include `choices[0].message.content`. | Check the 9Router/provider response shape hasn't changed. |
```

- [ ] **Step 2: Commit**

```bash
git add docs/9router.md
git commit -m "docs: document the 9Router integration setup and troubleshooting"
```
