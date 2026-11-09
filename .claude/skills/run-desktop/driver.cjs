// REPL driver for StemKit's Electron app. Works on Windows/macOS/Linux with
// a real display; wrap with xvfb-run on headless Linux. Designed for agents:
// wrap in tmux, send-keys commands, capture-pane output.
const { _electron: electron } = require('playwright-core')
const readline = require('readline')
const fs = require('fs')
const path = require('path')
const os = require('os')

const APP_DIR = path.resolve(__dirname, '../../..')
const SHOT_DIR = process.env.SCREENSHOT_DIR || path.join(os.tmpdir(), 'stemkit-shots')
fs.mkdirSync(SHOT_DIR, { recursive: true })

let app = null
let page = null // the single BrowserWindow StemKit opens

function electronBin() {
  if (process.platform === 'darwin') {
    return path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  }
  if (process.platform === 'win32') {
    return path.join(APP_DIR, 'node_modules/electron/dist/electron.exe')
  }
  return path.join(APP_DIR, 'node_modules/electron/dist/electron')
}

// matches a library row in the sidebar by (partial) song title and clicks it
async function clickSongByTitle(title) {
  return page.evaluate((t) => {
    const btns = [...document.querySelectorAll('aside button')]
    const el = btns.find((b) => b.textContent?.includes(t))
    if (!el) return 'NOT_FOUND'
    el.click()
    return 'OK'
  }, title)
}

const COMMANDS = {
  // builds out/ (electron-vite). Without this, out/main/index.js is stale
  // or missing and launch fails — not run automatically since a human may
  // want to iterate on an existing build
  async launch() {
    if (app) return console.log('already launched')
    if (!fs.existsSync(path.join(APP_DIR, 'out/main/index.js'))) {
      return console.log("ERROR: out/main/index.js is missing — run 'node scripts/run.cjs build' first")
    }
    app = await electron.launch({
      executablePath: electronBin(),
      args: [APP_DIR],
      timeout: 30_000
    })
    page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    // env status + library list populate async after load; no reliable
    // selector to wait on, so give it a moment
    await page.waitForTimeout(2000)
    console.log('launched.', page.url())
  },

  async ss(name) {
    if (!page) return console.log('ERROR: launch first')
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + '.png')
    await page.screenshot({ path: f })
    console.log('screenshot:', f)
  },

  // DOM click, not locator.click() — coordinates are unnecessary here (a
  // single BrowserWindow, no BrowserView overlay) but this stays robust to
  // elements scrolled out of the viewport
  async click(sel) {
    if (!page) return console.log('ERROR: launch first')
    const r = await page.evaluate((s) => {
      const el = document.querySelector(s)
      if (!el) return 'NOT_FOUND'
      el.click()
      return 'OK'
    }, sel)
    console.log('click', sel, '→', r)
  },

  async 'click-text'(text) {
    if (!page) return console.log('ERROR: launch first')
    const r = await page.evaluate((t) => {
      const els = [...document.querySelectorAll('button, a, [role="button"]')]
      const el = els.find((e) => e.textContent?.trim() === t) ?? els.find((e) => e.textContent?.includes(t))
      if (!el) return 'NOT_FOUND'
      el.click()
      return 'OK: ' + el.tagName
    }, text)
    console.log('click-text', JSON.stringify(text), '→', r)
  },

  async type(text) {
    if (page) await page.keyboard.type(text, { delay: 30 })
  },
  async press(key) {
    if (page) await page.keyboard.press(key)
  },

  async wait(sel) {
    if (!page) return console.log('ERROR: launch first')
    try {
      await page.waitForSelector(sel, { timeout: 10_000 })
      console.log('found:', sel)
    } catch {
      console.log('TIMEOUT:', sel)
    }
  },

  async eval(expr) {
    if (!page) return console.log('ERROR: launch first')
    try {
      console.log(JSON.stringify(await page.evaluate(expr)))
    } catch (e) {
      console.log('ERROR:', e.message)
    }
  },

  async text(sel) {
    if (!page) return console.log('ERROR: launch first')
    console.log(await page.evaluate((s) => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)', sel || null))
  },

  async windows() {
    if (!app) return console.log('ERROR: launch first')
    for (const w of app.windows()) console.log(' ', w.url())
  },

  // --- app-specific commands, learned from driving the real library ---

  // open-song <title substring> — clicks the matching sidebar library entry
  async 'open-song'(title) {
    if (!page) return console.log('ERROR: launch first')
    console.log('open-song', JSON.stringify(title), '→', await clickSongByTitle(title))
    await page.waitForTimeout(1200)
  },

  // toggles the Lyrics panel in the Player header (exact-text button "Lyrics")
  async 'toggle-lyrics'() {
    if (!page) return console.log('ERROR: launch first')
    const r = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Lyrics')
      if (!btn) return 'NOT_FOUND'
      btn.click()
      return 'OK'
    })
    console.log('toggle-lyrics →', r)
    await page.waitForTimeout(800)
  },

  // clicks the round white Transport play/pause button (no aria-label/title
  // is set on it, so match by its distinctive class pair instead)
  async 'toggle-play'() {
    if (!page) return console.log('ERROR: launch first')
    const r = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(
        (b) => b.className.includes('rounded-full') && b.className.includes('bg-white')
      )
      if (!btn) return 'NOT_FOUND'
      btn.click()
      return 'OK'
    })
    console.log('toggle-play →', r)
  },

  async quit() {
    if (app) await app.close().catch(() => {})
    app = null
    page = null
  },
  help() {
    console.log('commands:', Object.keys(COMMANDS).join(', '))
  }
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'driver> ' })

// readline emits 'line' for every buffered line in a tight synchronous
// loop when stdin arrives as one chunk (piped input, or several tmux
// send-keys in flight at once) — pause()/resume() inside an async handler
// does NOT stop that loop. Queue instead, and drain it one command at a
// time so 'launch' always finishes before 'ss'/'click'/etc. run.
const queue = []
let draining = false

async function runOne(line) {
  const [cmd, ...rest] = line.trim().split(/\s+/)
  if (!cmd) return
  const fn = COMMANDS[cmd]
  if (!fn) {
    console.log('unknown:', cmd, '— try: help')
    return
  }
  try {
    await fn(rest.join(' '))
  } catch (e) {
    console.log('ERROR:', e.message)
  }
  if (cmd === 'quit') rl.close()
}

async function drain() {
  if (draining) return
  draining = true
  while (queue.length) {
    await runOne(queue.shift())
    if (rl.closed) break
    rl.prompt()
  }
  draining = false
}

rl.on('line', (line) => {
  queue.push(line)
  void drain()
})
rl.on('close', async () => {
  await COMMANDS.quit()
})

console.log('StemKit desktop driver — "help" for commands, "launch" to start')
rl.prompt()
