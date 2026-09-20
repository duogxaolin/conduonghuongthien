import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer, request } from 'node:http'
import { createApp, defineEventHandler, toNodeListener } from 'h3'
import { readBoundedUploadBody } from '../server/utils/bounded-upload-body.ts'

test('H3 rejects oversized Content-Length and chunked bytes before materializing a body', async () => {
  const app = createApp()
  app.use(defineEventHandler(async event => ({ bytes: (await readBoundedUploadBody(event, 1024)).length })))
  const server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const send = (chunks: Buffer[], headers: Record<string, string> = {}) => new Promise<{ status: number, body: string }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, method: 'PUT', headers }, res => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode!, body }))
    })
    req.on('error', reject)
    for (const chunk of chunks) req.write(chunk)
    req.end()
  })
  try {
    assert.equal((await send([Buffer.alloc(2048)], { 'Content-Length': '2048' })).status, 413)
    assert.equal((await send([Buffer.alloc(512), Buffer.alloc(513)], { 'Transfer-Encoding': 'chunked' })).status, 413)
    const accepted = await send([Buffer.alloc(512), Buffer.alloc(512)], { 'Transfer-Encoding': 'chunked' })
    assert.equal(accepted.status, 200)
    assert.equal(JSON.parse(accepted.body).bytes, 1024)
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
})
