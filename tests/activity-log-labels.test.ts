/**
 * Every `resource` and `action` string the server writes into `activity_logs` has
 * a label — and every label corresponds to a string somebody actually writes.
 *
 * Both directions fail silently, which is why this file exists.
 *
 * A MISSING label costs the audit page its filter. `reader_ip_bans` was written
 * by services/ip-bans.ts from the start and had no entry, so an officer asking
 * "who blocked this address, and when" found no option in the Đối tượng dropdown
 * and would reasonably conclude the portal does not record it. It does record it;
 * the row was simply unreachable through the only UI that reads the table. Nine
 * resources were in that state, including every write path belonging to reader
 * moderation — the surface whose whole justification is that citizens' data
 * cannot be touched without a trace.
 *
 * A STALE label is the mirror image and reads worse. The dropdown advertises an
 * option, the officer picks it, and the table comes back empty — indistinguishable
 * from "this has never happened". `news` and `chatbot_settings` were both in that
 * state because they are RBAC *resource* names, not audit `resource` values. The
 * two namespaces overlap enough (`users`, `roles`, `settings`, `pages`, `media`)
 * that borrowing from the wrong one produces something that looks right.
 *
 * Checked by scanning source text: the label maps are literals in a Vue SFC and
 * the writers are literals in handlers, so a comparison of the two sets is exactly
 * what can go stale. What this does NOT prove is that a label reads correctly to
 * an officer — only that no string is orphaned on either side.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const root = new URL('../', import.meta.url)
const read = (relative: string) => readFileSync(new URL(relative, root), 'utf8')

/** Every `.ts` file under server/, which is the only place audit rows are written. */
function serverSources(): string[] {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (path.endsWith('.ts')) files.push(path)
    }
  }
  walk(new URL('server/', root).pathname)
  return files
}

/**
 * Collect the literal values written for one audit column.
 *
 * Only single-quoted literals are matched, which is the shape every writer in
 * this codebase uses. A computed value (`action: verb`) would be invisible here —
 * an accepted limit, and the reason the writers are expected to stay literal.
 */
function writtenValues(column: 'resource' | 'action'): Map<string, string> {
  const pattern = new RegExp(`${column}:\\s*'([a-z_]+)'`, 'g')
  const found = new Map<string, string>()
  for (const file of serverSources()) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(pattern)) {
      if (!found.has(match[1]!)) found.set(match[1]!, file.slice(file.indexOf('/server/') + 1))
    }
  }
  return found
}

const page = read('app/pages/admin/users/activity.vue')

/** The keys of one label map, read out of the SFC source. */
function labelKeys(name: 'ACTION_LABELS' | 'RESOURCE_LABELS', endsBefore: string): Set<string> {
  const start = page.indexOf(`const ${name}`)
  assert.ok(start !== -1, `${name} no longer exists — this guard is testing nothing`)
  const end = page.indexOf(endsBefore, start)
  assert.ok(end !== -1, `cannot find the end of ${name}`)
  // Keys only: the Vietnamese label values contain no lowercase-underscore runs
  // followed by `: '`, so this does not pick them up.
  return new Set([...page.slice(start, end).matchAll(/([a-z_]+):\s*'/g)].map(match => match[1]!))
}

describe('the audit page can filter every resource the server records', () => {
  const written = writtenValues('resource')
  const labels = labelKeys('RESOURCE_LABELS', 'const MFA_METHOD_LABELS')

  it('every written resource has a label', () => {
    const missing = [...written].filter(([value]) => !labels.has(value))
    assert.deepEqual(
      missing.map(([value]) => value),
      [],
      `these resources are written to activity_logs but absent from RESOURCE_LABELS, so no filter option exists for them: ${
        missing.map(([value, file]) => `${value} (${file})`).join(', ')
      }`,
    )
  })

  it('no label points at a resource nothing writes', () => {
    // A filter option that always returns nothing reads as "this never happened".
    const orphaned = [...labels].filter(value => !written.has(value))
    assert.deepEqual(
      orphaned,
      [],
      `RESOURCE_LABELS offers filter options no code writes, so selecting one shows an empty table: ${orphaned.join(', ')}`,
    )
  })
})

describe('the audit page can filter every action the server records', () => {
  const written = writtenValues('action')
  const labels = labelKeys('ACTION_LABELS', 'const RESOURCE_LABELS')

  it('every written action has a label', () => {
    const missing = [...written].filter(([value]) => !labels.has(value))
    assert.deepEqual(
      missing.map(([value]) => value),
      [],
      `these actions are written to activity_logs but absent from ACTION_LABELS: ${
        missing.map(([value, file]) => `${value} (${file})`).join(', ')
      }`,
    )
  })

  it('no label points at an action nothing writes', () => {
    const orphaned = [...labels].filter(value => !written.has(value))
    assert.deepEqual(
      orphaned,
      [],
      `ACTION_LABELS offers filter options no code writes: ${orphaned.join(', ')}`,
    )
  })
})

describe('reader moderation is reachable through the audit filter', () => {
  it('names each write path this feature added', () => {
    // Spelled out by name rather than left to the set comparison above. These are
    // the rows carrying citizens' names, email addresses and IPs, and the reason
    // design.md D14 requires every read and write to be audited at all — a trail
    // that exists but cannot be filtered to is most of the way back to no trail.
    const labels = labelKeys('RESOURCE_LABELS', 'const MFA_METHOD_LABELS')
    for (const resource of ['readers', 'comments', 'article_comments', 'reader_ip_bans', 'google_oauth_settings']) {
      assert.ok(labels.has(resource), `${resource} has no filter option on /admin/users/activity`)
    }
  })
})
