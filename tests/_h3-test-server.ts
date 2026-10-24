import { createServer, request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import * as h3 from 'h3'

/**
 * A real h3 app on an ephemeral port, and a client that sends bodies byte for
 * byte with exactly the headers given.
 *
 * For tests about how a request BODY is read: a fake event (`{ body }` plus a
 * `readBody` global) skips the part that goes wrong — h3 parsing the bytes, which
 * depends on the exact `Content-Type` (strict JSON only for a bare
 * `application/json`; with `; charset=utf-8` a truncated body comes back as a
 * string). `fetch` cannot send a body without a `Content-Type`, so `node:http`.
 */
export type H3TestResponse = { status: number, text: string, json: () => Record<string, unknown> }
export type H3TestServer = {
  send: (method: string, path: string, options?: { body?: string, contentType?: string }) => Promise<H3TestResponse>
  close: () => Promise<void>
}

export async function startH3TestServer(mount: (router: h3.Router) => void): Promise<H3TestServer> {
  const app = h3.createApp()
  const router = h3.createRouter()
  mount(router)
  app.use('/', router.handler)
  const server: Server = createServer(h3.toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  const send: H3TestServer['send'] = (method, path, options = {}) =>
    new Promise((resolve, reject) => {
      const headers: Record<string, string | number> = {}
      if (options.contentType !== undefined) headers['content-type'] = options.contentType
      if (options.body !== undefined) headers['content-length'] = Buffer.byteLength(options.body)
      const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => { text += chunk })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text, json: () => JSON.parse(text) as Record<string, unknown> }))
      })
      req.on('error', reject)
      req.end(options.body)
    })

  const close = () => new Promise<void>(resolve => server.close(() => resolve()))
  return { send, close }
}
