/**
 * A real h3 app on an ephemeral port, for behaviour suites that run route
 * handlers with cookies, headers and middleware.
 *
 * Sibling of `_h3-test-server.ts`, which is about request BODIES sent byte for
 * byte. This one is about the rest of the request: the h3 helpers Nitro
 * auto-imports are installed as globals (so a handler written as
 * `defineEventHandler(...)` with no import loads unchanged), global middleware is
 * mounted before the router as Nitro mounts it, and the response's status,
 * `Set-Cookie` and `Retry-After` are the real thing — `getClientIp`,
 * `isSecureRequest` and `setCookie` run as they do in production.
 *
 * `installH3Globals()` must run before the handler modules are imported.
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import * as h3 from 'h3'

const AUTO_IMPORTS = [
  'defineEventHandler', 'createError', 'readBody', 'getQuery', 'getRouterParam', 'getCookie', 'setCookie',
  'deleteCookie', 'setResponseHeader', 'getRequestHeader', 'getRequestURL', 'getRequestIP', 'getHeader',
] as const

/**
 * h3 prints this on every error whose `statusMessage` holds characters outside its
 * header-safe set — every Vietnamese message in the app. It is a deprecation
 * notice about h3's own future, not about the code under test; only that exact
 * line is dropped.
 */
const H3_STATUS_MESSAGE_NOTICE = '[h3] Please prefer using `message` for longer error messages'

export function installH3Globals(): void {
  const globals = globalThis as unknown as Record<string, unknown>
  for (const name of AUTO_IMPORTS) globals[name] = h3[name]
  const warn = console.warn
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith(H3_STATUS_MESSAGE_NOTICE)) return
    warn(...args)
  }
}

export type HandlerRoute = { method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, handler: h3.EventHandler }

export interface HandlerResponse {
  status: number
  body: Record<string, unknown>
  headers: Headers
  /** Every `Set-Cookie`, by cookie name. An empty `value` is a deletion. */
  cookies: Map<string, { value: string, raw: string }>
}

export interface HandlerServer {
  /**
   * `redirect: 'manual'` answers a 3xx as it is (status + `Location`) instead of
   * following it — a handler that redirects to an outside host (an OAuth start)
   * would otherwise send the test to the network.
   */
  request(method: string, path: string, options?: { cookie?: string, body?: unknown, headers?: Record<string, string>, redirect?: 'follow' | 'manual' }): Promise<HandlerResponse>
  close(): Promise<void>
}

/** A failure a suite injected on purpose (`_sqlite-mysql-db.ts` `failNext`), anywhere in the cause chain. */
function isInjectedFailure(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 5; depth += 1) {
    if (current instanceof Error && current.message.startsWith('injected failure')) return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

export async function startHandlerServer(routes: HandlerRoute[], middleware: h3.EventHandler[] = []): Promise<HandlerServer> {
  const app = h3.createApp({
    // The 500 an injected failure produces is the expected outcome of that test:
    // answer it without h3's stack trace. Every other unhandled error still prints.
    onError: async (error, event) => {
      if (!isInjectedFailure(error)) return
      h3.setResponseStatus(event, 500)
      await h3.send(event, JSON.stringify({ statusCode: 500, injected: true }), 'application/json')
    },
  })
  for (const handler of middleware) app.use(handler)
  const router = h3.createRouter()
  for (const route of routes) router[route.method](route.path, route.handler)
  app.use(router)

  const server: Server = createServer(h3.toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    async request(method, path, options = {}) {
      const headers: Record<string, string> = { ...options.headers }
      if (options.cookie) headers.cookie = options.cookie
      let body: string | undefined
      if (options.body !== undefined) {
        body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body)
        headers['content-type'] ??= 'application/json'
      }
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body, redirect: options.redirect ?? 'follow' })
      const text = await response.text()
      let parsed: Record<string, unknown> = {}
      try { parsed = text ? JSON.parse(text) as Record<string, unknown> : {} } catch { parsed = { text } }
      const cookies = new Map<string, { value: string, raw: string }>()
      for (const raw of response.headers.getSetCookie()) {
        const pair = raw.split(';')[0] ?? ''
        const separator = pair.indexOf('=')
        cookies.set(pair.slice(0, separator), { value: decodeURIComponent(pair.slice(separator + 1)), raw })
      }
      return { status: response.status, body: parsed, headers: response.headers, cookies }
    },
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}
