/**
 * `activity_logs.meta` is a JSON column, and an audit writer hands it an OBJECT.
 *
 * FINDING-R3-3: 17 handlers (16 under `server/api/admin/ai/**` plus
 * `comments/[id]/visibility.patch.ts`) wrote `meta: JSON.stringify({ … })`.
 * Drizzle encodes a JSON column itself, so those rows held a JSON *string* inside
 * the column — `"{\"type\":\"budget_update\",…}"` — and `JSON_EXTRACT(meta,
 * '$.type')` found nothing on them. Nothing failed anywhere: the column accepts
 * any JSON value, `meta` is typed `unknown`, and the two readers that surface meta
 * (`activity-logs/index.get.ts`, `profile/history.get.ts`) treat a non-object as
 * "no keys" — the rows just quietly stopped being queryable by content.
 *
 * Fixed in all 17 files at once; this guard keeps it that way. It scans every
 * `.ts` file under `server/` and `scripts/` whose CODE references `activityLogs`
 * (the only table with a `meta` column) and refuses `meta: JSON.stringify(` —
 * written inline, or as `const meta = JSON.stringify(…)` passed by shorthand.
 *
 * NAMED LIMITS — not caught: a stringified value under a different variable name
 * (`const m = JSON.stringify(…); … meta: m`), or one handed through a helper
 * (`writeAudit(JSON.stringify(…))`). Both would be new indirections written on
 * purpose; the behaviour test in `ai-budget-update-behavior.test.ts` pins the
 * stored shape end to end for the handler this was found in.
 *
 * Historic rows already written as strings are NOT backfilled: no reader needs
 * them as objects (both readers above surface only `ip`/`userAgent`/`mfaMethod`,
 * which none of the 17 writers ever put in meta, and treat a string as "no keys";
 * `media-sync-rewrite.ts` reads only `resource = 'media'` rows), and there is no
 * export of `activity_logs`. `admin-profile-history-behavior.test.ts` already
 * feeds a string-meta row through the reader.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const ROOT = new URL('../', import.meta.url)
const read = (relative: string) => readFileSync(new URL(relative, ROOT), 'utf8')

/** Comments and string contents out, whitespace collapsed — prose naming the bad pattern must not trip it. */
function normalizeSource(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/\s+/g, ' ')
}

const INLINE = /\bmeta\s*:\s*JSON\s*\.\s*stringify\s*\(/
const SHORTHAND = /\b(?:const|let|var)\s+meta\s*(?::[^=]+)?=\s*JSON\s*\.\s*stringify\s*\(/

/** The file writes audit rows (code, not prose) and hands `meta` a string. */
function stringifiesAuditMeta(source: string): boolean {
  const code = normalizeSource(source)
  if (!/\bactivityLogs\b/.test(code)) return false
  return INLINE.test(code) || SHORTHAND.test(code)
}

function walk(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(new URL(dir, ROOT), { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...walk(`${path}/`))
    else if (entry.name.endsWith('.ts')) found.push(path)
  }
  return found
}

describe('activity_logs.meta is written as an object, never a JSON string', () => {
  it('no file under server/ or scripts/ stringifies the meta it audits', () => {
    const scanned = [...walk('server/'), ...walk('scripts/')]
    const auditing = scanned.filter(file => /\bactivityLogs\b/.test(normalizeSource(read(file))))
    // A scan that finds no audit writer is green exactly like one that works.
    assert.ok(auditing.length > 50, `only ${auditing.length} audit writers found — the scan is looking in the wrong place`)
    const offenders = scanned.filter(file => stringifiesAuditMeta(read(file)))
    assert.deepEqual(
      offenders,
      [],
      'ghi `meta: JSON.stringify(…)` vào activity_logs — cột `meta` là JSON, Drizzle tự mã hoá; '
      + 'truyền thẳng object, nếu không hàng chứa một CHUỖI JSON và JSON_EXTRACT không thấy gì (FINDING-R3-3)',
    )
  })

  it('the detector catches a real writer stringified again, in every spelling', () => {
    const file = 'server/api/admin/ai/budget/index.put.ts'
    const base = read(file)
    assert.equal(stringifiesAuditMeta(base), false, 'the fixed file must pass')
    const objectMeta = /meta: \{\n(\s+)type: 'budget_update',\n\s+changedFields: Object\.keys\(patch\),\n\s+\},/
    assert.match(base, objectMeta, 'the injection anchor moved — update this proof')
    const mutations: Record<string, string> = {
      // The exact shape the 17 files had.
      inline: base.replace(objectMeta, "meta: JSON.stringify({\n$1type: 'budget_update',\n$1changedFields: Object.keys(patch),\n      }),"),
      // Line break and spaces between the key, the dot and the call.
      spaced: base.replace(objectMeta, "meta:\n        JSON . stringify ({ type: 'budget_update' }),"),
      // Built first, passed by shorthand.
      shorthand: base
        .replace('await db.transaction(', "const meta: string = JSON.stringify({ type: 'budget_update' })\n  await db.transaction(")
        .replace(objectMeta, 'meta,'),
    }
    for (const [id, mutated] of Object.entries(mutations)) {
      assert.notEqual(mutated, base, `${id}: the injection did not apply`)
      assert.equal(stringifiesAuditMeta(mutated), true, `${id}: a stringified audit meta went unnoticed`)
    }
  })

  it('the detector does not fire on prose, string contents, or JSON written to other columns', () => {
    const ignored = [
      // The bad pattern named in a comment — the way this repo documents its fixes.
      "// used to be meta: JSON.stringify({ … })\nawait tx.insert(activityLogs).values({ meta: { type: 'x' } })",
      "/* const meta = JSON.stringify(x) */ await tx.insert(activityLogs).values({ meta })",
      // Inside a string.
      "const hint = 'meta: JSON.stringify(x)'\nawait tx.insert(activityLogs).values({ meta: { hint } })",
      // A settings value or an SSE payload is TEXT, stringified on purpose.
      'await tx.insert(settings).values({ value: JSON.stringify(items) })\nawait tx.insert(activityLogs).values({ meta: { itemCount: 1 } })',
      'publish({ data: JSON.stringify(message) })\nawait tx.insert(activityLogs).values({ meta: { id } })',
      // `meta: JSON.stringify` in a file that writes no audit row at all.
      "logInfo({ meta: JSON.stringify({ a: 1 }) })",
    ]
    for (const sample of ignored) {
      assert.equal(stringifiesAuditMeta(sample), false, `false positive on:\n${sample}`)
    }
  })
})
