/**
 * `$fetch` for the PUBLIC site, with the response type stated by the caller
 * (design D-FETCH, lot G — the public counterpart of `adminFetch`).
 *
 * WHAT THIS IS — AND IS NOT. `T` is an unchecked assertion, exactly as in `adminFetch`:
 * nothing compares it with what the endpoint returns. Call sites pass a type DERIVED
 * from the handler (`Payload<typeof handler>`, app/types/handler-payload.ts, collected
 * in app/types/public-*-api.ts), so a changed response changes the type; but
 * `publicFetch<Wrong>(url)` still compiles. What this replaces is one hand-written
 * cast of the global per call site; the one assertion now lives here.
 *
 * WHY IT IS NOT `adminFetch`. The admin helper may grow admin-only behaviour (it already
 * reads JSON error bodies of downloads); a public page must not inherit that by accident.
 *
 * THE CACHE INVARIANT — why this is a bare call of the global `$fetch` and nothing more.
 * During SSR, Nuxt's global `$fetch` calls the Nitro handler WITHOUT the visitor's
 * request headers: no `cookie`, so no `cdkt_lang` and no reader session. That is what
 * keeps the HTML of the `swr` routes (`/`, `/news/**`, `/about`…, nuxt.config.ts
 * `routeRules`) the same for every visitor — the server renders Vietnamese and
 * anonymous, and the page switches after hydrate. `useRequestFetch()` / `useFetch`
 * forward those headers; a helper built on them would cache ONE visitor's language or
 * identity and replay it to everyone. So: the global, called at call time (tests
 * install a real ofetch over a fake network in its place), url and options passed
 * through untouched, no `#imports` (tests `import()` the composables straight into Node).
 * Where a call runs — inside a `useAsyncData` handler (SSR + payload) or after mount
 * (browser only) — is decided by the call site, exactly as before; this changes neither.
 *
 * Errors are the SAME object `$fetch` rejected with, never wrapped: call sites read them
 * with `errorMessage()` / `errorStatus()` (app/utils/errorMessage.ts), and a wrapper would
 * hide the status (401 → "sign in again") and let ofetch's own `[GET] "/api/…"` line reach
 * the screen (tests/error-message.test.ts). Not even `async`: a synchronous throw stays one.
 *
 * Options are the ones the public call sites use, under the names they use: `params`
 * is ofetch's alias of `query` (both are merged into the query string), kept so a call
 * site moved here changed its callee and nothing else.
 */

export type PublicFetchMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

export interface PublicFetchOptions {
  method?: PublicFetchMethod
  /** `undefined` values are dropped from the query string, as with bare `$fetch`. */
  query?: Record<string, unknown>
  /** ofetch's alias of `query`. */
  params?: Record<string, unknown>
  /** Plain objects and arrays are sent as JSON. */
  body?: Record<string, unknown> | unknown[]
  signal?: AbortSignal
  /** ofetch's own default applies when omitted: one retry for GET on 408/409/425/429/5xx. */
  retry?: number | false
  /** Milliseconds; none when omitted. */
  timeout?: number
  /** Let the request outlive the page (a view counter sent while leaving). */
  keepalive?: boolean
}

type TypedFetch = <T>(url: string, options?: PublicFetchOptions) => Promise<T>

export function publicFetch<T>(url: string, options?: PublicFetchOptions): Promise<T> {
  return ($fetch as TypedFetch)<T>(url, options)
}
