/**
 * Audit atomicity for media-portal and livestream write paths.
 *
 * Preceded by `tests/reader-audit-atomicity.test.ts`, which guards the reader-side
 * and the original admin endpoints/services. This file focuses on the second axis
 * the reader-audit guard never reached: the media-portal and livestream endpoints
 * added by the `add-media-portal` change, plus the service modules those
 * endpoints delegate to (`AUDITED_SERVICES`).
 *
 * The failure shape is identical and the rule is the same: a row and its
 * `activity_logs` row must commit together. Written as mutate-then-log on the pool,
 * a failed second statement leaves the row changed and nothing recording who did
 * it. For media items, a failed audit after a publish means an officer cannot
 * answer "who published this video, and when". For a livestream, the same gap means
 * a broadcast went on air with no record of who started it. The quiet failure is
 * what this exists to prevent — the row stands, the log does not, and nobody
 * notices because the UI shows a success.
 *
 * Reviewed by source text rather than by driving MySQL: a transaction boundary is
 * a property of how the code is written. The cases that would need a live database
 * (rollback on a real failed insert) are covered by Drizzle's `transaction()`
 * contract — rollback on throw — which this project does not re-verify.
 *
 * ## Why a directory scan, not a file list
 *
 * The reader-audit guard learned this the hard way: a list of file paths is green
 * forever for any file nobody remembered to add. The directory scan below walks
 * `server/api/admin/media-portal/**`, `server/api/admin/livestream/**`, and the
 * service modules in `AUDITED_SERVICES`, and demands each one that touches `activity_logs` either
 * wraps the pair in `db.transaction` or is exempt with a stated reason. Adding a
 * new endpoint or service that mutates and audits forces that choice — there is
 * no silent third option.
 *
 * ## Why the endpoints are expected to be thin
 *
 * Every media-portal/livestream endpoint delegates the mutation + audit pair to a
 * service. The endpoint file itself only reads the request, checks RBAC, and maps
 * service errors to HTTP status. It has no `activity_logs` insert and therefore no
 * pair to wrap — the directory scan confirms this by checking that no endpoint
 * writes `activityLogs` on the pool. The services are where the transaction lives.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const read = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')

/** Recursively collect `.ts` files under a directory. */
function walkTs(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...walkTs(path))
    else if (entry.name.endsWith('.ts')) found.push(path)
  }
  return found
}

/** Strip comments and string contents before matching, so a pattern written inside
 *  a doc comment does not hide a real occurrence. Mirrors the reader-audit guard. */
function normalizeSource(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/\s+/g, ' ')
}

/** Writes a row OTHER than the audit row — i.e. has a pair that needs wrapping. */
function writesItsOwnRow(normalized: string): boolean {
  return /\b(?:db|tx)\s*\.\s*(?:update|delete)\(/.test(normalized)
    || /\b(?:db|tx)\s*\.\s*insert\(\s*(?!activityLogs)/.test(normalized)
}

// ──────────────────────────────────────────────────────────────────────────────
// Service-level: the service modules carry the mutation + audit pair.
// ──────────────────────────────────────────────────────────────────────────────

const AUDITED_SERVICES = [
  // `media-portal.ts` is now a barrel (re-exports only, no write path). The two
  // files below carry its row + audit pairs: item create/update/delete, and the
  // custom-thumbnail set/clear. Naming the barrel here would pass vacuously.
  'server/services/media-portal-admin-write.ts',
  'server/services/media-portal-thumbnail-override.ts',
  'server/services/livestream.ts',
  'server/services/livestream-chat.ts',
  'server/services/chunked-upload.ts',
]

const SERVICE_EXEMPTIONS: Record<string, string> = {}

describe('AUDITED_SERVICES names every media-portal file that writes activity_logs', () => {
  it('a media-portal*.ts touching `activityLogs` cannot be missing from the list', () => {
    // The list above stays explicit, but the media portal is split across
    // `media-portal-*.ts` files: a new sub-file that writes a row + audit pair
    // must not slip past the per-file atomicity checks just because nobody added
    // it here. Raw source match (comments included), like the reader-audit scan —
    // a false positive asks a question, a false negative hides a write.
    const portalFiles = readdirSync('server/services')
      .filter(name => /^media-portal.*\.ts$/.test(name))
      .map(name => `server/services/${name}`)
    assert.ok(portalFiles.includes('server/services/media-portal.ts'), 'scan found no media-portal files — it is checking nothing')
    const auditing = portalFiles.filter(file => /activityLogs/.test(read(file)))
    assert.ok(auditing.length > 0, 'no media-portal file writes activity_logs — the scan is checking nothing')
    assert.deepEqual(
      auditing.filter(file => !AUDITED_SERVICES.includes(file)),
      [],
      'a media-portal file touches `activityLogs` but is not in AUDITED_SERVICES — add it so its '
      + 'row + audit pair is checked for one transaction on the tx handle',
    )
  })
})

describe('media-portal/livestream services commit row + audit row together', () => {
  for (const file of AUDITED_SERVICES) {
    it(`${file.replace('server/services/', '')} wraps its audited writes in one transaction`, () => {
      const source = read(file)
      assert.match(source, /db\.transaction\(/, 'the write and its audit row are not atomic')
      assert.match(
        source,
        /tx\.insert\(activityLogs\)/,
        'the audit row is inserted on the pool rather than the transaction handle — it would commit independently',
      )
      assert.ok(
        !/\bawait db\.insert\(activityLogs\)/.test(source),
        'a pool-level activityLogs insert remains; move it onto the tx handle',
      )
    })

    it(`${file.replace('server/services/', '')} performs its mutation on the tx handle`, () => {
      // A transaction carrying only the audit row is worse than none — the log
      // rolls back while the change stands.
      const source = read(file)
      assert.match(source, /tx\.(insert|update|delete)\(/, 'opens a transaction but performs its write outside it')
    })
  }

  it('no pool-level activityLogs insert survives inside any transaction block', () => {
    for (const file of AUDITED_SERVICES) {
      const source = read(file)
      const normalized = normalizeSource(source)
      // Find each `db.transaction(` block and check that no `db.insert(activityLogs)`
      // survives inside it — it would commit independently of the transaction.
      const start = normalized.indexOf('db.transaction(')
      if (start === -1) continue
      // Walk the block by brace matching.
      let depth = 0
      let blockStart = -1
      for (let i = start; i < normalized.length; i++) {
        if (normalized[i] === '{') { depth++; if (blockStart === -1) blockStart = i }
        else if (normalized[i] === '}') depth--
        if (blockStart !== -1 && depth === 0) {
          const block = normalized.slice(blockStart, i)
          assert.ok(
            !/\bdb\s*\.\s*insert\s*\(\s*activityLogs\s*\)/.test(block),
            `${file}: a pool-level activityLogs insert survives inside a transaction block — it commits independently`,
          )
          break
        }
      }
    }
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Directory scan: every file that touches activity_logs is either wrapped or
// exempt with a stated reason — not silently passing because no list named it.
// ──────────────────────────────────────────────────────────────────────────────

const SCAN_ROOTS = [
  'server/api/admin/media-portal',
  'server/api/admin/livestream',
]

describe('no media-portal/livestream file writes activity_logs outside a transaction', () => {
  it('every audited file is either wrapped or exempt with a stated reason', () => {
    const offenders: string[] = []

    // Endpoints.
    for (const root of SCAN_ROOTS) {
      for (const file of walkTs(root)) {
        const normalized = normalizeSource(read(file))
        if (!/activityLogs/.test(normalized)) continue
        if (/db\.transaction\(/.test(normalized)) continue
        const key = file
        if (SERVICE_EXEMPTIONS[key]) continue
        offenders.push(key)
      }
    }

    // Services.
    for (const file of AUDITED_SERVICES) {
      const normalized = normalizeSource(read(file))
      if (!/activityLogs/.test(normalized)) continue
      if (/db\.transaction\(/.test(normalized)) continue
      const key = file
      if (SERVICE_EXEMPTIONS[key]) continue
      offenders.push(key)
    }

    assert.deepEqual(
      offenders,
      [],
      'a file writes `activity_logs` without a `db.transaction(` — wrap the pair, '
      + 'or list it in SERVICE_EXEMPTIONS with the reason it needs no wrapping. '
      + 'A hand-written list is green forever for a file it never named; this '
      + 'directory scan is here because of that.',
    )
  })

  it('the detector sees the multi-line/multi-statement style and does not fire on comments', () => {
    const caught = [
      // Multi-line write — the majority style in this repo.
      'await db\n  .update(mediaItems)\n  .set({})\nawait db.insert(activityLogs).values({})',
      // Delete-then-log on one line.
      'await db.delete(mediaItems); await db.insert(activityLogs).values({})',
    ]
    for (const sample of caught) {
      const n = normalizeSource(sample)
      assert.ok(
        /activityLogs/.test(n) && writesItsOwnRow(n) && !/db\.transaction\(/.test(n),
        `the detector missed an unwrapped pair:\n${sample}`,
      )
    }

    const ignored = [
      // Already wrapped.
      'await db.transaction(async (tx) => { await tx.update(mediaItems).set({}); await tx.insert(activityLogs).values({}) })',
      // Only the audit row, no other mutation — nothing to make atomic.
      'await db.insert(activityLogs).values({})',
      // Sample lives inside a comment that explains the forbidden shape.
      '// await db.update(mediaItems) then db.insert(activityLogs) would be wrong\nawait db.insert(activityLogs).values({})',
    ]
    for (const sample of ignored) {
      const n = normalizeSource(sample)
      const flagged = /activityLogs/.test(n) && writesItsOwnRow(n) && !/db\.transaction\(/.test(n)
      assert.ok(!flagged, `the detector fired on a valid sample:\n${sample}`)
    }
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Endpoint files delegate to services and carry no local audit pair.
// The directory scan above confirms this; this additional assertion pins it
// explicitly: every media-portal/livestream endpoint that writes activityLogs
// already wraps it in a transaction (i.e. none do — they delegate to services).
// ──────────────────────────────────────────────────────────────────────────────

describe('media-portal/livestream endpoints do not insert activity_logs on the pool', () => {
  it('no endpoint file has a pool-level `db.insert(activityLogs)`', () => {
    const offenders: string[] = []
    for (const root of SCAN_ROOTS) {
      for (const file of walkTs(root)) {
        const normalized = normalizeSource(read(file))
        if (/\bawait\s+db\s*\.\s*insert\s*\(\s*activityLogs\s*\)/.test(normalized)) {
          offenders.push(file)
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'an endpoint inserts activity_logs on the pool rather than delegating to a '
      + 'service that wraps the pair in a transaction — the row would commit '
      + 'independently of the audit record.',
    )
  })
})
