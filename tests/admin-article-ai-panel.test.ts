/**
 * The article editor's AI panel (`app/components/admin/articles/ArticleAIPanel.vue`): the REAL
 * component — `<script setup>` and template — over REAL ofetch on a fake network shaped like
 * `server/api/admin/ai/editorial.post.ts`, with the real `adminFetch`/`errorMessage`/
 * `replaceFirstLiteral` (tests/_admin-page-harness.ts `mountAdminPage`).
 *
 * Written before its last `$fetch` cast became `adminFetch<AdminAiEditorialResponse>` (wave3,
 * the panel was the last admin file in `tests/ratchets/fetch-casts.baseline.json`), and green on
 * the cast too — so the swap is shown to change nothing a person or the server sees: one POST per
 * click with exactly `{ action, title, content }`, the three drawers, applying a title / summary /
 * change / the whole polished body through the parent's callbacks, and every failure as a toast
 * with the server's own sentence (never ofetch's `[POST] "/api/…"` line).
 *
 * `AI_PANEL_DOM_LOG=<file>` appends one JSON line per step (`{ test, step, html, calls, toasts,
 * emitted, editor }`) — the same suite run on the cast and on `adminFetch` gives identical files.
 */
import assert from 'node:assert/strict'
import { appendFileSync } from 'node:fs'
import { afterEach, describe, it, type TestContext } from 'node:test'

import { replaceFirstLiteral } from '../app/utils/replace-literal.ts'
import {
  dropped, h3Error, json, mountAdminPage, OFETCH_LINE, routes, sent, settle, unmountAll, type NetCall,
} from './_admin-page-harness.ts'
import { byText, click, findAll, textOf, type MiniElement } from './_sfc-mount.ts'

afterEach(unmountAll)

const URL_EDITORIAL = '/api/admin/ai/editorial'
const DOM_LOG = process.env.AI_PANEL_DOM_LOG

/** What the handler answers on success (editorial.post.ts), with the fields a test overrides. */
const answer = (overrides: Record<string, unknown> = {}) => json({
  ok: true, action: 'summary', options: [], titles: [], polishedContent: '', changes: [], summaryNotes: '', notes: [], rawText: '',
  usage: { promptTokens: 120, completionTokens: 40, costVnd: '12' }, ...overrides,
})

async function openPanel(t: TestContext, options: { title?: string, body?: string, reply?: (call: NetCall) => Response | Error | undefined } = {}) {
  const emitted: Array<[string, string]> = []
  const editor = { html: options.body ?? '<p>Nội dung bài viết có lổi chính tả.</p>', writes: [] as string[] }
  const opened = await mountAdminPage('components/admin/articles/ArticleAIPanel.vue', routes({
    [`POST ${URL_EDITORIAL}`]: options.reply ?? (() => answer()),
  }), {
    props: {
      formTitle: options.title ?? 'Tiêu đề bài',
      getEditorContent: () => editor.html,
      setEditorContent: (html: string) => { editor.writes.push(html); editor.html = html },
      'onUpdate:title': (value: string) => { emitted.push(['update:title', value]) },
      'onUpdate:excerpt': (value: string) => { emitted.push(['update:excerpt', value]) },
    },
    auto: { replaceFirstLiteral },
  })
  let step = 0
  const snap = () => {
    if (DOM_LOG) appendFileSync(DOM_LOG, `${JSON.stringify({ test: t.fullName, step: step++, html: opened.page.html(), calls: sent(opened.calls), toasts: opened.toasts, emitted, editor })}\n`)
  }
  snap()
  const press = async (el: MiniElement) => { await click(el); await settle(); snap() }
  const root = () => opened.page.root
  return { ...opened, emitted, editor, snap, press, root }
}

type Panel = Awaited<ReturnType<typeof openPanel>>
const tool = (p: Panel, label: string) => byText(p.root(), 'button', label)
const buttonsIn = (p: Panel) => findAll(p.root(), el => el.tag === 'button')
const disabled = (el: MiniElement) => el.props.disabled === true || el.props.disabled === ''
const posts = (p: Panel) => p.calls.filter(call => call.method === 'POST' && call.url.pathname === URL_EDITORIAL)

describe('ArticleAIPanel — one POST per action, exactly { action, title, content }', () => {
  for (const [label, action] of [['Gợi ý tiêu đề', 'suggest_titles'], ['Tự động viết tóm tắt', 'summary'], ['Soát lỗi & Văn phong', 'polish']] as const) {
    it(`"${label}" → POST ${URL_EDITORIAL} { action: '${action}', title, content }`, async (t) => {
      const p = await openPanel(t, { reply: () => answer({ action }) })
      await p.press(tool(p, label))
      assert.deepEqual(sent(p.calls), [{ wire: `POST ${URL_EDITORIAL}`, body: { action, title: 'Tiêu đề bài', content: '<p>Nội dung bài viết có lổi chính tả.</p>' } }])
      assert.deepEqual(Object.keys(posts(p)[0]!.body as object), ['action', 'title', 'content'])
    })
  }

  it('no title and no body: a toast, nothing sent', async (t) => {
    const p = await openPanel(t, { title: '', body: '' })
    await p.press(tool(p, 'Gợi ý tiêu đề'))
    assert.deepEqual(p.calls, [])
    assert.equal(p.lastToast('error'), 'Vui lòng nhập tiêu đề hoặc nội dung bài viết trước khi dùng Trợ lý AI.')
  })

  it('while the answer is pending: the three buttons are off and the panel says what it is doing', async (t) => {
    const pending: NetCall[] = []
    const p = await openPanel(t, { reply: (call) => { pending.push(call); return undefined } })
    void click(tool(p, 'Soát lỗi & Văn phong'))
    await settle()
    p.snap()
    assert.match(textOf(p.root()), /Trợ lý AI đang rà soát chính tả và văn phong\.\.\./)
    assert.deepEqual(['Gợi ý tiêu đề', 'Tự động viết tóm tắt', 'Soát lỗi & Văn phong'].map(label => disabled(tool(p, label))), [true, true, true])
    pending[0]!.respond(answer({ action: 'polish', changes: [] }))
    await settle()
    p.snap()
    assert.doesNotMatch(textOf(p.root()), /Trợ lý AI đang/)
    assert.equal(disabled(tool(p, 'Gợi ý tiêu đề')), false)
  })
})

describe('ArticleAIPanel — what comes back', () => {
  it('titles: a drawer of buttons; picking one emits update:title and closes the drawer', async (t) => {
    const p = await openPanel(t, { reply: () => answer({ action: 'suggest_titles', titles: ['Tiêu đề A', 'Tiêu đề B'] }) })
    await p.press(tool(p, 'Gợi ý tiêu đề'))
    assert.equal(p.lastToast('success'), 'Đã có đề xuất tiêu đề, mời bạn bấm chọn bên dưới!')
    await p.press(tool(p, 'Tiêu đề B'))
    assert.deepEqual(p.emitted, [['update:title', 'Tiêu đề B']])
    assert.equal(p.lastToast('success'), 'Đã áp dụng tiêu đề!')
    assert.doesNotMatch(textOf(p.root()), /Đề xuất tiêu đề từ AI/)
  })

  it('titles: none parsed → the raw reply, one line per title', async (t) => {
    const p = await openPanel(t, { reply: () => answer({ action: 'suggest_titles', titles: [], rawText: 'Dòng một\nDòng hai' }) })
    await p.press(tool(p, 'Gợi ý tiêu đề'))
    assert.ok(tool(p, 'Dòng một') && tool(p, 'Dòng hai'))
  })

  it('summaries: applying one strips the "Phương án n:" label and emits update:excerpt', async (t) => {
    const p = await openPanel(t, { reply: () => answer({ action: 'summary', options: ['Phương án 1 (Trực diện): Sapo một.', 'Sapo hai.'] }) })
    await p.press(tool(p, 'Tự động viết tóm tắt'))
    assert.equal(p.lastToast('success'), 'Đã có đề xuất tóm tắt, mời bạn xem và chọn bên dưới!')
    await p.press(findAll(p.root(), el => el.tag === 'button' && /Áp dụng vào Tóm tắt/.test(textOf(el)))[0]!)
    assert.deepEqual(p.emitted, [['update:excerpt', 'Sapo một.']])
    assert.doesNotMatch(textOf(p.root()), /Đề xuất tóm tắt từ AI/)
  })

  it('summaries: no options → the raw reply as the one option', async (t) => {
    const p = await openPanel(t, { reply: () => answer({ action: 'summary', options: [], rawText: 'Sapo thô.' }) })
    await p.press(tool(p, 'Tự động viết tóm tắt'))
    assert.match(textOf(p.root()), /Sapo thô\./)
  })

  it('polish with changes: the list; one change, then all, go through setEditorContent', async (t) => {
    const p = await openPanel(t, {
      body: '<p>lổi một, lổi hai</p>',
      reply: () => answer({ action: 'polish', summaryNotes: 'Hai lỗi.', changes: [{ original: 'lổi một', suggested: 'lỗi một', reason: 'chính tả' }, { original: 'lổi hai', suggested: 'lỗi hai', reason: '' }] }),
    })
    await p.press(tool(p, 'Soát lỗi & Văn phong'))
    assert.match(textOf(p.root()), /2 điểm cần sửa/)
    assert.match(textOf(p.root()), /Hai lỗi\./)
    assert.match(textOf(p.root()), /Lỗi #2: Chuẩn hóa câu từ/)
    await p.press(findAll(p.root(), el => el.tag === 'button' && /Áp dụng sửa đổi này/.test(textOf(el)))[0]!)
    assert.deepEqual(p.editor.writes, ['<p>lỗi một, lổi hai</p>'])
    assert.equal(findAll(p.root(), el => el.tag === 'span' && /Đã áp dụng/.test(textOf(el))).length, 1)
    await p.press(findAll(p.root(), el => el.tag === 'button' && /Áp dụng tất cả sửa đổi/.test(textOf(el)))[0]!)
    assert.deepEqual(p.editor.writes, ['<p>lỗi một, lổi hai</p>', '<p>lỗi một, lỗi hai</p>'])
    assert.equal(p.lastToast('success'), 'Đã áp dụng toàn bộ sửa đổi vào bài viết!')
  })

  it('polish without a change list: the sanitised body in the preview (never rawText), applied whole', async (t) => {
    const p = await openPanel(t, { reply: () => answer({ action: 'polish', polishedContent: '<p>Bản đã sửa</p>', rawText: '<img src=x onerror=alert(1)>', notes: ['Một', 'Hai'] }) })
    await p.press(tool(p, 'Soát lỗi & Văn phong'))
    const preview = findAll(p.root(), el => el.props.innerHTML !== undefined)
    assert.deepEqual(preview.map(el => el.props.innerHTML), ['<p>Bản đã sửa</p>'])
    assert.match(textOf(p.root()), /Một • Hai/)
    await p.press(findAll(p.root(), el => el.tag === 'button' && /Áp dụng tất cả sửa đổi/.test(textOf(el)))[0]!)
    assert.deepEqual(p.editor.writes, ['<p>Bản đã sửa</p>'])
  })

  it('polish, nothing usable: an empty preview, not the raw reply', async (t) => {
    const p = await openPanel(t, { reply: () => answer({ action: 'polish', polishedContent: '', rawText: '<script>x</script>' }) })
    await p.press(tool(p, 'Soát lỗi & Văn phong'))
    assert.deepEqual(findAll(p.root(), el => el.props.innerHTML !== undefined).map(el => el.props.innerHTML), [''])
  })
})

describe('ArticleAIPanel — failures are a toast with the server\'s sentence', () => {
  for (const [what, reply, expected] of [
    ['budget refused (429)', () => h3Error(429, 'Hệ thống hết ngân sách cho AI. Vui lòng nạp thêm ngân sách.'), 'Hệ thống hết ngân sách cho AI. Vui lòng nạp thêm ngân sách.'],
    ['provider failed (502)', () => h3Error(502, 'Không thể tạo phản hồi từ trợ lý AI.'), 'Không thể tạo phản hồi từ trợ lý AI.'],
    ['bad request (400)', () => h3Error(400, 'Hành động không hợp lệ. Chọn summary, suggest_titles hoặc polish.'), 'Hành động không hợp lệ. Chọn summary, suggest_titles hoặc polish.'],
    ['no answer at all', () => dropped(), 'Lỗi khi gọi Trợ lý AI.'],
  ] as const) {
    it(`${what}: "${expected}", the toolbar back, nothing applied`, async (t) => {
      const p = await openPanel(t, { reply })
      await p.press(tool(p, 'Gợi ý tiêu đề'))
      assert.equal(p.lastToast('error'), expected)
      assert.ok(!p.toasts.some(toast => OFETCH_LINE.test(toast.message)), JSON.stringify(p.toasts))
      assert.equal(p.toasts.filter(toast => toast.type === 'success').length, 0)
      assert.ok(buttonsIn(p).every(button => !disabled(button)))
      assert.deepEqual(p.emitted, [])
      assert.equal(posts(p).length, 1)
    })
  }
})
