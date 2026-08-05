/**
 * Reader identity, shared by the header and the comment form.
 *
 * State lives at MODULE level, not per call: the header and the comment section
 * are two components on the same page, and a per-call ref would have each of them
 * fetch `/api/public/reader/me` separately and then disagree — the header could
 * show a name while the comment box still offered a sign-in button.
 *
 * The fetch happens ONLY after mount, and only once. Public article routes are
 * served with `swr: 60` (nuxt.config.ts), so anything reader-specific that
 * entered server-rendered HTML would be handed to the next visitor from the
 * cache. This is the same shape the view-counter ping in ArticleDetail.vue
 * already uses, and the reason no route is added to `routeRules` for any of this.
 */
import { computed, ref } from 'vue'

export type ReaderProfile = {
  displayName: string
  email:       string | null
  initials:    string
}

/** Module-level: one identity per page, not one per component. */
const reader = ref<ReaderProfile | null>(null)
const loading = ref(false)
const loaded = ref(false)
const failed = ref(false)

/** Reasons the portal refused a sign-in, as the OAuth endpoints report them. */
const SIGN_IN_MESSAGES: Record<string, string> = {
  disabled:          'Đăng nhập bằng Google hiện đang tắt trên cổng thông tin.',
  not_configured:    'Đăng nhập bằng Google chưa được cấu hình. Vui lòng liên hệ ban quản trị.',
  secret_unreadable: 'Đăng nhập bằng Google đang gặp sự cố cấu hình. Vui lòng liên hệ ban quản trị.',
  rate_limited:      'Bạn đã thử đăng nhập quá nhiều lần. Vui lòng chờ ít phút rồi thử lại.',
  ip_banned:         'Địa chỉ của bạn đã bị hạn chế bình luận trên cổng thông tin.',
  account_banned:    'Tài khoản của bạn đã bị hạn chế bình luận trên cổng thông tin.',
  failed:            'Không thể hoàn tất đăng nhập. Vui lòng thử lại.',
}

export function useReaderAuth() {
  async function load(force = false): Promise<void> {
    if (loading.value) return
    if (loaded.value && !force) return

    loading.value = true
    failed.value = false
    try {
      const response = await $fetch<{ ok: boolean, reader: ReaderProfile | null }>('/api/public/reader/me')
      reader.value = response?.reader ?? null
      loaded.value = true
    } catch {
      // A failed identity lookup means "not signed in" as far as the page is
      // concerned. It must never turn a readable article into an error page.
      reader.value = null
      failed.value = true
    } finally {
      loading.value = false
    }
  }

  /**
   * Leave for Google, carrying where to come back to.
   *
   * A full navigation, not a fetch: the OAuth flow is a sequence of top-level
   * redirects through accounts.google.com and cannot happen inside XHR.
   */
  function signIn(returnPath?: string): void {
    if (typeof window === 'undefined') return
    const target = returnPath || `${window.location.pathname}${window.location.search}`
    window.location.href = `/api/auth/google/start?return_to=${encodeURIComponent(target)}`
  }

  async function signOut(): Promise<void> {
    try {
      await $fetch('/api/public/reader/logout', { method: 'POST' })
    } catch {
      // Ignored on purpose: the cookie is HTTP-only, so if the request did not
      // land there is nothing the client can do about it, and showing an error
      // for a failed sign-out only makes the reader click again.
    }
    reader.value = null
    loaded.value = true
  }

  /**
   * Drop the cached identity WITHOUT calling the logout endpoint.
   *
   * For when the server has already told us the ticket is no longer accepted — a
   * 401 on a write because the 30-day expiry elapsed while the page sat open, or
   * because `tokenVersion` was bumped by a ban. Calling `signOut` there would be
   * a pointless round trip to clear a cookie the server has already rejected.
   *
   * The important part is what this fixes on screen: without it the compose box
   * stays rendered (`isSignedIn` is still true from stale state) showing "Chưa
   * đăng nhập" as an error, and the reader has no sign-in button to press — a
   * dead end where the only way out is a manual page reload.
   */
  function forgetReader(): void {
    reader.value = null
    loaded.value = true
  }

  /** Turn a `?dangnhap=` reason into a sentence, or null when there is none. */
  function signInMessage(reason: unknown): string | null {
    if (typeof reason !== 'string' || !reason) return null
    return SIGN_IN_MESSAGES[reason] ?? SIGN_IN_MESSAGES.failed!
  }

  return {
    reader:      computed(() => reader.value),
    isSignedIn:  computed(() => reader.value !== null),
    loading:     computed(() => loading.value),
    loaded:      computed(() => loaded.value),
    failed:      computed(() => failed.value),
    load,
    signIn,
    signOut,
    forgetReader,
    signInMessage,
  }
}
