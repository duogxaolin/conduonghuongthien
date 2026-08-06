/**
 * Reader notifications — "somebody replied to you".
 *
 * State lives at MODULE level, not per call, for the same reason useReaderAuth
 * does: the header bell and the list on /profile are two components on the same
 * page. A per-call ref would have each of them fetch separately and then disagree
 * — the bell could show "3" while the list below it showed none, and marking one
 * read would not clear the other.
 *
 * Everything is fetched AFTER MOUNT and only for a signed-in reader. Public
 * article routes are served with `swr: 60` (nuxt.config.ts), so anything
 * reader-specific that entered server-rendered HTML would be handed to the next
 * visitor from cache. Same shape the comment thread and the view-counter ping
 * already use, and the reason no route is added to `routeRules` for any of this.
 *
 * There is deliberately NO background polling. A poll is one request every few
 * seconds from every open tab, for a number that is never urgent — nobody is
 * waiting on a legal answer to the second. The count refreshes when the page
 * loads and after the reader acts on it, which is when it can actually change
 * anything they see.
 */
import { computed, ref } from 'vue'

export type NotificationTarget = {
  articleTitle: string
  url:          string
}

export type NotificationItem = {
  id:           number
  isRead:       boolean
  createdAt:    string | null
  authorName:   string
  isAdminReply: boolean
  excerpt:      string
  /** Null when the reply can no longer be reached — unpublished article, or
   *  comments turned off (which hides a thread without deleting rows). */
  target:       NotificationTarget | null
}

type NotificationResponse = {
  ok:          boolean
  items:       NotificationItem[]
  total:       number
  unreadCount: number
  page:        number
  perPage:     number
  totalPages:  number
}

/** Module-level: one list per page, not one per component. */
const items = ref<NotificationItem[]>([])
const unreadCount = ref(0)
const total = ref(0)
const page = ref(1)
const totalPages = ref(1)
const pending = ref(false)
const failed = ref(false)
const loaded = ref(false)

/**
 * The request currently in flight, if any.
 *
 * Two callers race on every page load of /profile: the layout starts a load as
 * soon as `reader` resolves, and the page's own `onMounted` asks for one too. A
 * bare `if (pending) return` would make the second call resolve IMMEDIATELY while
 * the data was still arriving — so the page's `await` would fall through to code
 * that assumes the list is populated, and the retry button would appear to do
 * nothing while a load was already running. Sharing the promise makes the second
 * caller wait for the first instead of being told a lie.
 */
let inFlight: Promise<void> | null = null

export function useReaderNotifications() {
  /**
   * Load one page.
   *
   * Failure sets `failed` rather than throwing: this runs on pages whose job is
   * to display an article, and a notification list that cannot load has no
   * standing to turn a readable page into an error. The surfaces that show a
   * retry button read `failed`.
   */
  async function load(targetPage = 1): Promise<void> {
    // Only share the promise for a request wanting the SAME page — otherwise
    // clicking "next page" while the first load is in flight would silently
    // return the page the reader was already on.
    if (inFlight && targetPage === page.value) return inFlight

    const request = (async () => {
      pending.value = true
      failed.value = false
      try {
        const response = await $fetch<NotificationResponse>('/api/public/reader/notifications', {
          query: { page: targetPage },
        })
        items.value = response?.items ?? []
        unreadCount.value = Number(response?.unreadCount ?? 0)
        total.value = Number(response?.total ?? 0)
        page.value = Number(response?.page ?? 1)
        totalPages.value = Number(response?.totalPages ?? 1)
        loaded.value = true
      } catch (error) {
        failed.value = true
        // A 401 means the 30-day ticket lapsed, or a ban bumped tokenVersion,
        // while the page sat open. Rethrown so the caller can drop the cached
        // identity — this composable does not own that decision, useReaderAuth
        // does. 403 is a ban and is deliberately NOT rethrown: the reader is
        // still signed in, and prompting them to sign in again would invite a
        // round trip that succeeds and changes nothing.
        const status = (error as { statusCode?: number })?.statusCode
        if (status === 401) throw error
      } finally {
        pending.value = false
        inFlight = null
      }
    })()

    inFlight = request
    return request
  }

  /**
   * Mark specific notifications read, updating the local state first.
   *
   * Optimistic on purpose: the reader has just clicked the thing, and waiting for
   * a round trip before the badge drops makes the click feel ignored. A failed
   * write leaves the server row unread, so the next load restores the true count
   * — the cost of being wrong is a badge that comes back, not data loss.
   */
  async function markRead(ids: number[]): Promise<void> {
    const wanted = ids.filter(id => Number.isSafeInteger(id) && id > 0)
    if (!wanted.length) return

    const changed = items.value.filter(item => wanted.includes(item.id) && !item.isRead).length
    if (!changed) return

    for (const item of items.value) {
      if (wanted.includes(item.id)) item.isRead = true
    }
    unreadCount.value = Math.max(0, unreadCount.value - changed)

    try {
      await $fetch('/api/public/reader/notifications/read', {
        method: 'POST',
        body: { ids: wanted },
      })
    } catch {
      // Swallowed: see above. The badge self-corrects on the next load.
    }
  }

  async function markAllRead(): Promise<void> {
    if (!unreadCount.value) return

    for (const item of items.value) item.isRead = true
    unreadCount.value = 0

    try {
      await $fetch('/api/public/reader/notifications/read', {
        method: 'POST',
        body: { all: true },
      })
    } catch {
      // Swallowed: see above.
    }
  }

  /** Drop everything. Called on sign-out so the next reader on a shared machine
   *  never sees the previous one's count. */
  function reset(): void {
    items.value = []
    unreadCount.value = 0
    total.value = 0
    page.value = 1
    totalPages.value = 1
    loaded.value = false
    failed.value = false
    // Drop the shared promise too: a sign-out mid-request would otherwise leave
    // the next reader's first load waiting on the previous reader's response.
    inFlight = null
  }

  return {
    items:       computed(() => items.value),
    unreadCount: computed(() => unreadCount.value),
    total:       computed(() => total.value),
    page:        computed(() => page.value),
    totalPages:  computed(() => totalPages.value),
    pending:     computed(() => pending.value),
    failed:      computed(() => failed.value),
    loaded:      computed(() => loaded.value),
    load,
    markRead,
    markAllRead,
    reset,
  }
}
