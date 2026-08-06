import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse } from '@vue/compiler-sfc'

/**
 * The approved knowledge bank as a page a visitor can browse.
 *
 * Before this existed, the bank was reachable only by asking the assistant a
 * question that happened to match a row, then expanding the citation. Someone who
 * simply wanted to read what has been approved had no way in.
 *
 * These assertions inspect source text and the compiled template, so they pin
 * structure — a published-only query, no internal fields on the wire, the
 * loading/error/empty contract — and not runtime behaviour. That boundary is
 * deliberate: a claim about source text should never be read as a claim about
 * what a visitor sees.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

const PAGE = '../app/pages/qa-documents.vue'
const HANDLER = '../server/api/public/chatbot/knowledge.get.ts'
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

test('the list endpoint serves published rows only', () => {
  // A draft is an answer nobody has approved yet. The whole lifecycle in
  // chatbot-knowledge.ts exists to keep unapproved legal text off the portal, and
  // a list endpoint that forgot this clause would undo all of it at once.
  const handler = read(HANDLER)
  assert.match(handler, /eq\(chatbotKnowledge\.status, 'published'\)/, 'drafts must never be served publicly')
})

test('the list endpoint never puts internal fields on the wire', () => {
  // The projection goes through `serializePublicKnowledge` rather than naming
  // columns here, so a column added to the table later cannot leak by default.
  assert.match(read(HANDLER), /serializePublicKnowledge/, 'the public serializer must build the projection')
  const handler = code(HANDLER)
  for (const secret of ['internalNotes', 'sourceInternal', 'apiKey', 'authorId', 'reviewerId']) {
    assert.doesNotMatch(handler, new RegExp(secret, 'i'), `${secret} must not leave the server`)
  }
})

test('the topic facet counts published rows only', () => {
  // Deriving the facet from the whole table would advertise a topic with nothing
  // published under it; picking it would return an empty list and no explanation.
  const handler = read(HANDLER)
  const facet = handler.match(/const topicRows[\s\S]*?\.limit\(\d+\)/)?.[0]
  assert.ok(facet, 'the topic facet query moved; re-check that it filters by status')
  assert.match(facet, /eq\(chatbotKnowledge\.status, 'published'\)/)
  assert.match(facet, /groupBy\(chatbotKnowledge\.topic\)/)
})

test('a failed query is distinguishable from an empty bank', () => {
  // `ok: false` is what the page turns into its error branch. Returning an empty
  // list on failure would render as "nothing has been approved yet", and a
  // visitor would leave believing the portal has no answers.
  const handler = read(HANDLER)
  assert.match(handler, /return \{ ok: false, items: \[\], topics: \[\]/, 'a caught failure must report ok: false')
  assert.match(handler, /ok: true/, 'the success path must report ok: true')
})

test('an unknown topic yields an empty page rather than an error', () => {
  // The filter arrives in a URL a visitor can edit or share. A 400 on a stale
  // link reads as the portal being broken.
  assert.doesNotMatch(code(HANDLER), /createError/, 'a bad filter must not throw; it must return an empty page')
})

test('per-page is capped so one request cannot ask for the whole bank', () => {
  assert.match(code(HANDLER), /readInt\(query\.perPage, 20, 1, 50\)/)
})

test('a non-numeric page falls back instead of becoming NaN', () => {
  // Found by calling the endpoint: `?page=abc` under `Math.max(1, Number(raw))`
  // produced `page: null` in the response and `NaN` in `offset()` — a paginator
  // that returns rows while reporting no current page. Both the handler and the
  // page parse this, so both need the finite check.
  const handler = code(HANDLER)
  assert.match(handler, /Number\.isFinite\(value\)/, 'the handler must reject NaN before clamping')
  assert.doesNotMatch(handler, /Math\.max\(1, Number\(query\.page/, 'this form yields NaN for non-numeric input')

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
  assert.match(source, /const openIds = ref\(new Set\(\)\)/, 'open state must hold a set, not one index')
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
    const source = template(file)
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
  const layout = read('../app/layouts/default.vue')
  assert.match(layout, /to="\/qa-documents"/, 'the footer must link the page')
  assert.match(layout, /url: '\/qa-documents'/, 'the default nav must offer the page too')
  // The nav labels come from the dictionary, so a missing key renders as the raw URL.
  const dictionary = read('../app/composables/useI18n.ts')
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
