import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeTiming, karaokeAnchors, timingInput, validateKaraoke } from './karaoke-timing.ts'

const anchors = karaokeAnchors([
  { time: 1.25, text: 'Turn around' },
  { time: 4, text: 'Turn around' },
  { time: 4, text: 'again' },
  { time: 10, text: 'Outside the song' }
], 10)
const inputs = timingInput(anchors, 10, [[0, 1.5], [3.4, 4.2], [11, 12]])
const reply = [
  { id: 1, starts: [0, 0.3, 1.04], end: 2.25 },
  { id: 0, starts: [0.2, 0.8], end: 1.9 }
]

test('reconstructs the selected lyrics in source order, retaining repeats, simultaneous lines and gaps', () => {
  const lines = decodeTiming(JSON.stringify(reply), inputs, anchors)
  assert.deepEqual(lines, [
    { start: 1.25, end: 3.15, words: [{ text: 'Turn', start: 1.45 }, { text: 'around', start: 2.05 }] },
    { start: 4, end: 6.25, words: [{ text: 'Turn', start: 4 }, { text: 'around', start: 4.3 }, { text: 'again', start: 5.04 }] }
  ])
  assert.deepEqual(inputs[0].quiet, [[0, 0.25], [2.15, 2.75]])
  assert.deepEqual(inputs[1].quiet, [[0, 0.2]])
})

test('honors embedded word timestamps in enhanced LRC', () => {
  const rich = karaokeAnchors([{ time: 1, text: '<00:01.1>Sing <00:01.8>now' }], 4)
  const request = timingInput(rich, 4, [])
  assert.deepEqual(request[0].knownStarts, [0.1, 0.8])
  const [line] = decodeTiming('[{"id":0,"starts":[0,0.6],"end":2}]', request, rich)
  assert.deepEqual(line.words, [{ text: 'Sing', start: 1.1 }, { text: 'now', start: 1.8 }])
})

test('rejects missing cues, malformed JSON and out-of-order or out-of-window model times', () => {
  const bad = [ 'not JSON', [], [reply[0], reply[0]], [reply[0], { ...reply[1], starts: [0] }],
    [reply[0], { ...reply[1], starts: [-1, 0] }], [reply[0], { ...reply[1], starts: [1, 1] }],
    [reply[0], { ...reply[1], end: 18 }] ]
  for (const item of bad) assert.throws(() => decodeTiming(JSON.stringify(item), inputs, anchors))
})

test('rejects invalid manual edits before replacing saved cues', () => {
  const lines = decodeTiming(JSON.stringify(reply), inputs, anchors)
  assert.throws(() => validateKaraoke({ lines: [...lines].reverse() }, 10))
  assert.throws(() => validateKaraoke({ lines: [{ ...lines[0], words: [{ text: 'two words', start: 1.45 }] }] }, 10))
  assert.throws(() => validateKaraoke({ lines }, 4))
})
