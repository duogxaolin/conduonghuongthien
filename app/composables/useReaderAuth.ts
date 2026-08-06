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
  /** The name the reader chose, or null when the Google one is showing. */
  customDisplayName?: string | null
}

/** Module-level: one identity per page, not one per component. */
const reader = ref<ReaderProfile | null>(null)
const loading = ref(false)
const loaded = ref(false)
const failed = ref(false)

/**
 * Where the chat widget keeps `{id, token}` per conversation.
 *
 * Duplicated from useChatbot.ts rather than imported, and the duplication is the
 * lesser evil: importing it would pull the whole chatbot composable — its
 * module-level conversation state, its typewriter timers — into every page that
 * renders a header. This composable needs one string.
 */
const CHAT_SESSIONS_KEY = 'cdkt_sessions_v1'

/** Set once per browser session after a claim attempt, successful or not. */
const CLAIM_FLAG_KEY = 'cdkt_chats_claimed_v1'

/**
 * Drop the once-per-session claim flag.
 *
 * Called on sign-out and whenever the server stops accepting the ticket. Without
 * it, a shared computer breaks in a specific way: reader A signs in, the flag is
 * set, A signs out, B signs in — and B's conversations are never offered for
 * claiming, because the flag says this browser session already asked. The flag
 * means "this ACCOUNT has been asked", so it has to die with the account's session.
 */
function clearClaimFlag(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(CLAIM_FLAG_KEY)
  } catch {
    // Private browsing can refuse storage access; nothing here is load-bearing.
  }
}

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
  /**
   * Hand the server the tickets for conversations held in this browser, so they
   * attach to the account.
   *
   * Once per browser session, flagged in `sessionStorage`. Not `localStorage`: a
   * conversation started later in the same browser would then never be claimed,
   * because the flag from months ago would still be set.
   *
   * Everything here is swallowed. This runs on every page load for every signed-in
   * reader, on pages whose job is to display an article — a failed claim has no
   * standing to surface an error, and the reader can always retry from /nguoi-doc.
   */
  async function claimChats(): Promise<void> {
    if (typeof window === 'undefined') return
    try {
      if (sessionStorage.getItem(CLAIM_FLAG_KEY)) return

      const raw = localStorage.getItem(CHAT_SESSIONS_KEY)
      if (!raw) return

      const parsed = JSON.parse(raw) as { sessions?: unknown }
      if (!Array.isArray(parsed?.sessions)) return

      // Only entries that actually carry a ticket. A conversation the visitor
      // started but never sent a message in has `token: null` — there is nothing
      // to prove and no row on the server to attach.
      const sessions = parsed.sessions
        .filter((item): item is { token: string } =>
          !!item && typeof item === 'object' && typeof (item as { token?: unknown }).token === 'string' && !!(item as { token: string }).token)
        .map(item => ({ token: item.token }))

      // The flag is set even when there is nothing to send: the answer would be
      // the same on every subsequent page load in this session.
      sessionStorage.setItem(CLAIM_FLAG_KEY, '1')
      if (!sessions.length) return

      await $fetch('/api/public/reader/claim-chats', { method: 'POST', body: { sessions } })
    } catch {
      // Deliberately silent — see above.
    }
  }

  async function load(force = false): Promise<void> {
    if (loading.value) return
    if (loaded.value && !force) return

    loading.value = true
    failed.value = false
    try {
      const response = await $fetch<{ ok: boolean, reader: ReaderProfile | null }>('/api/public/reader/me')
      reader.value = response?.reader ?? null
      loaded.value = true
      // Only once identity is confirmed: an anonymous visitor has no account to
      // attach conversations to, and the endpoint would reject them anyway.
      if (reader.value) void claimChats()
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
    clearClaimFlag()
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
    clearClaimFlag()
  }

  /**
   * Update the cached identity after a successful rename.
   *
   * The state is module-level, so this is what makes the header change the moment
   * the profile form saves. Without it the reader would see their new name in the
   * form and the old one in the header until the next full page load, and the
   * obvious reading of that is that the rename did not take.
   */
  function applyDisplayName(next: { displayName: string, initials: string }): void {
    if (!reader.value) return
    reader.value = {
      ...reader.value,
      displayName:       next.displayName,
      initials:          next.initials,
      customDisplayName: next.displayName,
    }
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
    applyDisplayName,
    /** Exposed so /nguoi-doc can offer a retry button; `load()` already runs it
     *  once per browser session on its own. */
    claimChats,
    /** Exposed for the same retry: without clearing the flag, pressing the button
     *  a second time would return immediately having done nothing. */
    clearClaimFlag,
  }
}
