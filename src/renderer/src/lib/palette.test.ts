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
