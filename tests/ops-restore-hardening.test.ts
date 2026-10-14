import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { SECRET, cleanup, makeSandbox, type Sandbox } from './_ops-sandbox'

/**
 * BEHAVIOUR tests for the database-restore guards in scripts/restore-db.sh and
 * scripts/verify-restore.sh, run in the throwaway sandbox (fake docker, no real
 * container). Two things the original suite could not see:
 *
 *  - real-size dumps. The old guard was `gzip -dc | grep -q …` under pipefail:
 *    grep -q stops at the first hit, gzip dies of SIGPIPE (141), pipefail turns
 *    the `if` false — so a dump with `USE other_db;` near the TOP sailed through
 *    once it was bigger than a pipe buffer. The fake mysqldump writes ~61 KB,
 *    which is why nobody noticed. These dumps are > 1 MiB.
 *  - verify-restore.sh pipes the same dumps into mysql with only a scratch
 *    DEFAULT database; a `USE live_db;` line would run the dump's DROP TABLEs
 *    against the live one. It now carries the same guard.
 */

const MiB = 1024 * 1024

/** A mysqldump-shaped body: ≥ 20 tables, > 1 MiB of INSERTs, completion marker last. */
function dumpBody(opts: { top?: string; bottom?: string; filler?: string } = {}) {
  const parts: string[] = []
  if (opts.top !== undefined) parts.push(opts.top)
  parts.push('-- MySQL dump 10.13', '/*!40101 SET NAMES utf8mb4 */;')
  for (let i = 0; i < 25; i++) parts.push(`DROP TABLE IF EXISTS \`t${i}\`;`, `CREATE TABLE \`t${i}\` (id int, body text);`)
  const row = `(1,'${(opts.filler ?? 'x').repeat(2000)}')`
  const insert = `INSERT INTO \`t0\` VALUES ${Array(20).fill(row).join(',')};`
  while (parts.join('\n').length < 1.2 * MiB) parts.push(insert)
  if (opts.bottom !== undefined) parts.push(opts.bottom)
  parts.push('-- Dump completed on 2026-10-14  2:00:00', '')
  return parts.join('\n')
}

function sandbox(): Sandbox {
  const sb = makeSandbox(`MYSQL_ROOT_PASSWORD=${SECRET}\nMYSQL_DATABASE=cdkt_admin\n`)
  mkdirSync(sb.path('backups'))
  return sb
}
let seq = 0
const writeDump = (sb: Sandbox, body: string | Buffer) => {
  const file = sb.path('backups', `cdkt-cdkt_admin-20261014T020000Z-${++seq}.sql.gz`)
  writeFileSync(file, Buffer.isBuffer(body) ? body : gzipSync(body))
  return file
}
const reachedMysql = (sb: Sandbox) => readdirSync(sb.dir).some((f) => f.startsWith('mysql.stdin.'))

// Every one of these makes the dump write somewhere other than the database the
// operator named (or leave mysql altogether). Upper/lower case, leading blanks,
// a BOM, an executable comment and the client shorthands are all real ways in.
const FORBIDDEN: Array<[string, string]> = [
  ['USE', 'USE `other_db`;'],
  ['lower-case use', 'use other_db;'],
  ['indented USE', '   USE other_db;'],
  ['CREATE DATABASE', 'CREATE DATABASE /*!32312 IF NOT EXISTS*/ `other_db` /*!40100 DEFAULT CHARACTER SET utf8mb4 */;'],
  ['CREATE SCHEMA', 'create schema other_db;'],
  ['DROP DATABASE in an executable comment', '/*!40000 DROP DATABASE IF EXISTS `cdkt_admin`*/;'],
  ['USE in an executable comment', '/*!40000 USE other_db */;'],
  ['client \\u', '\\u other_db'],
  ['client connect', 'connect other_db'],
  ['client \\r', '\\r other_db localhost'],
  ['client source', 'source /tmp/other.sql'],
  ['client system', 'system rm -rf /var/lib/mysql'],
  ['BOM then USE', '﻿USE other_db;'],
]

// Lines a genuine single-database dump contains: these must NOT trip the guard.
const HARMLESS = [
  "INSERT INTO `t1` VALUES (1,'&nbsp;\\r\\n; use the form; USE other_db; \\\\u00e9');",
  '/*!40101 SET character_set_client = utf8mb4 */;',
  'ALTER DATABASE `cdkt_admin` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ;',
  '-- Current Database: `cdkt_admin`',
  'CREATE TABLE `users_db` (id int);',
]

test('restore-db refuses a REAL-SIZE dump that switches database — at the top as well as at the bottom', () => {
  const sb = sandbox()
  try {
    for (const [label, line] of FORBIDDEN) {
      for (const where of ['top', 'bottom'] as const) {
        const body = dumpBody(where === 'top' ? { top: line } : { bottom: line })
        assert.ok(body.length > MiB)
        const r = sb.run('scripts/restore-db.sh', [writeDump(sb, body), 'cdkt_admin', '--replace'])
        assert.equal(r.status, 2, `${label} at the ${where}: expected a refusal, got ${r.status}\n${r.stdout}${r.stderr}`)
        assert.match(r.stderr, /selects its own database or leaves it/, `${label} (${where})`)
      }
    }
    assert.ok(!reachedMysql(sb), 'a refused dump reached mysql')
    assert.ok(!sb.dockerLog().some((l) => l.includes(' mysqldump ')), 'refused before the pre-restore dump, too')
  } finally {
    cleanup(sb)
  }
})

test('verify-restore refuses the same dumps BEFORE importing anything into the scratch database', () => {
  const sb = sandbox()
  try {
    for (const [label, line] of FORBIDDEN) {
      const r = sb.run('scripts/verify-restore.sh', [writeDump(sb, dumpBody({ top: line }))])
      assert.equal(r.status, 2, `${label}: ${r.stdout}${r.stderr}`)
      assert.match(r.stderr, /selects its own database or leaves it/, label)
    }
    assert.ok(!reachedMysql(sb), 'verify-restore imported a dump that switches database')
    assert.ok(!sb.dockerLog().some((l) => l.includes('CREATE DATABASE')), 'no scratch database is even created')
  } finally {
    cleanup(sb)
  }
})

test('a genuine single-database dump still restores and verifies (no false positives on article text)', () => {
  const sb = sandbox()
  try {
    const body = dumpBody({ bottom: HARMLESS.join('\n'), filler: 'Đường hướng thiện; use ' })
    const file = writeDump(sb, body)
    const restore = sb.run('scripts/restore-db.sh', [file, 'cdkt_admin', '--replace'])
    assert.equal(restore.status, 0, restore.stdout + restore.stderr)
    const stdin = readdirSync(sb.dir).find((f) => f.startsWith('mysql.stdin.'))!
    assert.equal(readFileSync(sb.path(stdin), 'utf8'), body, 'the whole dump reached mysql unmodified')
    const verify = sb.run('scripts/verify-restore.sh', [file])
    assert.equal(verify.status, 0, verify.stdout + verify.stderr)

    // And what backup-db.sh itself writes (through the fake mysqldump) round-trips.
    const backup = sb.run('scripts/backup-db.sh', [sb.path('backups')], { env: { BACKUP_STAMP: '20261014T030000Z' } })
    assert.equal(backup.status, 0, backup.stdout + backup.stderr)
    const own = readdirSync(sb.path('backups')).find((f) => f.startsWith('cdkt-cdkt_admin-20261014T030000Z-'))!
    const again = sb.run('scripts/restore-db.sh', [sb.path('backups', own), 'cdkt_admin', '--replace'])
    assert.equal(again.status, 0, again.stdout + again.stderr)
  } finally {
    cleanup(sb)
  }
})

test('a dump that cannot be read to the end fails closed in both scripts', () => {
  const sb = sandbox()
  try {
    const whole = gzipSync(dumpBody())
    // Cut a real-size archive in half: not a gzip that merely has a bad header.
    const file = writeDump(sb, whole.subarray(0, Math.floor(whole.length / 2)))
    const restore = sb.run('scripts/restore-db.sh', [file, 'cdkt_admin', '--replace'])
    assert.equal(restore.status, 2, restore.stdout + restore.stderr)
    const verify = sb.run('scripts/verify-restore.sh', [file])
    assert.equal(verify.status, 2, verify.stdout + verify.stderr)
    assert.ok(!reachedMysql(sb))
  } finally {
    cleanup(sb)
  }
})

test('verify-restore --latest picks the newest backup-db.sh dump of MYSQL_DATABASE from .env', () => {
  const sb = makeSandbox(`MYSQL_ROOT_PASSWORD=${SECRET}\nMYSQL_DATABASE=portal_db\nBACKUP_DIR=./backups\n`)
  try {
    mkdirSync(sb.path('backups'))
    const body = gzipSync(dumpBody())
    // Each file gets its own mtime; newest = smallest secondsAgo.
    const at = (name: string, secondsAgo: number) => {
      writeFileSync(sb.path('backups', name), body)
      const t = new Date(Date.now() - secondsAgo * 1000)
      utimesSync(sb.path('backups', name), t, t)
    }
    at('cdkt-portal_db-20261012T020000Z-11.sql.gz', 300)
    at('cdkt-portal_db-20261013T020000Z-12.sql.gz', 200)
    at('cdkt-cdkt_admin-20261014T020000Z-13.sql.gz', 10) // another database
    at('cdkt-prerestore-portal_db-20261014T020000Z-14.sql.gz', 5) // restore-db.sh safety copy
    at('cdkt-20261014T020000Z-manual.sql.gz', 1) // in-app backup
    const r = sb.run('scripts/verify-restore.sh', ['--latest'])
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /cdkt-portal_db-20261013T020000Z-12\.sql\.gz/)

    const none = makeSandbox(`MYSQL_ROOT_PASSWORD=${SECRET}\nMYSQL_DATABASE=nothing_here\n`)
    try {
      const miss = none.run('scripts/verify-restore.sh', ['--latest'])
      assert.equal(miss.status, 1)
      assert.match(miss.stderr, /no backup-db\.sh dump of nothing_here/)
    } finally {
      cleanup(none)
    }
  } finally {
    cleanup(sb)
  }
})

// ─── "Is the app stopped?" must fail closed ──────────────────────────────────
function mediaArchive(sb: Sandbox) {
  const file = sb.path('backups', 'cdkt-uploads-20261014T020000Z-1.tar.gz')
  mkdirSync(sb.path('src/uploads/2026'), { recursive: true })
  writeFileSync(sb.path('src/uploads/2026/a.jpg'), 'jpeg')
  assert.equal(spawnSync('tar', ['-C', sb.path('src'), '-czf', file, 'uploads']).status, 0)
  return file
}

test('restore-db and restore-media refuse when `docker compose ps` fails and the app container says it is running', () => {
  const sb = sandbox()
  try {
    const dump = writeDump(sb, dumpBody())
    const env = { FAKE_COMPOSE_PS_RC: '1', FAKE_APP_INSPECT: 'true' }
    const db = sb.run('scripts/restore-db.sh', [dump, 'cdkt_admin', '--replace'], { env })
    assert.equal(db.status, 2, db.stdout + db.stderr)
    assert.match(db.stderr, /docker compose stop app/)
    const media = sb.run('scripts/restore-media.sh', [mediaArchive(sb), '--replace'], { env })
    assert.equal(media.status, 2, media.stdout + media.stderr)
    assert.ok(!reachedMysql(sb))
    assert.ok(!sb.dockerLog().some((l) => l.startsWith('compose run')), 'the volume was touched')
  } finally {
    cleanup(sb)
  }
})

test('neither signal can tell → refuse, unless the operator vouches with --i-know-app-is-stopped', () => {
  const sb = sandbox()
  try {
    const dump = writeDump(sb, dumpBody())
    const env = { FAKE_COMPOSE_PS_RC: '1', FAKE_APP_INSPECT: 'missing' }
    const refused = sb.run('scripts/restore-db.sh', [dump, 'cdkt_admin', '--replace'], { env })
    assert.equal(refused.status, 2, refused.stdout + refused.stderr)
    assert.match(refused.stderr, /--i-know-app-is-stopped/)
    const media = sb.run('scripts/restore-media.sh', [mediaArchive(sb), '--replace'], { env })
    assert.equal(media.status, 2, media.stdout + media.stderr)
    assert.match(media.stderr, /--i-know-app-is-stopped/)
    assert.ok(!reachedMysql(sb) && !sb.dockerLog().some((l) => l.startsWith('compose run')))

    const vouched = sb.run('scripts/restore-db.sh', [dump, 'cdkt_admin', '--replace', '--i-know-app-is-stopped'], { env })
    assert.equal(vouched.status, 0, vouched.stdout + vouched.stderr)
    assert.match(vouched.stderr, /app_state_unknown/, 'the override is on the record')
  } finally {
    cleanup(sb)
  }
})

test('one positive "stopped" is enough: compose ps broken but docker inspect says not running', () => {
  const sb = sandbox()
  try {
    const r = sb.run('scripts/restore-db.sh', [writeDump(sb, dumpBody()), 'cdkt_admin', '--replace'], {
      env: { FAKE_COMPOSE_PS_RC: '1', FAKE_APP_INSPECT: 'false' },
    })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    // ...and compose saying "stopped" while inspect says "running" is still a refusal.
    const split = sb.run('scripts/restore-db.sh', [writeDump(sb, dumpBody()), 'cdkt_admin', '--replace'], {
      env: { FAKE_APP_INSPECT: 'true' },
    })
    assert.equal(split.status, 2, split.stdout + split.stderr)
  } finally {
    cleanup(sb)
  }
})

test('restore-db rejects an unknown trailing option instead of ignoring it', () => {
  const sb = sandbox()
  try {
    const r = sb.run('scripts/restore-db.sh', [writeDump(sb, dumpBody()), 'cdkt_admin', '--replace', '--force'])
    assert.equal(r.status, 1, r.stdout + r.stderr)
    assert.match(r.stderr, /unknown option: --force/)
    assert.equal(sb.dockerLog().length, 0)
  } finally {
    cleanup(sb)
  }
})

// ─── restore-media: links, devices and odd names never reach the volume ──────
// Archives are built with the real `tar` CLI from a tree made in the sandbox. The
// fake `compose run` executes the container script against $SANDBOX/vol, so the
// assertions are on what ends up in the "volume".
const UPLOADS_VOL = ['vol', 'app', 'public', 'uploads']

function uploadsTree(sb: Sandbox, build: (root: string) => void, opts: { top?: string } = {}) {
  const src = sb.path(`tree-${++seq}`)
  mkdirSync(join(src, 'uploads/2026'), { recursive: true })
  writeFileSync(join(src, 'uploads/2026/ok.jpg'), 'jpeg')
  build(src)
  const file = sb.path('backups', `cdkt-uploads-20261014T020000Z-${seq}.tar.gz`)
  const r = spawnSync('tar', ['-C', src, '-czf', file, opts.top ?? 'uploads'], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return file
}
/** The live volume before each restore: one file that must survive a refusal. */
function seedUploads(sb: Sandbox) {
  mkdirSync(sb.path(...UPLOADS_VOL, 'live'), { recursive: true })
  writeFileSync(sb.path(...UPLOADS_VOL, 'live', 'keep.jpg'), 'live')
}
const liveKept = (sb: Sandbox) => readFileSync(sb.path(...UPLOADS_VOL, 'live', 'keep.jpg'), 'utf8') === 'live'
const sh = (cmd: string, cwd: string) => assert.equal(spawnSync('bash', ['-c', cmd], { cwd }).status, 0, cmd)

const HOSTILE: Array<[string, (root: string) => void]> = [
  ['absolute symlink to a database dump', (root) => sh('ln -s /app/backups/cdkt-cdkt_admin-x.sql.gz uploads/x.pdf', root)],
  ['relative symlink escaping uploads/', (root) => sh('ln -s ../../../app/backups uploads/2026/b', root)],
  ['symlinked directory', (root) => sh('ln -s /etc uploads/etc', root)],
  ['hard link', (root) => sh('ln uploads/2026/ok.jpg uploads/2026/twin.jpg', root)],
  ['fifo', (root) => sh('mkfifo uploads/2026/pipe', root)],
  ['newline in a name', (root) => writeFileSync(join(root, 'uploads/2026/a\nb.jpg'), 'x')],
  ['backslash in a name', (root) => writeFileSync(join(root, 'uploads/2026/a\\b.jpg'), 'x')],
  ['control character in a name', (root) => writeFileSync(join(root, 'uploads/2026/a\u0001b.jpg'), 'x')],
  ['the staging directory name', (root) => sh('mkdir -p uploads/.cdkt-restore-staging && echo x > uploads/.cdkt-restore-staging/f', root)],
]

test('restore-media refuses symlinks, hard links, fifos and unsafe names before anything runs in the container', () => {
  const sb = sandbox()
  try {
    seedUploads(sb)
    for (const [label, build] of HOSTILE) {
      const r = sb.run('scripts/restore-media.sh', [uploadsTree(sb, build), '--replace'])
      assert.equal(r.status, 1, `${label}: ${r.stdout}${r.stderr}`)
      assert.match(r.stderr, /not plain files or directories|unsafe path|inconsistent/, label)
    }
    assert.ok(!sb.dockerLog().some((l) => l.startsWith('compose run')), 'a refused archive reached the container')
    assert.ok(liveKept(sb))
  } finally {
    cleanup(sb)
  }
})

test('UTF-8 (Vietnamese) file names are not mistaken for control characters', () => {
  const sb = sandbox()
  try {
    seedUploads(sb)
    const file = uploadsTree(sb, (root) => writeFileSync(join(root, 'uploads/2026/Hướng dẫn tái hòa nhập.pdf'), 'pdf'))
    const r = sb.run('scripts/restore-media.sh', [file, '--replace'])
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.equal(readFileSync(sb.path(...UPLOADS_VOL, '2026', 'Hướng dẫn tái hòa nhập.pdf'), 'utf8'), 'pdf')
    assert.ok(!existsSync(sb.path(...UPLOADS_VOL, 'live')), 'restored tree replaced the old one')
  } finally {
    cleanup(sb)
  }
})

test('second line of defence: the container re-checks what tar produced and keeps the volume if anything is not a plain file', () => {
  // Prove the in-container `find` on its own: a sandbox copy of the script with the
  // host-side type check switched off (the real script is not given a bypass).
  for (const [label, build] of HOSTILE.slice(0, 5)) {
    const sb = sandbox()
    try {
      const script = sb.path('scripts/restore-media.sh')
      const original = readFileSync(script, 'utf8')
      const patched = original.replace('[[ -z "$BAD_TYPES" ]] ||', ': ||')
      assert.notEqual(patched, original, 'the host-side type check moved; update this test')
      writeFileSync(script, patched)
      seedUploads(sb)
      const r = sb.run('scripts/restore-media.sh', [uploadsTree(sb, build), '--replace', '--no-safety-copy'])
      assert.equal(r.status, 4, `${label}: ${r.stdout}${r.stderr}`)
      assert.match(r.stderr, /links\/devices\/fifos; nothing was replaced/, label)
      assert.ok(liveKept(sb), `${label}: the volume lost its contents`)
      assert.deepEqual(readdirSync(sb.path(...UPLOADS_VOL)), ['live'], `${label}: staging left behind`)
    } finally {
      cleanup(sb)
    }
  }
})

test('restore-media keeps a verified, restorable copy of the volume it replaces', () => {
  const sb = sandbox()
  try {
    seedUploads(sb)
    const r = sb.run('scripts/restore-media.sh', [uploadsTree(sb, () => {}), '--replace'])
    assert.equal(r.status, 0, r.stdout + r.stderr)
    const snaps = readdirSync(sb.path('backups')).filter((f) => f.startsWith('cdkt-prerestore-uploads-'))
    assert.equal(snaps.length, 1, JSON.stringify(readdirSync(sb.path('backups'))))
    assert.match(snaps[0]!, /^cdkt-prerestore-uploads-\d{8}T\d{6}Z-\d+\.tar\.gz$/)
    const listing = spawnSync('tar', ['-tzf', sb.path('backups', snaps[0]!)], { encoding: 'utf8' }).stdout.split('\n')
    assert.ok(listing.includes('uploads/live/keep.jpg'), listing.join('\n'))
    assert.ok(!existsSync(sb.path(...UPLOADS_VOL, 'live')), 'the restore itself went ahead')

    // ...and restoring that copy puts the old contents back (same layout, accepted name).
    const back = sb.run('scripts/restore-media.sh', [sb.path('backups', snaps[0]!), '--replace', '--no-safety-copy'])
    assert.equal(back.status, 0, back.stdout + back.stderr)
    assert.ok(liveKept(sb))
    assert.ok(!existsSync(sb.path(...UPLOADS_VOL, '2026')))
  } finally {
    cleanup(sb)
  }
})

test('media archives get the same checks, and the media safety copy restores like a backup-media.sh archive', () => {
  const sb = sandbox()
  try {
    const src = sb.path('media-src')
    mkdirSync(join(src, 'media/slug'), { recursive: true })
    writeFileSync(join(src, 'media/slug/seg-0.ts'), 'segment')
    const good = sb.path('backups', 'cdkt-media-20261014T020000Z-1.tar.gz')
    sh(`tar -czf "${good}" .`, src)
    sh('ln -s /app/backups media/slug/escape', src)
    const bad = sb.path('backups', 'cdkt-media-20261014T020000Z-2.tar.gz')
    sh(`tar -czf "${bad}" .`, src)

    mkdirSync(sb.path('vol/var/lib/cdkt/media/old'), { recursive: true })
    writeFileSync(sb.path('vol/var/lib/cdkt/media/old/seg.ts'), 'old')
    const refused = sb.run('scripts/restore-media.sh', [bad, '--replace'])
    assert.equal(refused.status, 1, refused.stdout + refused.stderr)
    assert.match(refused.stderr, /not plain files or directories/)

    const ok = sb.run('scripts/restore-media.sh', [good, '--replace'])
    assert.equal(ok.status, 0, ok.stdout + ok.stderr)
    assert.equal(readFileSync(sb.path('vol/var/lib/cdkt/media/media/slug/seg-0.ts'), 'utf8'), 'segment')
    const snap = readdirSync(sb.path('backups')).find((f) => f.startsWith('cdkt-prerestore-media-'))!
    assert.ok(snap, 'no media safety copy')
    const back = sb.run('scripts/restore-media.sh', [sb.path('backups', snap), '--replace', '--no-safety-copy'])
    assert.equal(back.status, 0, back.stdout + back.stderr)
    assert.equal(readFileSync(sb.path('vol/var/lib/cdkt/media/old/seg.ts'), 'utf8'), 'old')
    assert.ok(!existsSync(sb.path('vol/var/lib/cdkt/media/media')))
  } finally {
    cleanup(sb)
  }
})

test('restore-media changes nothing when the safety copy cannot be taken (exit 3); --no-safety-copy skips it', () => {
  const sb = sandbox()
  try {
    seedUploads(sb)
    const file = uploadsTree(sb, () => {})
    // FAKE_RUN_EXEC=0: `compose run` produces no output, so the copy is empty.
    const r = sb.run('scripts/restore-media.sh', [file, '--replace'], { env: { FAKE_RUN_EXEC: '0' } })
    assert.equal(r.status, 3, r.stdout + r.stderr)
    assert.match(r.stderr, /nothing was changed/)
    assert.equal(sb.dockerLog().filter((l) => l.startsWith('compose run')).length, 1, 'only the copy was attempted')
    assert.ok(!readdirSync(sb.path('backups')).some((f) => f.startsWith('cdkt-prerestore-')), 'an empty copy was left behind')
    assert.ok(liveKept(sb))

    const skipped = sb.run('scripts/restore-media.sh', [file, '--replace', '--no-safety-copy'])
    assert.equal(skipped.status, 0, skipped.stdout + skipped.stderr)
    assert.ok(!readdirSync(sb.path('backups')).some((f) => f.startsWith('cdkt-prerestore-')))
  } finally {
    cleanup(sb)
  }
})
