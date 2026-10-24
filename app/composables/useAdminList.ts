import {
  getCurrentScope,
  onScopeDispose,
  ref,
  shallowReactive,
  shallowRef,
  type Ref,
  type ShallowReactive,
  type ShallowRef,
} from 'vue'

// Relative path, not `~/`: the test loader (scripts/ts-resolver.mjs) only knows `~~/`.
import { errorMessage } from '../utils/errorMessage'

/**
 * State of one paginated, filterable admin list (design.md D-FETCH).
 *
 * Every admin list page used to hand-copy the same refs and the same `load()`.
 * The copies agreed on the happy path and all missed the same race: an officer
 * changes a filter, changes it again before the first answer is back, and the
 * OLDER answer lands last — the page then shows the first filter's rows under the
 * second filter's controls, and nothing on screen says so. Here a newer request
 * aborts the older one and, because an aborted ofetch request rejects as a
 * `FetchError` (its `cause` is the AbortError) and a source may ignore the signal
 * altogether, every outcome is also checked against the request generation: only
 * the latest request may write `items`, `error` or `loading`.
 *
 * Deliberately NOT here:
 *   - No watcher on `filters`. Each of these endpoints writes an audit row per
 *     call; fetching as the officer types would flood `activity_logs`. Filters
 *     apply on `applyFilters()` (submit, a tab, a select's `change`).
 *   - No fetch from setup. `loading` starts true and the page calls `reload` from
 *     `onMounted` — on SSR a setup-time request goes out without the admin cookie.
 *   - No error/retry markup. The page renders its own `role="alert"` block and
 *     binds "Thử lại" to `reload`, because tests/admin-error-retry-ui.test.ts reads
 *     each page file's own source (split-guard rule).
 *
 * Tests: tests/admin-list.test.ts (behaviour, real ofetch over a fake network),
 * tests/admin-list-pilot-pages.test.ts (the migrated pages' source contract).
 */

export interface AdminListPage<TItem> {
  items: TItem[]
  total: number
  totalPages: number
  /**
   * The page the server actually served. Comments/readers clamp an out-of-range
   * page and report the clamped one; omit it and the requested page is assumed.
   */
  page?: number
}

export interface AdminListRequest<TFilters> {
  page: number
  /** A snapshot taken when the request started — later typing does not change it. */
  filters: TFilters
  /** Pass it on to `adminFetch`, so a superseded request is cancelled on the wire. */
  signal: AbortSignal
}

export interface UseAdminListOptions<TItem, TFilters extends object, TPage extends AdminListPage<TItem>> {
  /** Initial filter values; copied, never mutated. `resetFilters()` returns to them. */
  filters: TFilters
  /**
   * Fetch one page. Resolve `null` when the server answered without a usable list
   * (`ok: false`, a proxy's HTML page) — shown as `errorFallback`, never as an
   * empty list. Rejections are shown through `errorMessage()`, so only a message
   * the server composed for people reaches the screen.
   */
  load: (request: AdminListRequest<TFilters>) => Promise<TPage | null>
  /** What the error branch says when nothing readable came back. */
  errorFallback: string
}

export interface AdminList<TItem, TFilters extends object, TPage extends AdminListPage<TItem>> {
  readonly page: Readonly<Ref<number>>
  /** Bind the filter form here (`v-model="filters.q"`); applied by `applyFilters()`. */
  readonly filters: ShallowReactive<TFilters>
  readonly items: Readonly<ShallowRef<TItem[]>>
  readonly total: Readonly<Ref<number>>
  readonly totalPages: Readonly<Ref<number>>
  readonly loading: Readonly<Ref<boolean>>
  /** '' when the latest request succeeded (or is still in flight). */
  readonly error: Readonly<Ref<string>>
  /** The latest successful answer, for page-specific extras (e.g. a badge count). */
  readonly result: Readonly<ShallowRef<TPage | null>>
  /** Re-run the current page with the current filters — the retry button's handler. */
  reload: () => Promise<void>
  /** Back to page 1 with the current filters. */
  applyFilters: () => Promise<void>
  /** Ignored for anything but a whole page in 1..totalPages other than the current one. */
  goToPage: (next: number) => Promise<void>
  /** Restore the initial filters and load page 1. */
  resetFilters: () => Promise<void>
}

/** A page count or page number from the server; anything unusable reads as 1. */
function pageNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1
}

export function useAdminList<
  TItem,
  TFilters extends object,
  TPage extends AdminListPage<TItem> = AdminListPage<TItem>,
>(options: UseAdminListOptions<TItem, TFilters, TPage>): AdminList<TItem, TFilters, TPage> {
  const initialFilters = { ...options.filters }

  const page = ref(1)
  // Shallow: filters are flat form values; a top-level assignment is all v-model does.
  const filters = shallowReactive({ ...initialFilters })
  const items = shallowRef<TItem[]>([])
  const total = ref(0)
  const totalPages = ref(1)
  const loading = ref(true)
  const error = ref('')
  // `shallowRef<T>` picks its return type with a conditional on `T extends Ref`,
  // which TypeScript cannot resolve while TPage is still generic — Vue's documented
  // pattern for generic composables is to state the ref type.
  const result = shallowRef(null) as ShallowRef<TPage | null>

  let generation = 0
  let controller: AbortController | null = null
  let disposed = false

  async function reload(): Promise<void> {
    // A late action handler (`await reload()` after a delete) must not fire a
    // request — and an audit row — for a page that has already gone.
    if (disposed) return

    const ticket = ++generation
    controller?.abort()
    const current = new AbortController()
    controller = current
    loading.value = true
    error.value = ''

    const requested = page.value
    let askForLastPage = false
    try {
      const answer = await options.load({ page: requested, filters: { ...filters }, signal: current.signal })
      if (ticket !== generation) return
      if (!answer || !Array.isArray(answer.items)) {
        error.value = options.errorFallback
        return
      }

      const lastPage = pageNumber(answer.totalPages)
      const served = pageNumber(answer.page ?? requested)
      const count = typeof answer.total === 'number' && Number.isFinite(answer.total) ? answer.total : 0

      if (served > lastPage && count > 0) {
        // The server echoed a page past the end without clamping it (rows were
        // removed meanwhile). An empty page with data on the pages before it
        // reads as "nothing here"; ask once more for the last page that exists.
        page.value = lastPage
        askForLastPage = true
      } else {
        items.value = answer.items
        total.value = count
        totalPages.value = lastPage
        // Nothing on any page: settle on 1 so a later retry does not keep asking
        // for a page number that no longer means anything.
        page.value = Math.min(served, lastPage)
        result.value = answer
      }
    } catch (err: unknown) {
      // A superseded request — aborted or merely late — has nobody waiting for it.
      if (ticket !== generation) return
      error.value = errorMessage(err, options.errorFallback)
    } finally {
      // Only the latest request ends the loading state: an older one settling
      // must not swap the skeleton for stale rows while the newer is in flight.
      if (ticket === generation && !askForLastPage) {
        loading.value = false
        controller = null
      }
    }

    if (askForLastPage) await reload()
  }

  async function applyFilters(): Promise<void> {
    page.value = 1
    await reload()
  }

  async function goToPage(next: number): Promise<void> {
    if (!Number.isInteger(next) || next < 1 || next > totalPages.value || next === page.value) return
    page.value = next
    await reload()
  }

  async function resetFilters(): Promise<void> {
    Object.assign(filters, initialFilters)
    await applyFilters()
  }

  // Inside a component this is its setup scope: unmounting cancels the request in
  // flight and stops any answer from writing into a page that is gone.
  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposed = true
      generation++
      controller?.abort()
      controller = null
    })
  }

  return { page, filters, items, total, totalPages, loading, error, result, reload, applyFilters, goToPage, resetFilters }
}
