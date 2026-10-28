/**
 * `$fetch` for the admin panel, with the response type stated by the caller
 * (design.md D-FETCH).
 *
 * WHAT THIS IS — AND IS NOT. `T` is an unchecked assertion: nothing compares it
 * with what the endpoint returns, so `adminFetch<Wrong>(url)` compiles, and
 * renaming a response field on the server still breaks no build. That is exactly
 * as unsafe as the cast it replaces, `($fetch as (u: string, o?: …) => Promise<{…}>)`.
 * What changes is WHERE the assertion lives: one cast here instead of one per call
 * site, a call site that reads as a plain call, and one place to tighten later
 * (e.g. deriving `T` from Nitro's route types). It is not type safety.
 *
 * Cost, stated: a page that used bare, uncast `$fetch` had its response type
 * inferred from the Nitro route (the readers list did). Moving it here trades that
 * for a declared type the compiler cannot verify.
 *
 * Errors are rethrown as the SAME object, never wrapped. Call sites (and `useAdminList`)
 * read them with `errorMessage()` / `errorStatus()` from `app/utils/errorMessage.ts`: a
 * wrapped error would hide the status the 401-vs-403 decision needs, and would stop
 * `errorMessage` from recognising a failed `$fetch` — after which ofetch's own
 * `[GET] "/api/…": <no response>` line could reach the screen
 * (tests/error-message.test.ts, tests/admin-list.test.ts).
 *
 * One thing is done to it first, for a request with a non-JSON `responseType` (a
 * download): ofetch reads the error body with that type too, so a refusal written as
 * `createError({ statusMessage })` arrived as a Blob/string/ArrayBuffer of JSON and
 * `errorMessage` found no `data.statusMessage` — the officer read the page's fallback
 * instead of the server's sentence. A JSON error body is parsed into `data`; anything
 * else (an nginx HTML page) is left as it was (tests/admin-fetch-error-body.test.ts).
 *
 * Note on aborts: a request cancelled through `signal` rejects as a `FetchError`
 * whose `cause` is the `AbortError`. `isAbortError()` follows `.cause` and does
 * see it, but a source may also ignore the signal and resolve late — so decide
 * staleness by which request is current, as `useAdminList` does, not by
 * inspecting the error.
 *
 * `$fetch` stays a bare global (Nuxt auto-import) so tests install a real ofetch
 * over a fake network in its place.
 */

export type AdminFetchMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface AdminFetchOptions {
  method?: AdminFetchMethod
  /** `undefined` values are dropped from the query string, as with bare `$fetch`. */
  query?: Record<string, unknown>
  /** Plain objects and arrays are sent as JSON. */
  body?: Record<string, unknown> | unknown[] | FormData | Blob | string
  headers?: Record<string, string>
  signal?: AbortSignal
  /** ofetch's own default applies when omitted: one retry for GET on 408/409/425/429/5xx. */
  retry?: number | false
  /** How to read the body; JSON when omitted. A file download (a stream) is `'blob'` with `T = Blob`. */
  responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer'
}

type TypedFetch = <T>(url: string, options?: AdminFetchOptions) => Promise<T>

export async function adminFetch<T>(url: string, options?: AdminFetchOptions): Promise<T> {
  try {
    return await ($fetch as TypedFetch)<T>(url, options)
  } catch (err: unknown) {
    if (options?.responseType && options.responseType !== 'json') await parseJsonErrorBody(err)
    throw err
  }
}

/**
 * A failed `$fetch` exposes its body as `data`, a getter over `response._data` (ofetch
 * `createFetchError`), so the parsed body is written there. Not JSON after all → left
 * untouched, and `errorMessage` falls back as it did.
 */
async function parseJsonErrorBody(err: unknown): Promise<void> {
  const response = err && typeof err === 'object'
    ? (err as { response?: { headers?: Headers, _data?: unknown } }).response
    : undefined
  if (!response || !/\bjson\b/i.test(response.headers?.get('content-type') ?? '')) return
  const body = response._data
  try {
    const text = typeof body === 'string' ? body
      : body instanceof Blob ? await body.text()
        : body instanceof ArrayBuffer ? new TextDecoder().decode(body)
          : undefined
    if (text !== undefined) response._data = JSON.parse(text)
  } catch {
    // Unreadable or not JSON: keep what ofetch read.
  }
}
