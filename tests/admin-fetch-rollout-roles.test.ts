/**
 * Wave 3 D-FETCH, batch F: the role editor — `pages/admin/users/roles.vue` (2 `$fetch` casts) —
 * calls `adminFetch<T>()` with `AdminRolesResponse` / `AdminRoleUpdateResponse`
 * (app/types/admin-users-api.ts, derived from the handlers).
 *
 * The REAL page is mounted over REAL ofetch on a fake network. Pinned, green before and after:
 *   - the GET of the mount; the first role is selected and its matrix rendered;
 *   - "Lưu Phân Quyền" PUTs the matrix of the SELECTED role (every resource, all seven flags),
 *     then reloads and keeps that role selected;
 *   - a failed or `ok: false` load shows a `role="alert"` with "thử lại" (the server's sentence,
 *     never ofetch's line) and no matrix — so no save button: this page already gated saving on
 *     the load (the button lives inside the loaded branch), unlike the menu editors of batch F;
 *   - a system role's matrix cannot be saved; a refused save toasts the server's sentence.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { fire, findAll, textOf, type MiniElement } from './_sfc-mount.ts'
import {
  alertText, dropped, h3Error, json, mountAdminPage, OFETCH_LINE, OpenModal, routes, sent, settle, unmountAll, wire,
  type MountedAdminPage, type NetCall, type Responder,
} from './_admin-page-harness.ts'
import { PERMISSION_RESOURCES } from '../shared/permissions.ts'

afterEach(unmountAll)

type Route = (call: NetCall) => Response | Error | undefined

const PAGE = 'pages/admin/users/roles.vue'
const ROLES = [
  { id: 1, name: 'superadmin', description: 'Toàn quyền', isSystem: true, createdAt: null, permissions: [] },
  { id: 2, name: 'editor', description: 'Biên tập', isSystem: false, createdAt: null, permissions: [{ id: 9, roleId: 2, resource: 'news', canCreate: true, canRead: true, canUpdate: true, canDelete: false, canPublish: null, canArchive: null, canTest: null }] },
  { id: 3, name: 'viewer', description: 'Chỉ xem', isSystem: false, createdAt: null, permissions: [] },
]

function server(overrides: Record<string, Route> = {}): Responder {
  return routes({
    'GET /api/admin/roles': () => json({ ok: true, roles: ROLES }),
    'PUT /api/admin/roles/3': () => json({ ok: true }),
    'PUT /api/admin/roles/2': () => json({ ok: true }),
    ...overrides,
  })
}

const open = (responder = server()) => mountAdminPage(PAGE, responder)
const heading = (opened: MountedAdminPage) => textOf(findAll(opened.page.root, el => el.tag === 'h2')[0] ?? [])
const roleButton = (opened: MountedAdminPage, name: string): MiniElement =>
  findAll(opened.page.root, el => el.tag === 'button' && textOf(el).startsWith(name))[0]!
const saveButtons = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'button' && /Lưu Phân Quyền|Đang lưu/.test(textOf(el)))
const box = (opened: MountedAdminPage, label: string) => findAll(opened.page.root, el => el.tag === 'input' && el.props['aria-label'] === label)[0]!

describe(PAGE, () => {
  it('mount: one GET; the first role is selected; its matrix reads the stored flags', async () => {
    const opened = await open()
    assert.deepEqual(opened.calls.map(wire), ['GET /api/admin/roles'])
    assert.match(heading(opened), /Ma trận Phân quyền: superadmin/)
    await fire(roleButton(opened, 'editor'), 'click')
    await settle()
    assert.match(heading(opened), /Ma trận Phân quyền: editor/)
    assert.equal(box(opened, 'Bản tin & Tin tức: Thêm').model?.value, true)
    assert.equal(box(opened, 'Bản tin & Tin tức: Xóa').model?.value, false)
    assert.equal(alertText(opened.page), '')
  })

  it('"Lưu Phân Quyền" PUTs the selected role\'s whole matrix, toasts, reloads and keeps the role selected', async () => {
    const opened = await open()
    await fire(roleButton(opened, 'viewer'), 'click')
    await settle()
    await fire(box(opened, 'Bản tin & Tin tức: Xem'), 'update:modelValue', true)
    const before = opened.calls.length
    await fire(saveButtons(opened)[0]!, 'click')
    await settle()
    const after = opened.calls.slice(before)
    assert.deepEqual(after.map(wire), ['PUT /api/admin/roles/3', 'GET /api/admin/roles'])
    const body = after[0]!.body as { permissions: Array<Record<string, unknown>> }
    assert.equal(body.permissions.length, PERMISSION_RESOURCES.length)
    assert.deepEqual(body.permissions.find(row => row.resource === 'news'),
      { resource: 'news', canCreate: false, canRead: true, canUpdate: false, canDelete: false, canPublish: false, canArchive: false, canTest: false })
    assert.equal(opened.lastToast('success'), 'Đã cập nhật phân quyền thành công!')
    assert.match(heading(opened), /Ma trận Phân quyền: viewer/)
  })

  it('a system role: "Lưu Phân Quyền" is disabled', async () => {
    const opened = await open()
    assert.equal(saveButtons(opened)[0]!.props.disabled, true)
  })

  it('a refused save toasts the server\'s sentence; a dropped one the page\'s; never ofetch\'s line; no reload', async () => {
    const opened = await open(server({ 'PUT /api/admin/roles/2': () => h3Error(403, 'Không thể gán quyền bạn không có.') }))
    await fire(roleButton(opened, 'editor'), 'click')
    await settle()
    const before = opened.calls.length
    await fire(saveButtons(opened)[0]!, 'click')
    await settle()
    assert.equal(opened.lastToast('error'), 'Không thể gán quyền bạn không có.')
    assert.deepEqual(opened.calls.slice(before).map(wire), ['PUT /api/admin/roles/2'])
    const dead = await open(server({ 'PUT /api/admin/roles/2': () => dropped() }))
    await fire(roleButton(dead, 'editor'), 'click')
    await settle()
    await fire(saveButtons(dead)[0]!, 'click')
    await settle()
    assert.equal(dead.lastToast('error'), 'Lỗi lưu phân quyền')
    assert.doesNotMatch(dead.lastToast('error') ?? '', OFETCH_LINE)
  })

  it('a failed load: the server\'s sentence in role="alert" with "thử lại", no matrix and no save; "thử lại" asks again', async () => {
    let fail = true
    const opened = await open(server({ 'GET /api/admin/roles': () => (fail ? h3Error(403, 'Bạn không có quyền xem vai trò.') : json({ ok: true, roles: ROLES })) }))
    assert.match(alertText(opened.page), /Bạn không có quyền xem vai trò\. Vui lòng thử lại\./)
    assert.doesNotMatch(alertText(opened.page), OFETCH_LINE)
    assert.equal(saveButtons(opened).length, 0)
    fail = false
    await fire(findAll(opened.page.root, el => el.tag === 'button' && textOf(el) === 'thử lại')[0]!, 'click')
    await settle()
    assert.equal(alertText(opened.page), '')
    assert.equal(saveButtons(opened).length, 1)
  })

  it('`ok: false` reads as a failed load, not as "no roles"', async () => {
    const opened = await open(server({ 'GET /api/admin/roles': () => json({ ok: false }) }))
    assert.match(alertText(opened.page), /Không tải được danh sách vai trò\./)
    assert.equal(saveButtons(opened).length, 0)
  })
})

/**
 * `pages/admin/users/index.vue` (no cast — a pending item of D-FETCH): the edit dialog read a
 * missing role as `user.roleId || 2`. `users.role_id` is nullable (`ON DELETE SET NULL`; the
 * role-delete handler checks "no account has it" and deletes outside one transaction), and the
 * dialog always resends `roleId` — so for an account WITHOUT a role, saving only a new email
 * silently granted role 2 (seeded as `editor`; `assertUserManageable(null)` passes, an account
 * with no role holds no permission), or failed with "Vai trò không tồn tại." where no role 2
 * exists. FINDING, RED on the base (551651c7): the dialog now shows no role and the PUT leaves
 * the role alone until the officer picks one.
 */
describe('pages/admin/users/index.vue — an account without a role', () => {
  const USERS = [
    { id: 5, username: 'bientap', email: null, isActive: true, roleId: 2, roleName: 'editor', createdAt: null, lastLoginAt: null },
    { id: 6, username: 'molan', email: 'molan@example.vn', isActive: true, roleId: null, roleName: null, createdAt: null, lastLoginAt: null },
  ]
  const usersServer = () => routes({
    'GET /api/admin/users': () => json({ ok: true, users: USERS }),
    'GET /api/admin/roles': () => json({ ok: true, roles: ROLES }),
    'PUT /api/admin/users/5': () => json({ ok: true }),
    'PUT /api/admin/users/6': () => json({ ok: true }),
  })
  const openUsers = () => mountAdminPage('pages/admin/users/index.vue', usersServer(), { modules: { '~/components/admin/AdminModal.vue': { default: OpenModal } } })
  const dialog = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.props.role === 'dialog')[0]!
  async function edit(opened: MountedAdminPage, username: string) {
    const row = findAll(opened.page.root, el => el.tag === 'tr' && findAll(el, td => td.tag === 'td').some(td => textOf(td) === username))[0]!
    await fire(findAll(row, el => el.tag === 'button' && el.props.title === 'Chỉnh sửa tài khoản')[0]!, 'click')
    await settle()
  }
  const roleSelect = (opened: MountedAdminPage) => findAll(dialog(opened), el => el.tag === 'select')[0]!
  async function submit(opened: MountedAdminPage) {
    const before = opened.calls.length
    await fire(findAll(dialog(opened), el => el.tag === 'form')[0]!, 'submit')
    await settle()
    return sent(opened.calls, before)[0] as { wire: string, body: Record<string, unknown> }
  }

  it('FINDING: the dialog shows no role, and saving a new email leaves the role alone (it granted role 2)', async () => {
    const opened = await openUsers()
    await edit(opened, 'molan')
    assert.equal(roleSelect(opened).model?.value, null)
    await fire(findAll(dialog(opened), el => el.tag === 'input' && el.props.type === 'email')[0]!, 'update:modelValue', 'molan2@example.vn')
    const put = await submit(opened)
    assert.equal(put.wire, 'PUT /api/admin/users/6')
    assert.deepEqual(put.body, { email: 'molan2@example.vn', isActive: true })
  })

  it('a role picked for that account is sent; an account with a role still resends its own', async () => {
    const opened = await openUsers()
    await edit(opened, 'molan')
    await fire(roleSelect(opened), 'update:modelValue', 3)
    assert.deepEqual((await submit(opened)).body, { email: 'molan@example.vn', roleId: 3, isActive: true })
    await edit(opened, 'bientap')
    assert.equal(roleSelect(opened).model?.value, 2)
    assert.deepEqual((await submit(opened)).body, { email: '', roleId: 2, isActive: true })
  })
})
