import assert from 'node:assert/strict'
import test from 'node:test'
import { checkPermission } from '../server/utils/auth'
import { requireResourcePermission, type ActorLike } from '../server/utils/permissions'

/**
 * `requireResourcePermission` is the check behind 282 admin endpoints and nothing
 * called it in a test — the escalation guards beside it were covered, the guard
 * itself was only grepped for. These tests call it with the kinds of actor the
 * database actually produces (nullable flags, missing rows) and pin what it
 * refuses.
 */

const ROW = { resource: 'news', canCreate: false, canRead: false, canUpdate: false, canDelete: false }
const actorWith = (overrides: Partial<typeof ROW>, extra: Partial<ActorLike> = {}): ActorLike => ({
  id: 5,
  isSuperAdmin: false,
  permissions: [{ ...ROW, ...overrides }],
  ...extra,
})

function statusOf(fn: () => void): number | null {
  try { fn(); return null } catch (error) { return (error as { statusCode?: number }).statusCode ?? -1 }
}

test('each action is granted only by its own flag', () => {
  const flags = { create: 'canCreate', read: 'canRead', update: 'canUpdate', delete: 'canDelete' } as const
  for (const [action, flag] of Object.entries(flags) as Array<[keyof typeof flags, (typeof flags)[keyof typeof flags]]>) {
    const actor = actorWith({ [flag]: true })
    for (const other of Object.keys(flags) as Array<keyof typeof flags>) {
      assert.equal(
        statusOf(() => requireResourcePermission(actor, 'news', other)),
        other === action ? null : 403,
        `${flag} must allow ${action} and nothing else (tried ${other})`,
      )
    }
  }
})

test('the refusal is a 403 with the standard message', () => {
  try {
    requireResourcePermission(actorWith({}), 'news', 'read')
    assert.fail('should have thrown')
  } catch (error) {
    assert.equal((error as { statusCode: number }).statusCode, 403)
    assert.match((error as { statusMessage: string }).statusMessage, /Forbidden/)
  }
})

test('a resource the actor holds nothing on is refused, however much they hold elsewhere', () => {
  const actor = actorWith({ canCreate: true, canRead: true, canUpdate: true, canDelete: true })
  assert.equal(statusOf(() => requireResourcePermission(actor, 'users', 'read')), 403)
  assert.equal(statusOf(() => requireResourcePermission(actor, 'news', 'read')), null)
  // The match is exact: a prefix, a different case or padding is a different resource.
  for (const lookalike of ['new', 'news2', 'News', ' news', 'news ', '']) {
    assert.equal(statusOf(() => requireResourcePermission(actor, lookalike, 'read')), 403, JSON.stringify(lookalike))
  }
})

test('null flags — what an unset column reads as — are not a grant', () => {
  const actor = { id: 1, isSuperAdmin: false, permissions: [{ resource: 'news', canCreate: null, canRead: null, canUpdate: null, canDelete: null }] } as ActorLike
  for (const action of ['create', 'read', 'update', 'delete'] as const) {
    assert.equal(statusOf(() => requireResourcePermission(actor, 'news', action)), 403, action)
  }
})

test('a missing actor, permission list or role is refused rather than waved through', () => {
  assert.equal(statusOf(() => requireResourcePermission(undefined as unknown as ActorLike, 'news', 'read')), 403)
  assert.equal(statusOf(() => requireResourcePermission(null as unknown as ActorLike, 'news', 'read')), 403)
  assert.equal(statusOf(() => requireResourcePermission({ id: 1 }, 'news', 'read')), 403)
  assert.equal(statusOf(() => requireResourcePermission({ id: 1, permissions: null }, 'news', 'read')), 403)
  assert.equal(statusOf(() => requireResourcePermission({ id: 1, permissions: [] }, 'news', 'read')), 403)
})

test('super-admin passes only on a strict true', () => {
  assert.equal(statusOf(() => requireResourcePermission({ id: 1, isSuperAdmin: true, permissions: [] }, 'anything', 'delete')), null)
  for (const notTrue of [false, null, undefined, 1, 'true', 'yes', {}, []]) {
    const actor = { id: 1, isSuperAdmin: notTrue, permissions: [] } as unknown as ActorLike
    assert.equal(statusOf(() => requireResourcePermission(actor, 'news', 'read')), 403, `isSuperAdmin: ${JSON.stringify(notTrue)}`)
  }
})

test('only a flag that is exactly true grants', () => {
  for (const notTrue of [1, 'true', 'yes', {}, [1]]) {
    const actor = { id: 1, isSuperAdmin: false, permissions: [{ ...ROW, canRead: notTrue }] } as unknown as ActorLike
    assert.equal(statusOf(() => requireResourcePermission(actor, 'news', 'read')), 403, `canRead: ${JSON.stringify(notTrue)}`)
  }
})

test('the first matching row decides, so a duplicate row cannot widen access after the fact', () => {
  const actor = {
    id: 1,
    isSuperAdmin: false,
    permissions: [{ ...ROW, canRead: false }, { ...ROW, canRead: true }],
  } as ActorLike
  assert.equal(statusOf(() => requireResourcePermission(actor, 'news', 'read')), 403)
  assert.equal(checkPermission(actor.permissions as never, 'news', 'read'), false)
})

test('checkPermission called directly also treats only a strict true super-admin flag as super-admin', () => {
  // Some callers hand it a value read straight from a row or a token.
  for (const notTrue of [undefined, null, false, 0, '', 'true', 1]) {
    assert.equal(checkPermission([], 'news', 'read', notTrue as never), false, JSON.stringify(notTrue))
  }
  assert.equal(checkPermission([], 'news', 'read', true), true)
})
