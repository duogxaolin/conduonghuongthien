import assert from 'node:assert/strict'
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { DEFINING_MODULES, ROOT, classifyHandler, rel } from './_admin-authz-classifier'

/**
 * Inventory guard: every handler under `server/api/admin/**` enforces an
 * authorization check on its own path, or is named below with the reason it
 * does not need one.
 *
 * `server/middleware/admin-auth.ts` establishes WHO is calling (session, active
 * user, token generation, MFA stage); it does not decide what that person may do.
 * That is each handler's job. A new handler that forgets it is open to every
 * logged-in officer, and nothing else in the suite would turn red. This guard
 * makes "forgot the check" a test failure that names the file.
 *
 * It is a source-reading guard by nature (the property is "no handler is
 * forgotten"), so it is deliberately strict about what counts — see
 * `_admin-authz-classifier.ts` (TypeScript AST, not regex):
 *  - comments and `import type` never count;
 *  - a `require*` check counts only when it is CALLED from code reachable from the
 *    handler's `export default`;
 *  - `checkPermission(...)` counts only when its boolean is USED (condition,
 *    return, throw) — a bare `checkPermission(...);` is not a check;
 *  - a hop through `server/services/**` / `server/utils/**` counts only when the
 *    handler CALLS an imported function and THAT function (resolved per export,
 *    not per module) reaches a check. Importing a module that contains a check in
 *    some other function proves nothing.
 * Behaviour is covered elsewhere (`admin-auth-path-gate.test.ts`,
 * `permissions-behavior.test.ts`, `admin-auth-middleware.test.ts`).
 */

const ADMIN_API = path.join(ROOT, 'server/api/admin')

/**
 * Handlers that legitimately enforce no RBAC permission. Each reason states what
 * protects the endpoint instead. Keys are paths relative to the repository root.
 */
const AUTH_EXEMPTIONS: Record<string, string> = {
  // Login flow — the middleware exempts these four on purpose; they run before a session exists.
  'server/api/admin/auth/login.post.ts': 'login flow: checks the password itself (rate-limited, captcha)',
  'server/api/admin/auth/captcha.get.ts': 'login flow: issues the captcha shown on the login form',
  'server/api/admin/auth/mfa/verify.post.ts': 'login flow: authenticates with the MFA challenge ticket (cdkt_mfa cookie)',
  'server/api/admin/auth/mfa/send-code.post.ts': 'login flow: authenticates with the MFA challenge ticket (cdkt_mfa cookie)',
  // Own session / own profile — any authenticated officer may act on their OWN account only.
  'server/api/admin/auth/logout.post.ts': 'own session: ends the caller\'s own session',
  'server/api/admin/auth/me.get.ts': 'own session: returns the caller\'s own identity and permissions (401 without adminUser)',
  'server/api/admin/profile/password.put.ts': 'own profile: changes the caller\'s own password after re-entering the current one',
  'server/api/admin/profile/mfa/index.get.ts': 'own profile: lists the caller\'s own second factors',
  'server/api/admin/profile/mfa/enroll.post.ts': 'own profile: enrolls a factor on the caller\'s own account',
  'server/api/admin/profile/mfa/confirm.post.ts': 'own profile: confirms a factor on the caller\'s own account',
  'server/api/admin/profile/mfa/disable.post.ts': 'own profile: disables a factor on the caller\'s own account',
  'server/api/admin/profile/mfa/recovery-codes.post.ts': 'own profile: regenerates the caller\'s own recovery codes',
  'server/api/admin/profile/mfa/recovery-codes.delete.ts': 'own profile: revokes the caller\'s own recovery codes',
  'server/api/admin/profile/history.get.ts': 'own profile: own activity history; another account\'s history requires an inline super-admin check',
  // Inline super-admin check (break-glass on ANOTHER account).
  'server/api/admin/users/[id]/mfa.delete.ts': 'inline super-admin check: only a super-admin may strip another account\'s factors',
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (full.endsWith('.ts')) out.push(full)
  }
  return out
}

function unclassifiedHandlers(files: string[]): string[] {
  return files.filter(file => classifyHandler(file) === null && !(rel(file) in AUTH_EXEMPTIONS)).map(rel)
}

test('every admin handler enforces an authorization check or is a named exemption', () => {
  const files = walk(ADMIN_API)
  assert.ok(files.length > 200, `expected the full admin API, found ${files.length} handlers`)
  const missing = unclassifiedHandlers(files)
  assert.deepEqual(
    missing,
    [],
    `admin handler(s) with no permission check and no AUTH_EXEMPTIONS entry:\n  ${missing.join('\n  ')}\n`
      + 'Call requireResourcePermission(...) (or requireSuperAdmin / a require*Permission helper), '
      + 'or a service function that does, or add the file to AUTH_EXEMPTIONS with the reason it needs none.',
  )
})

test('the exemption list does not rot', () => {
  for (const [file, reason] of Object.entries(AUTH_EXEMPTIONS)) {
    assert.ok(reason.trim().length > 10, `${file}: an exemption needs a real reason`)
    const full = path.join(ROOT, file)
    assert.ok(existsSync(full), `${file} no longer exists — remove its AUTH_EXEMPTIONS entry`)
    assert.equal(
      classifyHandler(full),
      null,
      `${file} now enforces a permission check by itself — remove its AUTH_EXEMPTIONS entry`,
    )
  }
})

// ─── The classifier itself: fixtures run through the SAME code path ───────────
//
// Virtual files under the real tree (they are never written): the handler and,
// where needed, a fake service next to the real ones, so import resolution and
// the services/utils boundary behave exactly as for real handlers.

const HANDLER = path.join(ADMIN_API, '__fixture__', 'x.post.ts')
const SERVICE = path.join(ROOT, 'server/services/__fixture_service__.ts')
const classify = (handler: string, service?: string) => classifyHandler(HANDLER, {
  overrides: new Map([[HANDLER, handler], ...(service !== undefined ? [[SERVICE, service] as [string, string]] : [])]),
})

const SERVICE_WITH_ONE_CHECKED_EXPORT = [
  "import { requireResourcePermission } from '../utils/permissions'",
  'export async function deleteThing(actor, id) { requireResourcePermission(actor, "things", "delete"); return id }',
  'export async function listThings() { return [] }',
  'const helper = (actor) => requireResourcePermission(actor, "things", "update")',
  'export async function updateThing(actor) { helper(actor) }',
].join('\n')

test('a handler that merely imports a symbol from a service containing a check is NOT enforced', () => {
  assert.equal(classify([
    "import { listThings } from '../../../services/__fixture_service__'",
    'export default defineEventHandler(async () => listThings())',
  ].join('\n'), SERVICE_WITH_ONE_CHECKED_EXPORT), null, 'listThings has no check, even though deleteThing does')
  assert.equal(classify([
    "import { deleteThing } from '../../../services/__fixture_service__'",
    'export default defineEventHandler(async () => ({ ok: typeof deleteThing }))',
  ].join('\n'), SERVICE_WITH_ONE_CHECKED_EXPORT), null, 'imported but never called')
})

test('calling the exported function that holds the check IS enforced (named, aliased, namespace, via a local helper)', () => {
  for (const handler of [
    "import { deleteThing } from '../../../services/__fixture_service__'\nexport default defineEventHandler(async (e) => deleteThing(e.context.adminUser, 1))",
    "import { deleteThing as remove } from '../../../services/__fixture_service__'\nexport default defineEventHandler(async (e) => { await remove(e.context.adminUser, 1) })",
    "import * as things from '../../../services/__fixture_service__'\nexport default defineEventHandler(async (e) => { await things.deleteThing(e.context.adminUser, 1) })",
    "import { updateThing } from '../../../services/__fixture_service__'\nexport default defineEventHandler(async (e) => { await updateThing(e.context.adminUser) })",
  ]) {
    assert.equal(classify(handler, SERVICE_WITH_ONE_CHECKED_EXPORT), 'enforced', handler)
  }
})

test('checkPermission(...) whose boolean is ignored is NOT a check; a consumed one is', () => {
  const header = "import { checkPermission } from '../../../utils/auth'\n"
  for (const body of [
    'export default defineEventHandler(async (e) => { checkPermission(e.context.adminUser.permissions, "settings", "read"); return { ok: true } })',
    'export default defineEventHandler(async (e) => { const allowed = checkPermission(e.context.adminUser.permissions, "settings", "read"); return { ok: true } })',
    'export default defineEventHandler(async (e) => { void checkPermission(e.context.adminUser.permissions, "settings", "read"); return 1 })',
    'export default defineEventHandler(async (e) => { ["read"].some(a => checkPermission(e.context.adminUser.permissions, "settings", a)); return 1 })',
  ]) {
    assert.equal(classify(header + body), null, body)
  }
  for (const body of [
    'export default defineEventHandler(async (e) => { if (!checkPermission(e.context.adminUser.permissions, "settings", "read")) throw createError({ statusCode: 403 }); return 1 })',
    'export default defineEventHandler(async (e) => { const ok = checkPermission(e.context.adminUser.permissions, "settings", "read"); if (!ok) throw createError({ statusCode: 403 }); return 1 })',
    'export default defineEventHandler(async (e) => { if (!["read", "create"].some(a => checkPermission(e.context.adminUser.permissions, "settings", a))) throw createError({ statusCode: 403 }); return 1 })',
    'export default defineEventHandler(async (e) => checkPermission(e.context.adminUser.permissions, "settings", "read") ? 1 : 2)',
  ]) {
    assert.equal(classify(header + body), 'enforced', body)
  }
})

test('comments, type-only imports and uncalled local helpers do not count', () => {
  assert.equal(classify([
    "import { requireResourcePermission, type ActorLike } from '../../../utils/permissions'",
    '// requireResourcePermission(adminUser, "settings", "read")',
    '/* requireSuperAdmin(adminUser) */',
    'export default defineEventHandler(() => ({ ok: true }))',
  ].join('\n')), null)
  assert.equal(classify([
    "import type { deleteThing } from '../../../services/__fixture_service__'",
    'export default defineEventHandler(() => ({ ok: true }))',
  ].join('\n'), SERVICE_WITH_ONE_CHECKED_EXPORT), null)
  assert.equal(classify([
    "import { requireResourcePermission } from '../../../utils/permissions'",
    'function neverCalled(a) { requireResourcePermission(a, "x", "read") }',
    'export default defineEventHandler(() => ({ ok: true }))',
  ].join('\n')), null)
  assert.ok(DEFINING_MODULES.has('server/utils/permissions.ts'), 'importing the defining module is not a hop')
})

test('a same-named "require…Permission" defined locally is followed, not trusted by name', () => {
  assert.equal(classify([
    'function requireFakePermission() { return true }',
    'export default defineEventHandler(() => { requireFakePermission(); return 1 })',
  ].join('\n')), null)
  assert.equal(classify([
    "import { requireResourcePermission } from '../../../utils/permissions'",
    'function requireThingPermission(a) { requireResourcePermission(a, "x", "read") }',
    'export default defineEventHandler((e) => { requireThingPermission(e.context.adminUser); return 1 })',
  ].join('\n')), 'enforced')
})
