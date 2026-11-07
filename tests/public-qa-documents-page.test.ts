import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse } from '@vue/compiler-sfc'
import { chatSurfaceTemplate } from './_component-family.ts'
import { inVietnamese } from './_vi-template.ts'

/**
 * The approved knowledge bank as a page a visitor can browse.
 *
 * Before this existed, the bank was reachable only by asking the assistant a
 * question that happened to match a row, then expanding the citation. Someone who
 * simply wanted to read what has been approved had no way in.
 *
 * These assertions inspect source text and the compiled template, so they pin
 * structure — the loading/error/empty contract, accordion semantics, routes — and
 * not runtime behaviour. That boundary is deliberate: a claim about source text
 * should never be read as a claim about what a visitor sees. What the ENDPOINT
 * serves (published only, no internal field, caps, failure shape) is run for real in
 * tests/public-qa-knowledge-list-behavior.test.ts.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

const PAGE = '../app/pages/qa-documents.vue'
const CHAT_SURFACES = ['../app/components/ChatWidget.vue', '../app/pages/assistant.vue'] as const

const template = (path: string) => parse(read(path), { filename: path }).descriptor.template?.content ?? ''

/**
 * Every "this must not appear" assertion below runs against stripped source.
 * Without this, a comment explaining *why* `internalNotes` must stay on the
 * server, or why `v-html` is the wrong tool for approved prose, fails the very
 * test it documents — which teaches the next person to delete the explanation
 * instead of keeping the guard.
 */
const stripComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // `[^:]` keeps `https://` out of the line-comment case.
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1')

const code = (path: string) => stripComments(read(path))
const templateCode = (path: string) => stripComments(template(path))

// ─── Endpoint ────────────────────────────────────────────────────────────────
// The list endpoint (published-only list/total/facet, no internal field on the wire, the
// perPage cap, NaN page, an unknown topic as an empty page, ok:false on failure) is run for real
// in tests/public-qa-knowledge-list-behavior.test.ts. The page's own half of the NaN rule stays:

test('a non-numeric page falls back instead of becoming NaN (the page side)', () => {
  // Found by calling the endpoint: `?page=abc` under `Math.max(1, Number(raw))`
  // produced `page: null` in the response and `NaN` in `offset()` — a paginator
  // that returns rows while reporting no current page. The handler's half is run in
  // tests/public-qa-knowledge-list-behavior.test.ts; the page parses it too.
  const pageSource = code(PAGE)
  assert.match(pageSource, /Number\.isFinite\(value\) && value >= 1/, 'the page must reject NaN too')
  assert.doesNotMatch(pageSource, /Math\.max\(1, Number\(route\.query\.page/, 'this form yields NaN for non-numeric input')
})

// ─── Page: the loading / error / empty contract ──────────────────────────────

test('the page renders all three data states', () => {
  const source = template(PAGE)
  assert.match(source, /v-if="pending"/, 'a page with no loading branch looks loaded and blank')
  assert.match(source, /v-else-if="loadError"/, 'without an error branch a failed fetch reads as an empty bank')
  assert.match(source, /v-else-if="entries\.length === 0"/, 'an empty bank needs its own wording')
})

test('the error branch announces itself and retries the failed fetch', () => {
  const source = template(PAGE)
  const errorTag = source.match(/<[^>]*v-else-if="loadError"[^>]*>/)?.[0]
  assert.ok(errorTag, 'the error branch moved')
  assert.match(errorTag, /role="alert"/, 'a red box is silent to screen readers without this')
  assert.match(source, /@click="refresh\(\)"/, 'retry must re-run the failed fetch')
  assert.doesNotMatch(templateCode(PAGE), /location\.reload/, 'reloading the page to re-run one request throws away all other state')
})

test('the loading skeleton is announced and honours reduced motion', () => {
  const source = template(PAGE)
  const container = source.match(/<div\s+v-if="pending"[\s\S]{0,400}?>/)?.[0] ?? ''
  assert.match(container, /role="status"/, 'the skeleton container needs role="status"')
  assert.match(container, /aria-busy="true"/)
  assert.match(source, /sr-only">Đang tải tài liệu hỏi – đáp/, 'the skeleton needs a Vietnamese text label')

  // A full-page pulse is exactly the motion `prefers-reduced-motion` exists to
  // turn off, and this file is not on the decorative-pulse allowlist.
  for (const tag of source.match(/<[^>]*\banimate-pulse[^>]*>/g) ?? []) {
    assert.ok(tag.includes('motion-reduce:animate-none'), `animate-pulse without a guard: ${tag.slice(0, 120)}`)
  }
  assert.ok((source.match(/\banimate-pulse\b/g) ?? []).length >= 1, 'the page must render a skeleton')
  assert.match(source, /aria-hidden="true"/, 'the grey boxes must be hidden from screen readers')
})

// ─── Page: approved text is text ─────────────────────────────────────────────

test('approved answers are rendered as text, never as markup', () => {
  // This is the assistant's own answer text. `v-html` would put knowledge-bank
  // content on a path that executes markup.
  assert.doesNotMatch(templateCode(PAGE), /v-html/, 'approved content must not be rendered as HTML')
  assert.match(template(PAGE), /whitespace-pre-line/, 'the paragraph and numbering breaks the officers wrote must survive')
})

test('the page has no scoped style block', () => {
  // Project rule: new work is Tailwind utilities. The exception is pseudo-elements
  // and keyframes, and this page needs neither.
  assert.ok(!read(PAGE).includes('<style'), 'new pages must not declare a <style> block')
})

// ─── Page: accordion semantics ───────────────────────────────────────────────

test('each entry is an accordion button that reports its own state', () => {
  const source = template(PAGE)
  assert.match(source, /:aria-expanded="isOpen\(item\.id\)"/, 'the toggle must announce expansion')
  assert.match(source, /:aria-controls="`qa-answer-\$\{item\.id\}`"/, 'the toggle must point at the panel it controls')
  assert.match(source, /:id="`qa-answer-\$\{item\.id\}`"/, 'the panel needs the id aria-controls names')
})

test('an entry can be deep-linked and opens on arrival', () => {
  // This is where a chat citation lands. Arriving at a collapsed list with
  // nothing open would read as a broken link.
  const source = read(PAGE)
  assert.match(source, /replace\('#qa-', ''\)/, 'the hash must resolve to a row id')
  assert.match(template(PAGE), /:id="`qa-\$\{item\.id\}`"/, 'each entry needs the anchor the hash targets')
  assert.match(source, /watch\(highlightId/, 'the targeted entry must be opened, not merely scrolled to')
  assert.match(template(PAGE), /scroll-mt-24/, 'the anchor must clear the sticky header')
})

test('multiple entries stay open independently', () => {
  // The single-`activeIndex` accordion on /legal-qa closes one panel to open the
  // next. Here a visitor is reading and comparing, so collapsing their previous
  // answer to show another is the wrong trade.
  const source = read(PAGE)
  // Nhận cả `ref(new Set())` và `ref<Set<number>>(new Set())` — tham số kiểu là
  // bắt buộc từ khi tệp này bật `lang="ts"` (một `new Set()` trần suy ra
  // `Set<unknown>`, nên `.has(id)` nhận mọi thứ). Điều test này bảo vệ là **cấu
  // trúc dữ liệu**: một tập hợp, không phải một `activeIndex` đơn lẻ.
  assert.match(source, /const openIds = ref(?:<Set<number>>)?\(new Set\(\)\)/,
    'open state must hold a set, not one index')
})

// ─── Page: filters live in the URL ───────────────────────────────────────────

test('search, topic and page are read from the route, not from local state', () => {
  // A filtered view has to survive being shared, bookmarked, or reloaded — and the
  // deep link from chat depends on the route being the source of truth.
  const source = read(PAGE)
  for (const key of ['q', 'topic', 'page']) {
    assert.match(source, new RegExp(`route\\.query\\.${key}`), `${key} must come from the URL`)
  }
  assert.match(source, /lazy: true/, 'without lazy the skeleton never paints on a filter change')
})

test('the topic filter reports which option is active', () => {
  const source = template(PAGE)
  assert.match(source, /:aria-pressed="activeTopic === item\.topic"/, 'each topic button must report its state')
  assert.match(source, /:aria-pressed="!activeTopic"/, 'the "Tất cả" button must report its state too')
})

// ─── The link from chat ──────────────────────────────────────────────────────

test('both chat surfaces link a citation to the full page', () => {
  // The in-place expand stays: it answers "what did you just cite" without
  // throwing the visitor out of their conversation. This link answers the next
  // question — the surrounding topic — and it is the reason the page exists.
  for (const file of CHAT_SURFACES) {
    // The widget as its whole family since its wave3 split (tests/_component-family.ts); the
    // wording through `t()`, read in Vietnamese (tests/_vi-template.ts).
    const source = inVietnamese(chatSurfaceTemplate(file))
    assert.match(
      source,
      /:to="`\/qa-documents#qa-\$\{source\.entryId\}`"/,
      `${file} must deep-link the cited entry`,
    )
    assert.match(source, /Mở trong Tài liệu Hỏi – Đáp/, `${file} link text changed wording`)
    // The expand-in-place affordance must survive: replacing it with a link would
    // make reading a citation cost the visitor their conversation.
    assert.match(source, /toggleSourceDetail\(source\.entryId\)/, `${file} must keep the in-place expand`)
  }
})

// ─── Reachability ────────────────────────────────────────────────────────────

test('the page is reachable without going through the assistant', () => {
  // An endpoint and a page nobody can navigate to is not a feature. The footer is
  // the assertion that matters: the header nav is built from admin settings and
  // `DEFAULT_NAV` is only the fallback, so a deployment whose officers have saved
  // a custom menu would not show the header entry at all.
  const footer = read('../app/components/layout/DefaultFooter.vue')
  assert.match(footer, /to="\/qa-documents"/, 'the footer must link the page')
  // `DEFAULT_NAV` moved to `app/utils/nav-config.ts`, where the shape checks that
  // guard admin-supplied nav config are testable without mounting the layout
  // (`tests/nav-config-boundary.test.ts`). The claim is about reachability, not
  // about which file holds the table.
  const navConfig = read('../app/utils/nav-config.ts')
  assert.match(navConfig, /url: '\/qa-documents'/, 'the default nav must offer the page too')
  // The nav labels come from the dictionary, so a missing key renders as the raw URL.
  const dictionary = read('../app/composables/i18n-default-dictionary.ts')
  for (const key of ['faq_articles', 'faq_approved_docs']) {
    assert.ok(
      (dictionary.match(new RegExp(`${key}:`, 'g')) ?? []).length === 2,
      `${key} must be defined in both VN and EN, otherwise the nav shows a raw URL`,
    )
  }
})

test('the page is cached like the other public reading pages', () => {
  // Same reasoning as /legal-qa: content changes only when an officer publishes,
  // and every visitor sees the same list, so there is nothing private to leak.
  assert.match(read('../nuxt.config.ts'), /'\/qa-documents': \{ swr: 60 \}/)
})
