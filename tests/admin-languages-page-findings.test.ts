/**
 * `/admin/languages` — bugs found while writing tests/admin-languages-page.test.ts (wave3
 * 4.2). Each test here is RED on the original page (`LANGUAGES_PAGE_FILE=<original>`) and
 * on the pure split, green after its fix (each fix is its own commit).
 *
 * FINDING-L1 — the Vietnamese source the AI translates FROM went stale. The page reads
 * every vi row once (`viTranslationsMap`) and sends `sourceText` from it for a single key
 * ("Dịch AI cho riêng khóa này") and for a batch ("Dịch AI (n)"). Two writes change vi rows
 * without reading that map again:
 *   - "Nạp mặc định" inserts the vi text of new default keys (most seed keys carry vi only),
 *     the other languages list them as untranslated, and translating one sent its KEY
 *     ("hotline") as the text to translate — the AI's answer was stored as the translation;
 *   - "Lưu" on a vi row in the table: translating that key into another language still sent
 *     the OLD Vietnamese text.
 *
 * FINDING-L2 — two AI batches at once share one progress dialog. "Đóng cửa sổ" hides a
 * running batch (it goes on in the background) and leaves every other language's
 * "Dịch AI (n)" enabled. Starting a second batch reset the shared progress, stop flag and
 * log: the first batch's chunks were counted into the second's progress, the first one's
 * end marked the dialog "Hoàn tất" while the second still ran, and "Dừng lại" could no
 * longer stop the first (the second had cleared the flag). Now one batch runs at a time: a
 * second start shows the running batch's dialog and says which language is running.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { click, fire, input, type MiniElement } from './_sfc-mount.ts'
import {
  button, buttonsWith, byTitle, card, dialog, dialogs, findAll, HOLD, lastToast, languagesServer, openPage, tabButton, tableRows, textOf, wire,
  type NetCall,
} from './_languages-page-harness.ts'

const tap = (el: MiniElement) => { void click(el) }
const header = (page: Awaited<ReturnType<typeof openPage>>['page'], label: string) =>
  buttonsWith(page, label).find(b => String(b.props.class ?? '').includes('text-xs font-bold cursor-pointer flex items-center gap-1.5'))!
const chunkItems = (calls: NetCall[], from: number) => calls.slice(from)
  .filter(c => wire(c) === 'POST /api/admin/languages/ai-translate-chunk')
  .flatMap(c => (c.body as { items: Array<{ key: string, sourceText: string }> }).items)

describe('FINDING-L1 — the Vietnamese source text is read again after a write that changes it', () => {
  it('after "Nạp mặc định", a batch sends a seeded key\'s Vietnamese text, not the key (RED before: "hotline")', async (t) => {
    const ctx = await openPage(t)
    await click(header(ctx.page, 'Nạp mặc định'))
    await ctx.settle()
    assert.equal(lastToast(ctx.toasts, 'success'), 'Đã nạp 0 ngôn ngữ và 1 bản dịch mặc định.')
    const from = ctx.calls.length
    await click(button(card(ctx.page, 'fr'), 'Dịch AI ('))
    await ctx.settle()
    assert.deepEqual(chunkItems(ctx.calls, from), [{ group: 'footer', key: 'hotline', sourceText: 'Đường dây nóng' }])
    assert.equal(ctx.server.state.rows.fr!.find(r => r.key === 'hotline')?.value, 'AI(fr): Đường dây nóng', 'what is stored is a translation of the text')
  })

  it('after "Nạp mặc định", a single key\'s "Dịch AI" sends its Vietnamese text (RED before)', async (t) => {
    const ctx = await openPage(t)
    await click(header(ctx.page, 'Nạp mặc định'))
    await ctx.settle()
    await click(tabButton(ctx.page, 'Bản dịch UI'))
    await ctx.settle()
    const hotline = tableRows(ctx.page).find(r => textOf(r.children[0] as never) === 'hotline')!
    const from = ctx.calls.length
    await click(byTitle(hotline, 'Dịch AI cho riêng khóa này')[0]!)
    await ctx.settle()
    const sent = ctx.calls.slice(from).find(c => wire(c) === 'POST /api/admin/languages/ai-translate-key')!
    assert.equal((sent.body as { sourceText: string }).sourceText, 'Đường dây nóng')
  })

  it('after "Lưu" on a Vietnamese row, translating that key into English sends the NEW Vietnamese text (RED before: the old one)', async (t) => {
    const ctx = await openPage(t)
    await click(tabButton(ctx.page, 'Bản dịch UI'))
    await ctx.settle()
    const language = () => findAll(ctx.page.root, el => el.tag === 'select' && el.props['aria-label'] === 'Ngôn ngữ')[0]!
    const pick = async (code: string) => {
      await fire(language(), 'change', { target: { value: code } })
      await ctx.settle()
    }
    await pick('vi')
    const viNews = tableRows(ctx.page).find(r => textOf(r.children[0] as never) === 'news')!
    await click(byTitle(viNews, 'Sửa bản dịch')[0]!)
    await ctx.settle()
    for (const box of findAll(ctx.page.root, el => el.tag === 'textarea')) await input(box, 'Tin tức mới')
    await ctx.settle()
    await click(buttonsWith(ctx.page, 'Lưu').find(b => textOf(b) === 'Lưu')!)
    await ctx.settle()
    await pick('en')
    const enNews = tableRows(ctx.page).find(r => textOf(r.children[0] as never) === 'news')!
    const from = ctx.calls.length
    await click(byTitle(enNews, 'Dịch AI cho riêng khóa này')[0]!)
    await ctx.settle()
    const sent = ctx.calls.slice(from).find(c => wire(c) === 'POST /api/admin/languages/ai-translate-key')!
    assert.equal((sent.body as { sourceText: string }).sourceText, 'Tin tức mới')
  })
})

describe('FINDING-L2 — one AI batch at a time', () => {
  async function runningInBackground(t: Parameters<typeof openPage>[0]) {
    const server = languagesServer()
    server.state.rows.fr![1]!.value = null // fr misses nav.news too
    const held: NetCall[] = []
    server.state.override = call => (wire(call) === 'POST /api/admin/languages/ai-translate-chunk' ? (held.push(call), HOLD) : undefined)
    const ctx = await openPage(t, server)
    tap(button(card(ctx.page, 'en'), 'Dịch AI ('))
    await ctx.settle()
    await click(findAll(dialog(ctx.page), el => el.tag === 'button' && textOf(el) === 'Đóng cửa sổ')[0]!)
    await ctx.settle()
    assert.equal(dialogs(ctx.page).length, 0)
    return { ctx, server, held }
  }

  it('a second language\'s "Dịch AI" while one runs starts nothing: the running dialog comes back, and says which (RED before: a second batch)', async (t) => {
    const { ctx, server, held } = await runningInBackground(t)
    const from = ctx.calls.length
    tap(button(card(ctx.page, 'fr'), 'Dịch AI ('))
    await ctx.settle()
    assert.deepEqual(ctx.calls.slice(from).map(wire), [], 'no second batch: French is not read, no chunk is sent')
    assert.equal(dialog(ctx.page).props['aria-label'], 'Tiến trình Dịch AI: 🇬🇧 English (en)')
    assert.equal(lastToast(ctx.toasts, 'info'), 'Đang dịch AI cho English — chờ xong hoặc bấm "Dừng lại" rồi chạy tiếp.')
    server.answer(held[0]!)
    await ctx.settle()
    assert.equal(lastToast(ctx.toasts, 'success'), 'Đã hoàn tất dịch 1/1 key cho English!')
    assert.match(textOf(dialog(ctx.page)), /Đã dịch: 1 \/ 1 key/)
  })

  it('"Dịch tất cả còn thiếu" while a batch runs asks nothing and starts nothing (RED before)', async (t) => {
    const { ctx } = await runningInBackground(t)
    const from = ctx.calls.length
    const confirmsBefore = ctx.confirms.length
    tap(header(ctx.page, 'Dịch tất cả còn thiếu'))
    await ctx.settle()
    assert.equal(ctx.confirms.length, confirmsBefore)
    assert.deepEqual(ctx.calls.slice(from).map(wire), [])
    assert.equal(dialog(ctx.page).props['aria-label'], 'Tiến trình Dịch AI: 🇬🇧 English (en)')
  })

  it('"Dừng lại" still stops the batch that runs (RED before: a second start had cleared the stop)', async (t) => {
    const server = languagesServer()
    for (let i = 1; i <= 12; i++) server.state.rows.vi!.push({ group: 'bulk', key: `k${i}`, value: `Giá trị ${i}`, isAiTranslated: false })
    const held: NetCall[] = []
    server.state.override = call => (wire(call) === 'POST /api/admin/languages/ai-translate-chunk' ? (held.push(call), HOLD) : undefined)
    const ctx = await openPage(t, server)
    tap(button(card(ctx.page, 'en'), 'Dịch AI ('))
    await ctx.settle()
    await click(button(dialog(ctx.page), 'Dừng lại'))
    await ctx.settle()
    await click(findAll(dialog(ctx.page), el => el.tag === 'button' && textOf(el) === 'Đóng cửa sổ')[0]!)
    await ctx.settle()
    tap(button(card(ctx.page, 'fr'), 'Dịch AI ('))
    await ctx.settle()
    for (const call of [...held]) server.answer(call)
    await ctx.settle()
    for (const call of held.slice(1)) server.answer(call)
    await ctx.settle()
    const enChunks = ctx.calls.filter(c => wire(c) === 'POST /api/admin/languages/ai-translate-chunk' && (c.body as { langCode: string }).langCode === 'en')
    assert.equal(enChunks.length, 1, 'English stopped after the chunk in flight')
  })
})
