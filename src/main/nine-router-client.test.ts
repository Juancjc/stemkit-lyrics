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

test('sendChatCompletion combines text parts in order', async () => {
  const { url, close } = await startServer((_req, res) => {
    const content = [{ type: 'text', text: '[1,' }, { type: 'text', text: '2]' }]
    res.end(JSON.stringify({ choices: [{ message: { content } }] }))
  })
  try {
    assert.equal((await sendChatCompletion(testConfig(url), [])).content, '[1,2]')
  } finally {
    await close()
  }
})

test('sendChatCompletion reports a timeout while reading a 200 response', async () => {
  const { url, close } = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.write('{')
    setTimeout(() => res.end('}'), 500)
  })
  try {
    await assert.rejects(sendChatCompletion(testConfig(url, { timeoutMs: 100 }), []),
      (err: unknown) => err instanceof AiGatewayError && err.kind === 'timeout')
  } finally {
    await close()
  }
})
