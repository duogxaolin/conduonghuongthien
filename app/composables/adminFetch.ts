/**
 * `$fetch` for the admin panel, typed by the caller (design.md D-FETCH).
 *
 * Nitro types `$fetch` by route, and inferring that type across the whole route
 * tree is expensive enough that admin pages stopped asking for it: they cast
 * instead, `($fetch as (u: string, o?: Record<string, unknown>) => Promise<{…}>)`,
 * at every call site. A cast is a promise the compiler cannot check — rename a
 * response field on the server and every cast keeps compiling. This wrapper keeps
 * the ONE cast here and gives call sites `adminFetch<Response>(url, opts)`.
 *
 * Errors are rethrown UNCHANGED. Call sites (and `useAdminList`) read them with
 * `errorMessage()` / `errorStatus()` from `app/utils/errorMessage.ts`: a wrapped
 * error would hide the status the 401-vs-403 decision needs, and would stop
 * `errorMessage` from recognising a failed `$fetch` — after which ofetch's own
 * `[GET] "/api/…": <no response>` line could reach the screen
 * (tests/error-message.test.ts, tests/admin-list.test.ts).
 *
 * Note on aborts: a request cancelled through `signal` rejects as a `FetchError`
 * whose `cause` is the `AbortError` — `isAbortError()` reads `.name` and does not
 * see it. Decide staleness by which request is current, as `useAdminList` does,
 * not by inspecting the error.
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
}

type TypedFetch = <T>(url: string, options?: AdminFetchOptions) => Promise<T>

export function adminFetch<T>(url: string, options?: AdminFetchOptions): Promise<T> {
  return ($fetch as TypedFetch)<T>(url, options)
}
