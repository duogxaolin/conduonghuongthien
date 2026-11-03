import assert from 'node:assert/strict'
import test, { afterEach, beforeEach } from 'node:test'

/**
 * The production boot guard (server/plugins/require-secrets.ts).
 *
 * `JWT_SECRET` signs every admin session, MFA ticket and reader session; a forgeable
 * one hands out SuperAdmin to whoever knows it. The guard runs the plugin as Nitro
 * would, at boot, and the invariants are:
 *   - in production the server refuses to start when `JWT_SECRET` is missing or
 *     blank, shorter than 16 characters, or one of the defaults that were committed
 *     to this repository — padding it with spaces does not get a default through;
 *   - in production a set `ADMIN_PASSWORD` that breaks the password policy stops the
 *     boot too (an unset one does not — it only seeds the first account);
 *   - the refusal never quotes the secret or the password it rejected (boot errors
 *     end up in container logs);
 *   - outside production nothing is checked, so development keeps working.
 *
 * The plugin is loaded with `defineNitroPlugin` as the identity, and called with the
 * environment set per test; nothing else is replaced.
 */

const globals = globalThis as unknown as Record<string, unknown>
globals.defineNitroPlugin = (plugin: () => void) => plugin
const bootGuard = (await import('../server/plugins/require-secrets')).default as unknown as () => void

const COMMITTED_DEFAULTS = ['cdkt_admin_secret_change_me', 'cdkt_docker_jwt_secret_987654321', 'cdkt_secret_key_change_me_123456']
const STRONG_JWT = 'f3b9c1d7e5a2846b0c9d1e3f5a7b9c2d4e6f8a0b1c3d5e7f'
const STRONG_ADMIN_PASSWORD = 'Xy7#mQp2Lv8Ns-boot'
const KEYS = ['NODE_ENV', 'JWT_SECRET', 'ADMIN_PASSWORD'] as const
let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map(key => [key, process.env[key]]))
  process.env.NODE_ENV = 'production'
  process.env.JWT_SECRET = STRONG_JWT
  delete process.env.ADMIN_PASSWORD
})
afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

/** The boot must stop, and the reason must not repeat the value it refused. */
function assertBootRefused(pattern: RegExp, refusedValue: string, label: string) {
  assert.throws(bootGuard, (error: unknown) => {
    assert.ok(error instanceof Error, label)
    assert.match(error.message, pattern, label)
    if (refusedValue.trim()) assert.ok(!error.message.includes(refusedValue.trim()), `${label}: the refused value is in the boot error`)
    return true
  }, label)
}

test('production with a strong JWT_SECRET (and no ADMIN_PASSWORD, or a strong one) boots', () => {
  assert.doesNotThrow(bootGuard)
  process.env.ADMIN_PASSWORD = STRONG_ADMIN_PASSWORD
  assert.doesNotThrow(bootGuard)
})

test('a missing or blank JWT_SECRET stops the boot', () => {
  delete process.env.JWT_SECRET
  assertBootRefused(/JWT_SECRET is required/, '', 'unset')
  for (const blank of ['', '   ', '\t\n']) {
    process.env.JWT_SECRET = blank
    assertBootRefused(/JWT_SECRET is required/, blank, JSON.stringify(blank))
  }
})

test('a JWT_SECRET shorter than 16 characters stops the boot — counted after trimming', () => {
  for (const short of ['Qz9', 'fifteen-chars-x', '   fifteen-chars-x   ']) {
    process.env.JWT_SECRET = short
    assertBootRefused(/at least 16 characters/, short, JSON.stringify(short))
  }
  process.env.JWT_SECRET = 'sixteen-chars-xy'
  assert.doesNotThrow(bootGuard)
})

test('every default committed to this repository stops the boot, padded or not', () => {
  for (const known of COMMITTED_DEFAULTS) {
    for (const value of [known, ` ${known} `, `${known}\n`]) {
      process.env.JWT_SECRET = value
      assertBootRefused(/known default/, value, JSON.stringify(value))
    }
  }
})

test('an ADMIN_PASSWORD that breaks the policy stops the boot without quoting it', () => {
  for (const weak of ['Admin@conduonghuongthien2026', 'password1234', 'Short1!']) {
    process.env.ADMIN_PASSWORD = weak
    assertBootRefused(/ADMIN_PASSWORD does not meet the password policy/, weak, weak)
  }
})

test('outside production nothing is checked', () => {
  process.env.JWT_SECRET = COMMITTED_DEFAULTS[0]!
  process.env.ADMIN_PASSWORD = 'password1234'
  for (const environment of ['development', 'test', '']) {
    process.env.NODE_ENV = environment
    assert.doesNotThrow(bootGuard, environment)
  }
  delete process.env.NODE_ENV
  delete process.env.JWT_SECRET
  assert.doesNotThrow(bootGuard)
})
