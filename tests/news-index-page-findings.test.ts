/**
 * `/news` — defects found while splitting the page (wave3 4.2). Each test was RED on the
 * original `app/pages/news/index.vue` (run it there with `NEWS_PAGE_FILE=<file>`), and is
 * green after the fix. Recorded in docs/decisions/refactor-large-files.md.
 *
 *   FINDING-N1  category names never follow the language. The categories were fetched under
 *               the constant key `'news-categories'` with no `lang` in the query, so the
 *               handler fell back to the `cdkt_lang` cookie — which `$fetch` does not forward
 *               during server rendering — and a language switch never fetched again: an
 *               English reader got Vietnamese chips, rail entries, crumb and (legacy `?cat=`)
 *               heading, while `/news/<chuyên mục>` (ContentTypeListSection) showed English.
 *               The D25 defect of "Đọc nhiều", on the category list.
 *   FINDING-N2  a failed search read as "0 results". Nuxt resets `data` to `default()` when a
 *               request fails (asyncData.js), and the search banner showed its count whenever
 *               the list was not pending — "«abc» (0 bài viết)" above the error card.
 *   FINDING-N3  a failed "Đọc nhiều" read as "no data". The rail said "Chưa có dữ liệu lượt
 *               xem." when the request failed — same reset — with no way to retry.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { click, findAll } from './_sfc-mount.ts'
import {
  alerts, buttonsWith, byTag, h1, isCategories, isList, isMostRead, navByLabel, newsServer, openNews, pills, queryOf, unavailable, widget, words,
  type NetCall,
} from './_news-page-harness.ts'

const categoryCalls = (calls: NetCall[]) => calls.filter(isCategories).map(queryOf)

test('FINDING-N1: the categories are requested in the page language', async (t) => {
  const ctx = await openNews(t)
  assert.deepEqual(categoryCalls(ctx.calls), [{ type: 'news', lang: 'vi' }])
})

test('FINDING-N1: an English reader gets English category names on first load', async (t) => {
  const ctx = await openNews(t, newsServer(), { lang: 'en', query: { cat: 'tin-dia-phuong' } })
  assert.deepEqual(categoryCalls(ctx.calls), [{ type: 'news', lang: 'en' }])
  assert.deepEqual(pills(ctx.page).map(words).slice(1, 4), ['Featured News', 'Activities', 'Local News'])
  assert.equal(h1(ctx.page), 'Local News')
})

test('FINDING-N1: switching the language fetches the categories again, once, and relabels every place they show', async (t) => {
  const ctx = await openNews(t, newsServer(), { query: { cat: 'tin-dia-phuong' } })
  assert.equal(h1(ctx.page), 'Tin địa phương')
  ctx.currentLang.value = 'en'
  await ctx.settle()
  assert.deepEqual(categoryCalls(ctx.calls), [{ type: 'news', lang: 'vi' }, { type: 'news', lang: 'en' }])
  assert.deepEqual(pills(ctx.page).map(words).slice(1, 4), ['Featured News', 'Activities', 'Local News'])
  assert.deepEqual(byTag(widget(ctx.page, 'Categories') ?? widget(ctx.page, 'Chuyên mục')!, 'button').map(words).slice(1), ['Featured News', 'Activities', 'Local News'])
  assert.equal(h1(ctx.page), 'Local News')
  assert.match(words(navByLabel(ctx.page, 'Đường dẫn trang')!), /› Local News$/)

  // And back: one more request, Vietnamese again.
  ctx.currentLang.value = 'vi'
  await ctx.settle()
  assert.equal(categoryCalls(ctx.calls).length, 3)
  assert.equal(h1(ctx.page), 'Tin địa phương')
})

test('FINDING-N2: a failed search does not claim "0 bài viết"', async (t) => {
  const server = newsServer()
  server.state.override = call => (isList(call) ? unavailable({ ok: false, articles: [], pagination: { page: 1, limit: 19, total: 0, totalPages: 1 } }) : undefined)
  const ctx = await openNews(t, server, { query: { q: 'abc' } })
  assert.equal(alerts(ctx.page).length, 1, 'the error card is up')
  const banner = buttonsWith(ctx.page, 'Xóa bộ lọc')[0]!.parent!
  assert.equal(words(banner), 'Kết quả tìm kiếm cho: «abc» Xóa bộ lọc')

  // Once the retry succeeds, the count is back.
  server.state.override = () => undefined
  await click(buttonsWith(ctx.page, 'Thử lại ngay')[0]!)
  await ctx.settle()
  assert.equal(words(buttonsWith(ctx.page, 'Xóa bộ lọc')[0]!.parent!), 'Kết quả tìm kiếm cho: «abc» (4 bài viết) Xóa bộ lọc')
})

test('FINDING-N3: a failed "Đọc nhiều" says it failed and offers a retry — not "no data"', async (t) => {
  const server = newsServer()
  server.state.override = call => (isMostRead(call) ? unavailable({ ok: false, articles: [], pagination: { page: 1, limit: 6, total: 0, totalPages: 1 } }) : undefined)
  const ctx = await openNews(t, server)
  const box = widget(ctx.page, 'Đọc nhiều')!
  assert.doesNotMatch(words(box), /Chưa có dữ liệu lượt xem/)
  const alert = findAll(box, el => el.props.role === 'alert')
  assert.equal(alert.length, 1)
  assert.equal(words(alert[0]!), 'Đã xảy ra lỗi khi kết nối dữ liệu máy chủ. Thử lại')
  // The list's own error card is not involved.
  assert.equal(alerts(ctx.page).length, 1)

  const before = ctx.calls.filter(isMostRead).length
  server.state.override = () => undefined
  await click(buttonsWith(box, 'Thử lại')[0]!)
  await ctx.settle()
  assert.equal(ctx.calls.filter(isMostRead).length, before + 1, 'one request: "Đọc nhiều" only')
  assert.equal(ctx.calls.filter(isList).length, 1, 'the list is not reloaded')
  assert.equal(byTag(widget(ctx.page, 'Đọc nhiều')!, 'li').length, 6)
  assert.equal(alerts(ctx.page).length, 0)
})
