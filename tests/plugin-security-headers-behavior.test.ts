import assert from 'node:assert/strict'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import test from 'node:test'

import { createEvent, getResponseHeader, setResponseHeader } from 'h3'

import { fakeNitroApp, loadPlugin } from './_nitro-plugin-harness.ts'

/**
 * `server/plugins/security-headers.ts` — CHẠY plugin thật.
 *
 * Phạm vi thật của plugin: nó KHÔNG đặt header nào (CSP/HSTS… nằm ở `nuxt.config.ts` routeRules +
 * `server/middleware`), nó chỉ gỡ `x-powered-by: Nuxt` do renderer đặt cứng, theo hai đường:
 * non-streamed (header nằm trong `response.headers`, Nitro áp lên event SAU hook) và streamed
 * (header đã nằm trên event, `response.headers` không có). Cả hai phải sạch, và header khác phải
 * còn nguyên (không gỡ lan).
 */

const plugin = await loadPlugin('server/plugins/security-headers.ts')

function bootHook() {
  const nitro = fakeNitroApp()
  plugin(nitro.app)
  return nitro
}

const realEvent = () => createEvent(new IncomingMessage(new Socket()), new ServerResponse(new IncomingMessage(new Socket())))

test('đăng ký đúng MỘT hook: render:response (middleware chạy trước renderer nên không gỡ được)', () => {
  const nitro = bootHook()
  assert.deepEqual(nitro.names(), ['render:response'])
  assert.equal(nitro.hooks.get('render:response')?.length, 1)
})

test('non-streamed: x-powered-by (cả hai kiểu hoa/thường) bị gỡ khỏi response.headers, header khác còn nguyên', async () => {
  const nitro = bootHook()
  const response = {
    headers: {
      'x-powered-by': 'Nuxt',
      'X-Powered-By': 'Nuxt',
      'content-type': 'text/html;charset=utf-8',
      'x-frame-options': 'SAMEORIGIN',
    } as Record<string, string>,
  }
  await nitro.fire('render:response', response, { event: realEvent() })
  assert.deepEqual(response.headers, { 'content-type': 'text/html;charset=utf-8', 'x-frame-options': 'SAMEORIGIN' })
})

test('streamed: header đã đặt thẳng lên event bị gỡ khỏi event, header khác trên event còn nguyên', async () => {
  const nitro = bootHook()
  const event = realEvent()
  setResponseHeader(event, 'x-powered-by', 'Nuxt')
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
  // Streamed: response không có headers để sửa.
  await nitro.fire('render:response', {}, { event })
  assert.equal(getResponseHeader(event, 'x-powered-by'), undefined)
  assert.equal(getResponseHeader(event, 'x-content-type-options'), 'nosniff')
})

test('không ném khi thiếu response.headers hoặc event (renderer lỗi / không có event)', async () => {
  const nitro = bootHook()
  await nitro.fire('render:response', undefined, { event: undefined })
  await nitro.fire('render:response', {}, {})
  await nitro.fire('render:response', { headers: undefined }, { event: realEvent() })
})
