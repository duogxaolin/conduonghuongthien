import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertAssignablePermissions,
  assertRoleAssignable,
  VALID_RESOURCES,
} from '../server/utils/permissions'

/**
 * Two privilege-escalation paths existed before these guards:
 *   1. a delegated `users:update` role could move itself into the system role
 *      (which confers superadmin);
 *   2. a delegated `roles:update` role could grant itself any permission.
 * These tests pin both doors shut.
 */

type Actor = Parameters<typeof assertAssignablePermissions>[0]

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    id: 2,
    isSuperAdmin: false,
    permissions: [
      { resource: 'news', canCreate: true, canRead: true, canUpdate: true, canDelete: false },
      { resource: 'roles', canCreate: true, canRead: true, canUpdate: true, canDelete: false },
    ],
    ...overrides,
  } as Actor
}

const superadmin = actor({ isSuperAdmin: true, permissions: [] })

function statusOf(fn: () => void): number | null {
  try { fn(); return null } catch (error) { return (error as { statusCode?: number }).statusCode ?? -1 }
}

test('a delegated role cannot grant a permission it does not itself hold', () => {
  for (const grant of [
    { resource: 'users', canCreate: true },
    { resource: 'settings', canUpdate: true },
    { resource: 'roles', canDelete: true },
    { resource: 'news', canDelete: true },
  ]) {
    assert.equal(statusOf(() => assertAssignablePermissions(actor(), [grant])), 403,
      `expected 403 for ${JSON.stringify(grant)}`)
  }
})

test('a delegated role may re-grant permissions it already holds', () => {
  assert.equal(statusOf(() => assertAssignablePermissions(actor(), [
    { resource: 'news', canCreate: true, canRead: true, canUpdate: true },
    { resource: 'roles', canRead: true },
  ])), null)
})

test('unknown resources are rejected before anything is written', () => {
  assert.equal(statusOf(() => assertAssignablePermissions(actor(), [{ resource: '__evil__', canRead: true }])), 400)
  assert.equal(statusOf(() => assertAssignablePermissions(actor(), [{ resource: '', canRead: true }])), 400)
  assert.equal(statusOf(() => assertAssignablePermissions(superadmin, [{ resource: 'nope', canRead: true }])), 400,
    'even a superadmin may not invent resources')
})

test('a superadmin may grant anything within the known resource set', () => {
  assert.equal(statusOf(() => assertAssignablePermissions(superadmin, [
    { resource: 'users', canCreate: true, canRead: true, canUpdate: true, canDelete: true },
    { resource: 'settings', canUpdate: true },
  ])), null)
})

test('setting a permission flag to false never requires holding it', () => {
  assert.equal(statusOf(() => assertAssignablePermissions(actor(), [
    { resource: 'users', canCreate: false, canRead: false, canUpdate: false, canDelete: false },
  ])), null)
})

test('non-array permission payloads are ignored rather than throwing', () => {
  assert.equal(statusOf(() => assertAssignablePermissions(actor(), undefined)), null)
  assert.equal(statusOf(() => assertAssignablePermissions(actor(), null)), null)
})

test('only a superadmin may place a user into a system role', () => {
  assert.equal(statusOf(() => assertRoleAssignable(actor(), true)), 403)
  assert.equal(statusOf(() => assertRoleAssignable(actor(), false)), null)
  assert.equal(statusOf(() => assertRoleAssignable(superadmin, true)), null)
  assert.equal(statusOf(() => assertRoleAssignable(actor(), null)), null)
})

test('the resource allow-list covers every resource the admin UI manages', () => {
  for (const resource of [
    'news', 'role_models', 'reintegration', 'documents', 'faq', 'categories',
    'home_sections', 'pages', 'users', 'roles', 'media', 'settings',
    'submissions', 'analytics', 'chatbot_settings', 'chatbot_knowledge',
  ]) {
    assert.ok(VALID_RESOURCES.has(resource), `missing resource: ${resource}`)
  }
})
