# 9Router integration: reusable AI gateway service layer

## Context

StemKit is presented as a fully local app — the README states "no accounts,
no API keys... your songs, searches and audio never leave your machine" as
a core promise. This spec adds the *infrastructure* to talk to 9Router (an
AI gateway the user runs on their own Oracle Cloud VPS, exposing an
OpenAI-compatible `chat/completions` endpoint across a fallback chain of
models), without yet wiring it into any user-facing feature. No screen,
button, or IPC channel changes as part of this work — this is purely a
main-process service layer a future feature can call.

## Goals

- A reusable main-process service that centralizes all HTTP communication
  with 9Router: config loading, request/response shaping, error
  classification. No other part of the app makes HTTP calls to 9Router
  directly.
- Config sourced from a project-root `.env` file (gitignored already),
  matching the variables the user specified: `NINE_ROUTER_ENABLED`,
  `NINE_ROUTER_BASE_URL`, `NINE_ROUTER_API_KEY`, `NINE_ROUTER_MODEL`,
  `NINE_ROUTER_TIMEOUT`.
- Always send `model: "default"` — the fallback order across
  `ag/claude-opus-5-5-medium` → `gh/claude-opus-5` →
  `oc/deepseek-v4.1-flash-free` → NVIDIA DeepSeek models lives entirely in
  the 9Router panel. The project never special-cases or reorders models.
- Typed, classified error handling (auth / rate limit / bad request /
  gateway unavailable / timeout / network) with no automatic retries — a
  single attempt per call, trusting 9Router's own fallback.
- A way to manually verify the integration works end-to-end (a runnable
  test that sends a fixed message and reports success/failure in plain
  language).
- Documented so a future contributor can configure and test this without
  reading the implementation.

## Non-goals

- No UI, IPC channel, or preload surface. Nothing in the renderer changes.
- No streaming support yet — only a single non-streaming
  `sendChatCompletion`. Streaming is a small, additive extension of the
  same client (another request parameter, an async generator over the
  SSE body) to build once a feature actually needs token-by-token output.
- No manual model rotation/retry logic — 9Router's panel fallback is the
  only fallback mechanism.
- No persistence of chat history, conversation state, or usage/balance
  tracking. The service is stateless per call.
- No settings-UI way to enter the API key. `.env` is the only config
  source for now; moving the key into `settings.json` (like
  `background.ts`/`lyrics.ts` do for their own config) is a natural
  follow-up once a real feature and its Settings UI exist.

## Architecture

### New main-process files

- **`src/main/env-file.ts`**
  - `parseEnvFile(content: string): Record<string, string>` — pure.
    Handles `KEY=VALUE` lines, `#`-comments, blank lines, and
    single/double-quoted values (quotes stripped). Unit-tested directly.
  - `loadDotEnvFile(path: string): Record<string, string>` — reads the
    file via `fs.readFileSync`; returns `{}` on any error (missing file,
    permission issue), same resilience pattern as `loadSettings()` /
    `loadBackground()`. Not unit-tested (thin fs wrapper around the pure
    parser).
  - `applyEnvFile(target: NodeJS.ProcessEnv, parsed: Record<string,
    string>): void` — copies keys into `target` only where not already
    set, so real environment variables always win over the `.env` file
    (same precedence convention as the `dotenv` package, without adding
    the dependency).

- **`src/main/nine-router.ts`**
  - `interface NineRouterConfig { baseUrl: string; apiKey: string; model:
    string; timeoutMs: number }`
  - `type NineRouterConfigResult = { status: 'disabled' } | { status:
    'misconfigured'; reason: string } | { status: 'ok'; config:
    NineRouterConfig }`
  - `resolveNineRouterConfig(env: NodeJS.ProcessEnv):
    NineRouterConfigResult` — pure. `'disabled'` when
    `NINE_ROUTER_ENABLED` isn't `'true'`; `'misconfigured'` (with a
    specific `reason` string naming the missing variable) when enabled
    but `NINE_ROUTER_BASE_URL` or `NINE_ROUTER_API_KEY` is empty;
    otherwise `'ok'` with `model` defaulting to `'default'` and
    `timeoutMs` defaulting to `120_000` (from `NINE_ROUTER_TIMEOUT`
    seconds, falling back when absent/non-numeric). Unit-tested for all
    three branches.
  - `type AiGatewayErrorKind = 'auth' | 'rate_limit' | 'bad_request' |
    'unavailable' | 'timeout' | 'network' | 'unknown'`
  - `classifyHttpStatus(status: number): AiGatewayErrorKind` — pure;
    `401→auth`, `429→rate_limit`, `400→bad_request`,
    `500|502|503|504→unavailable`, else `unknown`. Unit-tested.
  - `friendlyMessage(kind: AiGatewayErrorKind, status?: number): string`
    — pure; one human-readable sentence per kind (see Error handling
    below), reused by both the thrown error and the integration test's
    output.
  - `class AiGatewayError extends Error { kind: AiGatewayErrorKind;
    status?: number; cause?: unknown }`
  - `interface ChatMessage { role: 'system' | 'user' | 'assistant';
    content: string }`
  - `sendChatCompletion(config: NineRouterConfig, messages:
    ChatMessage[]): Promise<{ content: string; raw: unknown }>` — POSTs
    to `${config.baseUrl}/chat/completions` with headers `x-api-key:
    config.apiKey` and `Content-Type: application/json`, body `{ model:
    config.model, messages, stream: false }`, using the **global `fetch`**
    (Node's built-in, not Electron's `net` module) with `signal:
    AbortSignal.timeout(config.timeoutMs)`. This keeps the module usable
    both inside the Electron main process and from a plain `node` script
    with no Electron runtime involved — see Testing below. On a thrown
    `TimeoutError`/`AbortError`, raises `AiGatewayError('timeout', ...)`;
    on any other fetch rejection, `AiGatewayError('network', ...)`; on a
    non-OK response, classifies the status and throws with
    `friendlyMessage()`; on an OK response whose body doesn't contain a
    string at `choices[0].message.content`, throws
    `AiGatewayError('unknown', 'Unexpected response shape from 9Router')`.
    Not unit-tested (real HTTP call) — covered by the integration test.

- **`src/main/ai-gateway.ts`**
  - `interface AiGateway { sendChat(messages: ChatMessage[]):
    Promise<string> }`
  - `getAiGateway(): AiGateway | null` — loads `.env` (via
    `loadDotEnvFile` + `applyEnvFile` against `process.env`, path resolved
    relative to `process.cwd()`, i.e. the repo root the app/scripts are
    always run from), resolves config, and returns `null` for
    `'disabled'`/`'misconfigured'` or a small object wrapping
    `sendChatCompletion` bound to the resolved 9Router config otherwise.
    This is the only function anything outside this file should call —
    swapping to a different gateway later means changing what this
    function constructs, not any call site. Result is cached in a
    module-level variable (config doesn't change at runtime without a
    restart, same assumption `settings.ts` makes for the settings file).
    Not unit-tested (thin orchestration, no branching logic of its own).

### No changes to:

- `src/preload/index.ts`, `src/shared/types.ts`, any renderer component,
  `src/main/index.ts` IPC registration. There is nothing to invoke this
  service yet.

## Error handling

| HTTP / failure | `kind` | `friendlyMessage()` |
|---|---|---|
| 401 | `auth` | "9Router rejected the API key (401) — check NINE_ROUTER_API_KEY." |
| 429 | `rate_limit` | "9Router rate-limited this request (429) — wait and retry later." |
| 400 | `bad_request` | "9Router rejected the request (400) — check the model/message payload." |
| 500/502/503/504 | `unavailable` | "9Router or the upstream provider is unavailable (status) — try again later." |
| abort/timeout | `timeout` | "9Router did not respond within NINE_ROUTER_TIMEOUT seconds." |
| fetch rejection (DNS, connection refused, etc.) | `network` | "Could not reach 9Router — check NINE_ROUTER_BASE_URL and network connectivity." |
| anything else / malformed body | `unknown` | "Unexpected response from 9Router." |

No retries anywhere in this module, at any layer — a single attempt per
`sendChatCompletion` call, per the requirement that model fallback stays
centralized in 9Router's own panel.

## Testing

- **Unit** (`node:test`, added to the existing `npm test` script,
  no network, no Electron):
  - `src/main/env-file.test.ts` — `parseEnvFile` against comments, blank
    lines, quoted values.
  - `src/main/nine-router.test.ts` — `resolveNineRouterConfig`'s three
    branches (disabled, misconfigured with each required var missing,
    ok with defaults applied); `classifyHttpStatus` for every mapped
    code plus an unmapped one.
- **Integration** (manual, real network call): `tests/nine-router.test.mjs`
  — a new `npm run test:9router` script. Written with `node:test` so it
  reuses the same runner, but calls `t.skip(reason)` when
  `resolveNineRouterConfig(process.env)` (after loading `.env`) isn't
  `'ok'`, so contributors without a configured `.env` never see a failure
  from this file in plain `npm test`. When configured, it sends `"Responda
  apenas: Integração com 9Router funcionando!"` through `sendChatCompletion`
  with `model: 'default'` and asserts a non-empty string response,
  printing the received content on success or the `friendlyMessage()` on
  failure.

## Documentation

- **`.env.example`** (new, repo root): the 5 variables with one-line
  comments each, matching the table in the request.
- **`docs/9router.md`** (new): variable reference; how to generate an API
  key in the 9Router panel; how the `default` model combo and its
  fallback order are configured there (and that the project never
  overrides that order); how to run `npm run test:9router`; a copy of the
  error-handling table above as "common errors and what they mean".
