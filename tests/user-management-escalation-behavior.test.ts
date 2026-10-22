import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

/**
 * A delegated `users:*` grant must not become a way to gain or seize rights the
 * holder does not have (rà soát 2026-10-22). Before this, `assertRoleAssignable`
 * only kept users out of the system role, so an officer holding `users:update`
 * could move an account — their own included — into any richer non-system role,
 * or reset the password of an account already in one and sign in as it.
 *
 * These run the real handlers and services against a fake database that answers
 * by table and by the id in the WHERE clause, and look at what gets written.
 */

type Row = Record<string, unknown>

const { users, roles, permissions, activityLogs } = await import('../server/db/schema')

const accounts: Record<number, { id: number, username: string, roleId: number | null, isSystem: boolean }> = {}
const roleRows: Record<number, { isSystem: boolean }> = {}
const rolePerms: Record<number, Row[]> = {}
const writes: string[] = []

/** The literal values bound in a drizzle condition (`eq(col, 7)` → [7]). */
function paramsOf(condition: unknown): unknown[] {
  const found: unknown[] = []
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    if ((node as object).constructor?.name === 'Param') found.push((node as { value: unknown }).value)
    const chunks = (node as { queryChunks?: unknown[] }).queryChunks
    if (Array.isArray(chunks)) chunks.forEach(visit)
  }
  visit(condition)
  return found
}

function answer(table: unknown, condition: unknown): Row[] {
  const id = Number(paramsOf(condition)[0])
  if (table === users) return accounts[id] ? [accounts[id]] : []
  if (table === roles) return roleRows[id] ? [roleRows[id]] : []
  if (table === permissions) return rolePerms[id] ?? []
  return []
}

function select() {
  let table: unknown
  const builder = {
    from(t: unknown) { table = t; return builder },
    leftJoin() { return builder },
    where(condition: unknown) {
      const rows = answer(table, condition)
      return { limit: async () => rows, then: (resolve: (value: Row[]) => unknown) => resolve(rows) }
    },
  }
  return builder
}

const name = (table: unknown) => (table === users ? 'users' : table === activityLogs ? 'activity_logs' : table === permissions ? 'permissions' : table === roles ? 'roles' : 'other')
const tx = {
  insert: (table: unknown) => ({ values: async () => { writes.push(`insert ${name(table)}`); return [{ insertId: 77 }] } }),
  update: (table: unknown) => ({ set: () => ({ where: async () => { writes.push(`update ${name(table)}`) } }) }),
  delete: (table: unknown) => ({ where: async () => { writes.push(`delete ${name(table)}`) } }),
}
mock.module('../server/utils/db', {
  namedExports: {
    getDb: () => ({ select, transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx) }),
  },
})

type Event = { body: unknown, params: Record<string, string>, context: { adminUser: unknown } }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.readBody = async (event: Event) => event.body
globals.getRouterParam = (event: Event, key: string) => event.params[key]
globals.createError = (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input)

const updateUser = (await import('../server/api/admin/users/[id].put')).default as unknown as (event: Event) => Promise<Row>
const updateRole = (await import('../server/api/admin/roles/[id].put')).default as unknown as (event: Event) => Promise<Row>
const createUser = (await import('../server/api/admin/users/index.post')).default as unknown as (event: Event) => Promise<Row>
const { deleteUserById, setUserActive } = await import('../server/services/users')

const crud = (resource: string) => ({ resource, canCreate: true, canRead: true, canUpdate: true, canDelete: true })
// The delegated user manager: full rights on users, read+write on news, nothing else.
const MANAGER_PERMS = [crud('users'), { resource: 'news', canCreate: true, canRead: true, canUpdate: true, canDelete: false }]
const manager = { id: 5, isSuperAdmin: false, permissions: MANAGER_PERMS }
const superadmin = { id: 1, isSuperAdmin: true, permissions: [] }

const ROLE_EDITOR = 10 // news read only — within the manager's rights
const ROLE_SETTINGS = 11 // holds settings:update, which the manager lacks
const ROLE_PUBLISHER = 12 // news + canPublish — a non-CRUD flag the manager lacks
const ROLE_MANAGER = 13 // exactly the manager's own rights
const STRONG_PASSWORD = 'Mat-Khau-Rat-Manh-2026'

function reset() {
  writes.length = 0
  for (const store of [accounts, roleRows, rolePerms]) for (const key of Object.keys(store)) delete (store as Record<string, unknown>)[key]
  roleRows[ROLE_EDITOR] = { isSystem: false }
  roleRows[ROLE_SETTINGS] = { isSystem: false }
  roleRows[ROLE_PUBLISHER] = { isSystem: false }
  roleRows[ROLE_MANAGER] = { isSystem: false }
  rolePerms[ROLE_EDITOR] = [{ resource: 'news', canCreate: false, canRead: true, canUpdate: false, canDelete: false }]
  rolePerms[ROLE_SETTINGS] = [{ resource: 'settings', canCreate: false, canRead: true, canUpdate: true, canDelete: false }]
  rolePerms[ROLE_PUBLISHER] = [{ resource: 'news', canCreate: false, canRead: true, canUpdate: false, canDelete: false, canPublish: true }]
  rolePerms[ROLE_MANAGER] = MANAGER_PERMS
  accounts[5] = { id: 5, username: 'quanly', roleId: ROLE_MANAGER, isSystem: false }
  accounts[20] = { id: 20, username: 'bientap', roleId: ROLE_EDITOR, isSystem: false }
  accounts[21] = { id: 21, username: 'caidat', roleId: ROLE_SETTINGS, isSystem: false }
}

const put = (actor: unknown, id: number, body: Row): Event => ({ body, params: { id: String(id) }, context: { adminUser: actor } })
async function statusOf(run: () => Promise<unknown>): Promise<number | null> {
  try { await run(); return null } catch (error) { return (error as { statusCode?: number }).statusCode ?? -1 }
}

// ─── PUT /api/admin/users/:id ────────────────────────────────────────────────

test('update: an account whose role holds rights the actor lacks cannot be touched at all', async () => {
  const attempts: Row[] = [
    { password: STRONG_PASSWORD },
    { email: 'ke-gian@example.com' },
    { isActive: false },
    { roleId: ROLE_EDITOR },
  ]
  for (const body of attempts) {
    reset()
    assert.equal(await statusOf(() => updateUser(put(manager, 21, body))), 403, JSON.stringify(body))
    assert.deepEqual(writes, [], `${JSON.stringify(body)}: a refused request writes nothing`)
  }
})

test('update: an account within the actor\'s rights is edited, in one transaction', async () => {
  reset()
  await updateUser(put(manager, 20, { email: 'bientap@example.com', password: STRONG_PASSWORD }))
  assert.deepEqual(writes, ['update users', 'insert activity_logs'])
})

test('update: moving an account into a richer role is refused — every flag counts, not only CRUD', async () => {
  for (const roleId of [ROLE_SETTINGS, ROLE_PUBLISHER]) {
    reset()
    assert.equal(await statusOf(() => updateUser(put(manager, 20, { roleId }))), 403, `role ${roleId}`)
    assert.deepEqual(writes, [])
  }
})

test('update: a SuperAdmin is not limited by the subset rule', async () => {
  reset()
  await updateUser(put(superadmin, 21, { roleId: ROLE_PUBLISHER, password: STRONG_PASSWORD }))
  assert.deepEqual(writes, ['update users', 'insert activity_logs'])
})

test('update: isActive must be a real boolean — the string "false" no longer unlocks', async () => {
  for (const isActive of ['false', 'true', 0, 1, null]) {
    reset()
    assert.equal(await statusOf(() => updateUser(put(manager, 20, { isActive }))), 400, JSON.stringify(isActive))
    assert.deepEqual(writes, [])
  }
  reset()
  assert.equal(await statusOf(() => updateUser(put(manager, 20, { isActive: false }))), null)
})

test('update: the email is validated on edit, as it is on create', async () => {
  reset()
  assert.equal(await statusOf(() => updateUser(put(manager, 20, { email: 'khong-phai-email' }))), 400)
  assert.deepEqual(writes, [])
  reset()
  assert.equal(await statusOf(() => updateUser(put(manager, 20, { email: '' }))), null, 'clearing the email stays allowed')
})

test('update: your own role, lock and password are not changed from the user list', async () => {
  const refused: Row[] = [
    { roleId: ROLE_EDITOR },
    { isActive: false },
    { password: STRONG_PASSWORD },
  ]
  for (const body of refused) {
    reset()
    assert.equal(await statusOf(() => updateUser(put(manager, 5, body))), 400, JSON.stringify(body))
    assert.deepEqual(writes, [])
  }
  // The edit form always resends roleId/isActive: an unchanged form saving a new email still works.
  reset()
  await updateUser(put(manager, 5, { email: 'quanly@example.com', roleId: ROLE_MANAGER, isActive: true }))
  assert.deepEqual(writes, ['update users', 'insert activity_logs'])
})

// ─── POST /api/admin/users ───────────────────────────────────────────────────

test('create: no account is created with more rights than the creator holds', async () => {
  for (const roleId of [ROLE_SETTINGS, ROLE_PUBLISHER]) {
    reset()
    const body = { username: 'moi-tao', password: STRONG_PASSWORD, roleId }
    assert.equal(await statusOf(() => createUser(put(manager, 0, body))), 403, `role ${roleId}`)
    assert.deepEqual(writes, [])
  }
  reset()
  await createUser(put(manager, 0, { username: 'moi-tao', password: STRONG_PASSWORD, roleId: ROLE_EDITOR }))
  assert.deepEqual(writes, ['insert users', 'insert activity_logs'])
})

// ─── services/users.ts (single-row and bulk routes) ──────────────────────────

test('delete and lock: refused on an account with more rights, allowed within them', async () => {
  reset()
  assert.equal(await statusOf(() => deleteUserById(manager, 21)), 403)
  assert.equal(await statusOf(() => setUserActive(manager, 21, false)), 403)
  assert.deepEqual(writes, [])

  reset()
  await setUserActive(manager, 20, false)
  await deleteUserById(manager, 20)
  assert.deepEqual(writes, ['update users', 'insert activity_logs', 'delete users', 'insert activity_logs'])

  reset()
  await deleteUserById(superadmin, 21)
  assert.deepEqual(writes, ['delete users', 'insert activity_logs'])
})

// ─── PUT /api/admin/roles/:id ────────────────────────────────────────────────
// Found by the pre-commit verify pass: without this, `roles:update` could strip a
// richer role down to the actor's own rights, after which every check above passes
// for the accounts in it.

const roleEditor = { id: 6, isSuperAdmin: false, permissions: [...MANAGER_PERMS, crud('roles')] }

test('roles: the grants of a role richer than the actor cannot be rewritten', async () => {
  reset()
  const body = { permissions: [{ resource: 'news', canRead: true }] }
  assert.equal(await statusOf(() => updateRole(put(roleEditor, ROLE_SETTINGS, body))), 403)
  assert.equal(await statusOf(() => updateRole(put(roleEditor, ROLE_PUBLISHER, body))), 403, 'a non-CRUD flag counts here too')
  assert.deepEqual(writes, [])
})

test('roles: a role within the actor\'s rights is still edited; a SuperAdmin edits any non-system role', async () => {
  reset()
  await updateRole(put(roleEditor, ROLE_EDITOR, { permissions: [{ resource: 'news', canRead: true, canUpdate: true }] }))
  assert.deepEqual(writes, ['delete permissions', 'insert permissions', 'insert activity_logs'])
  reset()
  await updateRole(put(superadmin, ROLE_SETTINGS, { permissions: [{ resource: 'news', canRead: true }] }))
  assert.deepEqual(writes, ['delete permissions', 'insert permissions', 'insert activity_logs'])
})
