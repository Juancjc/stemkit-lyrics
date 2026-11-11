# 9Router integration

StemKit can talk to [9Router](https://9router.juancjc.com.br), an
OpenAI-compatible AI gateway, through a small main-process service layer
(`src/main/nine-router.ts`, `src/main/ai-gateway.ts`). Karaoke studio uses the configured model to estimate word timing for the selected
synchronized lyrics. The original language and the order of the verses and repeated
choruses are preserved. Review the timings against the recording and save any
corrections in the studio. Subsequent playback and karaoke exports use the saved
timeline on disk.

Select **Time to sing** to play with the vocal stem muted. If lead and backing
voices share that stem, both are muted. For a karaoke MP4, choose **Instrumental**
or **Current mix** and use the separate karaoke download button. The latter
includes any vocal level, mute, solo and pan adjustments in the mixer.

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
