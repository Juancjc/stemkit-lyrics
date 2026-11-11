---
name: run-desktop
description: Build, launch, and drive StemKit's Electron desktop app for an agent that cannot see a window. Use when asked to start the app, take a screenshot of it, or verify a UI change works end to end.
---

StemKit is an Electron app (electron-vite). For agent/automated use, drive
it through the Playwright REPL at `driver.cjs` in this folder — it launches
the real built app and exposes click/type/screenshot commands over stdin.

All paths below are relative to the repo root.

## Prerequisites

Windows and macOS: none — these have a real display and Electron runs
natively. Headless Linux (CI containers) needs a virtual display and the
Chromium shared libs:

```bash
apt-get install -y xvfb libnss3 libgbm1 libasound2t64 libgtk-3-0 \
  libxss1 libxkbcommon0 libatk-bridge2.0-0 libcups2 libdrm2
```

## Build

The driver launches the **built** app, not `npm run dev` — `electron-vite
dev` is a foreground dev-server + Electron combo that's awkward to control
headlessly. Build once (ffmpeg is not needed for this, unlike `npm run dev`
or `dist`):

```bash
node scripts/run.cjs build
```

Rebuild after any renderer/main/preload change before relaunching.

## Run (agent path)

```bash
node .claude/skills/run-desktop/driver.cjs
```

On headless Linux: `xvfb-run -a node .claude/skills/run-desktop/driver.cjs`

Wrap in tmux for interactive use:

```bash
tmux new-session -d -s app -x 200 -y 50
tmux send-keys -t app 'node .claude/skills/run-desktop/driver.cjs' Enter
timeout 20 bash -c 'until tmux capture-pane -t app -p | grep -q "driver>"; do sleep 0.2; done'
tmux send-keys -t app 'launch' Enter
timeout 30 bash -c 'until tmux capture-pane -t app -p | grep -q "launched"; do sleep 0.2; done'
tmux send-keys -t app 'ss landing' Enter
tmux capture-pane -t app -p
```

Screenshots land in `%TEMP%/stemkit-shots` (Windows) or `/tmp/stemkit-shots`
(macOS/Linux) — override with `SCREENSHOT_DIR`.

### Commands

| command | what it does |
|---|---|
| `launch` | launch the built app, wait for the window |
| `ss [name]` | screenshot → `<SCREENSHOT_DIR>/<name>.png` |
| `click <css-sel>` | click element (DOM `.click()`, not coordinates) |
| `click-text <text>` | click the button/link whose text matches |
| `type <text>` / `press <key>` | keyboard input |
| `wait <css-sel>` | wait for an element, 10s timeout |
| `eval <js>` | evaluate expression in the page, print JSON |
| `text [css-sel]` | print `innerText` (body if no selector) |
| `windows` | list open windows |
| `open-song <title substring>` | click a library entry in the sidebar by title |
| `toggle-lyrics` | click the "Lyrics" header button in the Player |
| `toggle-theater` | click the "Open Theater Mode" button in the Lyrics panel (needs `toggle-lyrics` first, and cached synced lyrics) |
| `toggle-play` | click the round transport play/pause button |
| `quit` | close the app, exit the driver |

## Run (human path)

```bash
npm run dev   # opens a real window; Ctrl-C to quit
```

## Gotchas

- **`npm run dev` isn't used by the driver.** The app's main process checks
  `!app.isPackaged && process.env.ELECTRON_RENDERER_URL` to decide between
  loading a dev server or starting its own local static server over
  `out/renderer`. Launching the built `out/main/index.js` directly (no env
  var) takes the static-server path — no separate Vite dev server needed.
- **The library already has songs on a machine that's used the app** — the
  fastest way to reach the Player is `open-song <title>` rather than
  running a real split (which needs yt-dlp + the Python engines + ffmpeg).
- **The Transport play/pause button has no `aria-label` or `title`.** Match
  it by its class pair (`rounded-full` + `bg-white`) — see `toggle-play`.
- **`app.close()` shuts the app down cleanly.** StemKit's
  `window-all-closed` handler calls `app.quit()`, so no Electron process is
  left running after `quit` — verified by checking `electron.exe` process
  list after a driver session.
- **Lyrics panel selectors** (from building the lyrics-search feature):
  search input is `input[placeholder*="Track title"]`, its results list is
  the `div` with class `max-h-60`, and the synced-lyrics line list is the
  `div` with class `max-h-72` (each line a direct child `div`; the active
  line carries `font-semibold`).
- **Theater Mode's close button has no exact-text match** — it's matched by
  `title` (`"Open Theater Mode"` / `"Close Theater Mode"`), same approach as
  `toggle-play`, since it's an icon-only button.

## Troubleshooting

- **`out/main/index.js is missing`:** run `node scripts/run.cjs build` first.
- **Launch timeout (30s):** rebuild — a stale `out/` from before a main-
  process change can crash on startup.
- **"Missing X server" (Linux):** forgot `xvfb-run`.
- **Stale Xvfb locks (Linux):** `rm -f /tmp/.X*-lock; pkill Xvfb`
