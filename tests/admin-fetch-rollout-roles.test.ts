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
 *
 * CHANGELOG § 66 (wave3/roles-ui): the retired cells — "Trang chủ" (`home_sections`) and
 * "Kiểm thử" (`canTest`) — are no longer shown but still go back as stored; "Thêm vai trò"
 * (`POST`) and "Xóa vai trò" (`DELETE`) are shown only with `roles.create` / `roles.delete`,
 * delete is greyed out for the server's two refusals and asks first, and every refusal shows
 * the server's sentence in a `role="alert"`.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { click, fire, findAll, input, textOf, type MiniElement } from './_sfc-mount.ts'
import {
  alertText, dropped, h3Error, json, mountAdminPage, OFETCH_LINE, OpenModal, routes, screenText, sent, settle, unmountAll, wire,
  type MountedAdminPage, type MountOptions, type NetCall, type Responder,
} from './_admin-page-harness.ts'
import { PERMISSION_RESOURCES, ROLE_MATRIX_ACTIONS, ROLE_MATRIX_RESOURCES } from '../shared/permissions.ts'

afterEach(unmountAll)

type Route = (call: NetCall) => Response | Error | undefined

const PAGE = 'pages/admin/users/roles.vue'
const ROLES = [
  { id: 1, name: 'superadmin', description: 'Toàn quyền', isSystem: true, createdAt: null, userCount: 1, permissions: [] },
  { id: 2, name: 'editor', description: 'Biên tập', isSystem: false, createdAt: null, userCount: 2, permissions: [{ id: 9, roleId: 2, resource: 'news', canCreate: true, canRead: true, canUpdate: true, canDelete: false, canPublish: null, canArchive: null, canTest: null }] },
  { id: 3, name: 'viewer', description: 'Chỉ xem', isSystem: false, createdAt: null, userCount: 0, permissions: [] },
]

function server(overrides: Record<string, Route> = {}): Responder {
  return routes({
    'GET /api/admin/roles': () => json({ ok: true, roles: ROLES }),
    'PUT /api/admin/roles/3': () => json({ ok: true }),
    'PUT /api/admin/roles/2': () => json({ ok: true }),
    ...overrides,
  })
}

const open = (responder = server(), options: MountOptions = {}) =>
  mountAdminPage(PAGE, responder, { modules: { '~/components/admin/AdminModal.vue': { default: OpenModal } }, ...options })
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

// ─── Retired cells: not shown, still sent back as stored ─────────────────────

describe(`${PAGE} — "Trang chủ" and "Kiểm thử" (retired, CHANGELOG § 66)`, () => {
  const LEGACY = {
    id: 5, name: 'bientapcu', description: 'Vai trò cũ', isSystem: false, createdAt: null, userCount: 0,
    permissions: [
      { id: 20, roleId: 5, resource: 'news', canCreate: true, canRead: true, canUpdate: false, canDelete: false, canPublish: false, canArchive: false, canTest: true },
      { id: 21, roleId: 5, resource: 'home_sections', canCreate: false, canRead: true, canUpdate: true, canDelete: false, canPublish: false, canArchive: false, canTest: true },
    ],
  }

  it('the matrix shows neither; a save sends both back exactly as stored, beside the visible edit', async () => {
    const opened = await open(server({
      'GET /api/admin/roles': () => json({ ok: true, roles: [...ROLES, LEGACY] }),
      'PUT /api/admin/roles/5': () => json({ ok: true }),
    }))
    await fire(roleButton(opened, 'bientapcu'), 'click')
    await settle()
    assert.deepEqual(findAll(opened.page.root, el => el.tag === 'th').map(textOf),
      ['Tài nguyên / Tính năng', 'Thêm', 'Xem', 'Sửa', 'Xóa', 'Xuất bản', 'Lưu trữ'])
    const boxes = findAll(opened.page.root, el => el.tag === 'input' && el.props.type === 'checkbox')
    assert.equal(boxes.length, ROLE_MATRIX_RESOURCES.length * ROLE_MATRIX_ACTIONS.length)
    assert.equal(ROLE_MATRIX_RESOURCES.length, PERMISSION_RESOURCES.length - 1)
    assert.ok(!boxes.some(el => /^Trang chủ:|: Kiểm thử$/.test(String(el.props['aria-label']))))
    assert.doesNotMatch(screenText(opened.page), /home_sections|Kiểm thử/)

    await fire(box(opened, 'Bản tin & Tin tức: Sửa'), 'update:modelValue', true)
    const before = opened.calls.length
    await fire(saveButtons(opened)[0]!, 'click')
    await settle()
    const put = opened.calls.slice(before)[0]!
    assert.equal(wire(put), 'PUT /api/admin/roles/5')
    const rows = (put.body as { permissions: Array<Record<string, unknown>> }).permissions
    assert.equal(rows.length, PERMISSION_RESOURCES.length, 'every catalog row, the hidden one included — the PUT replaces the role\'s rows')
    assert.deepEqual(rows.find(row => row.resource === 'news'),
      { resource: 'news', canCreate: true, canRead: true, canUpdate: true, canDelete: false, canPublish: false, canArchive: false, canTest: true })
    assert.deepEqual(rows.find(row => row.resource === 'home_sections'),
      { resource: 'home_sections', canCreate: false, canRead: true, canUpdate: true, canDelete: false, canPublish: false, canArchive: false, canTest: true })
  })
})

// ─── Without roles.update: the matrix is read-only (verifier W5) ─────────────

describe(`${PAGE} — without roles.update`, () => {
  const readOnly: MountOptions = { can: (resource, action) => !(resource === 'roles' && action === 'update') }
  const boxes = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'input' && el.props.type === 'checkbox')
  const saveReason = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.props.id === 'role-save-blocked').map(textOf).join('')

  it('every box disabled, "Lưu Phân Quyền" greyed with the reason; a forced click sends nothing', async () => {
    const opened = await open(server(), readOnly)
    await fire(roleButton(opened, 'viewer'), 'click')
    await settle()
    const save = saveButtons(opened)[0]!
    assert.equal(save.props.disabled, true)
    assert.equal(save.props['aria-describedby'], 'role-save-blocked')
    assert.match(saveReason(opened), /cần quyền Sửa trên "Vai trò & Phân quyền" để lưu\. Nhờ người có quyền sửa vai trò gán quyền\./)
    assert.ok(boxes(opened).length > 0 && boxes(opened).every(el => el.props.disabled === true))
    const before = opened.calls.length
    await fire(save, 'click')
    await settle()
    assert.deepEqual(opened.calls.slice(before), [], 'the handler refuses too, not only the button')
  })

  it('with roles.update the same role is editable and no reason shows; a system role shows its own lock, not this one', async () => {
    const opened = await open()
    assert.equal(saveReason(opened), '', 'superadmin: the system-role banner explains it')
    await fire(roleButton(opened, 'viewer'), 'click')
    await settle()
    assert.equal(saveButtons(opened)[0]!.props.disabled, false)
    assert.equal(saveButtons(opened)[0]!.props['aria-describedby'], undefined)
    assert.ok(boxes(opened).every(el => el.props.disabled === false))
    assert.equal(saveReason(opened), '')
    const locked = await open(server(), readOnly)
    assert.equal(saveReason(locked), '')
  })
})

// ─── "Thêm vai trò" ──────────────────────────────────────────────────────────

describe(`${PAGE} — "Thêm vai trò" (POST /api/admin/roles)`, () => {
  const NEW_ROLE = { id: 4, name: 'Cộng tác viên', description: 'Viết tin', isSystem: false, createdAt: null, userCount: 0, permissions: [] }
  const createButtons = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'button' && textOf(el) === 'Thêm vai trò')
  const dialog = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.props.role === 'dialog')[0]
  const field = (opened: MountedAdminPage, id: string) => findAll(dialog(opened)!, el => el.tag === 'input' && el.props.id === id)[0]!
  const dialogAlert = (opened: MountedAdminPage) => findAll(dialog(opened)!, el => el.props.role === 'alert').map(textOf).join(' | ')
  const submit = (opened: MountedAdminPage) => fire(findAll(dialog(opened)!, el => el.tag === 'form')[0]!, 'submit')
  async function openDialog(opened: MountedAdminPage, name: string, description = '') {
    await click(createButtons(opened)[0]!)
    await settle()
    await input(field(opened, 'role-create-name'), name)
    await input(field(opened, 'role-create-description'), description)
  }

  it('shown only with roles.create — whatever else the officer holds', async () => {
    const without = await open(server(), { can: (resource, action) => !(resource === 'roles' && action === 'create') })
    assert.equal(createButtons(without).length, 0)
    const only = await open(server(), { can: (resource, action) => resource === 'roles' && action === 'create' })
    assert.equal(createButtons(only).length, 1)
  })

  it('labelled fields; sends the typed name and description, closes, toasts, reloads and selects the new role', async () => {
    let created = false
    const opened = await open(server({
      'GET /api/admin/roles': () => json({ ok: true, roles: created ? [...ROLES, NEW_ROLE] : ROLES }),
      'POST /api/admin/roles': () => { created = true; return json({ ok: true, id: 4 }) },
    }))
    assert.equal(dialog(opened), undefined)
    await openDialog(opened, 'Cộng tác viên', 'Viết tin')
    for (const id of ['role-create-name', 'role-create-description']) {
      assert.equal(findAll(dialog(opened)!, el => el.tag === 'label' && el.props.for === id).length, 1, `label for ${id}`)
    }
    assert.deepEqual([field(opened, 'role-create-name').props.maxlength, field(opened, 'role-create-description').props.maxlength], ['64', '255'])
    const before = opened.calls.length
    await submit(opened)
    await settle()
    assert.deepEqual(sent(opened.calls, before), [
      { wire: 'POST /api/admin/roles', body: { name: 'Cộng tác viên', description: 'Viết tin' } },
      'GET /api/admin/roles',
    ])
    assert.equal(dialog(opened), undefined)
    assert.match(opened.lastToast('success') ?? '', /^Đã tạo vai trò Cộng tác viên\./)
    assert.match(heading(opened), /Ma trận Phân quyền: Cộng tác viên/, 'the new role is selected, ready for its matrix')
  })

  it('without roles.update the dialog and the toast say who sets the rights (verifier W5)', async () => {
    let created = false
    const opened = await open(server({
      'GET /api/admin/roles': () => json({ ok: true, roles: created ? [...ROLES, NEW_ROLE] : ROLES }),
      'POST /api/admin/roles': () => { created = true; return json({ ok: true, id: 4 }) },
    }), { can: (resource, action) => !(resource === 'roles' && action === 'update') })
    await openDialog(opened, 'Cộng tác viên')
    assert.match(textOf(dialog(opened)!), /Bạn không có quyền sửa vai trò: sau khi tạo, nhờ người có quyền sửa vai trò gán quyền\./)
    assert.doesNotMatch(textOf(dialog(opened)!), /bấm "Lưu Phân Quyền"/)
    await submit(opened)
    await settle()
    assert.equal(opened.lastToast('success'), 'Đã tạo vai trò Cộng tác viên. Nhờ người có quyền sửa vai trò gán quyền cho vai trò này.')

    const editor = await open(server({ 'POST /api/admin/roles': () => json({ ok: true, id: 4 }) }))
    await openDialog(editor, 'Cộng tác viên')
    assert.match(textOf(dialog(editor)!), /đánh dấu quyền trong ma trận rồi bấm "Lưu Phân Quyền"/)
    await submit(editor)
    await settle()
    assert.match(editor.lastToast('success') ?? '', /Hãy chọn quyền rồi bấm "Lưu Phân Quyền"\.$/)
  })

  it('"Hủy" closes without sending; reopening starts empty', async () => {
    const opened = await open()
    await openDialog(opened, 'Nháp')
    const before = opened.calls.length
    await click(buttonIn(dialog(opened)!, 'Hủy'))
    await settle()
    assert.equal(dialog(opened), undefined)
    assert.deepEqual(opened.calls.slice(before), [])
    await click(createButtons(opened)[0]!)
    await settle()
    assert.equal(field(opened, 'role-create-name').model?.value, '')
  })

  it('refused: the dialog stays open with what was typed and the server\'s sentence in role="alert"; nothing reloads', async () => {
    const taken = 'Tên vai trò trùng với vai trò đã có (không phân biệt hoa/thường và dấu). Vui lòng chọn tên khác.'
    const opened = await open(server({ 'POST /api/admin/roles': () => h3Error(400, taken) }))
    await openDialog(opened, 'editor')
    const before = opened.calls.length
    await submit(opened)
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), ['POST /api/admin/roles'])
    assert.equal(dialogAlert(opened), taken)
    assert.equal(field(opened, 'role-create-name').model?.value, 'editor')
    assert.equal(field(opened, 'role-create-name').props['aria-describedby'], 'role-create-error')
    assert.equal(opened.lastToast('success'), undefined)

    const dead = await open(server({ 'POST /api/admin/roles': () => dropped() }))
    await openDialog(dead, 'Vai trò mới')
    await submit(dead)
    await settle()
    assert.equal(dialogAlert(dead), 'Không tạo được vai trò.')
    assert.doesNotMatch(dialogAlert(dead), OFETCH_LINE)
  })

  it('while the POST is pending: "Đang tạo…", disabled, and another submit sends nothing', async () => {
    const pending: NetCall[] = []
    const opened = await open(server({ 'POST /api/admin/roles': (call) => { pending.push(call); return undefined } }))
    await openDialog(opened, 'Vai trò mới')
    const first = submit(opened)
    await settle()
    const submitButton = findAll(dialog(opened)!, el => el.tag === 'button' && el.props.type === 'submit')[0]!
    assert.deepEqual([textOf(submitButton), submitButton.props.disabled], ['Đang tạo…', true])
    const second = submit(opened)
    await settle()
    const sentTwice = pending.length
    // Answer whatever went out, so a page that did send twice fails below instead of hanging.
    for (const call of pending) call.respond(json({ ok: true, id: 3 }))
    await Promise.all([first, second])
    await settle()
    assert.equal(sentTwice, 1, 'one POST while the first is pending')
  })
})

// ─── "Xóa vai trò" ───────────────────────────────────────────────────────────

describe(`${PAGE} — "Xóa vai trò" (DELETE /api/admin/roles/:id)`, () => {
  const deleteButtons = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'button' && /Xóa vai trò|Đang xóa/.test(textOf(el)))
  const reason = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.props.id === 'role-delete-blocked').map(textOf).join('')
  async function pick(opened: MountedAdminPage, name: string) {
    await fire(roleButton(opened, name), 'click')
    await settle()
  }

  it('shown only with roles.delete', async () => {
    const without = await open(server(), { can: (resource, action) => !(resource === 'roles' && action === 'delete') })
    await pick(without, 'viewer')
    assert.equal(deleteButtons(without).length, 0)
    const only = await open(server(), { can: (resource, action) => resource === 'roles' && action === 'delete' })
    await pick(only, 'viewer')
    assert.equal(deleteButtons(only).length, 1)
  })

  it('greyed out, with the reason, for the server\'s two refusals: a system role, a role accounts still hold', async () => {
    const opened = await open()
    assert.equal(deleteButtons(opened)[0]!.props.disabled, true)
    assert.equal(deleteButtons(opened)[0]!.props['aria-describedby'], 'role-delete-blocked')
    assert.equal(reason(opened), 'Vai trò hệ thống không xóa được.')
    await pick(opened, 'editor')
    assert.equal(deleteButtons(opened)[0]!.props.disabled, true)
    assert.match(reason(opened), /^Còn 2 tài khoản đang dùng vai trò này/)
    await pick(opened, 'viewer')
    assert.equal(deleteButtons(opened)[0]!.props.disabled, false)
    assert.equal(deleteButtons(opened)[0]!.props['aria-describedby'], undefined)
    assert.equal(reason(opened), '')
  })

  it('asks first, naming the role and what goes with it; declined, nothing is sent', async () => {
    const opened = await open()
    await pick(opened, 'viewer')
    opened.answers.confirm = false
    const before = opened.calls.length
    await click(deleteButtons(opened)[0]!)
    await settle()
    assert.equal(opened.confirms.length, 1)
    const asked = opened.confirms[0]!
    assert.equal(asked.danger, true)
    assert.equal(asked.confirmLabel, 'Xóa vai trò')
    assert.match(asked.message ?? '', /Xóa vai trò "viewer"\?.*ma trận phân quyền.*không thể hoàn tác/)
    assert.deepEqual(opened.calls.slice(before), [])
  })

  it('confirmed: DELETEs that role, toasts, reloads; the first role is shown', async () => {
    let deleted = false
    const opened = await open(server({
      'GET /api/admin/roles': () => json({ ok: true, roles: deleted ? ROLES.filter(role => role.id !== 3) : ROLES }),
      'DELETE /api/admin/roles/3': () => { deleted = true; return json({ ok: true }) },
    }))
    await pick(opened, 'viewer')
    const before = opened.calls.length
    await click(deleteButtons(opened)[0]!)
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), ['DELETE /api/admin/roles/3', 'GET /api/admin/roles'])
    assert.equal(opened.lastToast('success'), 'Đã xóa vai trò viewer.')
    assert.match(heading(opened), /Ma trận Phân quyền: superadmin/)
    assert.equal(findAll(opened.page.root, el => el.tag === 'button' && textOf(el).startsWith('viewer')).length, 0)
  })

  it('refused: the server\'s sentence in role="alert" beside the button, no reload; picking another role clears it', async () => {
    const opened = await open(server({ 'DELETE /api/admin/roles/3': () => h3Error(400, 'Vẫn còn tài khoản gán cho vai trò này. Hãy gán lại trước khi xóa.') }))
    await pick(opened, 'viewer')
    const before = opened.calls.length
    await click(deleteButtons(opened)[0]!)
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), ['DELETE /api/admin/roles/3'])
    assert.equal(alertText(opened.page), 'Vẫn còn tài khoản gán cho vai trò này. Hãy gán lại trước khi xóa.')
    assert.equal(opened.lastToast('success'), undefined)
    await pick(opened, 'editor')
    assert.equal(alertText(opened.page), '')

    const dead = await open(server({ 'DELETE /api/admin/roles/3': () => dropped() }))
    await pick(dead, 'viewer')
    await click(deleteButtons(dead)[0]!)
    await settle()
    assert.equal(alertText(dead.page), 'Không xóa được vai trò.')
    assert.doesNotMatch(alertText(dead.page), OFETCH_LINE)
  })

  it('while the DELETE is pending: "Đang xóa…" and disabled — a second press sends nothing', async () => {
    const pending: NetCall[] = []
    const opened = await open(server({ 'DELETE /api/admin/roles/3': (call) => { pending.push(call); return undefined } }))
    await pick(opened, 'viewer')
    const first = click(deleteButtons(opened)[0]!)
    await settle()
    const button = deleteButtons(opened)[0]!
    assert.deepEqual([textOf(button), button.props.disabled], ['Đang xóa…', true])
    // The browser would not deliver the click; the handler must refuse it all the same.
    const second = fire(button, 'click')
    await settle()
    const sentTwice = pending.length
    for (const call of pending) call.respond(json({ ok: true }))
    await Promise.all([first, second])
    await settle()
    assert.equal(sentTwice, 1, 'one DELETE while the first is pending')
  })
})

function buttonIn(from: MiniElement, text: string): MiniElement {
  return findAll(from, el => el.tag === 'button' && textOf(el) === text)[0]!
}

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
