/**
 * Bản tiếng Anh không còn chữ tiếng Việt ở những chỗ người dùng báo (2026-11-02, bản build):
 * menu "Pháp luật" / "Giải đáp pháp luật", TOÀN BỘ trang Tìm kiếm, liên kết "Bỏ qua tới nội
 * dung", và giao diện chatbot (widget + /assistant: tiêu đề, trạng thái, lời chào, nút, dòng
 * câu hỏi gợi ý, nhãn dưới câu trả lời, lời mời cạnh nút mở).
 *
 * Gốc: chuỗi tiếng Việt viết cứng trong template/script (search.vue, layouts/default.vue,
 * ChatWidget + chat-widget/*, assistant.vue) và trong module trạng thái chat (dòng trạng
 * thái câu hỏi gợi ý, nhãn loại câu trả lời, lời mời) — nơi không gọi được `useI18n()`; nhãn
 * nav do cán bộ đặt ("Pháp luật") không có trong `NAV_LABEL_TO_KEY`.
 *
 * Mỗi bề mặt được dựng THẬT (tests/_sfc-mount.ts) bằng tiếng Anh theo hai cách `t()` trả lời:
 * hàng DB của seed (sau hydrate) và từ điển hardcoded (máy chủ render tuyến không cache như
 * /search, /assistant; hoặc DB chưa trả lời). Phép kiểm: chữ và các thuộc tính đọc được
 * (aria-label, title, placeholder) không còn chữ cái chỉ tiếng Việt có. Dữ liệu (tiêu đề bài,
 * câu hỏi gợi ý) ở đây là ASCII để phép kiểm chỉ thấy chữ giao diện.
 *
 * Ngoài phạm vi (KNOWN, CHANGELOG § 71): lỗi do máy chủ soạn và lỗi gửi chat lưu trong
 * transcript, câu trả lời của bot, dropdown tìm kiếm ở header, dữ liệu bài viết.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import * as Vue from 'vue'

import { hardcodedDictionary } from '../app/composables/i18n-default-dictionary.ts'
import { DEFAULT_TRANSLATIONS_SEED } from '../server/data/default-translations-seed.ts'
import { answer, chatServer, content, HOLD, json as chatJson, meta, mountChat, sseStream, type ChatCtx, type MountOptions } from './_chat-widget-harness.ts'
import { dbI18n, i18nOverride, seedRows, VIETNAMESE_LETTERS } from './_i18n-db.ts'
import { json, loadAppModule, mountPublic, realPublicFetch, routes } from './_public-mount-harness.ts'
import { click, fire, findAll, input, textOf, type MiniElement } from './_sfc-mount.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (file: string) => readFileSync(`${ROOT}/${file}`, 'utf8')

/** Text and the readable attributes of every element under `root`, except subtrees `skip` matches. */
function readable(root: MiniElement, skip: (el: MiniElement) => boolean = () => false): string[] {
  const out: string[] = []
  const walk = (el: MiniElement) => {
    if (skip(el)) return
    for (const name of ['aria-label', 'title', 'placeholder']) {
      const value = el.props[name]
      if (typeof value === 'string' && value) out.push(`[${name}] ${value}`)
    }
    for (const child of el.children) {
      if (child.kind === 'element') walk(child)
      else if (child.kind === 'text' && child.text.trim()) out.push(child.text.trim())
    }
  }
  walk(root)
  return out
}
const vietnamese = (lines: string[]) => lines.filter(line => VIETNAMESE_LETTERS.test(line))
/** The text nodes under `root`, each trimmed, joined by one space (elements do not run together). */
function wordsOf(root: MiniElement): string {
  const out: string[] = []
  const walk = (el: MiniElement) => {
    for (const child of el.children) {
      if (child.kind === 'element') walk(child)
      else if (child.kind === 'text') out.push(child.text.replace(/\s+/g, ' ').trim())
    }
  }
  walk(root)
  return out.filter(Boolean).join(' ')
}
/**
 * What a reader sees, two ways: `textOf` keeps one sentence whole across inline elements
 * ("Nothing matches «zzz».", the bold value inside), `wordsOf` keeps neighbouring elements
 * apart ("All 14": a tab's label and its count). An expected phrase must appear in one.
 */
const seen = (root: MiniElement) => `${textOf(root)}\n${wordsOf(root)}`

// ─── /search ─────────────────────────────────────────────────────────────────

const ITEMS = [
  { id: 1, kind: 'article', type: 'news', typeLabel: 'Bản tin', typeIcon: 'fa-solid fa-newspaper', typeBadgeClass: '', title: 'Job fair 2026', excerpt: 'A job fair.', url: '/news/job-fair', thumbnailUrl: null, publishedAt: '2026-10-05T00:00:00.000Z', categoryName: null },
  { id: 2, kind: 'article', type: 'role_model', typeLabel: 'Tấm gương tiêu biểu', typeIcon: 'fa-solid fa-award', typeBadgeClass: '', title: 'A new start', excerpt: '', url: '/role-models/a-new-start', thumbnailUrl: null, publishedAt: null, categoryName: null },
  { id: 3, kind: 'qa', type: 'qa', typeLabel: 'Tài liệu Hỏi – Đáp', typeIcon: 'fa-solid fa-comments', typeBadgeClass: '', title: 'Record clearing', excerpt: '', url: '/qa-documents#qa-3', thumbnailUrl: null, publishedAt: null, categoryName: null },
  { id: 4, kind: 'page', type: 'page', typeLabel: 'Trang thông tin', typeIcon: 'fa-solid fa-file-invoice', typeBadgeClass: '', title: 'About', excerpt: '', url: '/about', thumbnailUrl: null, publishedAt: null, categoryName: null },
]
const RESULTS = { ok: true, items: ITEMS, total: 14, counts: { all: 14, news: 8, role_model: 2, reintegration_model: 1, document: 1, faq: 0, qa: 1, page: 1 }, pagination: { page: 1, limit: 10, total: 14, totalPages: 2 } }
const NO_RESULTS = { ok: true, items: [], total: 0, counts: { all: 0, news: 0, role_model: 0, reintegration_model: 0, document: 0, faq: 0, qa: 0, page: 0 }, pagination: { page: 1, limit: 10, total: 0, totalPages: 0 } }

async function mountSearch(t: TestContext, lang: string, query: Record<string, string>, reply: () => Response, db: 'seed' | 'none' = 'seed') {
  return mountPublic(t, {
    file: 'pages/search.vue',
    route: { path: '/search', query },
    responder: routes({ 'GET /api/public/search': reply }),
    suspense: true,
    globals: { window: { scrollTo: () => {} } },
    ...i18nOverride(dbI18n(lang, { db })),
  })
}

describe('/search in English', () => {
  for (const db of ['seed', 'none'] as const) {
    it(`results (${db === 'seed' ? 'DB rows loaded' : 'hardcoded dictionary: server render / DB not answered'}): no Vietnamese anywhere in the page chrome`, async (t) => {
      const ctx = await mountSearch(t, 'en', { q: 'job' }, () => json(RESULTS), db)
      await ctx.settle()
      const lines = readable(ctx.page.root)
      assert.deepEqual(vietnamese(lines), [])
      const text = seen(ctx.page.root)
      for (const expected of ['Home', 'Search the portal', 'Results for: «job»', '14 matching results across the portal', 'All 14', 'Role models 2',
        'Legal Q&A 0', 'Pages 1', 'News', 'Role model', 'Q&A document', 'Page', 'View Details', 'C11 Portal', 'Page 1 of 2']) {
        assert.ok(text.includes(expected), `missing "${expected}" in: ${text}`)
      }
      assert.ok(lines.includes('[placeholder] Enter keywords (title, content, topic)...'))
      assert.ok(lines.includes('[aria-label] Previous page') && lines.includes('[aria-label] Next page'))
      // The count and the page numbers stay bold, wherever the translation puts them.
      assert.deepEqual(findAll(ctx.page.root, el => el.tag === 'strong').map(el => textOf(el)), ['14', '1', '2'])
      const head = ctx.heads.map(h => (typeof h === 'function' ? (h as () => { title: string })() : h)) as Array<{ title: string }>
      assert.equal(head.at(-1)!.title, 'Search | Con Đường Hướng Thiện')
    })
  }

  it('no results: the empty state and its two buttons', async (t) => {
    const ctx = await mountSearch(t, 'en', { q: 'zzz', type: 'news' }, () => json(NO_RESULTS))
    await ctx.settle()
    assert.deepEqual(vietnamese(readable(ctx.page.root)), [])
    const text = seen(ctx.page.root)
    for (const expected of ['No results found', 'Nothing matches «zzz». Try a shorter keyword or another filter.', 'Show all categories', 'New search']) {
      assert.ok(text.includes(expected), `missing "${expected}" in: ${text}`)
    }
  })

  it('no keyword yet: the idle state (the suggested keywords are Vietnamese search terms on purpose)', async (t) => {
    const ctx = await mountSearch(t, 'en', {}, () => json(NO_RESULTS))
    await ctx.settle()
    const chips = new Set(['Ninh Bình', 'Tái hòa nhập', 'Tấm gương', 'Văn bản', 'Nghị định'])
    const lines = readable(ctx.page.root, el => el.tag === 'button' && chips.has(textOf(el)))
    assert.deepEqual(vietnamese(lines), [])
    assert.ok(textOf(ctx.page.root).includes('Enter a keyword to start searching'))
    assert.ok(textOf(ctx.page.root).includes('Suggested keywords:'))
  })

  it('a failed search: the error state and its retry', async (t) => {
    const ctx = await mountSearch(t, 'en', { q: 'job' }, () => json({ statusCode: 500, statusMessage: 'Server Error' }, 500))
    await ctx.settle()
    assert.deepEqual(vietnamese(readable(ctx.page.root)), [])
    const alert = findAll(ctx.page.root, el => el.props.role === 'alert')
    assert.equal(alert.length, 1)
    assert.equal(wordsOf(alert[0]!), 'Could not load search results Something went wrong while contacting the server. Try again')
  })

  it('Vietnamese reads exactly as before', async (t) => {
    const ctx = await mountSearch(t, 'vi', { q: 'job' }, () => json(RESULTS))
    await ctx.settle()
    const text = seen(ctx.page.root)
    for (const expected of ['Trang chủ › Tìm kiếm', 'Tìm kiếm thông tin', 'Kết quả cho từ khóa: «job»', 'Tìm thấy 14 kết quả phù hợp trên toàn hệ thống',
      'Tấm gương 2', 'Tấm gương tiêu biểu', 'Tài liệu Hỏi – Đáp', 'Xem chi tiết', 'Cổng thông tin C11', 'Trang 1 trên tổng số 2 trang']) {
      assert.ok(text.includes(expected), `missing "${expected}" in: ${text}`)
    }
  })
})

// ─── Skip link ───────────────────────────────────────────────────────────────

describe('"Bỏ qua tới nội dung" (layout skip link)', () => {
  for (const [lang, db, expected] of [['en', 'seed', 'Skip to main content'], ['en', 'none', 'Skip to main content'], ['vi', 'seed', 'Bỏ qua tới nội dung']] as const) {
    it(`${lang} (${db}): "${expected}", still the first link to #main-content`, async (t) => {
      const ctx = await mountPublic(t, { file: 'components/layout/DefaultSkipLink.vue', responder: routes({}), ...i18nOverride(dbI18n(lang, { db })) })
      const links = findAll(ctx.page.root, el => el.tag === 'a')
      assert.equal(links.length, 1)
      assert.equal(links[0]!.props.href, '#main-content')
      assert.equal(textOf(links[0]!), expected)
    })
  }

  it('the cached HTML stays Vietnamese: rendered on the server with no cookie, through the REAL useI18n', async (t) => {
    const nuxtState = new Map<string, Vue.Ref<unknown>>()
    const imports = {
      useHead: () => {},
      useNuxtApp: () => ({ isHydrating: false, hooks: { hookOnce: () => {} } }),
      useRequestHeader: () => undefined,
      useState: <T>(key: string, init?: () => T) => {
        if (!nuxtState.has(key)) nuxtState.set(key, Vue.ref(init ? init() : undefined))
        return nuxtState.get(key) as Vue.Ref<T>
      },
      publicFetch: realPublicFetch,
    }
    const real = await loadAppModule('composables/useI18n.ts', { modules: { '#imports': imports }, importMeta: { server: true, client: false } })
    const ctx = await mountPublic(t, {
      file: 'components/layout/DefaultSkipLink.vue',
      responder: routes({}),
      importMeta: { server: true, client: false },
      modules: { '~/composables/useI18n': real },
      auto: { useI18n: real.useI18n },
    })
    assert.equal(textOf(findAll(ctx.page.root, el => el.tag === 'a')[0]!), 'Bỏ qua tới nội dung')
    assert.deepEqual(ctx.calls, [], 'the server render asked for nothing')
  })

  it('layouts/default.vue renders the part, not its own Vietnamese sentence', () => {
    const layout = read('app/layouts/default.vue')
    assert.match(layout, /<LayoutDefaultSkipLink \/>/)
    assert.doesNotMatch(layout, /Bỏ qua tới nội dung/)
  })
})

// ─── Navigation labels set by an officer ─────────────────────────────────────

/** `nav_menu_navbar` as the user's database holds it (GET /api/public/settings, 2026-11-02). */
const DB_NAV = [
  { id: 'n1', label: 'Trang chủ', url: '/' },
  { id: 'n2', label: 'Giới thiệu', url: '/about' },
  { id: 'n3', label: 'Bản tin', url: '/news', children: [{ id: 'n31', label: 'Tin nổi bật', url: '/news/featured-news' }, { id: 'n32', label: 'Tin hoạt động', url: '/news/activity-news' }, { id: 'n33', label: 'Tin địa phương', url: '/news/local-news' }] },
  { id: 'n4', label: 'Tấm gương tiêu biểu', url: '/role-models' },
  { id: 'n5', label: 'Mô hình tái hòa nhập', url: '/reintegration-models' },
  { id: 'n6', label: 'Pháp luật', url: '#', children: [{ id: 'n61', label: 'Giải đáp pháp luật', url: '/legal-qa' }] },
  { id: 'n7', label: 'Liên hệ', url: '/contact' },
]

async function navLabels(lang: string, db: 'seed' | 'none') {
  const i18n = dbI18n(lang, { db })
  const module = await loadAppModule('composables/useLayoutNav.ts', { modules: { '~/composables/useI18n': { useI18n: () => i18n } } })
  const useLayoutNav = module.useLayoutNav as (settings: Vue.Ref<unknown>) => { navMenu: Vue.ComputedRef<Array<{ label: string | null, children?: unknown[] }>>, navItemLabel: (item: unknown) => string }
  const nav = useLayoutNav(Vue.ref({ settings: { nav_menu_navbar: JSON.stringify(DB_NAV) } }))
  const flat = (items: Array<{ children?: unknown[] }>): string[] => items.flatMap(item => [nav.navItemLabel(item), ...flat((item.children ?? []) as Array<{ children?: unknown[] }>)])
  return flat(nav.navMenu.value)
}

describe('navigation labels from the database (no labelKey: the editor cannot set one)', () => {
  for (const db of ['seed', 'none'] as const) {
    it(`en (${db}): "Pháp luật" → "Law", "Giải đáp pháp luật" → "Legal Q&A…", nothing left in Vietnamese`, async () => {
      const labels = await navLabels('en', db)
      assert.deepEqual(vietnamese(labels), [], labels.join(' | '))
      assert.equal(labels[8], 'Law')
      assert.match(labels[9]!, /^Legal (Q&A|FAQ)$/)
    })
  }
  it('vi: the officer\'s own words', async () => {
    assert.deepEqual(await navLabels('vi', 'seed'), ['Trang chủ', 'Giới thiệu', 'Bản tin', 'Tin nổi bật', 'Tin hoạt động', 'Tin địa phương', 'Tấm gương tiêu biểu', 'Mô hình tái hòa nhập', 'Pháp luật', 'Giải đáp pháp luật', 'Liên hệ'])
  })
})

// ─── Chat widget + /assistant ────────────────────────────────────────────────

const ASSISTANT = fileURLToPath(new URL('../app/pages/assistant.vue', import.meta.url))
const ASCII_QUESTIONS = [{ id: 1, question: 'How do I clear a record?' }, { id: 2, question: 'Where can I learn a trade?' }]
const SOURCE = { id: 7, question: 'Clearing a record?', answer: 'Article 70.', source: { label: 'Q&A Documents', reference: 'No. 7', url: null } }

async function englishChat(t: TestContext, db: 'seed' | 'none', options: MountOptions = {}) {
  const server = chatServer()
  server.state.quickQuestions = () => chatJson({ ok: true, available: true, items: ASCII_QUESTIONS })
  server.state.sources = () => chatJson({ ok: true, source: { question: 'Clearing a record?', answer: 'Article 70 says so.' } })
  const ctx = await mountChat(t, server, { i18n: dbI18n('en', { db }), ...options })
  await ctx.settle()
  return ctx
}
const chatLines = (ctx: ChatCtx) => readable(ctx.widget.root)
const openWidgetDialog = async (ctx: ChatCtx) => {
  await click(findAll(ctx.widget.root, el => el.tag === 'button' && el.props['aria-controls'] === 'public-chatbot-dialog')[0]!)
  await ctx.settle()
}
const askIn = async (ctx: ChatCtx, id: string, question: string) => {
  const box = findAll(ctx.widget.root, el => el.props.id === id)[0]!
  await input(box, question)
  await fire(findAll(ctx.widget.root, el => el.tag === 'form' && findAll(el, i => i.props.id === id).length > 0)[0]!, 'submit')
  await ctx.settle()
}

describe('chat widget in English', () => {
  for (const db of ['seed', 'none'] as const) {
    it(`(${db}) the whole conversation chrome: header, greeting, status, chips, sending, answer label, sources, contact form, list`, async (t) => {
      const ctx = await englishChat(t, db)
      // The teaser beside the launcher, 2 s after mount.
      await ctx.tick(2_100)
      const teasers = Object.entries(db === 'seed' ? seedRows('en') : hardcodedDictionary.en!).filter(([key]) => key.startsWith('cw_teaser_')).map(([, v]) => v)
      assert.equal(teasers.length, 7)
      assert.ok(teasers.some(teaser => textOf(ctx.widget.root).includes(teaser)), 'the teaser is not one of the English invitations')
      await openWidgetDialog(ctx)
      let text = textOf(ctx.widget.root)
      for (const expected of ['Huong Thien Assistant', 'Online', 'Hello! I can look up information in the knowledge base approved by Department C11.', 'Suggested questions', 'Suggested questions from the approved knowledge base']) {
        assert.ok(text.includes(expected), `missing "${expected}" in: ${text}`)
      }
      assert.deepEqual(findAll(ctx.widget.root, el => el.tag === 'strong').map(el => textOf(el)), ['Department C11'])
      assert.deepEqual(vietnamese(chatLines(ctx)), [])

      // Waiting: "Sending…" under the question, the typing indicator, then the slow-wait line.
      ctx.server.state.chat.push(() => HOLD)
      await askIn(ctx, 'public-chatbot-input', 'How do I clear a record?')
      text = textOf(ctx.widget.root)
      for (const expected of ['Sending…', 'The assistant is writing a reply', 'Thinking & searching...']) assert.ok(text.includes(expected), `missing "${expected}" in: ${text}`)
      await ctx.tick(21_000)
      assert.ok(textOf(ctx.widget.root).includes('This is taking longer than usual, please wait a little longer…'))
      assert.deepEqual(vietnamese(chatLines(ctx)), [])
      const call = ctx.server.state.held.shift()!
      const stream = sseStream(call.signal)
      call.respond(stream.response)
      stream.push(content('Article 70 applies.'))
      stream.push(meta({ kind: 'curated', sources: [SOURCE], askContact: true }))
      stream.done()
      await ctx.settle()

      text = textOf(ctx.widget.root)
      for (const expected of ['Answered from approved content', 'AI tools: answered directly', 'Copy', 'Show full text', 'Leave your contact details', 'Send details']) {
        assert.ok(text.includes(expected), `missing "${expected}" in: ${text}`)
      }
      assert.ok(chatLines(ctx).includes('[title] Copy the answer'))
      await click(findAll(ctx.widget.root, el => el.tag === 'button' && textOf(el) === 'Show full text')[0]!)
      await ctx.settle()
      assert.ok(textOf(ctx.widget.root).includes('Open in Q&A Documents →'))
      assert.ok(textOf(ctx.widget.root).includes('Collapse'))
      assert.deepEqual(vietnamese(chatLines(ctx)), [])

      // The conversation list: its header, "New", the default title shown translated.
      await click(findAll(ctx.widget.root, el => el.tag === 'button' && el.props['aria-label'] === 'Conversation list')[0]!)
      await ctx.settle()
      await click(findAll(ctx.widget.root, el => el.tag === 'button' && textOf(el) === 'New')[0]!)
      await ctx.settle()
      await click(findAll(ctx.widget.root, el => el.tag === 'button' && el.props['aria-label'] === 'Conversation list')[0]!)
      await ctx.settle()
      text = textOf(ctx.widget.root)
      for (const expected of ['Conversations', 'New conversation', 'No messages yet · 29/10/2026', '2 messages · 29/10/2026']) assert.ok(text.includes(expected), `missing "${expected}" in: ${text}`)
      assert.ok(chatLines(ctx).includes('[aria-label] Delete New conversation'))
      assert.deepEqual(vietnamese(chatLines(ctx)), [])
      // Stored as the sentinel, never translated (send.ts compares it with ===).
      const saved = JSON.parse(ctx.local.getItem('cdkt_sessions_v1')!) as { sessions: Array<{ title: string }> }
      assert.equal(saved.sessions[0]!.title, 'Cuộc trò chuyện mới')
    })
  }

  it('quick questions that failed or came back empty say so in English', async (t) => {
    for (const [answerWith, expected] of [
      [() => chatJson({ statusCode: 503 }, 503), 'Suggested questions could not be loaded. You can still type your question below.'],
      [() => chatJson({ ok: true, available: false, items: [] }), 'There are no approved suggested questions yet. You can still type your question below.'],
    ] as const) {
      const server = chatServer()
      server.state.quickQuestions = answerWith
      const ctx = await mountChat(t, server, { i18n: dbI18n('en') })
      await ctx.settle()
      await openWidgetDialog(ctx)
      assert.ok(textOf(ctx.widget.root).includes(expected), textOf(ctx.widget.root))
      assert.deepEqual(vietnamese(chatLines(ctx)), [])
      ctx.close()
    }
  })

  it('a source that fails to load: the error line and its retry in English', async (t) => {
    const ctx = await englishChat(t, 'seed')
    await openWidgetDialog(ctx)
    ctx.server.state.chat.push(answer('See the source.', { kind: 'curated', sources: [SOURCE] }))
    ctx.server.state.sources = () => chatJson({ statusCode: 500 }, 500)
    await askIn(ctx, 'public-chatbot-input', 'Source?')
    await click(findAll(ctx.widget.root, el => el.tag === 'button' && textOf(el) === 'Show full text')[0]!)
    await ctx.settle()
    const alert = findAll(ctx.widget.root, el => el.props.role === 'alert').map(el => wordsOf(el))
    assert.ok(alert.includes('Could not load the full text. Try again'), alert.join(' | '))
  })
})

describe('/assistant in English', () => {
  for (const db of ['seed', 'none'] as const) {
    it(`(${db}) sidebar, header, greeting, status and the answer chrome`, async (t) => {
      const ctx = await englishChat(t, db, { file: ASSISTANT, path: '/assistant', auto: { watch: Vue.watch, useHead: () => {} } })
      Object.defineProperty(findAll(ctx.widget.root, el => el.props.id === 'tro-ly-input')[0]!, 'style', { value: {}, configurable: true, writable: true })
      let text = textOf(ctx.widget.root)
      for (const expected of ['New chat', 'Up to 10 conversations are kept on this device.', 'Huong Thien Assistant', 'New conversation',
        'Hello! I can look up information in the knowledge base approved by Department C11.', 'No messages yet · 29/10/2026']) {
        assert.ok(text.includes(expected), `missing "${expected}" in: ${text}`)
      }
      assert.deepEqual(vietnamese(chatLines(ctx)), [])
      ctx.server.state.chat.push(answer('Article 70 applies.', { kind: 'not_found', sources: [SOURCE] }))
      await askIn(ctx, 'tro-ly-input', 'How do I clear a record?')
      text = textOf(ctx.widget.root)
      for (const expected of ['No matching information found yet', 'Copy', 'Show full text']) assert.ok(text.includes(expected), `missing "${expected}" in: ${text}`)
      assert.deepEqual(vietnamese(chatLines(ctx)), [])
    })
  }
})

// ─── Every key these surfaces use exists in both dictionaries ────────────────

const SURFACE_FILES = [
  'app/pages/search.vue', 'app/pages/assistant.vue', 'app/components/ChatWidget.vue', 'app/components/layout/DefaultSkipLink.vue',
  'app/components/chat-widget/ChatWidgetComposer.vue', 'app/components/chat-widget/ChatWidgetConversationList.vue',
  'app/components/chat-widget/ChatWidgetHeader.vue', 'app/components/chat-widget/ChatWidgetLauncher.vue',
  'app/components/chat-widget/ChatWidgetMessageMeta.vue', 'app/components/chat-widget/ChatWidgetQuickQuestions.vue',
  'app/components/chat-widget/ChatWidgetWelcome.vue', 'app/components/ChatMessageContent.vue', 'app/components/ChatFollowUps.vue',
  'app/utils/chat-i18n.ts', 'app/composables/useLayoutNav.ts',
]

describe('i18n keys of these surfaces: vi + en in the seed AND in the hardcoded dictionary', () => {
  const keys = new Set<string>()
  for (const file of SURFACE_FILES) {
    const source = read(file)
    for (const m of source.matchAll(/\bt\('([a-z0-9_]+)'\)/g)) keys.add(m[1]!)
    // Keys held in tables (`labelKey: 'sp_tab_all'`, `'cw_kind_curated'`, `'nav_law'`) and picked at runtime.
    for (const m of source.matchAll(/'((?:cw|sp|asst|nav)_[a-z0-9_]+)'/g)) keys.add(m[1]!)
  }
  for (const key of ['faq', 'search', 'home', 'view_detail', 'close']) keys.add(key)

  it('found the keys (a scan over nothing is not a pass)', () => {
    assert.ok(keys.size > 90, `${keys.size} keys`)
  })
  for (const lang of ['vi', 'en']) {
    it(`${lang}: every key has a non-empty seed row and a hardcoded fallback`, () => {
      const rows = seedRows(lang)
      const missingSeed = [...keys].filter(key => !rows[key])
      const missingHard = [...keys].filter(key => !hardcodedDictionary[lang]?.[key])
      assert.deepEqual({ missingSeed, missingHard }, { missingSeed: [], missingHard: [] })
    })
  }
  it('the new keys say the same in the seed and in the hardcoded dictionary (one wording per language)', () => {
    const newKeys = [...keys].filter(key => /^(cw_(title|online|welcome|sending|retry|source_|lead_(done|title|sending|submit)|typing|thinking|slow|qq_|conversations|new$|delete_named|meta_|cop|kind_|teaser_|follow_ups|tool)|asst_(new_chat|no_conv|max_saved|thinking|seo_desc)|sp_|nav_law|skip_to_content)/.test(key))
    assert.ok(newKeys.length > 80, `${newKeys.length}`)
    for (const lang of ['vi', 'en']) {
      const rows = seedRows(lang)
      const differ = newKeys.filter(key => rows[key] !== hardcodedDictionary[lang]![key])
      assert.deepEqual(differ, [], lang)
    }
  })
  it('each new key is ONE seed row: unique across groups (t() flattens every group into one map)', () => {
    const count = new Map<string, number>()
    for (const row of DEFAULT_TRANSLATIONS_SEED) count.set(row.key, (count.get(row.key) ?? 0) + 1)
    const doubled = [...keys].filter(key => /^(cw_|sp_|asst_|nav_law|skip_to_content)/.test(key) && (count.get(key) ?? 0) !== 1)
    assert.deepEqual(doubled, [])
  })
  it('no Vietnamese sentence is left in the templates of these surfaces (the suggested search terms excepted)', () => {
    const leftovers: string[] = []
    for (const file of SURFACE_FILES.filter(f => f.endsWith('.vue'))) {
      const template = read(file).split('<script')[0]!
      const withoutComments = template.replace(/<!--[\s\S]*?-->/g, '')
      for (const [i, line] of withoutComments.split('\n').entries()) {
        const visible = line.replace(/\[[^\]]*\]/g, '').replace(/'[^']*'/g, (m) => (/(Ninh Bình|Tái hòa nhập|Tấm gương|Văn bản|Nghị định)/.test(m) ? '' : m))
        if (VIETNAMESE_LETTERS.test(visible.replace(/<[^>]*\b(class|:class)="[^"]*"/g, ''))) leftovers.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`)
      }
    }
    assert.deepEqual(leftovers, [])
  })
  it('none of these surfaces writes the language cookie (the cached HTML must stay Vietnamese)', () => {
    for (const file of [...SURFACE_FILES, 'app/components/I18nStrong.vue']) assert.doesNotMatch(read(file), /useCookie|document\.cookie/, file)
  })
})
