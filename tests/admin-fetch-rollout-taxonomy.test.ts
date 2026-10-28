/**
 * Wave 3 D-FETCH, batch D: the two taxonomy pages — `pages/admin/content/categories/index.vue`
 * (5 `$fetch` casts) and `pages/admin/content/content-types.vue` (5) — call `adminFetch<T>()`
 * with response types derived from the handlers (app/types/admin-taxonomy-api.ts).
 *
 * The REAL page — `<script setup>` and template — is mounted (tests/_admin-page-harness.ts)
 * over REAL ofetch on a fake network. Pinned, green before and after the conversion:
 *   - the requests of the mount and of every action (method, path, JSON body), the confirm
 *     that gates a delete, and the reload after each write;
 *   - a failure shows the sentence the SERVER wrote, never ofetch's `[GET] "…"` line; a failed
 *     load is a `role="alert"` branch with "thử lại", not an empty list;
 *   - a reload narrows the bulk selection to the rows still on screen (`keepOnly`).
 *
 * FINDINGS, RED on the base (fb4751c1):
 *   - both lists are reloaded in full after every write, and the header's "Tạo … Mới" stays
 *     usable while a reload is in flight — so a create during the reload of a delete put two
 *     loads in flight, and the older one landing last wiped the row just created from the
 *     screen (the officer creates it again: a duplicate with slug `-2`). Now only the latest
 *     load writes rows, error and loading (the ticket pattern of the articles list,
 *     docs/decisions/fetch-rollout-d-fetch.md);
 *   - content-types: renaming a type's slug makes the SERVER move its categories to the new
 *     slug (`content-types/[id].put.ts` cascade), but the page reloaded only the types — the
 *     tree preview filtered the old category rows by the new slug and said "Chưa có danh mục
 *     nào trong thể loại này." for a type whose badge said 2 categories;
 *   - content-types: the categories load failed in silence, and every type in the tree then
 *     said "Chưa có danh mục nào trong thể loại này." — the empty state CLAUDE.md's error
 *     contract exists to prevent. It now says the categories could not be loaded, with a retry.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { byText, click, findAll, fire, input, textOf, type MiniElement } from './_sfc-mount.ts'
import {
  alertText, dropped, h3Error, json, mountAdminPage, OFETCH_LINE, OpenModal, routes, sent, settle, unmountAll, wire,
  type MountedAdminPage, type NetCall, type Responder,
} from './_admin-page-harness.ts'

afterEach(unmountAll)

type Route = (call: NetCall) => Response | Error | undefined

const MODAL = { '~/components/admin/AdminModal.vue': { default: OpenModal } }
const screen = (opened: MountedAdminPage) => textOf(opened.page.root)
function assertOnlyServerSentences(opened: MountedAdminPage) {
  for (const t of opened.toasts) assert.doesNotMatch(t.message, OFETCH_LINE, `toast "${t.message}"`)
  assert.doesNotMatch(alertText(opened.page), OFETCH_LINE)
}
const dialog = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.props.role === 'dialog')[0]
/** The button of `scope` whose whole text is `label`. */
const button = (scope: MiniElement, label: string) => {
  const found = findAll(scope, el => el.tag === 'button' && textOf(el) === label)
  assert.equal(found.length, 1, `expected one "${label}" button, found ${found.length}`)
  return found[0]!
}
const field = (scope: MiniElement, placeholder: string) => findAll(scope, el => el.props.placeholder === placeholder)[0]!
const bulkBar = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'AdminBulkActionBar')[0]
const checkbox = (opened: MountedAdminPage, label: string) => findAll(opened.page.root, el => el.tag === 'input' && el.props['aria-label'] === label)[0]!
const skeleton = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.props.role === 'status').length === 1

const CT_URL = '/api/admin/content-types'
const CAT_URL = '/api/admin/categories'
const STAMP = '2026-10-20T02:00:00.000Z'
const ctRow = (id: number, slug: string, name: string, over: Record<string, unknown> = {}) => ({
  id, name, slug, icon: 'fa-solid fa-newspaper', description: null, displayOrder: id, isSystem: false, createdAt: STAMP,
  categoryCount: 0, articleCount: 0, ...over,
})
const catRow = (id: number, name: string, type: string, parentId: number | null = null, over: Record<string, unknown> = {}) => ({
  id, name, slug: `dm-${id}`, parentId, type, description: null, displayOrder: 0, createdAt: STAMP, parentName: null, ...over,
})
const TYPES = [
  ctRow(1, 'news', 'Tin tức', { isSystem: true, categoryCount: 3, articleCount: 40 }),
  ctRow(7, 'tu-lieu', 'Tư liệu', { categoryCount: 0 }),
]
const CATS = [
  catRow(10, 'Tin hoạt động', 'news'),
  catRow(11, 'Tin địa phương', 'news', 10),
  catRow(12, 'Thông báo', 'news'),
]
const list = (items: unknown[]) => json({ ok: true, items })

function server(overrides: Record<string, Route> = {}): Responder {
  return routes({
    [`GET ${CT_URL}`]: () => list(TYPES),
    [`GET ${CAT_URL}`]: () => list(CATS),
    [`POST ${CAT_URL}`]: () => json({ ok: true, id: 30, slug: 'tin-moi' }),
    [`PUT ${CAT_URL}/12`]: () => json({ ok: true, slug: 'thong-bao' }),
    [`DELETE ${CAT_URL}/12`]: () => json({ ok: true }),
    [`POST ${CT_URL}`]: () => json({ ok: true, id: 9, slug: 'van-ban' }),
    [`PUT ${CT_URL}/7`]: () => json({ ok: true, slug: 'tu-lieu' }),
    [`PUT ${CT_URL}/1`]: () => json({ ok: true, slug: 'news' }),
    [`DELETE ${CT_URL}/7`]: () => json({ ok: true }),
    ...overrides,
  })
}

// ─── pages/admin/content/categories/index.vue ────────────────────────────────

const CATEGORIES = 'pages/admin/content/categories/index.vue'
const openCategories = (responder = server(), query: Record<string, unknown> = {}) =>
  mountAdminPage(CATEGORIES, responder, { modules: MODAL, route: { query } })
/** The desktop table row whose name cell is `name`. */
const catRowOf = (opened: MountedAdminPage, name: string) => {
  const found = findAll(opened.page.root, el => el.tag === 'tr' && findAll(el, td => td.tag === 'td').some(td => textOf(td).startsWith(name)))
  assert.equal(found.length, 1, `expected one row for "${name}", found ${found.length}`)
  return found[0]!
}

describe(CATEGORIES, () => {
  it('mount: content types, then the categories; roots with their children, the type named from content types', async () => {
    const opened = await openCategories()
    assert.deepEqual(opened.calls.map(wire), [`GET ${CT_URL}`, `GET ${CAT_URL}`])
    const cells = findAll(catRowOf(opened, 'Tin hoạt động'), el => el.tag === 'td').map(textOf)
    assert.deepEqual(cells.slice(1, 5), ['Tin hoạt động1 con', 'dm-10', 'Tin tức', '0'])
    assert.ok(catRowOf(opened, 'Tin địa phương'))
    assert.equal(alertText(opened.page), '')
  })

  it('`?type=` shows that type only (client-side, the request is unchanged)', async () => {
    const opened = await openCategories(server({ [`GET ${CAT_URL}`]: () => list([...CATS, catRow(20, 'Hồ sơ mẫu', 'tu-lieu')]) }), { type: 'tu-lieu' })
    assert.deepEqual(opened.calls.map(wire), [`GET ${CT_URL}`, `GET ${CAT_URL}`])
    assert.match(screen(opened), /Hồ sơ mẫu/)
    assert.doesNotMatch(screen(opened), /Tin hoạt động/)
  })

  it('create: POST the canonical payload, toast, close, reload the list', async () => {
    const opened = await openCategories()
    await click(byText(opened.page.root, 'button', 'Tạo Danh Mục Mới'))
    const modal = dialog(opened)!
    await input(field(modal, 'Vd: Tin hoạt động C11'), 'Tin mới ')
    const before = opened.calls.length
    await click(button(modal, 'Tạo Danh Mục'))
    await settle()
    assert.deepEqual(sent(opened.calls, before), [
      { wire: `POST ${CAT_URL}`, body: { name: 'Tin mới', slug: 'tin-moi', type: 'news', description: null, parentId: null, displayOrder: 0 } },
      `GET ${CAT_URL}`,
    ])
    assert.equal(opened.lastToast('success'), 'Đã tạo danh mục thành công!')
    assert.equal(dialog(opened), undefined)
  })

  it('edit: PUT the row; a refusal keeps the modal open and says the server\'s sentence', async () => {
    const opened = await openCategories()
    await click(button(catRowOf(opened, 'Thông báo'), 'Sửa'))
    const before = opened.calls.length
    await click(button(dialog(opened)!, 'Cập Nhật'))
    await settle()
    assert.deepEqual(sent(opened.calls, before), [
      { wire: `PUT ${CAT_URL}/12`, body: { name: 'Thông báo', slug: 'dm-12', type: 'news', description: null, parentId: null, displayOrder: 0 } },
      `GET ${CAT_URL}`,
    ])
    assert.equal(opened.lastToast('success'), 'Đã cập nhật danh mục thành công!')

    const refused = await openCategories(server({ [`PUT ${CAT_URL}/12`]: () => h3Error(400, 'Chỉ cho phép 1 cấp cha-con.') }))
    await click(button(catRowOf(refused, 'Thông báo'), 'Sửa'))
    await click(button(dialog(refused)!, 'Cập Nhật'))
    await settle()
    assert.equal(refused.lastToast('error'), 'Chỉ cho phép 1 cấp cha-con.')
    assert.ok(dialog(refused), 'the form stays open with what was typed')
    assertOnlyServerSentences(refused)
  })

  it('delete: confirm names the category; DELETE, toast, reload; a refusal says why; "no" sends nothing', async () => {
    const opened = await openCategories()
    const before = opened.calls.length
    await click(button(catRowOf(opened, 'Thông báo'), 'Xóa'))
    await settle()
    assert.equal(opened.confirms.at(-1)?.message, 'Bạn có chắc muốn xóa danh mục "Thông báo"?')
    assert.deepEqual(sent(opened.calls, before), [`DELETE ${CAT_URL}/12`, `GET ${CAT_URL}`])
    assert.equal(opened.lastToast('success'), 'Đã xóa danh mục thành công!')

    const refused = await openCategories(server({ [`DELETE ${CAT_URL}/12`]: () => h3Error(409, 'Danh mục còn 4 bài viết, không thể xoá.') }))
    await click(button(catRowOf(refused, 'Thông báo'), 'Xóa'))
    await settle()
    assert.equal(refused.lastToast('error'), 'Danh mục còn 4 bài viết, không thể xoá.')
    assertOnlyServerSentences(refused)

    const declined = await openCategories()
    declined.answers.confirm = false
    const sentBefore = declined.calls.length
    await click(button(catRowOf(declined, 'Thông báo'), 'Xóa'))
    await settle()
    assert.equal(declined.calls.length, sentBefore)
  })

  it('load failure: the server\'s sentence + "thử lại" (no empty state); a dropped connection the fallback; empty list', async () => {
    let answer: () => Response | Error = () => h3Error(403, 'Bạn không có quyền xem danh mục.')
    const opened = await openCategories(server({ [`GET ${CAT_URL}`]: () => answer() }))
    assert.match(alertText(opened.page), /Bạn không có quyền xem danh mục\./)
    assert.doesNotMatch(screen(opened), /Chưa có danh mục nào/)
    assertOnlyServerSentences(opened)
    answer = () => list(CATS)
    const before = opened.calls.length
    await click(byText(opened.page.root, 'button', 'thử lại'))
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), [`GET ${CAT_URL}`])
    assert.equal(alertText(opened.page), '')
    assert.ok(catRowOf(opened, 'Thông báo'))

    const offline = await openCategories(server({ [`GET ${CAT_URL}`]: () => dropped() }))
    assert.match(alertText(offline.page), /Không tải được danh sách danh mục\./)
    assertOnlyServerSentences(offline)
    const empty = await openCategories(server({ [`GET ${CAT_URL}`]: () => list([]) }))
    assert.match(screen(empty), /Chưa có danh mục nào\. Hãy tạo danh mục đầu tiên!/)
  })

  it('content types refused: the server\'s sentence in a toast; the list still loads', async () => {
    const opened = await openCategories(server({ [`GET ${CT_URL}`]: () => h3Error(403, 'Bạn không có quyền xem thể loại.') }))
    assert.equal(opened.lastToast('error'), 'Bạn không có quyền xem thể loại.')
    assert.ok(catRowOf(opened, 'Thông báo'))
    assertOnlyServerSentences(opened)
  })

  it('a reload drops a ticked row that is gone from the bulk selection (keepOnly)', async () => {
    let rows = CATS
    const opened = await openCategories(server({ [`GET ${CAT_URL}`]: () => list(rows) }))
    await fire(checkbox(opened, 'Chọn danh mục Tin địa phương'), 'change')
    await settle()
    assert.equal(bulkBar(opened)?.props.count, 1)
    rows = CATS.filter(c => c.id !== 11)
    await click(button(catRowOf(opened, 'Thông báo'), 'Xóa'))
    await settle()
    assert.equal(bulkBar(opened), undefined, 'a bulk delete must not reach a row that is no longer on screen')
  })

  it('FINDING: a create during the reload of a delete — the older reload landing last does not hide the new row', async () => {
    const pending: NetCall[] = []
    let mounted = false
    const opened = await openCategories(server({
      [`GET ${CAT_URL}`]: (call) => { if (!mounted) return list(CATS); pending.push(call); return undefined },
    }))
    mounted = true
    void click(button(catRowOf(opened, 'Thông báo'), 'Xóa'))
    await settle()
    assert.equal(pending.length, 1, 'the delete\'s reload is in flight')
    await click(byText(opened.page.root, 'button', 'Tạo Danh Mục Mới'))
    await input(field(dialog(opened)!, 'Vd: Tin hoạt động C11'), 'Tin mới')
    void click(button(dialog(opened)!, 'Tạo Danh Mục'))
    await settle()
    assert.equal(pending.length, 2, 'the create\'s reload is in flight too')
    const afterBoth = [...CATS.filter(c => c.id !== 12), catRow(30, 'Tin mới', 'news')]
    pending[1]!.respond(list(afterBoth))
    await settle()
    pending[0]!.respond(list(CATS.filter(c => c.id !== 12)))
    await settle()
    assert.match(screen(opened), /Tin mới/, 'the category just created vanished from the list')
    assert.equal(skeleton(opened), false)
  })

  it('FINDING: a superseded reload\'s failure neither shows an error nor ends the newer load', async () => {
    const pending: NetCall[] = []
    let mounted = false
    const opened = await openCategories(server({
      [`GET ${CAT_URL}`]: (call) => { if (!mounted) return list(CATS); pending.push(call); return undefined },
    }))
    mounted = true
    void click(button(catRowOf(opened, 'Thông báo'), 'Xóa'))
    await settle()
    await click(byText(opened.page.root, 'button', 'Tạo Danh Mục Mới'))
    await input(field(dialog(opened)!, 'Vd: Tin hoạt động C11'), 'Tin mới')
    void click(button(dialog(opened)!, 'Tạo Danh Mục'))
    await settle()
    pending[0]!.respond(h3Error(403, 'Phiên cũ đã hết quyền.'))
    await settle()
    assert.equal(alertText(opened.page), '')
    assert.equal(skeleton(opened), true, 'the newer load is still running')
    pending[1]!.respond(list(CATS))
    await settle()
    assert.equal(alertText(opened.page), '')
    assert.equal(skeleton(opened), false)
  })
})

// ─── pages/admin/content/content-types.vue ───────────────────────────────────

const CONTENT_TYPES = 'pages/admin/content/content-types.vue'
const openTypes = (responder = server()) => mountAdminPage(CONTENT_TYPES, responder, { modules: MODAL })
/** The tree card of one type (level 1 header + its categories). */
const card = (opened: MountedAdminPage, name: string) => {
  const found = findAll(opened.page.root, el => el.tag === 'div' && typeof el.props.class === 'string'
    && el.props.class.startsWith('rounded-xl border border-line overflow-hidden') && textOf(el).includes(name))
  assert.equal(found.length, 1, `expected one tree card for "${name}", found ${found.length}`)
  return found[0]!
}
const typeRowOf = (opened: MountedAdminPage, name: string) => {
  const found = findAll(opened.page.root, el => el.tag === 'tr' && findAll(el, td => td.tag === 'td').some(td => textOf(td).includes(name)))
  assert.equal(found.length, 1, `expected one row for "${name}", found ${found.length}`)
  return found[0]!
}
const showTable = async (opened: MountedAdminPage) => { await click(byText(opened.page.root, 'button', 'Xem bảng')); await settle() }

describe(CONTENT_TYPES, () => {
  it('mount: types and categories together; the tree nests each type\'s categories', async () => {
    const opened = await openTypes()
    assert.deepEqual(opened.calls.map(wire), [`GET ${CT_URL}`, `GET ${CAT_URL}`])
    const news = textOf(card(opened, 'Tin tức'))
    assert.match(news, /Hệ thống/)
    assert.match(news, /3 danh mục · 40 bài viết/)
    // Level 2 (a root, its slug, "1 con") then level 3 (the child) inside it.
    const root = findAll(card(opened, 'Tin tức'), el => el.tag === 'li' && textOf(el).startsWith('Tin hoạt động'))[0]!
    assert.equal(textOf(root), 'Tin hoạt độngdm-101 conTin địa phươngdm-11')
    assert.match(news, /Thông báodm-12/)
    assert.match(textOf(card(opened, 'Tư liệu')), /Chưa có danh mục nào trong thể loại này\./)
  })

  it('create: POST with the canonical slug; edit of a system type leaves the slug out; both reload', async () => {
    const opened = await openTypes()
    await click(byText(opened.page.root, 'button', 'Tạo Thể Loại Mới'))
    await input(field(dialog(opened)!, 'Vd: Video tuyên truyền'), 'Văn bản')
    const before = opened.calls.length
    await click(button(dialog(opened)!, 'Tạo Thể Loại'))
    await settle()
    assert.deepEqual(sent(opened.calls, before)[0], { wire: `POST ${CT_URL}`, body: { name: 'Văn bản', icon: 'fa-solid fa-folder', description: null, displayOrder: 0, slug: 'van-ban' } })
    assert.ok(sent(opened.calls, before).includes(`GET ${CT_URL}`))
    assert.equal(opened.lastToast('success'), 'Đã tạo thể loại thành công!')

    await click(byText(card(opened, 'Tin tức'), 'button', 'Sửa'))
    const at = opened.calls.length
    await click(button(dialog(opened)!, 'Cập Nhật'))
    await settle()
    assert.deepEqual(sent(opened.calls, at)[0], { wire: `PUT ${CT_URL}/1`, body: { name: 'Tin tức', icon: 'fa-solid fa-newspaper', description: null, displayOrder: 1 } })
    assert.equal(opened.lastToast('success'), 'Đã cập nhật thể loại thành công!')
  })

  it('FINDING: renaming a type\'s slug reloads the categories too — the server moved them to the new slug', async () => {
    let types = TYPES
    let cats = [...CATS, catRow(20, 'Hồ sơ mẫu', 'tu-lieu'), catRow(21, 'Biểu mẫu', 'tu-lieu')]
    const opened = await openTypes(server({
      [`GET ${CT_URL}`]: () => list(types),
      [`GET ${CAT_URL}`]: () => list(cats),
      [`PUT ${CT_URL}/7`]: () => {
        // What content-types/[id].put.ts does: the type, then its categories and articles.
        types = [TYPES[0]!, ctRow(7, 'tai-lieu', 'Tư liệu', { categoryCount: 2 })]
        cats = cats.map(c => (c.type === 'tu-lieu' ? { ...c, type: 'tai-lieu' } : c))
        return json({ ok: true, slug: 'tai-lieu' })
      },
    }))
    assert.match(textOf(card(opened, 'Tư liệu')), /Hồ sơ mẫu/)
    await click(byText(card(opened, 'Tư liệu'), 'button', 'Sửa'))
    await input(field(dialog(opened)!, 'video-tuyen-truyen'), 'tai-lieu')
    await click(button(dialog(opened)!, 'Cập Nhật'))
    await settle()
    const renamed = textOf(card(opened, 'Tư liệu'))
    assert.match(renamed, /tai-lieu/)
    assert.match(renamed, /Hồ sơ mẫu/, 'the renamed type lost its categories in the tree')
    assert.doesNotMatch(renamed, /Chưa có danh mục nào/)
  })

  it('FINDING: the categories cannot be loaded — the tree says so (with a retry), not "Chưa có danh mục nào"', async () => {
    let answer: () => Response | Error = () => h3Error(403, 'Bạn không có quyền xem danh mục.')
    const opened = await openTypes(server({ [`GET ${CAT_URL}`]: () => answer() }))
    assert.doesNotMatch(textOf(card(opened, 'Tin tức')), /Chưa có danh mục nào/, 'a list that was never read is not "empty"')
    assert.match(alertText(opened.page), /Bạn không có quyền xem danh mục\./)
    assertOnlyServerSentences(opened)
    answer = () => list(CATS)
    const before = opened.calls.length
    await click(byText(opened.page.root, 'button', 'thử lại'))
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), [`GET ${CAT_URL}`])
    assert.equal(alertText(opened.page), '')
    assert.match(textOf(card(opened, 'Tin tức')), /Tin hoạt động/)
  })

  it('delete: confirm, DELETE, toast, reload; a refusal says the server\'s sentence', async () => {
    const opened = await openTypes()
    const before = opened.calls.length
    await click(byText(card(opened, 'Tư liệu'), 'button', 'Xóa'))
    await settle()
    assert.equal(opened.confirms.at(-1)?.message, 'Bạn có chắc muốn xóa thể loại "Tư liệu"?')
    assert.deepEqual(sent(opened.calls, before), [`DELETE ${CT_URL}/7`, `GET ${CT_URL}`])
    assert.equal(opened.lastToast('success'), 'Đã xóa thể loại thành công!')

    const refused = await openTypes(server({ [`DELETE ${CT_URL}/7`]: () => h3Error(409, 'Thể loại còn 2 danh mục.') }))
    await click(byText(card(refused, 'Tư liệu'), 'button', 'Xóa'))
    await settle()
    assert.equal(refused.lastToast('error'), 'Thể loại còn 2 danh mục.')
    assertOnlyServerSentences(refused)
  })

  it('load failure: the server\'s sentence + "thử lại" (no empty state); dropped connection; empty list', async () => {
    let answer: () => Response | Error = () => h3Error(403, 'Bạn không có quyền xem thể loại.')
    const opened = await openTypes(server({ [`GET ${CT_URL}`]: () => answer() }))
    assert.match(alertText(opened.page), /Bạn không có quyền xem thể loại\./)
    assert.doesNotMatch(screen(opened), /Chưa có thể loại nào/)
    answer = () => list(TYPES)
    const before = opened.calls.length
    await click(byText(opened.page.root, 'button', 'thử lại'))
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), [`GET ${CT_URL}`])
    assert.equal(alertText(opened.page), '')

    const offline = await openTypes(server({ [`GET ${CT_URL}`]: () => dropped() }))
    assert.match(alertText(offline.page), /Không tải được danh sách thể loại\./)
    assertOnlyServerSentences(offline)
    const empty = await openTypes(server({ [`GET ${CT_URL}`]: () => list([]) }))
    assert.match(screen(empty), /Chưa có thể loại nào\. Hãy tạo thể loại đầu tiên!/)
  })

  it('a reload drops a ticked type that is gone from the bulk selection (keepOnly); system types have no box', async () => {
    let types = TYPES
    const opened = await openTypes(server({ [`GET ${CT_URL}`]: () => list(types) }))
    await showTable(opened)
    assert.equal(findAll(typeRowOf(opened, 'Tin tức'), el => el.tag === 'input').length, 0)
    await fire(checkbox(opened, 'Chọn thể loại Tư liệu'), 'change')
    await settle()
    assert.equal(bulkBar(opened)?.props.count, 1)
    types = [TYPES[0]!]
    await click(byText(typeRowOf(opened, 'Tin tức'), 'button', 'Sửa'))
    await click(button(dialog(opened)!, 'Cập Nhật'))
    await settle()
    assert.equal(bulkBar(opened), undefined)
  })

  it('FINDING: a create during the reload of a delete — the older reload landing last does not hide the new type', async () => {
    const pending: NetCall[] = []
    let mounted = false
    const opened = await openTypes(server({
      [`GET ${CT_URL}`]: (call) => { if (!mounted) return list(TYPES); pending.push(call); return undefined },
    }))
    mounted = true
    void click(byText(card(opened, 'Tư liệu'), 'button', 'Xóa'))
    await settle()
    assert.equal(pending.length, 1)
    await click(byText(opened.page.root, 'button', 'Tạo Thể Loại Mới'))
    await input(field(dialog(opened)!, 'Vd: Video tuyên truyền'), 'Văn bản')
    void click(button(dialog(opened)!, 'Tạo Thể Loại'))
    await settle()
    assert.equal(pending.length, 2)
    pending[1]!.respond(list([TYPES[0]!, ctRow(9, 'van-ban', 'Văn bản')]))
    await settle()
    pending[0]!.respond(list([TYPES[0]!]))
    await settle()
    assert.match(screen(opened), /Văn bản/, 'the type just created vanished from the list')
    assert.equal(skeleton(opened), false)
  })
})
