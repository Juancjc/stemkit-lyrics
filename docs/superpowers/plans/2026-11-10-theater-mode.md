# Theater Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-window, karaoke-style "Theater Mode" to StemKit's Player — one big synced-lyrics line over a moving background (the song's YouTube video, an animated gradient from the thumbnail's colors, or a per-song custom image/video).

**Architecture:** A new `TheaterMode.tsx` overlay fetches/parses its own copy of the cached synced lyrics (reusing `lib/lrc.ts`) and tracks the active line via `requestAnimationFrame`, same pattern as the existing `Lyrics.tsx` panel. Its background resolves in priority order — custom per-song media (new `background.ts` main-process module, mirroring `lyrics.ts`) → the live YouTube iframe (moved into the overlay via a React portal so it never reloads) → an animated canvas gradient colored from the thumbnail (new `lib/palette.ts`, falling back to a fixed palette).

**Tech Stack:** Electron 33 + React 18 + TypeScript, existing `node:net`/`dialog` IPC patterns, `node:test` for unit tests (no new dependencies).

## Global Constraints

- In-window overlay only — no OS-level Fullscreen API.
- No video-file export in this phase (explicitly deferred).
- A custom background is stored as a path reference only — never copied into the song's data folder.
- Background priority, highest first: custom image/video → YouTube video (when `showVideo` is true for the song) → animated gradient (thumbnail-extracted palette, else a fixed fallback palette).
- Lyrics display is single-current-line only — no previous/next context lines.
- Esc / the close button only changes what's mounted in the overlay — it must never pause playback or touch the YouTube drift-correction logic already in `Player.tsx`.
- Theater Mode's entry point only appears once the song has cached synced lyrics (reuses `window.stemkit.getLyrics`) — nothing to show full-screen otherwise.
- Follow existing patterns exactly: main-process IPC mirrors `src/main/lyrics.ts`; canvas animation mirrors `StemLane.tsx`'s resize-and-redraw-every-rAF pattern; unit tests mirror `src/main/data-dir.test.ts` (`node:test` + `--experimental-strip-types`, explicit `.ts` import extensions in the test file only).

---

### Task 1: Shared types for the custom background

**Files:**
- Modify: `src/shared/types.ts`

**Interfaces:**
- Produces: `BackgroundKind = 'image' | 'video'`, `SongBackground { kind: BackgroundKind; path: string }`, and three new `StemKitApi` methods — `getBackground(videoId): Promise<SongBackground | null>`, `pickBackground(videoId): Promise<SongBackground | null>`, `clearBackground(videoId): Promise<void>`.

- [ ] **Step 1: Add the `SongBackground` type**

In `src/shared/types.ts`, immediately after the `CachedLyrics` interface (ends right before the `UpdateEvent` interface), add:

```ts
export type BackgroundKind = 'image' | 'video'

// a custom per-song background picked by the user, cached to
// songDir(videoId)/background.json
export interface SongBackground {
  kind: BackgroundKind
  path: string
}
```

- [ ] **Step 2: Extend `StemKitApi`**

In the same file, inside the `StemKitApi` interface, right after the line `clearLyrics(videoId: string): Promise<void>`, add:

```ts
  getBackground(videoId: string): Promise<SongBackground | null>
  pickBackground(videoId: string): Promise<SongBackground | null>
  clearBackground(videoId: string): Promise<void>
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck:web`
Expected: exits 0 (the new types compile; nothing references them yet so there's nothing else to break).

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add SongBackground type and StemKitApi surface for Theater Mode"
```

---

### Task 2: Main-process custom background storage + IPC

**Files:**
- Create: `src/main/background.ts`
- Create: `src/main/background.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `package.json` (test script)

**Interfaces:**
- Consumes: `songDir(videoId)` from `src/main/library.ts` (already exported); `SongBackground`, `BackgroundKind` from Task 1.
- Produces: `inferKind(path: string): BackgroundKind`, `loadBackground(videoId: string): SongBackground | null`, `pickBackground(videoId: string): Promise<SongBackground | null>`, `clearBackground(videoId: string): void` — all exported from `src/main/background.ts`. IPC channels `background:get` / `background:pick` / `background:clear`. Preload methods `getBackground` / `pickBackground` / `clearBackground` on `window.stemkit`.

- [ ] **Step 1: Write the failing test for `inferKind`**

Create `src/main/background.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inferKind } from './background.ts'

test('treats common video extensions as video', () => {
  assert.equal(inferKind('C:/clips/sunset.mp4'), 'video')
  assert.equal(inferKind('/home/user/clips/loop.webm'), 'video')
  assert.equal(inferKind('/home/user/clips/loop.MOV'), 'video')
})

test('treats everything else as image', () => {
  assert.equal(inferKind('cover.png'), 'image')
  assert.equal(inferKind('cover.JPG'), 'image')
  assert.equal(inferKind('no-extension'), 'image')
})
```

- [ ] **Step 2: Run it to confirm it fails (module doesn't exist yet)**

Run: `node --test --experimental-strip-types src/main/background.test.ts`
Expected: FAIL — `Cannot find module './background.ts'` (or similar resolve error).

- [ ] **Step 3: Implement `src/main/background.ts`**

```ts
import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { join, extname } from 'path'
import { dialog } from 'electron'
import { songDir } from './library'
import type { SongBackground, BackgroundKind } from '../shared/types'

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif']
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov']

function backgroundPath(videoId: string): string {
  return join(songDir(videoId), 'background.json')
}

// pure: picks 'image' vs 'video' from a file's extension, defaulting to
// 'image' for anything unrecognized — the open-file dialog's filters
// already keep the user from picking something outside this list
export function inferKind(path: string): BackgroundKind {
  const ext = extname(path).slice(1).toLowerCase()
  return VIDEO_EXTENSIONS.includes(ext) ? 'video' : 'image'
}

export function loadBackground(videoId: string): SongBackground | null {
  try {
    const data = JSON.parse(readFileSync(backgroundPath(videoId), 'utf8')) as SongBackground
    // a transient missing file (unmounted drive, temporarily renamed) should
    // fall back to the gradient for this session without losing the saved
    // reference — so this returns null here but never deletes background.json
    if (typeof data.path !== 'string' || !existsSync(data.path)) return null
    return data
  } catch {
    return null
  }
}

export async function pickBackground(videoId: string): Promise<SongBackground | null> {
  const dir = songDir(videoId)
  if (!existsSync(dir)) throw new Error('Unknown song')
  const result = await dialog.showOpenDialog({
    title: 'Choose a Theater Mode background',
    buttonLabel: 'Use as background',
    properties: ['openFile'],
    filters: [
      { name: 'Images', extensions: IMAGE_EXTENSIONS },
      { name: 'Videos', extensions: VIDEO_EXTENSIONS }
    ]
  })
  if (result.canceled || !result.filePaths[0]) return null
  const picked: SongBackground = { kind: inferKind(result.filePaths[0]), path: result.filePaths[0] }
  writeFileSync(backgroundPath(videoId), JSON.stringify(picked, null, 2))
  return picked
}

export function clearBackground(videoId: string): void {
  rmSync(backgroundPath(videoId), { force: true })
}
```

- [ ] **Step 4: Add the test to the `test` npm script and run it**

In `package.json`, change:

```json
"test": "node --test --experimental-strip-types src/main/data-dir.test.ts",
```

to:

```json
"test": "node --test --experimental-strip-types src/main/data-dir.test.ts src/main/background.test.ts",
```

Run: `npm test`
Expected: both test files' suites PASS (`# pass 6` or more, `# fail 0`).

- [ ] **Step 5: Wire the IPC handlers in the main process**

In `src/main/index.ts`, add to the import block right after `import { loadLyrics, saveLyrics, clearLyrics, searchLyrics } from './lyrics'`:

```ts
import { loadBackground, pickBackground, clearBackground } from './background'
```

Then, right after the existing block of `lyrics:*` handlers (immediately after the line `ipcMain.handle('lyrics:clear', (_e, videoId: string) => clearLyrics(videoId))`), add:

```ts
  ipcMain.handle('background:get', (_e, videoId: string) => loadBackground(videoId))
  ipcMain.handle('background:pick', (_e, videoId: string) => pickBackground(videoId))
  ipcMain.handle('background:clear', (_e, videoId: string) => clearBackground(videoId))
```

- [ ] **Step 6: Expose the methods through the preload bridge**

In `src/preload/index.ts`, change the type import line to:

```ts
import type { JobEvent, EnvEvent, UpdateEvent, AppSettings, StemKitApi, LyricsTrack, SongBackground } from '../shared/types'
```

Then, right after the line `clearLyrics: (videoId) => ipcRenderer.invoke('lyrics:clear', videoId),`, add:

```ts
  getBackground: (videoId) => ipcRenderer.invoke('background:get', videoId),
  pickBackground: (videoId) => ipcRenderer.invoke('background:pick', videoId),
  clearBackground: (videoId) => ipcRenderer.invoke('background:clear', videoId),
```

(`SongBackground` isn't referenced by name in this file yet — it's imported so the next task's usage doesn't need another edit here. If `tsc` reports it unused after this step, that's expected until Task 7; `noUnusedLocals` applies to locals, not type-only imports used solely to satisfy `StemKitApi`'s shape, so this should not fail typecheck.)

- [ ] **Step 7: Typecheck node + web**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add src/main/background.ts src/main/background.test.ts src/main/index.ts src/preload/index.ts package.json
git commit -m "feat: add per-song custom background storage and IPC"
```

---

### Task 3: Palette extraction (`lib/palette.ts`)

**Files:**
- Create: `src/renderer/src/lib/palette.ts`
- Create: `src/renderer/src/lib/palette.test.ts`
- Modify: `package.json` (test script)

**Interfaces:**
- Produces: `FALLBACK_PALETTE: string[]`, `quantize(pixels: Uint8ClampedArray, count: number): string[]` (pure), `extractPalette(videoId: string, imageUrl: string): Promise<string[]>` (DOM-dependent, cached per `videoId`).

- [ ] **Step 1: Write the failing tests for `quantize`**

Create `src/renderer/src/lib/palette.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { quantize } from './palette.ts'

function solid(r: number, g: number, b: number, pixelCount: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(pixelCount * 4)
  for (let i = 0; i < pixelCount; i++) {
    data[i * 4] = r
    data[i * 4 + 1] = g
    data[i * 4 + 2] = b
    data[i * 4 + 3] = 255
  }
  return data
}

test('a solid color image quantizes to that single color, repeated', () => {
  const pixels = solid(200, 50, 10, 16)
  const colors = quantize(pixels, 3)
  assert.equal(colors.length, 3)
  for (const c of colors) assert.equal(c, '#c8320a')
})

test('two sharply split color halves produce two distinct colors', () => {
  const half = 8
  const left = solid(255, 0, 0, half)
  const right = solid(0, 0, 255, half)
  const pixels = new Uint8ClampedArray(left.length + right.length)
  pixels.set(left, 0)
  pixels.set(right, left.length)
  const colors = quantize(pixels, 2)
  assert.equal(colors[0], '#ff0000')
  assert.equal(colors[1], '#0000ff')
})

test('returns an empty array for empty input', () => {
  assert.deepEqual(quantize(new Uint8ClampedArray(0), 3), [])
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node --test --experimental-strip-types src/renderer/src/lib/palette.test.ts`
Expected: FAIL — `Cannot find module './palette.ts'`.

- [ ] **Step 3: Implement `src/renderer/src/lib/palette.ts`**

```ts
// a handful of violet/emerald tones matching the rest of the StemKit UI —
// used when there's no thumbnail to extract colors from (local files with
// no cover art), or while extraction hasn't resolved yet
export const FALLBACK_PALETTE = ['#7c3aed', '#34d399', '#4c1d95']

// buckets RGBA pixel data into `count` representative hex colors by
// averaging over a fixed grid of regions — simple and fast rather than a
// true k-means, which is plenty for a blurred animated-gradient background
export function quantize(pixels: Uint8ClampedArray, count: number): string[] {
  const pixelCount = pixels.length / 4
  if (pixelCount === 0 || count <= 0) return []
  const bucketSize = Math.max(1, Math.floor(pixelCount / count))
  const colors: string[] = []
  for (let b = 0; b < count; b++) {
    const start = b * bucketSize
    const end = b === count - 1 ? pixelCount : start + bucketSize
    if (start >= pixelCount) break
    let r = 0
    let g = 0
    let bl = 0
    let n = 0
    for (let i = start; i < end; i++) {
      r += pixels[i * 4]
      g += pixels[i * 4 + 1]
      bl += pixels[i * 4 + 2]
      n++
    }
    if (n === 0) continue
    const toHex = (v: number): string => Math.round(v / n).toString(16).padStart(2, '0')
    colors.push(`#${toHex(r)}${toHex(g)}${toHex(bl)}`)
  }
  return colors
}

const cache = new Map<string, Promise<string[]>>()

// draws the image into a small offscreen canvas and quantizes it; results
// are cached per videoId since Theater Mode may be opened/closed repeatedly
export function extractPalette(videoId: string, imageUrl: string): Promise<string[]> {
  const cached = cache.get(videoId)
  if (cached) return cached
  const promise = new Promise<string[]>((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const size = 24
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) return resolve(FALLBACK_PALETTE)
        ctx.drawImage(img, 0, 0, size, size)
        const { data } = ctx.getImageData(0, 0, size, size)
        const colors = quantize(data, 3)
        resolve(colors.length > 0 ? colors : FALLBACK_PALETTE)
      } catch {
        resolve(FALLBACK_PALETTE)
      }
    }
    img.onerror = () => resolve(FALLBACK_PALETTE)
    img.src = imageUrl
  })
  cache.set(videoId, promise)
  return promise
}
```

- [ ] **Step 4: Add the test to the `test` npm script and run it**

In `package.json`, change the `test` script again to:

```json
"test": "node --test --experimental-strip-types src/main/data-dir.test.ts src/main/background.test.ts src/renderer/src/lib/palette.test.ts",
```

Run: `npm test`
Expected: all three test files PASS (`# fail 0`).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck:web`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/lib/palette.ts src/renderer/src/lib/palette.test.ts package.json
git commit -m "feat: add thumbnail color-palette extraction for Theater Mode"
```

---

### Task 4: Theater Mode shell — trigger button, text, fallback gradient

**Files:**
- Modify: `src/renderer/src/components/Icons.tsx`
- Create: `src/renderer/src/components/TheaterMode.tsx`
- Modify: `src/renderer/src/components/Lyrics.tsx`
- Modify: `src/renderer/src/components/Player.tsx`
- Modify: `src/renderer/src/index.css`

**Interfaces:**
- Consumes: `parseLrc`, `activeLrcIndex`, `LrcLine` from `lib/lrc.ts` (existing); `FALLBACK_PALETTE` from `lib/palette.ts` (Task 3); `window.stemkit.getLyrics` (existing).
- Produces: `TheaterMode` component with props `{ videoId: string; getPosition: () => number; onClose: () => void }`; `Lyrics` gains a required prop `onOpenTheater: () => void`; `Player` gains local state `theaterOpen`.

- [ ] **Step 1: Add the expand icon**

In `src/renderer/src/components/Icons.tsx`, right after the `XIcon` function, add:

```tsx
export function ExpandIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9 3H3v6M15 21h6v-6M3 3l7 7M21 21l-7-7" />
    </svg>
  )
}
```

- [ ] **Step 2: Add the Theater Mode line-change animation**

In `src/renderer/src/index.css`, right after the existing `.rise-in { ... }` block, add:

```css
@keyframes theaterLineIn {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.theater-line {
  animation: theaterLineIn 0.4s cubic-bezier(0.22, 1, 0.36, 1) both;
}
```

- [ ] **Step 3: Create `TheaterMode.tsx`**

Create `src/renderer/src/components/TheaterMode.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import type { LrcLine } from '../lib/lrc'
import { parseLrc, activeLrcIndex } from '../lib/lrc'
import { FALLBACK_PALETTE } from '../lib/palette'
import { XIcon } from './Icons'

interface Props {
  videoId: string
  getPosition: () => number
  onClose: () => void
}

export function TheaterMode({ videoId, getPosition, onClose }: Props): React.ReactElement {
  const [lines, setLines] = useState<LrcLine[]>([])
  const [activeIndex, setActiveIndex] = useState(-1)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const paletteRef = useRef<string[]>(FALLBACK_PALETTE)

  // Theater Mode fetches and parses its own copy of the cached synced
  // lyrics rather than receiving it from the Lyrics panel, so the two
  // stay independently usable — at the cost of one extra (cheap,
  // already-on-disk) IPC round trip per open
  useEffect(() => {
    let cancelled = false
    setLines([])
    setActiveIndex(-1)
    window.stemkit.getLyrics(videoId).then((c) => {
      if (cancelled || !c?.syncedLyrics) return
      setLines(parseLrc(c.syncedLyrics))
    })
    return () => {
      cancelled = true
    }
  }, [videoId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (lines.length === 0) return
    let raf = 0
    const tick = (): void => {
      const idx = activeLrcIndex(lines, getPosition())
      setActiveIndex((prev) => (prev === idx ? prev : idx))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [lines, getPosition])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let raf = 0
    const draw = (time: number): void => {
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      const dpr = window.devicePixelRatio || 1
      if (w > 0 && (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr))) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      const ctx = canvas.getContext('2d')
      if (ctx && w > 0 && h > 0) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.fillStyle = '#0b0b10'
        ctx.fillRect(0, 0, w, h)
        const t = time / 1000
        const colors = paletteRef.current
        colors.forEach((color, i) => {
          const angle = t * 0.15 + (i * (Math.PI * 2)) / colors.length
          const cx = w / 2 + Math.cos(angle) * w * 0.3
          const cy = h / 2 + Math.sin(angle * 1.3) * h * 0.3
          const radius = Math.max(w, h) * 0.5
          const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
          grad.addColorStop(0, `${color}aa`)
          grad.addColorStop(1, `${color}00`)
          ctx.fillStyle = grad
          ctx.fillRect(0, 0, w, h)
        })
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  const text = activeIndex >= 0 ? (lines[activeIndex]?.text ?? '') : ''

  return (
    <div className="fixed inset-0 z-[60] bg-black">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      <div className="absolute inset-0 flex items-center justify-center px-16">
        <p
          key={activeIndex}
          className="theater-line text-center text-white text-5xl font-bold leading-tight drop-shadow-[0_2px_24px_rgba(0,0,0,0.6)]"
        >
          {text}
        </p>
      </div>
      <button
        onClick={onClose}
        title="Close Theater Mode"
        className="no-drag absolute top-6 right-6 w-10 h-10 rounded-full bg-black/40 hover:bg-black/60 text-white/70 hover:text-white flex items-center justify-center transition-colors"
      >
        <XIcon className="w-5 h-5" />
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Add the trigger button to the Lyrics panel**

In `src/renderer/src/components/Lyrics.tsx`:

Change the import line:

```ts
import { parseLrc, activeLrcIndex } from '../lib/lrc'
import { fmtTime } from '../lib/format'
```

to:

```ts
import { parseLrc, activeLrcIndex } from '../lib/lrc'
import { fmtTime } from '../lib/format'
import { ExpandIcon } from './Icons'
```

Change the `Props` interface:

```ts
interface Props {
  videoId: string
  title: string
  getPosition: () => number
  onSeek: (seconds: number) => void
}
```

to:

```ts
interface Props {
  videoId: string
  title: string
  getPosition: () => number
  onSeek: (seconds: number) => void
  onOpenTheater: () => void
}
```

Change the function signature:

```ts
export function Lyrics({ videoId, title, getPosition, onSeek }: Props): React.ReactElement {
```

to:

```ts
export function Lyrics({ videoId, title, getPosition, onSeek, onOpenTheater }: Props): React.ReactElement {
```

Replace the header block:

```tsx
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-white/30">
          Lyrics
        </span>
        {status === 'found' && (
          <button
            onClick={() => void forget()}
            className="no-drag text-[11px] text-white/35 hover:text-white/70 transition-colors"
          >
            Search again
          </button>
        )}
      </div>
```

with:

```tsx
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-white/30">
          Lyrics
        </span>
        <span className="flex items-center gap-2">
          {status === 'found' && lines.length > 0 && (
            <button
              onClick={onOpenTheater}
              title="Open Theater Mode"
              className="no-drag w-6 h-6 rounded-md hover:bg-white/10 text-white/40 hover:text-white flex items-center justify-center transition-colors"
            >
              <ExpandIcon className="w-3.5 h-3.5" />
            </button>
          )}
          {status === 'found' && (
            <button
              onClick={() => void forget()}
              className="no-drag text-[11px] text-white/35 hover:text-white/70 transition-colors"
            >
              Search again
            </button>
          )}
        </span>
      </div>
```

- [ ] **Step 5: Wire `theaterOpen` state into the Player**

In `src/renderer/src/components/Player.tsx`, add the import right after `import { Lyrics } from './Lyrics'`:

```ts
import { TheaterMode } from './TheaterMode'
```

Add state right after `const [showLyrics, setShowLyrics] = useState(false)`:

```ts
const [theaterOpen, setTheaterOpen] = useState(false)
```

Change the `<Lyrics ... />` call:

```tsx
              <Lyrics
                videoId={song.videoId}
                title={song.title}
                getPosition={getPosition}
                onSeek={seekTo}
              />
```

to:

```tsx
              <Lyrics
                videoId={song.videoId}
                title={song.title}
                getPosition={getPosition}
                onSeek={seekTo}
                onOpenTheater={() => setTheaterOpen(true)}
              />
```

Then, right before the final closing `</div>` of the component's returned root `<div className="h-full flex flex-col">`, add:

```tsx
      {theaterOpen && (
        <TheaterMode
          videoId={song.videoId}
          getPosition={getPosition}
          onClose={() => setTheaterOpen(false)}
        />
      )}
```

(so the full return block ends with this sibling after the `<div className="flex-1 min-h-0 overflow-y-auto ...">...</div>` and before the component's final `</div>`).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck:web`
Expected: exits 0.

- [ ] **Step 7: Build and manually verify**

Run: `node scripts/run.cjs build`
Expected: exits 0, `out/` rebuilt.

Run (driver REPL — see `.claude/skills/run-desktop/SKILL.md`):

```
node .claude/skills/run-desktop/driver.cjs
```
```
launch
open-song <a library song with cached synced lyrics>
toggle-lyrics
click-text Open Theater Mode
ss theater-open
press Escape
ss theater-closed
quit
```

Expected: `theater-open.png` shows a full-window dark overlay with a moving violet/emerald blobby gradient and one large line of text centered (or blank if the position is before the first synced line); `theater-closed.png` shows the normal Player view again, with playback undisturbed.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/Icons.tsx src/renderer/src/components/TheaterMode.tsx src/renderer/src/components/Lyrics.tsx src/renderer/src/components/Player.tsx src/renderer/src/index.css
git commit -m "feat: add Theater Mode overlay with karaoke-style current-line display"
```

---

### Task 5: Thumbnail-derived gradient palette

**Files:**
- Modify: `src/renderer/src/components/TheaterMode.tsx`

**Interfaces:**
- Consumes: `extractPalette(videoId, imageUrl)` from Task 3; `window.stemkit.getThumb(videoId)` (existing, already used by `lib/thumbs.tsx`).
- Produces: no prop/signature changes — same `TheaterMode` public interface as Task 4.

- [ ] **Step 1: Fetch the thumbnail and extract its palette**

In `src/renderer/src/components/TheaterMode.tsx`, change the import line:

```ts
import { FALLBACK_PALETTE } from '../lib/palette'
```

to:

```ts
import { FALLBACK_PALETTE, extractPalette } from '../lib/palette'
```

Add a new effect right after the lyrics-fetching effect (after its closing `}, [videoId])`):

```ts
  useEffect(() => {
    paletteRef.current = FALLBACK_PALETTE
    let cancelled = false
    window.stemkit.getThumb(videoId).then((thumb) => {
      if (cancelled || !thumb) return
      void extractPalette(videoId, thumb).then((colors) => {
        if (!cancelled) paletteRef.current = colors
      })
    })
    return () => {
      cancelled = true
    }
  }, [videoId])
```

(`paletteRef` already exists from Task 4 and is read every animation frame inside the gradient `draw` function, so this takes effect on the next frame with no extra plumbing.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck:web`
Expected: exits 0.

- [ ] **Step 3: Build and manually verify**

Run: `node scripts/run.cjs build`

Using the driver, open Theater Mode for a library song that has a cached thumbnail (any YouTube-sourced song) and a local file with no cover art:

```
launch
open-song <a YouTube-sourced library song>
toggle-lyrics
click-text Open Theater Mode
ss theater-youtube-palette
quit
```

Expected: the gradient's colors visibly differ from the Task 4 screenshot's fixed violet/emerald tones, and roughly match the song's thumbnail colors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/TheaterMode.tsx
git commit -m "feat: color Theater Mode's gradient from the song's thumbnail"
```

---

### Task 6: Live YouTube video as the Theater Mode background

**Files:**
- Modify: `src/renderer/src/components/Player.tsx`
- Modify: `src/renderer/src/components/TheaterMode.tsx`

**Interfaces:**
- Consumes: the existing `containerRef`/`YouTubeHost` mounting logic in `Player.tsx` (unchanged); `showVideo` (existing, computed in `Player.tsx`).
- Produces: `TheaterMode` gains two new required props — `showVideo: boolean` and `videoSlotRef: (el: HTMLDivElement | null) => void`.

- [ ] **Step 1: Reparent the YouTube container via a portal in `Player.tsx`**

In `src/renderer/src/components/Player.tsx`, add the import:

```ts
import { createPortal } from 'react-dom'
```

Add state right after `const [theaterOpen, setTheaterOpen] = useState(false)`:

```ts
const [videoSlot, setVideoSlot] = useState<HTMLDivElement | null>(null)
const [smallVideoSlot, setSmallVideoSlot] = useState<HTMLDivElement | null>(null)
const videoPortalTarget = theaterOpen ? videoSlot : smallVideoSlot
```

Replace the line:

```tsx
                  <div ref={containerRef} className="absolute inset-0 [&_iframe]:w-full [&_iframe]:h-full" />
```

with:

```tsx
                  <div ref={setSmallVideoSlot} className="absolute inset-0" />
```

Right after the `{showVideo && ( ... )}` block that contains the small video box closes (its matching `)}`), add:

```tsx
            {showVideo && videoPortalTarget && createPortal(
              <div ref={containerRef} className="absolute inset-0 [&_iframe]:w-full [&_iframe]:h-full" />,
              videoPortalTarget
            )}
```

This keeps the single `containerRef` div — and the `YouTubeHost`/iframe mounted inside it — alive continuously; only its parent DOM node changes between the small box and Theater Mode's full-bleed slot. React calls `setVideoSlot(null)` automatically when `TheaterMode` unmounts (closing Theater Mode), so no extra cleanup is needed.

- [ ] **Step 2: Pass the new props to `TheaterMode`**

Still in `Player.tsx`, change the `<TheaterMode ... />` call to:

```tsx
      {theaterOpen && (
        <TheaterMode
          videoId={song.videoId}
          getPosition={getPosition}
          onClose={() => setTheaterOpen(false)}
          showVideo={showVideo}
          videoSlotRef={setVideoSlot}
        />
      )}
```

- [ ] **Step 3: Render the video slot in `TheaterMode`, falling back to the gradient**

In `src/renderer/src/components/TheaterMode.tsx`, change the `Props` interface:

```ts
interface Props {
  videoId: string
  getPosition: () => number
  onClose: () => void
}
```

to:

```ts
interface Props {
  videoId: string
  getPosition: () => number
  onClose: () => void
  showVideo: boolean
  videoSlotRef: (el: HTMLDivElement | null) => void
}
```

Change the function signature:

```ts
export function TheaterMode({ videoId, getPosition, onClose }: Props): React.ReactElement {
```

to:

```ts
export function TheaterMode({ videoId, getPosition, onClose, showVideo, videoSlotRef }: Props): React.ReactElement {
```

Change the gradient canvas effect's dependency array from `[]` to `[showVideo]` (so it starts/stops correctly if the "hide video" setting flips while Theater Mode is open):

```ts
  }, [])
```

(the one closing the `useEffect` that defines `draw`/the canvas animation) becomes:

```ts
  }, [showVideo])
```

Replace the returned JSX's first child:

```tsx
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
```

with:

```tsx
      {showVideo ? (
        <div ref={videoSlotRef} className="absolute inset-0 [&_iframe]:w-full [&_iframe]:h-full" />
      ) : (
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      )}
      <div className="absolute inset-0 bg-black/30" />
```

(the added `bg-black/30` scrim keeps the large text readable over whatever is playing underneath).

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck:web`
Expected: exits 0.

- [ ] **Step 5: Build and manually verify video continuity**

Run: `node scripts/run.cjs build`

```
launch
open-song <a YouTube-sourced library song>
toggle-play
ss before-theater
toggle-lyrics
click-text Open Theater Mode
ss theater-with-video
press Escape
ss after-theater
quit
```

Expected: `theater-with-video.png` shows the YouTube video filling the whole window with the current lyric line over it; `after-theater.png` shows the small video box again, still playing from roughly where it was (no restart/reload — compare the video frame's visual content across the three screenshots, it should progress continuously, not jump back to the start).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/Player.tsx src/renderer/src/components/TheaterMode.tsx
git commit -m "feat: use the live YouTube video as Theater Mode's background via a portal"
```

---

### Task 7: Custom per-song background (image/video)

**Files:**
- Modify: `src/renderer/src/components/TheaterMode.tsx`

**Interfaces:**
- Consumes: `SongBackground` type (Task 1); `window.stemkit.getBackground` / `pickBackground` / `clearBackground` (Task 2).
- Produces: no prop/signature changes — same `TheaterMode` public interface as Task 6.

- [ ] **Step 1: Add background state and import the type**

In `src/renderer/src/components/TheaterMode.tsx`, add to the top-level imports:

```ts
import type { SongBackground } from '../../../shared/types'
```

Add state right after `const paletteRef = useRef<string[]>(FALLBACK_PALETTE)`:

```ts
  const [background, setBackground] = useState<SongBackground | null>(null)
  const [bgFailed, setBgFailed] = useState(false)
```

Add a new effect right after the thumbnail-palette effect from Task 5:

```ts
  useEffect(() => {
    let cancelled = false
    setBackground(null)
    setBgFailed(false)
    window.stemkit.getBackground(videoId).then((bg) => {
      if (!cancelled) setBackground(bg)
    })
    return () => {
      cancelled = true
    }
  }, [videoId])

  const pickBg = async (): Promise<void> => {
    const picked = await window.stemkit.pickBackground(videoId)
    if (picked) {
      setBackground(picked)
      setBgFailed(false)
    }
  }

  const clearBg = async (): Promise<void> => {
    await window.stemkit.clearBackground(videoId)
    setBackground(null)
  }
```

- [ ] **Step 2: Render the custom background above the video/gradient**

Replace the JSX block:

```tsx
      {showVideo ? (
        <div ref={videoSlotRef} className="absolute inset-0 [&_iframe]:w-full [&_iframe]:h-full" />
      ) : (
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      )}
      <div className="absolute inset-0 bg-black/30" />
```

with:

```tsx
      {background && !bgFailed ? (
        background.kind === 'video' ? (
          <video
            key={background.path}
            src={`file://${background.path}`}
            className="absolute inset-0 w-full h-full object-cover"
            autoPlay
            muted
            loop
            onError={() => setBgFailed(true)}
          />
        ) : (
          <img
            key={background.path}
            src={`file://${background.path}`}
            className="absolute inset-0 w-full h-full object-cover"
            onError={() => setBgFailed(true)}
          />
        )
      ) : showVideo ? (
        <div ref={videoSlotRef} className="absolute inset-0 [&_iframe]:w-full [&_iframe]:h-full" />
      ) : (
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      )}
      <div className="absolute inset-0 bg-black/30" />
```

(When a custom background is active, `videoSlotRef` is never called for this song while Theater Mode stays open in that state — `Player`'s shared video container then has no portal target and briefly unmounts/remounts the live YouTube player if the user later clears the custom background in the same Theater Mode session. This mirrors what already happens today whenever the "hide video" setting flips `showVideo` off and on, so it's an accepted, pre-existing tradeoff rather than a new regression.)

- [ ] **Step 3: Add the hover-revealed background controls**

Add, right before the existing close button (`<button onClick={onClose} ...>`):

```tsx
      <div className="no-drag absolute bottom-6 left-6 flex items-center gap-2 opacity-0 hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <button
          onClick={() => void pickBg()}
          className="rounded-full bg-black/40 hover:bg-black/60 text-white/70 hover:text-white text-[11px] font-medium px-3 py-1.5 transition-colors"
        >
          {background ? 'Change background' : 'Set background'}
        </button>
        {background && (
          <button
            onClick={() => void clearBg()}
            className="rounded-full bg-black/40 hover:bg-black/60 text-white/70 hover:text-white text-[11px] font-medium px-3 py-1.5 transition-colors"
          >
            Reset
          </button>
        )}
      </div>
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck:web`
Expected: exits 0.

- [ ] **Step 5: Build and manually verify**

Run: `node scripts/run.cjs build`

```
launch
open-song <any library song>
toggle-lyrics
click-text Open Theater Mode
eval document.querySelectorAll('.absolute.bottom-6.left-6 button').length
quit
```

Expected: `eval` prints `1` (only "Set background" — no background picked yet, "Reset" not rendered). Manually picking a file via the file dialog isn't automatable through the driver (native OS dialog) — confirm by hand once that `click-text Set background` opens a real OS file picker, that choosing an image shows it full-bleed behind the text, and that `click-text Reset` returns to the video/gradient.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/TheaterMode.tsx
git commit -m "feat: let a song use a custom image/video as its Theater Mode background"
```

---

### Task 8: Driver + skill doc updates for Theater Mode QA

**Files:**
- Modify: `.claude/skills/run-desktop/driver.cjs`
- Modify: `.claude/skills/run-desktop/SKILL.md`

**Interfaces:**
- Consumes: nothing new from the app — this only adds agent-tooling convenience commands.
- Produces: a `toggle-theater` driver command.

- [ ] **Step 1: Add a `toggle-theater` command to the driver**

In `.claude/skills/run-desktop/driver.cjs`, right after the `'toggle-lyrics'` command definition, add:

```js
  // clicks the "Open Theater Mode" icon button inside the Lyrics panel
  // (only present once a song has cached synced lyrics — run toggle-lyrics
  // first)
  async 'toggle-theater'() {
    if (!page) return console.log('ERROR: launch first')
    const r = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.title === 'Open Theater Mode')
      if (!btn) return 'NOT_FOUND'
      btn.click()
      return 'OK'
    })
    console.log('toggle-theater →', r)
    await page.waitForTimeout(800)
  },
```

- [ ] **Step 2: Document it in `SKILL.md`**

In `.claude/skills/run-desktop/SKILL.md`, add a row to the Commands table right after the `toggle-lyrics` row:

```
| `toggle-theater` | click the "Open Theater Mode" button in the Lyrics panel (needs `toggle-lyrics` first, and cached synced lyrics) |
```

Add to the Gotchas list:

```
- **Theater Mode's close button has no exact-text match** — it's matched by
  `title` (`"Open Theater Mode"` / `"Close Theater Mode"`), same approach as
  `toggle-play`, since it's an icon-only button.
```

- [ ] **Step 3: Full end-to-end smoke test**

```
node .claude/skills/run-desktop/driver.cjs
```
```
launch
open-song <a library song with cached synced lyrics>
toggle-play
toggle-lyrics
toggle-theater
ss e2e-theater
press Escape
ss e2e-after
quit
```

Expected: `e2e-theater.png` shows the full-window karaoke overlay; `e2e-after.png` shows the normal Player, transport still showing the song progressing (not reset to 0:00).

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/run-desktop/driver.cjs .claude/skills/run-desktop/SKILL.md
git commit -m "chore: teach the run-desktop driver to drive Theater Mode"
```
