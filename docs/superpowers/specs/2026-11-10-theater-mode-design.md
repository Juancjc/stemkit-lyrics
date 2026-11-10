# Theater Mode: karaoke-style lyrics overlay

## Context

StemKit's Player already has a collapsible Lyrics panel (search LRCLIB,
cache a pick per song, scroll + highlight the synced line as it plays —
see `src/renderer/src/components/Lyrics.tsx` and `src/main/lyrics.ts`).

This spec adds a second, separate way to view those same synced lyrics:
a full-window "Theater Mode" that shows one big line of text at a time
over a moving background — the YouTube video itself when there is one,
or an animated gradient / a per-song custom image or video when there
isn't. This is the in-app, live-only phase of the feature; rendering an
actual exportable video file ("burn lyrics into an mp4") is an
explicitly separate, later phase and is out of scope here.

## Goals

- Karaoke-style single-line-at-a-time lyrics display, large and centered.
- Reuse the existing synced-lyrics cache and parser — no new lyrics
  source or format.
- Works for all three song shapes the app already has: YouTube video
  shown, YouTube video hidden (`hideVideo` setting), and local files
  (which have no video at all).
- Doesn't interrupt YouTube video playback (no reload/rebuffer) when
  entering/leaving the mode.
- Doesn't regress existing Player behavior (stem playback, transport
  keyboard shortcuts, pan/mute/solo, exports).

## Non-goals

- Exporting a rendered video file. Explicitly deferred.
- OS-level fullscreen (the Fullscreen API) — this is an in-window
  overlay only.
- Multi-line / context lyrics display (previous/next line) — single
  current line only, like classic karaoke.
- Any change to the existing scrollable Lyrics panel; Theater Mode is
  additive, reached from a new control inside that panel.

## User flow

1. In the existing Lyrics panel, once a song has cached synced lyrics
   (`cached.syncedLyrics` parses to at least one line), an "expand to
   Theater Mode" icon button appears next to the panel header. It's
   absent/disabled when there's no synced lyrics yet (instrumental,
   plain-only, or nothing picked) — there's nothing to show full-screen
   in that case.
2. Clicking it opens Theater Mode: a `fixed inset-0` overlay above
   everything else in the Player (stem lanes, transport, etc. stay
   mounted underneath, just hidden).
3. Background resolves in priority order (first that applies wins):
   1. A custom image/video the user picked for this specific song.
   2. The YouTube video, if `showVideo` is true for this song (i.e. not
      a local file, and the "hide video" setting is off).
   3. An animated gradient: colors extracted from the song's cached
      thumbnail, or a fixed app-default palette if there's no
      thumbnail (local files without cover art).
4. The current lyric line renders large and centered over that
   background, crossfading to the next line as playback advances.
5. Esc or a small corner close button exits back to the normal Player
   view. Space/arrow-key transport shortcuts keep working throughout —
   Theater Mode doesn't intercept or stop-propagate those events.
6. A subtle (hover-revealed) corner control lets the user pick or clear
   a custom background for the current song, independent of entering/
   leaving Theater Mode.

## Architecture

### New renderer pieces

- **`src/renderer/src/components/TheaterMode.tsx`** — the overlay.
  Props: `song: Song`, `lines: LrcLine[]` (already parsed by the
  caller), `getPosition: () => number`, `onClose: () => void`,
  `showVideo: boolean`, `videoContainer: HTMLDivElement | null` (the
  Player's existing YouTube container `ref`, reused — see below),
  `background: SongBackground | null`, `onPickBackground`,
  `onClearBackground`.

  Internally: an `activeIndex` state tracked via `requestAnimationFrame`
  against `getPosition()` and `lines` — the same pattern already used
  in `Lyrics.tsx` (`activeLrcIndex` from `lib/lrc.ts`, no new parsing
  logic). Renders `lines[activeIndex]?.text` with a CSS
  fade/slide transition keyed by `activeIndex`.

- **Reusing the live YouTube iframe without remounting it.** Player
  already mounts a single `YouTubeHost` into a `containerRef` div inside
  a small fixed-size box (`src/renderer/src/components/Player.tsx`).
  Remounting a second iframe for Theater Mode would restart playback
  and show a visible reload. Instead, `Player` renders that same
  `containerRef` div via `createPortal`, targeting either the small box
  (normal mode) or a full-bleed container inside `TheaterMode` (theater
  mode) depending on `theaterOpen`. The DOM node — and the `YouTubeHost`
  instance that owns it — never gets destroyed or recreated; only its
  portal target changes. `TheaterMode` exposes a ref/callback for
  `Player` to portal into when it's the active background layer.

- **`src/renderer/src/lib/palette.ts`** — two pieces, split so the math
  is unit-testable without a real `<canvas>`:
  - `quantize(pixels: Uint8ClampedArray, count: number): string[]`
    (pure function — buckets pixels and returns `count` representative
    hex colors). Unit-tested with synthetic pixel arrays.
  - `extractPalette(imageUrl: string): Promise<string[]>` (DOM-
    dependent — draws the image into an offscreen `<canvas>`, reads
    `getImageData`, calls `quantize`). Not unit-tested; exercised via
    manual QA. Results are cached in a `Map<videoId, string[]>` module-
    level cache so Theater Mode doesn't re-extract on every open.

- **Gradient rendering** — a `<canvas>` inside `TheaterMode` (used only
  when neither a custom background nor the video applies), drawn every
  frame via `requestAnimationFrame`: 2–3 soft radial-gradient blobs
  whose positions move along slow sine/cosine curves, colored from the
  extracted (or fallback) palette. Same perf pattern as the existing
  waveform canvas in `StemLane.tsx` (resize to `clientWidth/Height *
  devicePixelRatio`, redraw every rAF tick).

- **Fallback palette**: a fixed small set of hex colors matching the
  app's existing violet/emerald brand accents, used when there's no
  thumbnail to extract from (local files with no cover art).

### Main process / IPC — custom per-song background

Same shape as `src/main/lyrics.ts`, a new `src/main/background.ts`:

```ts
interface SongBackground {
  kind: 'image' | 'video'
  path: string
}
```

- `loadBackground(videoId)`: reads `songDir(videoId)/background.json`;
  if the referenced file no longer exists on disk (`existsSync` fails),
  returns `null` for this call **without deleting the stored reference**
  — a transient missing-file (unmounted drive, renamed-but-will-be-
  renamed-back) shouldn't silently lose the user's choice. UI falls
  back to the gradient for that session.
- `pickBackground(videoId)`: `dialog.showOpenDialog` filtered to common
  image (`png, jpg, jpeg, webp, gif`) and video (`mp4, webm, mov`)
  extensions; on a pick, writes `background.json` (kind inferred from
  the extension) and returns the saved `SongBackground`.
- `clearBackground(videoId)`: deletes `background.json`.

New IPC channels: `background:get`, `background:pick`,
`background:clear` — registered in `src/main/index.ts` exactly like the
`lyrics:*` handlers, exposed through the preload bridge, and added to
`StemKitApi` / `shared/types.ts` (`SongBackground`,
`getBackground(videoId)`, `pickBackground(videoId)`,
`clearBackground(videoId)`).

Rendering the custom background in the renderer: `kind: 'image'` → an
`<img src="file://<path>">` with `object-fit: cover`; `kind: 'video'` →
a muted, looping, autoplaying `<video>` with `object-fit: cover`. An
`onError` handler on either falls back to the gradient for that
session (without touching the stored reference, same reasoning as
above) if the file fails to decode.

## Error handling / edge cases

- No synced lyrics cached → the Theater Mode entry point doesn't
  appear in the Lyrics panel (nothing to show full-screen).
- Lyrics exist but `activeIndex` is `-1` (before the first line's
  timestamp, e.g. an instrumental intro) → Theater Mode shows the
  background only, no text, rather than a blank flash or a stale line.
- Custom background file missing/corrupt at render time → gradient
  fallback, reference kept on disk (see above).
- Local file song with no thumbnail and no custom background → fixed
  app-default gradient palette.
- Closing Theater Mode (Esc / close button) never pauses playback or
  touches the YouTube `postMessage` sync logic already in `Player.tsx`
  — it only changes which parent the shared video container portals
  into and whether the overlay/canvas/text layers are mounted.

## Testing

- `src/renderer/src/lib/palette.test.ts` (or colocated per the
  project's existing `node:test` style, see `data-dir.test.ts`): unit
  tests for `quantize()` against synthetic `Uint8ClampedArray` inputs
  (solid color → single dominant color; two sharply split color blocks
  → two representative colors).
- Everything DOM/Electron-dependent (video portaling, gradient canvas,
  file dialogs, `<img>`/`<video>` fallback) is verified manually via the
  `run-desktop` skill (`.claude/skills/run-desktop/`), the same way the
  lyrics-search feature was smoke-tested: build, launch, open a library
  song with cached synced lyrics, open Theater Mode, screenshot, verify
  the active line advances with playback, verify Esc/close returns to
  the normal Player view with the video still playing uninterrupted.
