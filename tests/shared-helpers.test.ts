/**
 * Cross-cutting helpers have exactly one implementation.
 *
 * Both guards here exist because the same literal was found pasted across many
 * files, and in both cases the literal encodes a decision that is quietly
 * load-bearing — so a copy that drifts does not look wrong, it looks like the
 * others.
 *
 * Reviewed by source text rather than by execution: "is this expression written
 * in more than one place" is a property of the source, and the behaviour these
 * helpers wrap is already covered by the suites that drive the limiter and the
 * analytics endpoints.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { describe, it } from 'node:test'

const ROOT = new URL('../', import.meta.url)

function walk(dir: URL, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = new URL(`${entry}`, `${dir}`.endsWith('/') ? dir : `${dir}/`)
    if (statSync(full).isDirectory()) walk(new URL(`${entry}/`, `${dir}`.endsWith('/') ? dir : `${dir}/`), out)
    else if (entry.endsWith('.ts')) out.push(full.pathname)
  }
  return out
}

const SERVER_FILES = walk(new URL('server/', ROOT))
const read = (path: string) => readFileSync(path, 'utf8')
const relative = (path: string) => path.slice(ROOT.pathname.length)

describe('the rate-limit executor is built in one place', () => {
  /**
   * `{ execute: pool ? ((sql, params) => pool.query(sql, params)) : null }` was
   * pasted into 13 call sites. The null branch is the part that matters: a null
   * pool makes rate-limit-store fall back to its in-process memory map instead of
   * failing open, so a copy that dropped it would turn a database blip into an
   * unlimited endpoint — and would look correct next to the twelve that were right.
   */
  it('no file rebuilds the executor literal', () => {
    const offenders = SERVER_FILES
      .filter(path => !path.endsWith('rate-limit-deps.ts'))
      .filter(path => /execute:\s*pool\s*\?/.test(read(path)))
      .map(relative)

    assert.deepEqual(offenders, [], 'these files rebuild the rate-limit executor instead of calling rateLimitDeps()')
  })

  it('the helper keeps the null-pool fallback', () => {
    const source = read(new URL('server/utils/rate-limit-deps.ts', ROOT).pathname)
    assert.match(source, /pool\s*\?/, 'rateLimitDeps no longer branches on a null pool')
    assert.match(source, /:\s*null/, 'rateLimitDeps no longer passes null when the pool is unavailable — the limiter would fail open')
  })

  /**
   * The helper lives outside rate-limit-store.ts on purpose: that module imports
   * nothing but the logger, which is what lets the limiter be driven in tests
   * against a plain Map with no MySQL. Importing getPool into it would drag the
   * database layer into every one of those tests.
   */
  it('rate-limit-store stays free of the database layer', () => {
    const source = read(new URL('server/utils/rate-limit-store.ts', ROOT).pathname)
    assert.ok(!/from '\.\/db'/.test(source), 'rate-limit-store now imports the database layer — its tests can no longer run without MySQL')
  })
})

describe('runtime config is read through typed accessors', () => {
  /**
   * `as unknown as { analytics?: { hmacSecret?: string } }` appeared at 5 call
   * sites. `as unknown as` *asserts* a shape rather than *checking* one — it is
   * the same construct that hid the `db.insert()` array bug through typecheck,
   * the fake pool, and every source-text test, until a real driver objected.
   */
  it('no endpoint casts its way into runtimeConfig', () => {
    const offenders = SERVER_FILES
      .filter(path => !path.endsWith('runtime-config.ts'))
      .filter(path => /as unknown as \{[^}]*analytics/.test(read(path)))
      .map(relative)

    assert.deepEqual(offenders, [], 'these files cast runtimeConfig instead of calling the typed accessor')
  })

  /**
   * Source text cannot show that the accessor returns what the cast used to.
   *
   * This drives the real functions against a stubbed `globalThis.useRuntimeConfig`
   * — the same shape Nitro provides — because "compiles" and "reads the right
   * value" are different claims, and this project has already been bitten once by
   * treating them as one.
   */
  it('reads the same values the casts used to read', async () => {
    const { analyticsConfig, analyticsHmacSecret } = await import('../server/utils/runtime-config.ts')
    const globals = globalThis as Record<string, unknown>
    const original = globals.useRuntimeConfig

    try {
      globals.useRuntimeConfig = () => ({
        analytics: { hmacSecret: 'abc123', collectionEnabled: true, maxRangeDays: 90 },
      })

      assert.equal(analyticsHmacSecret(), 'abc123')
      assert.equal(analyticsConfig().collectionEnabled, true)
      // A field no call site spelled out in its cast, and therefore could not see.
      assert.equal(analyticsConfig().maxRangeDays, 90)

      // collectionEnabled must survive as a real false, not collapse to undefined:
      // page-view.post.ts gates on `!== true`, so the distinction is load-bearing.
      globals.useRuntimeConfig = () => ({ analytics: { collectionEnabled: false } })
      assert.equal(analyticsConfig().collectionEnabled, false)
      assert.equal(analyticsHmacSecret(), '', 'a missing secret must read as empty string, not undefined')

      // Outside Nitro (maintenance scripts, tests) callers must still get an object.
      delete globals.useRuntimeConfig
      assert.deepEqual(analyticsConfig(), {}, 'off-server callers would crash on property access')
      assert.equal(analyticsHmacSecret(), '')
    } finally {
      if (original === undefined) delete globals.useRuntimeConfig
      else globals.useRuntimeConfig = original
    }
  })
})
