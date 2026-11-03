/**
 * `app/utils/i18n-placeholders.ts` — chỗ trống `{tên}` trong chuỗi dịch, và khoá số ít.
 *
 * Kiểm chứng độc lập (CHANGELOG § 71): (1) `name in values` nhận cả thuộc tính của prototype —
 * một bản dịch quản trị gõ "{constructor}" thành `function Object() { [native code] }`;
 * (2) bản tiếng Anh nói "1 matching results", "1 messages", "1 results".
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { conversationMetaText } from '../app/utils/chat-i18n.ts'
import { countKey, fillPlaceholders, splitPlaceholders } from '../app/utils/i18n-placeholders.ts'
import { dbI18n } from './_i18n-db.ts'
import { mountPublic, routes } from './_public-mount-harness.ts'
import { textOf } from './_sfc-mount.ts'

describe('fillPlaceholders / splitPlaceholders', () => {
  it('fills the named holes, in the translation\'s own order', () => {
    assert.equal(fillPlaceholders('Page {page} of {total}', { page: 2, total: 9 }), 'Page 2 of 9')
    assert.deepEqual(splitPlaceholders('Trang {page} trên tổng số {total} trang', { page: 2, total: 9 }), [
      { text: 'Trang ', value: false }, { text: '2', value: true }, { text: ' trên tổng số ', value: false }, { text: '9', value: true }, { text: ' trang', value: false },
    ])
  })

  it('a hole with no value of its own stays as written — prototype names included', () => {
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'missing']) {
      const text = `A {${name}} B`
      assert.equal(fillPlaceholders(text, { n: 1 }), text, name)
      assert.deepEqual(splitPlaceholders(text, { n: 1 }), [{ text, value: false }], name)
    }
    // Its own value, even under a prototype name, is used.
    assert.equal(fillPlaceholders('{constructor}', { constructor: 'x' }), 'x')
  })

  it('a value of 0 or "" is a value', () => {
    assert.equal(fillPlaceholders('{n} results', { n: 0 }), '0 results')
    assert.deepEqual(splitPlaceholders('«{q}»', { q: '' }), [{ text: '«', value: false }, { text: '', value: true }, { text: '»', value: false }])
  })
})

describe('countKey: singular in English', () => {
  it('exactly 1 → `<key>_one`; 0, 2, 14 → `<key>`', () => {
    assert.equal(countKey('sp_found', 1), 'sp_found_one')
    for (const n of [0, 2, 14]) assert.equal(countKey('sp_found', n), 'sp_found')
  })

  it('a conversation with one message says "1 message" (en) / "1 tin nhắn" (vi)', () => {
    const one = { id: 'c', token: null, title: 'x', createdAt: Date.UTC(2026, 9, 29, 3), messages: [{ id: 'u1', sender: 'user' as const, text: 'q' }] }
    const two = { ...one, messages: [...one.messages, { id: 'b1', sender: 'bot' as const, text: 'a' }] }
    assert.equal(conversationMetaText(one, dbI18n('en').t), '1 message · 29/10/2026')
    assert.equal(conversationMetaText(two, dbI18n('en').t), '2 messages · 29/10/2026')
    assert.equal(conversationMetaText(one, dbI18n('vi').t), '1 tin nhắn · 29/10/2026')
    assert.equal(conversationMetaText(one, dbI18n('en', { db: 'none' }).t), '1 message · 29/10/2026')
  })

  for (const db of ['seed', 'none'] as const) {
    it(`/search with exactly one result (en, ${db}): "1 matching result across the portal"`, async (t) => {
      const item = { id: 1, kind: 'article', type: 'news', typeLabel: 'Bản tin', typeIcon: '', typeBadgeClass: '', title: 'Only one', excerpt: '', url: '/news/only-one', thumbnailUrl: null, publishedAt: null, categoryName: null }
      const reply = { ok: true, items: [item], total: 1, counts: { all: 1, news: 1, role_model: 0, reintegration_model: 0, document: 0, faq: 0, qa: 0, page: 0 }, pagination: { page: 1, limit: 10, total: 1, totalPages: 1 } }
      const i18n = dbI18n('en', { db })
      const ctx = await mountPublic(t, {
        file: 'pages/search.vue',
        route: { path: '/search', query: { q: 'only' } },
        responder: routes({ 'GET /api/public/search': () => new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } }) }),
        suspense: true,
        globals: { window: { scrollTo: () => {} } },
        auto: { useI18n: () => i18n },
        modules: { '~/composables/useI18n': { useI18n: () => i18n } },
      })
      await ctx.settle()
      assert.ok(textOf(ctx.page.root).includes('1 matching result across the portal'), textOf(ctx.page.root))
    })
  }

  it('one tool result says "1 result" (en); none, "0 results"', async (t) => {
    const i18n = dbI18n('en')
    const ctx = await mountPublic(t, {
      file: 'components/ChatMessageContent.vue',
      props: { text: 'Answer.', isBot: true, toolCalls: [
        { name: 'search_c11_articles', label: 'Articles', status: 'done', count: 1, query: 'a' },
        { name: 'search_knowledge', label: 'Knowledge', status: 'done', count: 0, query: 'b' },
      ] },
      responder: routes({}),
      auto: { useI18n: () => i18n },
      modules: { '~/composables/useI18n': { useI18n: () => i18n } },
    })
    const text = textOf(ctx.page.root)
    assert.ok(text.includes('1 result') && !text.includes('1 results'), text)
    assert.ok(text.includes('0 results'), text)
  })
})
