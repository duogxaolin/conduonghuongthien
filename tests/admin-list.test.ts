/**
 * `adminFetch` + `useAdminList` (design.md D-FETCH): the typed fetch every admin
 * list page goes through, and the list state those pages used to hand-copy.
 *
 * Every admin list page held its own copy of the same eight refs and the same
 * `load()` — and none of the copies guarded against the race a list page is most
 * exposed to: an officer applies a filter, changes it again before the first
 * answer arrives, and the OLDER answer lands last. The page then shows the first
 * filter's rows under the second filter's controls, with nothing on screen to
 * say so. On the reader and comment pages those rows are citizens' names and
 * email addresses; on the chat-session page, phone numbers.
 *
 * What is pinned here, and why the shape of each fake matters:
 *   - Part 1 drives the composable with a hand-written loader, so page/filter
 *     semantics are checked without any transport in the way.
 *   - Part 2 drives it through `adminFetch` and REAL ofetch over a fake network
 *     (`createFetch({ fetch })`). The abort case only means something with the
 *     error ofetch really throws: an aborted request rejects as `FetchError`
 *     with the `AbortError` as its `cause`, so `isAbortError()` alone (which
 *     reads `.name`) does not recognise it. A hand-made `{ name: 'AbortError' }`
 *     would pass against a shape the browser never produces.
 *
 * The three pilot pages' source contract (no `$fetch` cast, error/retry block in
 * the page itself) lives in tests/admin-list-pilot-pages.test.ts.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createFetch, FetchError } from 'ofetch'
import { effectScope, nextTick } from 'vue'

import { adminFetch } from '../app/composables/adminFetch.ts'
import { useAdminList, type AdminListPage, type AdminListRequest } from '../app/composables/useAdminList.ts'
import { errorMessage, errorStatus, isAbortError } from '../app/utils/errorMessage.ts'

const FALLBACK = 'Không tải được danh sách người đọc.'

type Row = { id: number }
type Filters = { q: string; banned: 'all' | 'active' | 'banned' }
const INITIAL_FILTERS: Filters = { q: '', banned: 'all' }

/** Let promise chains (and ofetch's internal awaits) run to completion. */
const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

/** A loader whose every call waits until the test answers it. */
function manualLoader<TPage extends AdminListPage<Row> = AdminListPage<Row>>() {
  const calls: Array<{ request: AdminListRequest<Filters>; answer: ReturnType<typeof deferred<TPage | null>> }> = []
  const load = (request: AdminListRequest<Filters>) => {
    const answer = deferred<TPage | null>()
    calls.push({ request, answer })
    return answer.promise
  }
  return { calls, load }
}

const pageOf = (ids: number[], extra: Partial<AdminListPage<Row>> = {}): AdminListPage<Row> => ({
  items: ids.map(id => ({ id })),
  total: ids.length,
  totalPages: 1,
  ...extra,
})

// ─── Part 1: page, filters, bounds — hand-written loader ─────────────────────

describe('useAdminList — state and page/filter semantics', () => {
  it('starts in the loading state and fetches nothing until reload() — the page calls it on mount', () => {
    const loader = manualLoader()
    const list = useAdminList<Row, Filters>({ filters: INITIAL_FILTERS, load: loader.load, errorFallback: FALLBACK })

    // `loading` starts true so the skeleton paints on the first frame instead of
    // the empty state ("chưa có ai") flashing before the first answer.
    assert.equal(list.loading.value, true)
    assert.equal(list.page.value, 1)
    assert.deepEqual(list.items.value, [])
    assert.equal(list.error.value, '')
    assert.equal(list.errorStatus.value, null)
    // No fetch from setup: on SSR that request would go out without the admin
    // cookie, and every one of these endpoints writes an audit row per call.
    assert.equal(loader.calls.length, 0)
  })

  it('reload() asks for the current page with a snapshot of the filters and an abort signal, then shows the answer', async () => {
    const loader = manualLoader()
    const list = useAdminList<Row, Filters>({ filters: { q: 'an', banned: 'banned' }, load: loader.load, errorFallback: FALLBACK })

    const done = list.reload()
    assert.equal(loader.calls.length, 1)
    const { request } = loader.calls[0]!
    assert.equal(request.page, 1)
    assert.deepEqual(request.filters, { q: 'an', banned: 'banned' })
    assert.ok(request.signal instanceof AbortSignal)

    // Typing into the form while the request is in flight must not rewrite the
    // query that request already went out with.
    list.filters.q = 'bình'
    assert.equal(request.filters.q, 'an', 'the loader got a snapshot, not the live form object')

    loader.calls[0]!.answer.resolve(pageOf([1, 2], { total: 42, totalPages: 2 }))
    await done

    assert.deepEqual(list.items.value.map(r => r.id), [1, 2])
    assert.equal(list.total.value, 42)
    assert.equal(list.totalPages.value, 2)
    assert.equal(list.loading.value, false)
    assert.equal(list.error.value, '')
  })

  it('applyFilters() goes back to page 1 and sends the current filters', async () => {
    const loader = manualLoader()
    const list = useAdminList<Row, Filters>({ filters: INITIAL_FILTERS, load: loader.load, errorFallback: FALLBACK })
    void list.reload()
    loader.calls[0]!.answer.resolve(pageOf([1], { total: 60, totalPages: 3 }))
    await settle()
    void list.goToPage(3)
    loader.calls[1]!.answer.resolve(pageOf([3], { total: 60, totalPages: 3, page: 3 }))
    await settle()
    assert.equal(list.page.value, 3)

    list.filters.banned = 'banned'
    void list.applyFilters()

    assert.equal(loader.calls.length, 3)
    assert.equal(loader.calls[2]!.request.page, 1, 'a new filter starts from page 1 — page 3 of the old result means nothing')
    assert.deepEqual(loader.calls[2]!.request.filters, { q: '', banned: 'banned' })
    assert.equal(list.page.value, 1)
  })

  it('goToPage() keeps the filters and refuses pages outside 1..totalPages', async () => {
    const loader = manualLoader()
    const list = useAdminList<Row, Filters>({ filters: { q: 'lan', banned: 'all' }, load: loader.load, errorFallback: FALLBACK })
    void list.reload()
    loader.calls[0]!.answer.resolve(pageOf([1], { total: 50, totalPages: 2 }))
    await settle()

    for (const bad of [0, -1, 3, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1 /* already there */]) {
      await list.goToPage(bad)
    }
    assert.equal(loader.calls.length, 1, 'no request for a page that does not exist or is already shown')
    assert.equal(list.page.value, 1)

    void list.goToPage(2)
    assert.equal(loader.calls.length, 2)
    assert.equal(loader.calls[1]!.request.page, 2)
    assert.deepEqual(loader.calls[1]!.request.filters, { q: 'lan', banned: 'all' }, 'paging keeps the filters')
  })

  it('adopts the page the server actually served (comments/readers clamp out-of-range pages)', async () => {
    const loader = manualLoader()
    const list = useAdminList<Row, Filters>({ filters: INITIAL_FILTERS, load: loader.load, errorFallback: FALLBACK })
    void list.reload()
    loader.calls[0]!.answer.resolve(pageOf([1], { total: 75, totalPages: 3 }))
    await settle()
    void list.goToPage(3)
    // Rows were deleted meanwhile; the server clamped page 3 to page 2.
    loader.calls[1]!.answer.resolve(pageOf([9], { total: 30, totalPages: 2, page: 2 }))
    await settle()

    assert.equal(list.page.value, 2)
    assert.equal(list.totalPages.value, 2)
    assert.equal(loader.calls.length, 2, 'a clamped answer is already the right page — no second request')
  })

  it('asks again for the last page when the server does not clamp and the page ran past the end', async () => {
    // GET /api/admin/chatbot/sessions echoes the requested page unclamped. Without
    // this, retention deleting rows while an officer sits on the last page turns a
    // retry into "Chưa có phiên nào" with data still on the pages before it.
    const loader = manualLoader()
    const list = useAdminList<Row, Filters>({ filters: INITIAL_FILTERS, load: loader.load, errorFallback: FALLBACK })
    void list.reload()
    loader.calls[0]!.answer.resolve(pageOf([1], { total: 75, totalPages: 3 }))
    await settle()
    const done = list.goToPage(3)
    loader.calls[1]!.answer.resolve({ items: [], total: 40, totalPages: 2, page: 3 })
    await settle()

    assert.equal(loader.calls.length, 3, 'one follow-up request for the last page that exists')
    assert.equal(loader.calls[2]!.request.page, 2)
    assert.equal(list.loading.value, true, 'still loading until the follow-up answers')
    loader.calls[2]!.answer.resolve(pageOf([7], { total: 40, totalPages: 2, page: 2 }))
    await done

    assert.equal(list.page.value, 2)
    assert.deepEqual(list.items.value.map(r => r.id), [7])
    assert.equal(list.loading.value, false)
  })

  it('a server that keeps answering past the end cannot make the list loop — the action costs exactly 2 requests', async () => {
    // Each request writes an activity_logs row. A server answering `page: 2,
    // totalPages: 1` to EVERY request (even a request for page 1) once made the
    // follow-up re-ask forever — an independent probe counted 41 requests. The
    // loader answers immediately, so an unbounded loop would spin; it gives up
    // after 12 calls so a regression fails here instead of hanging the run.
    const requested: number[] = []
    const list = useAdminList<Row, Filters>({
      filters: INITIAL_FILTERS,
      errorFallback: FALLBACK,
      load: async ({ page }) => {
        requested.push(page)
        if (requested.length === 1) return pageOf([1], { total: 60, totalPages: 3 })
        if (requested.length > 12) return null
        return { items: [], total: 5, totalPages: 1, page: 2 }
      },
    })
    await list.reload()
    await list.goToPage(2)

    assert.deepEqual(requested, [1, 2, 1], 'page 2 past the end → one re-ask for page 1, and an answer for page 1 is never "past the end" of the request')
    assert.equal(list.page.value, 1)
    assert.equal(list.loading.value, false)
    assert.equal(list.error.value, '')

    // A plain retry on page 1 against the same server: the request was not past
    // the end, so its own (nonsensical) "page 2" answer earns no follow-up.
    await list.reload()
    assert.deepEqual(requested, [1, 2, 1, 1], 'asking for a page that exists costs exactly one request')
    assert.equal(list.page.value, 1)
  })

  it('at most one follow-up per action, even while the total keeps shrinking under it', async () => {
    // Strictly decreasing alone would still cost one request per page on a list
    // that shrinks between every two answers; one follow-up per action caps it.
    const answers: Array<AdminListPage<Row>> = [
      pageOf([1], { total: 75, totalPages: 3 }),
      { items: [], total: 40, totalPages: 2, page: 3 },
      { items: [], total: 10, totalPages: 1, page: 2 },
      pageOf([9], { total: 10, totalPages: 1, page: 1 }),
    ]
    const requested: number[] = []
    const list = useAdminList<Row, Filters>({
      filters: INITIAL_FILTERS,
      errorFallback: FALLBACK,
      load: async ({ page }) => {
        requested.push(page)
        return answers[requested.length - 1] ?? null
      },
    })
    await list.reload()
    await list.goToPage(3)

    assert.deepEqual(requested, [1, 3, 2], 'go to page 3 = page 3, then ONE re-ask for page 2 — not a third request')
    assert.equal(list.page.value, 1, 'the displayed page is clamped to what exists')
    assert.equal(list.totalPages.value, 1)
    assert.equal(list.loading.value, false)

    // The next action gets its own single follow-up again.
    await list.reload()
    assert.deepEqual(requested, [1, 3, 2, 1])
    assert.deepEqual(list.items.value.map(r => r.id), [9])
  })

  it('an empty result past page 1 settles on page 1 without another request', async () => {
    const loader = manualLoader()
    const list = useAdminList<Row, Filters>({ filters: INITIAL_FILTERS, load: loader.load, errorFallback: FALLBACK })
    void list.reload()
    loader.calls[0]!.answer.resolve(pageOf([1], { total: 30, totalPages: 2 }))
    await settle()
    void list.goToPage(2)
    loader.calls[1]!.answer.resolve({ items: [], total: 0, totalPages: 1, page: 2 })
    await settle()

    assert.equal(loader.calls.length, 2, 'nothing exists on any page — there is nothing to ask for')
    assert.equal(list.page.value, 1, 'a later retry must not keep asking for page 2 of an empty list')
    assert.equal(list.total.value, 0)
  })

  it('resetFilters() restores the initial filters and reloads from page 1', async () => {
    const loader = manualLoader()
    const list = useAdminList<Row, Filters>({ filters: INITIAL_FILTERS, load: loader.load, errorFallback: FALLBACK })
    void list.reload()
    loader.calls[0]!.answer.resolve(pageOf([1], { total: 60, totalPages: 3 }))
    await settle()
    list.filters.q = 'x'
    list.filters.banned = 'active'
    void list.applyFilters()
    loader.calls[1]!.answer.resolve(pageOf([2], { total: 60, totalPages: 3 }))
    await settle()
    void list.goToPage(2)
    loader.calls[2]!.answer.resolve(pageOf([3], { total: 60, totalPages: 3, page: 2 }))
    await settle()

    void list.resetFilters()
    assert.deepEqual({ ...list.filters }, INITIAL_FILTERS)
    assert.equal(loader.calls[3]!.request.page, 1)
    assert.deepEqual(loader.calls[3]!.request.filters, INITIAL_FILTERS)
    // The initial object is copied, not shared: editing the form never mutates it.
    assert.deepEqual(INITIAL_FILTERS, { q: '', banned: 'all' })
  })

  it('a null answer (server replied without a list, e.g. ok:false or an HTML page) is an error, not an empty list', async () => {
    const loader = manualLoader()
    const list = useAdminList<Row, Filters>({ filters: INITIAL_FILTERS, load: loader.load, errorFallback: FALLBACK })
    void list.reload()
    loader.calls[0]!.answer.resolve(null)
    await settle()

    assert.equal(list.error.value, FALLBACK)
    assert.equal(list.loading.value, false)
  })

  it('keeps extra fields of the latest answer in `result` (comments: the hidden-count badge)', async () => {
    type WithCount = AdminListPage<Row> & { hiddenCount: number }
    const loader = manualLoader<WithCount>()
    const list = useAdminList<Row, Filters, WithCount>({ filters: INITIAL_FILTERS, load: loader.load, errorFallback: FALLBACK })
    void list.reload()
    loader.calls[0]!.answer.resolve({ ...pageOf([1]), hiddenCount: 4 })
    await settle()
    assert.equal(list.result.value?.hiddenCount, 4)

    void list.reload()
    loader.calls[1]!.answer.reject(new Error('mất kết nối'))
    await settle()
    assert.equal(list.result.value?.hiddenCount, 4, 'a failed reload keeps the last good answer — the badge does not drop to 0')
  })
})

describe('useAdminList — stale answers never overwrite a newer one', () => {
  it('an older answer that arrives LAST is ignored (loader that cannot be aborted)', async () => {
    const loader = manualLoader()
    const list = useAdminList<Row, Filters>({ filters: INITIAL_FILTERS, load: loader.load, errorFallback: FALLBACK })

    void list.reload() // A: filter "all"
    list.filters.banned = 'banned'
    const newer = list.applyFilters() // B: filter "banned"

    assert.equal(loader.calls[0]!.request.signal.aborted, true, 'starting B aborts A')
    assert.equal(loader.calls[1]!.request.signal.aborted, false)

    loader.calls[1]!.answer.resolve(pageOf([20, 21]))
    await newer
    // A ignores its signal (or its answer was already on the wire) and lands now.
    loader.calls[0]!.answer.resolve(pageOf([1, 2, 3]))
    await settle()

    assert.deepEqual(list.items.value.map(r => r.id), [20, 21], "A's rows must not replace B's under B's filter controls")
    assert.equal(list.loading.value, false)
  })

  it('an older request that FAILS after a newer one started shows no error and does not end the loading state', async () => {
    const loader = manualLoader()
    const list = useAdminList<Row, Filters>({ filters: INITIAL_FILTERS, load: loader.load, errorFallback: FALLBACK })

    void list.reload() // A
    void list.applyFilters() // B
    loader.calls[0]!.answer.reject(new Error('A failed late'))
    await settle()

    assert.equal(list.error.value, '', "A's failure belongs to a request nobody is waiting for")
    assert.equal(list.loading.value, true, 'B is still in flight — the skeleton stays')

    loader.calls[1]!.answer.resolve(pageOf([5]))
    await settle()
    assert.equal(list.loading.value, false)
    assert.deepEqual(list.items.value.map(r => r.id), [5])
  })

  it('stopping the owning scope (page unmounted) aborts the in-flight request and ignores its answer', async () => {
    const loader = manualLoader()
    const scope = effectScope()
    const list = scope.run(() => useAdminList<Row, Filters>({ filters: INITIAL_FILTERS, load: loader.load, errorFallback: FALLBACK }))!

    void list.reload()
    scope.stop()
    assert.equal(loader.calls[0]!.request.signal.aborted, true)

    loader.calls[0]!.answer.resolve(pageOf([1]))
    await settle()
    assert.deepEqual(list.items.value, [], 'an answer for a page that has gone is not applied')

    // Not awaited: the loader is called synchronously, before reload's first
    // await, so the count is final right here. Awaiting would turn a regression
    // into a hang (this loader never answers) instead of a failure.
    void list.reload()
    assert.equal(loader.calls.length, 1, 'a reload after unmount (a late action handler) sends nothing — each call is an audit row')
  })
})

describe('useAdminList — error mapping and retry', () => {
  it('an error with nothing readable shows the fallback; retry clears it and re-asks the same page + filters', async () => {
    const loader = manualLoader()
    const list = useAdminList<Row, Filters>({ filters: { q: 'mai', banned: 'all' }, load: loader.load, errorFallback: FALLBACK })
    void list.reload()
    loader.calls[0]!.answer.resolve(pageOf([1], { total: 60, totalPages: 3 }))
    await settle()
    void list.goToPage(2)
    loader.calls[1]!.answer.reject(Object.assign(new Error(''), { name: 'TypeError' }))
    await settle()
    assert.equal(list.error.value, FALLBACK, 'never an empty message: a blank alert reads as a broken page')
    assert.equal(list.loading.value, false)

    const retry = list.reload()
    assert.equal(list.error.value, '', 'the error clears as soon as the retry starts')
    assert.equal(list.loading.value, true)
    assert.equal(loader.calls[2]!.request.page, 2, 'retry re-runs exactly the failed request')
    assert.deepEqual(loader.calls[2]!.request.filters, { q: 'mai', banned: 'all' })
    loader.calls[2]!.answer.resolve(pageOf([11], { total: 60, totalPages: 3, page: 2 }))
    await retry
    assert.equal(list.error.value, '')
    assert.deepEqual(list.items.value.map(r => r.id), [11])
  })
})

// ─── Part 2: through adminFetch and real ofetch over a fake network ──────────

type NetCall = {
  url: URL
  init: RequestInit
  respond: (response: Response) => void
  fail: (reason: unknown) => void
}

/**
 * The browser's `fetch`, faked at the network edge only. Aborting rejects with a
 * DOMException named AbortError, as real fetch does; everything above that —
 * query serialisation, JSON parsing, retries, the FetchError wrapping — is
 * ofetch's real code, installed as the `$fetch` global the way Nuxt installs it.
 */
function installFakeNetwork() {
  const calls: NetCall[] = []
  const fetchImpl = (input: RequestInfo | URL, init: RequestInit = {}) => new Promise<Response>((resolve, reject) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const call: NetCall = { url: new URL(raw, 'http://admin.test'), init, respond: resolve, fail: reject }
    init.signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')))
    calls.push(call)
  })
  ;(globalThis as Record<string, unknown>).$fetch = createFetch({ fetch: fetchImpl as typeof fetch })
  return calls
}

const json = (body: unknown, status = 200, statusText = 'OK') =>
  new Response(JSON.stringify(body), { status, statusText, headers: { 'content-type': 'application/json' } })

type ReaderListResponse = { ok: boolean; readers: Row[]; total: number; totalPages: number; page: number }

/** The readers page's loader, as the page writes it. */
const readersLoader = ({ page, filters, signal }: AdminListRequest<Filters>) =>
  adminFetch<ReaderListResponse>('/api/admin/readers', {
    query: { q: filters.q || undefined, banned: filters.banned, page },
    signal,
  }).then(res => (res?.ok ? { items: res.readers, total: res.total, totalPages: res.totalPages, page: res.page } : null))

describe('adminFetch', () => {
  it('passes method, query and body through to $fetch and returns the parsed body typed as T', async () => {
    const calls = installFakeNetwork()
    const pending = adminFetch<{ ok: boolean; results: Array<{ id: number }> }>('/api/admin/comments/ai-moderate', {
      method: 'POST',
      body: { commentIds: [1, 2] },
      query: { dryRun: undefined, lang: 'vi' },
    })
    await settle()
    assert.equal(calls.length, 1)
    assert.equal(calls[0]!.url.pathname, '/api/admin/comments/ai-moderate')
    assert.equal(calls[0]!.url.search, '?lang=vi', 'undefined query values are dropped, as with bare $fetch')
    assert.equal(calls[0]!.init.method, 'POST')
    assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { commentIds: [1, 2] })

    calls[0]!.respond(json({ ok: true, results: [{ id: 1 }] }))
    const res = await pending
    assert.deepEqual(res.results.map(r => r.id), [1])
  })

  it('rethrows the original FetchError, so errorMessage/errorStatus at the call site still see the server', async () => {
    const calls = installFakeNetwork()
    const pending = adminFetch<unknown>('/api/admin/readers', { query: { page: 1 } })
    await settle()
    calls[0]!.respond(json({ statusCode: 403, statusMessage: 'Bạn không có quyền xem danh sách người đọc.' }, 403, 'Forbidden'))

    const error = await pending.then(() => null, (err: unknown) => err)
    assert.ok(error instanceof FetchError, 'not wrapped: wrapping would hide the status the 401-vs-403 decision reads')
    assert.equal(errorStatus(error), 403)
    assert.equal(errorMessage(error, FALLBACK), 'Bạn không có quyền xem danh sách người đọc.')
  })

  it('an aborted request rejects as FetchError with the AbortError as cause — isAbortError() follows the cause', async () => {
    // The name on the thrown error is "FetchError"; isAbortError() sees the abort only
    // because it walks `.cause` (tests/error-abort-detection.test.ts). useAdminList still
    // decides staleness by request generation, since a source may ignore the signal.
    const calls = installFakeNetwork()
    const controller = new AbortController()
    const pending = adminFetch<unknown>('/api/admin/readers', { signal: controller.signal })
    await settle()
    assert.equal(calls.length, 1)
    controller.abort()

    const error = await pending.then(() => null, (err: unknown) => err)
    assert.ok(error instanceof FetchError)
    assert.equal((error.cause as { name?: string } | undefined)?.name, 'AbortError')
    assert.equal(isAbortError(error), true)
    assert.equal(calls.length, 1, 'ofetch does not retry an abort')
  })
})

describe('useAdminList over adminFetch (real ofetch, fake network)', () => {
  it('a newer filter aborts the older request on the wire; the older failure is silent and the newer rows win', async () => {
    const calls = installFakeNetwork()
    const list = useAdminList<Row, Filters>({ filters: INITIAL_FILTERS, load: readersLoader, errorFallback: FALLBACK })

    void list.reload()
    await settle()
    list.filters.banned = 'banned'
    const newer = list.applyFilters()
    await settle()

    assert.equal(calls.length, 2)
    assert.equal(calls[0]!.url.searchParams.get('banned'), 'all')
    assert.equal(calls[1]!.url.searchParams.get('banned'), 'banned')
    assert.equal(calls[0]!.init.signal?.aborted, true, 'the superseded request is cancelled, not just ignored')
    assert.equal(list.error.value, '', "the abort is the user's own doing — no red alert for it")
    assert.equal(list.loading.value, true)

    calls[1]!.respond(json({ ok: true, readers: [{ id: 30 }], total: 1, totalPages: 1, page: 1 }))
    await newer
    assert.deepEqual(list.items.value.map(r => r.id), [30])
    assert.equal(list.error.value, '')
    assert.equal(list.loading.value, false)
  })

  it('server-composed messages reach the alert; ofetch and proxy text never do', async () => {
    const calls = installFakeNetwork()
    const list = useAdminList<Row, Filters>({ filters: INITIAL_FILTERS, load: readersLoader, errorFallback: FALLBACK })

    // 400 from the endpoint's own validation: its Vietnamese sentence is shown.
    let done = list.reload()
    await settle()
    calls[0]!.respond(json({ statusCode: 400, statusMessage: 'Bộ lọc trạng thái không hợp lệ.' }, 400, 'Bad Request'))
    await done
    assert.equal(list.error.value, 'Bộ lọc trạng thái không hợp lệ.')
    assert.equal(list.errorStatus.value, 400)

    // Dropped connection: ofetch's "[GET] "/api/admin/readers…": <no response>" stays
    // in the console. ofetch retries a GET once on a network failure (it counts as a
    // 500), so the retry is answered the same way — and counted, so a change in that
    // default shows up here instead of as a hung test.
    done = list.reload()
    await settle()
    assert.equal(calls.length, 2)
    calls[1]!.fail(new TypeError('Failed to fetch'))
    await settle()
    assert.equal(calls.length, 3, 'ofetch retried the GET once')
    calls[2]!.fail(new TypeError('Failed to fetch'))
    await done
    assert.equal(list.error.value, FALLBACK)
    assert.equal(list.errorStatus.value, null, 'no response, no status — not a stale 400 from the previous failure')

    // nginx 502 HTML page (also retried once): not "Bad Gateway", not the HTML.
    const badGateway = () => new Response('<html>502 Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway', headers: { 'content-type': 'text/html' } })
    done = list.reload()
    await settle()
    assert.equal(calls.length, 4)
    calls[3]!.respond(badGateway())
    await settle()
    assert.equal(calls.length, 5, 'ofetch retried the GET once')
    calls[4]!.respond(badGateway())
    await done
    assert.equal(list.error.value, FALLBACK)
    assert.equal(list.errorStatus.value, 502)

    // A 200 that is not the list (proxy splash page) is an error, not "no readers".
    done = list.reload()
    await settle()
    assert.equal(calls.length, 6)
    calls[5]!.respond(new Response('<html>maintenance</html>', { status: 200, headers: { 'content-type': 'text/html' } }))
    await done
    assert.equal(list.error.value, FALLBACK)
    assert.equal(list.errorStatus.value, null, 'a 200 that is not the list is an error with no HTTP status')
    assert.equal(list.loading.value, false)
  })

  it('exposes the HTTP status, so a page can tell "no permission" (403) from "try again" — cleared on retry', async () => {
    // GET /api/admin/readers needs the `readers` resource, which ships granted to
    // nobody: after an upgrade a 403 here is the expected state, and retrying it
    // will not help. The page decides that from `errorStatus`, not from the text.
    const calls = installFakeNetwork()
    const list = useAdminList<Row, Filters>({ filters: INITIAL_FILTERS, load: readersLoader, errorFallback: FALLBACK })

    let done = list.reload()
    await settle()
    calls[0]!.respond(json({ statusCode: 403, statusMessage: 'Bạn không có quyền xem danh sách người đọc.' }, 403, 'Forbidden'))
    await done
    assert.equal(list.errorStatus.value, 403)
    assert.equal(list.error.value, 'Bạn không có quyền xem danh sách người đọc.')

    done = list.reload()
    assert.equal(list.errorStatus.value, null, 'cleared as soon as the retry starts, together with the message')
    await settle()
    calls[1]!.respond(json({ ok: true, readers: [{ id: 4 }], total: 1, totalPages: 1, page: 1 }))
    await done
    assert.equal(list.errorStatus.value, null)
    assert.deepEqual(list.items.value.map(r => r.id), [4])
  })

  it('a superseded request that fails with a status leaves no status behind', async () => {
    // A source that ignores the signal: the older request's 500 really arrives,
    // after the newer one started. It belongs to nobody.
    const loader = manualLoader()
    const list = useAdminList<Row, Filters>({ filters: INITIAL_FILTERS, load: loader.load, errorFallback: FALLBACK })

    void list.reload()
    const newer = list.applyFilters()
    loader.calls[0]!.answer.reject(Object.assign(new Error('Internal Server Error'), { statusCode: 500 }))
    await settle()
    assert.equal(list.errorStatus.value, null, "the older request's 500 is not the page's status")
    assert.equal(list.loading.value, true)

    loader.calls[1]!.answer.resolve(pageOf([3]))
    await newer
    assert.equal(list.errorStatus.value, null)
    assert.equal(list.error.value, '')
  })
})
