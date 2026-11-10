import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inferKind } from './background-kind.ts'

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
