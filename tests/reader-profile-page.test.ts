/**
 * Contract for the reader's own profile page (`/profile`).
 *
 * This page is different from every other public page in one way that governs
 * everything below: its content is ONE person's — their name, their email, their
 * comments, their conversations. Every other public route is served with
 * `swr: 60`, so the ordinary rules of this codebase are not enough here; the
 * page has to be actively kept OUT of that machinery.
 *
 * Five things are pinned:
 *
 *   1. `/profile` is absent from `routeRules`. An SWR window on this route hands
 *      one citizen's page to whoever visits next inside 60 seconds.
 *   2. Nothing is fetched during SSR. Same reason: reader data that reaches
 *      server-rendered HTML can be replayed from cache.
 *   3. No `v-html`, anywhere. Comment bodies, chat titles and article titles are
 *      text people typed.
 *   4. Every data block has all three branches (loading / error / empty), the
 *      error branch carries `role="alert"`, and the retry calls a function defined
 *      in this file — never `location.reload()`.
 *   5. Every `animate-pulse` is paired with `motion-reduce:animate-none`, per tag.
 *
 * LIMITATION, stated for the same reason tests/admin-error-retry-ui.test.ts states
 * it: these are assertions about SOURCE TEXT. Nothing is mounted. They prove the
 * branches and handlers exist and will fail loudly when one is deleted; they prove
 * nothing about whether a branch paints or whether a retry recovers.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse } from '@vue/compiler-sfc'

const PAGE = 'app/pages/profile.vue'
const source = readFileSync(new URL(`../${PAGE}`, import.meta.url), 'utf8')
const { descriptor } = parse(source)
const template = descriptor.template?.content ?? ''
const script = descriptor.scriptSetup?.content ?? ''

/** Template with HTML comments removed.
 *
 *  The comments in this page explain, in prose, the very things that must not
 *  appear in it — "không `v-html`", "không `location.reload()`". Asserting against
 *  the raw template would make each explanation fail the rule it explains, and the
 *  lesson learned would be to delete the explanation rather than to keep the
 *  guard. Same approach as tests/public-qa-documents-page.test.ts.
 */
const markup = template.replace(/<!--[\s\S]*?-->/g, '')

/** Script with comments removed, for the same reason. */
const code = script
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '')

// ─── 1. The cache-safety constraint ─────────────────────────────────────────

test('/profile is NOT given a cache rule', () => {
  const config = readFileSync(new URL('../nuxt.config.ts', import.meta.url), 'utf8')
  const rules = config.slice(config.indexOf('routeRules:'), config.indexOf('runtimeConfig:'))

  /**
   * `/profile` appears in routeRules as the TARGET of the 301 from the old
   * `/nguoi-doc` path — that mention is required, and matching on the bare word
   * would fail on it. What must never exist is a rule keyed on the route itself,
   * because that is the shape that could carry `swr`.
   */
  assert.doesNotMatch(
    rules,
    /['"]\/profile(\/\*\*)?['"]\s*:/,
    'an SWR window on /profile serves one reader\'s name, email, comments and chat '
    + 'transcripts to the next visitor inside the same 60 seconds',
  )

  // The redirect itself must survive: /nguoi-doc was live, shared and indexed.
  assert.match(
    rules,
    /['"]\/nguoi-doc['"]\s*:\s*\{\s*redirect/,
    'the 301 from the old /nguoi-doc path is gone — every link already shared now 404s',
  )
})

test('the profile page fetches nothing during server rendering', () => {
  // useFetch/useAsyncData run on the server during SSR. The identity, the comment
  // list and the chat list must all arrive after mount — the same shape the
  // view-counter ping and the comment thread already use.
  assert.doesNotMatch(code, /useFetch\(/, 'useFetch runs during SSR — reader data would enter cacheable HTML')
  assert.doesNotMatch(code, /useAsyncData\(/, 'useAsyncData runs during SSR — same problem')
  assert.match(code, /onMounted\(/, 'nothing loads after mount, so the page has no data at all')
})

test('the page body is wrapped in client-only with no fallback', () => {
  // Anchored to lines that ARE the tags: a bare /<client-only>/ also matches the
  // prose above the template explaining why the tag is there, so deleting the tag
  // while keeping the comment would leave this green.
  assert.match(template, /^\s*<client-only>\s*$/m, 'the page renders reader state during SSR')
  assert.match(template, /^\s*<\/client-only>\s*$/m, 'the client-only wrapper is not closed')
  assert.doesNotMatch(
    markup,
    /<client-only[^>]*>[\s\S]*?<template #fallback>/,
    'a fallback flashes "not signed in" at a reader who is signed in',
  )
})

// ─── 2. Plain text, never HTML ──────────────────────────────────────────────

test('nothing on the profile page is rendered as HTML', () => {
  assert.doesNotMatch(
    markup,
    /v-html/,
    'comment bodies, chat titles and article titles are text a person typed; '
    + 'rendering them as HTML is stored XSS on a page that shows a citizen their own words',
  )
})

test('comment bodies keep their line breaks without a formatter rewriting them', () => {
  // The server stores bodies verbatim precisely because the template cannot
  // interpret them (design.md D12). `whitespace-pre-line` is what makes the
  // paragraph the citizen typed still read as paragraphs.
  assert.match(markup, /whitespace-pre-line/, 'comment line breaks collapse into one run-on paragraph')
  assert.match(markup, /break-words/, 'a long unbroken string overflows the card on a phone')
})

// ─── 3. Loading / error / empty, per block ──────────────────────────────────

/**
 * The blocks that load data, with the ref their rejection lands in and the fetch
 * their retry re-runs.
 *
 * The identity block is deliberately absent: it has no fetch of its own — it reads
 * `useReaderAuth`, whose failure means "not signed in", which the page answers with
 * the sign-in block rather than an error.
 */
const DATA_BLOCKS: Array<{ label: string, pending: string, error: string, retry: string, empty: RegExp }> = [
  {
    label: 'bình luận của tôi',
    pending: 'commentsPending',
    error: 'commentsError',
    retry: 'loadComments',
    empty: /myComments\.length/,
  },
  {
    label: 'đoạn chat của tôi',
    pending: 'chatsPending',
    error: 'chatsError',
    retry: 'loadChats',
    empty: /myChats\.length/,
  },
]

for (const block of DATA_BLOCKS) {
  test(`khối "${block.label}" có đủ ba nhánh tải / lỗi / rỗng`, () => {
    // All three, not two: without the loading branch the page looks loaded and
    // empty, and without the error branch a failed fetch reads exactly like
    // "you have never commented" — so the reader concludes their comments are gone.
    assert.match(markup, new RegExp(`v-if="${block.pending}"`), `${block.label}: nhánh tải bị mất`)
    assert.match(markup, new RegExp(`v-else-if="${block.error}"`), `${block.label}: nhánh lỗi bị mất`)
    assert.match(markup, block.empty, `${block.label}: nhánh rỗng bị mất`)
  })

  test(`khối "${block.label}" có ref lỗi trong script`, () => {
    assert.match(
      code,
      new RegExp(`const ${block.error} = ref\\(`),
      `${block.label}: không có nơi nào để một lượt fetch hỏng rơi vào`,
    )
  })

  test(`nút thử lại của khối "${block.label}" gọi lại chính lượt fetch đã hỏng`, () => {
    assert.match(
      code,
      new RegExp(`(async )?function ${block.retry}\\(`),
      `${block.retry} không được khai báo trong tệp này — nút thử lại trỏ vào hư không`,
    )
    assert.match(
      markup,
      new RegExp(`@click="${block.retry}"`),
      `${block.label}: nút thử lại không gọi ${block.retry}`,
    )
  })
}

test('every persistent error branch is announced to assistive technology', () => {
  // Without role="alert" a sighted reader sees a red box and a screen-reader user
  // is told nothing at all — the failed fetch reads exactly like a page that
  // finished loading with nothing in it.
  const alerts = markup.match(/role="alert"/g)?.length ?? 0
  // One per data block, plus the rename form's own error.
  assert.ok(
    alerts >= DATA_BLOCKS.length + 1,
    `only ${alerts} error branches carry role="alert"; expected at least ${DATA_BLOCKS.length + 1}`,
  )
})

test('the page never reloads the document to retry one request', () => {
  assert.doesNotMatch(
    code + markup,
    /location\.reload\(/,
    'reloading the page to re-run one request throws away the other blocks\' loaded '
    + 'state and anything half-typed in the rename form',
  )
})

// ─── 4. Reduced motion ──────────────────────────────────────────────────────

test('every animate-pulse carries motion-reduce:animate-none', () => {
  // Per TAG, not per file: a page with two skeletons where only one is guarded
  // still passes a file-level check. prefers-reduced-motion is an accessibility
  // setting for people with vestibular disorders, and a pulsing full-width
  // placeholder is exactly the motion it exists to switch off.
  const offenders: string[] = []
  for (const tag of markup.match(/<[^>]*animate-pulse[^>]*>/g) ?? []) {
    if (!tag.includes('motion-reduce:animate-none')) offenders.push(tag.trim().slice(0, 90))
  }
  assert.deepEqual(offenders, [], `animate-pulse without a reduced-motion guard:\n${offenders.join('\n')}`)
})

test('each loading container announces itself and hides its grey boxes', () => {
  // Without this a screen reader reads out a string of meaningless empty boxes
  // instead of "đang tải bình luận của bạn".
  const containers = markup.match(/role="status"[^>]*aria-busy="true"/g)?.length ?? 0
  assert.ok(containers >= DATA_BLOCKS.length, `only ${containers} loading containers are announced`)
  assert.match(markup, /class="sr-only">Đang tải/, 'no Vietnamese label for what is loading')
  assert.match(markup, /aria-hidden="true"/, 'the grey placeholder boxes are read out as content')
})

// ─── 5. The privacy trade-off has to be stated, not inferred ────────────────

test('the page says out loud that reading history is per-device', () => {
  /**
   * This is a UI assertion standing in for a privacy decision (design.md D-A).
   *
   * Reading history lives in localStorage specifically so that no table exists
   * recording which citizen read which article — on a portal whose readers are
   * people with criminal records looking up their own legal position. The cost is
   * that the list is per device, and a reader who assumes it follows their account
   * will conclude the portal lost their data. Saying so is part of the decision,
   * not decoration around it.
   */
  assert.match(markup, /thiết bị này/, 'the per-device limitation is not stated anywhere on the page')
  assert.match(
    markup,
    /không lưu trên máy chủ/,
    'the page does not say the history stays off the server — which is the whole reason it is per-device',
  )
})

test('the profile page is excluded from search indexing', () => {
  assert.match(code, /robots:\s*'noindex/, 'a private page is offered to search engines')
})

// ─── 6. Session expiry must not become a dead end ───────────────────────────

test('a 401 mid-session drops the cached identity, and a 403 does not', () => {
  /**
   * The ticket lives 30 days and a ban bumps `tokenVersion` immediately, so the
   * server can start refusing writes while this page is open.
   *
   * On 401 the page must forget the reader, so the compose surfaces are replaced by
   * a sign-in block. Without it `reader` stays truthy, the form stays on screen with
   * an error under it, and there is no sign-in button anywhere — a dead end whose
   * only exit is a manual reload.
   *
   * On 403 it must NOT: that is a ban. The reader IS still signed in, and inviting
   * them to sign in again invites an attempt that will succeed and change nothing,
   * which reads as the portal being broken rather than as somebody's decision.
   */
  // Nhận cả `err?.statusCode === 401` và `errorStatus(err) === 401`: kể từ khi tệp
  // này bật `lang="ts"`, việc dò bốn đường trên một giá trị `unknown` đi qua helper
  // dùng chung `errorStatus()` (nó bao cả `statusCode`, `status`, `response.status`,
  // tức là **rộng hơn** phép đọc cũ). Điều test này bảo vệ không phải cách viết mà
  // là sự **bất đối xứng giữa 401 và 403**, và cả hai khẳng định dưới đây vẫn nói
  // đúng điều đó.
  assert.match(code, /(?:statusCode|errorStatus\(\w+\)) === 401/,
    'an expired ticket leaves the reader in a dead end')
  assert.match(code, /forgetReader\(\)/, 'nothing clears the stale identity')
  assert.doesNotMatch(
    code,
    /(?:statusCode|errorStatus\(\w+\)) === 403[\s\S]{0,80}forgetReader/,
    'a banned reader is invited to sign in again, which changes nothing and reads as a broken portal',
  )
})
