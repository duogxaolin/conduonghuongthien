import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { normalizeCreateTable, renderSchemaSnapshot, snapshotRelease } from '../scripts/snapshot-schema'

/**
 * `scripts/snapshot-schema.ts` writes `tests/fixtures/schema-prev.sql`, the previous
 * release's schema the upgrade suite boots on. The file must be deterministic (two
 * runs, same bytes), schema-only, loadable with foreign keys in any order, and the
 * script must clean up its ~30 MB temporary checkout whatever goes wrong.
 */

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

test('the auto-increment counter is data, not schema: it is dropped', () => {
  const ddl = 'CREATE TABLE `a` (\n  `id` int NOT NULL AUTO_INCREMENT,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB AUTO_INCREMENT=42 DEFAULT CHARSET=utf8mb4  \n'
  assert.equal(normalizeCreateTable(ddl), 'CREATE TABLE `a` (\n  `id` int NOT NULL AUTO_INCREMENT,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4')
})

test('the snapshot is sorted, schema-only and wrapped in FOREIGN_KEY_CHECKS', () => {
  const meta = { ref: 'v1', commit: 'a'.repeat(40), server: 'MySQL 8.0.46' }
  const tables = [
    { name: 'zeta', ddl: 'CREATE TABLE `zeta` (`id` int) ENGINE=InnoDB AUTO_INCREMENT=7' },
    { name: 'alpha', ddl: 'CREATE TABLE `alpha` (`id` int) ENGINE=InnoDB' },
  ]
  const sql = renderSchemaSnapshot(meta, tables)
  assert.equal(sql, renderSchemaSnapshot(meta, [...tables].reverse()), 'input order must not matter')
  assert.match(sql, /^-- ref: v1$/m)
  assert.match(sql, new RegExp(`^-- commit: ${'a'.repeat(40)}$`, 'm'))
  assert.match(sql, /^-- server: MySQL 8\.0\.46$/m)
  assert.match(sql, /^-- tables: 2$/m)
  assert.ok(sql.indexOf('CREATE TABLE `alpha`') < sql.indexOf('CREATE TABLE `zeta`'))
  assert.ok(sql.indexOf('SET FOREIGN_KEY_CHECKS=0;') < sql.indexOf('CREATE TABLE `'))
  assert.ok(sql.trimEnd().endsWith('SET FOREIGN_KEY_CHECKS=1;'))
  assert.doesNotMatch(sql, /AUTO_INCREMENT=|^\s*(DROP|INSERT)\b/m)
  assert.doesNotMatch(sql, /\d{4}-\d{2}-\d{2}/, 'no timestamp — two runs must give the same bytes')
})

test('an unreachable database still removes the temporary checkout and reports the first error', async () => {
  const freePort = await new Promise<number>((resolve) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      server.close(() => resolve(port))
    })
  })
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'snapshot-schema-test-'))
  const previousTmpdir = process.env.TMPDIR
  process.env.TMPDIR = tmp
  try {
    await assert.rejects(
      snapshotRelease({ repoRoot: REPO_ROOT, ref: 'HEAD', connect: { host: '127.0.0.1', port: freePort, user: 'root', password: 'not-a-real-password' } }),
      /init\.ts of [0-9a-f]{40} failed/,
      'the failure of the release\'s init is the error reported, not the cleanup\'s',
    )
    assert.deepEqual(readdirSync(tmp), [], 'the temporary checkout was left behind')
  } finally {
    if (previousTmpdir === undefined) delete process.env.TMPDIR
    else process.env.TMPDIR = previousTmpdir
    rmSync(tmp, { recursive: true, force: true })
  }
})
