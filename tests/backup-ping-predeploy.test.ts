import assert from 'node:assert/strict'
import test from 'node:test'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { SECRET, cleanup, makeSandbox, type Sandbox } from './_ops-sandbox'

/**
 * scripts/backup-db.sh and scripts/verify-restore.sh, RUN in the throwaway sandbox
 * (fake docker, fake curl — nothing real is touched).
 *
 * 1. `HEALTHCHECK_PING_URL` (healthchecks.io style): a host cron job that silently
 *    stops is only noticed on the day the backup is needed. With the variable set,
 *    each run requests the URL on success and `<URL>/fail` on failure; an
 *    unreachable monitor must never change the script's own exit status, and an
 *    unset variable must change nothing at all.
 * 2. `--prefix cdkt-predeploy`: the dump the deploy takes before swapping the
 *    image. Same verification, its own name, kept by COUNT (newest 5) instead of by
 *    age, and it never pings — a deploy-time success must not hide a dead nightly.
 */

const PING = 'https://hc-ping.example/0b7c2a4e-uuid'

function sandbox(extraEnv = '') {
  const sb = makeSandbox(`MYSQL_ROOT_PASSWORD=${SECRET}\nMYSQL_DATABASE=cdkt_admin\n${extraEnv}`)
  // Fake curl: records each URL it was asked for; FAKE_CURL_RC makes it fail.
  writeFileSync(
    sb.path('bin', 'curl'),
    `#!/usr/bin/env bash\nprintf '%s\\n' "\${@: -1}" >> "$SANDBOX/curl.log"\nexit "\${FAKE_CURL_RC:-0}"\n`,
  )
  chmodSync(sb.path('bin', 'curl'), 0o755)
  return sb
}
const pings = (sb: Sandbox) =>
  existsSync(sb.path('curl.log'))
    ? readFileSync(sb.path('curl.log'), 'utf8').split('\n').filter(Boolean)
    : []
const dumps = (dir: string) => (existsSync(dir) ? readdirSync(dir).sort() : [])

test('a successful nightly backup pings the URL once', () => {
  const sb = sandbox(`HEALTHCHECK_PING_URL=${PING}\n`)
  try {
    const r = sb.run('scripts/backup-db.sh', [sb.path('backups')])
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.deepEqual(pings(sb), [PING])
  } finally {
    cleanup(sb)
  }
})

test('a failed backup pings <URL>/fail and keeps its own exit code', () => {
  const sb = sandbox(`HEALTHCHECK_PING_URL=${PING}\n`)
  try {
    const r = sb.run('scripts/backup-db.sh', [sb.path('backups')], {
      env: { FAKE_MYSQLDUMP_FAIL: '1' },
    })
    assert.equal(r.status, 2, 'the dump failure exit code (2) must survive the exit handler')
    assert.deepEqual(pings(sb), [`${PING}/fail`])
    const truncated = sb.run('scripts/backup-db.sh', [sb.path('backups')], {
      env: { FAKE_DUMP_TRUNCATED: '1' },
    })
    assert.equal(truncated.status, 3)
    assert.equal(pings(sb).at(-1), `${PING}/fail`)
  } finally {
    cleanup(sb)
  }
})

test('an unreachable monitor does not fail a good backup', () => {
  const sb = sandbox(`HEALTHCHECK_PING_URL=${PING}\n`)
  try {
    const r = sb.run('scripts/backup-db.sh', [sb.path('backups')], { env: { FAKE_CURL_RC: '28' } })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.equal(pings(sb).length, 1, 'the ping was not attempted')
  } finally {
    cleanup(sb)
  }
})

test('without HEALTHCHECK_PING_URL nothing is requested', () => {
  const sb = sandbox()
  try {
    assert.equal(sb.run('scripts/backup-db.sh', [sb.path('backups')]).status, 0)
    assert.equal(
      sb.run('scripts/backup-db.sh', [sb.path('backups')], { env: { FAKE_MYSQLDUMP_FAIL: '1' } })
        .status,
      2,
    )
    assert.deepEqual(pings(sb), [])
  } finally {
    cleanup(sb)
  }
})

test('the restore check pings too, and still drops its scratch database', () => {
  const sb = sandbox(`HEALTHCHECK_PING_URL=${PING}\n`)
  try {
    assert.equal(sb.run('scripts/backup-db.sh', [sb.path('backups')]).status, 0)
    const file = dumps(sb.path('backups')).map((name) => sb.path('backups', name))[0]!
    const ok = sb.run('scripts/verify-restore.sh', [file], { env: { FAKE_RESTORED_TABLES: '62' } })
    assert.equal(ok.status, 0, ok.stdout + ok.stderr)
    assert.equal(pings(sb).at(-1), PING)
    const bad = sb.run('scripts/verify-restore.sh', [file], { env: { FAKE_RESTORED_TABLES: '3' } })
    assert.equal(bad.status, 2)
    assert.equal(pings(sb).at(-1), `${PING}/fail`)
    // The single exit handler still drops the scratch database on both paths.
    const drops = sb.dockerLog().filter((line) => line.includes('DROP DATABASE IF EXISTS'))
    assert.ok(drops.length >= 2, `scratch database not dropped: ${JSON.stringify(sb.dockerLog())}`)
  } finally {
    cleanup(sb)
  }
})

test('--prefix names the dump for the deploy, verifies it, keeps 5, and never pings', () => {
  const sb = sandbox(`HEALTHCHECK_PING_URL=${PING}\nBACKUP_KEEP_DAYS=0\n`)
  const dir = sb.path('.deploy-db-backups')
  try {
    mkdirSync(dir)
    // Seven older pre-deploy dumps plus a nightly dump in the same directory.
    for (let day = 10; day < 17; day++)
      writeFileSync(`${dir}/cdkt-predeploy-cdkt_admin-200001${day}T000000Z-1.sql.gz`, 'old')
    writeFileSync(`${dir}/cdkt-cdkt_admin-20000101T000000Z-1.sql.gz`, 'nightly')
    // Old enough for the nightly age rotation (BACKUP_KEEP_DAYS=0) to delete it —
    // if a pre-deploy run applied that rotation.
    const longAgo = new Date('2000-01-01T00:00:00Z')
    utimesSync(`${dir}/cdkt-cdkt_admin-20000101T000000Z-1.sql.gz`, longAgo, longAgo)
    const r = sb.run('scripts/backup-db.sh', ['--prefix', 'cdkt-predeploy', dir], {
      env: { BACKUP_STAMP: '20261023T020000Z' },
    })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    const left = dumps(dir)
    const predeploy = left.filter((name) => name.startsWith('cdkt-predeploy-'))
    assert.equal(predeploy.length, 5, `pre-deploy dumps kept: ${JSON.stringify(left)}`)
    assert.ok(
      predeploy.some((name) =>
        /^cdkt-predeploy-cdkt_admin-20261023T020000Z-\d+\.sql\.gz$/.test(name),
      ),
      "this run's dump was rotated away",
    )
    assert.ok(
      !predeploy.includes('cdkt-predeploy-cdkt_admin-20000110T000000Z-1.sql.gz'),
      'the oldest survived',
    )
    // Not its business: the nightly rotation (by age) is not applied to other names.
    assert.ok(
      left.includes('cdkt-cdkt_admin-20000101T000000Z-1.sql.gz'),
      'a pre-deploy run deleted a nightly dump',
    )
    assert.deepEqual(pings(sb), [], 'a pre-deploy dump pinged the nightly monitor')

    // A verification failure still removes the rejected file and exits non-zero.
    const bad = sb.run('scripts/backup-db.sh', ['--prefix', 'cdkt-predeploy', dir], {
      env: { FAKE_DUMP_TRUNCATED: '1' },
    })
    assert.equal(bad.status, 3)
    assert.equal(dumps(dir).filter((name) => name.startsWith('cdkt-predeploy-')).length, 5)
    assert.deepEqual(pings(sb), [])
  } finally {
    cleanup(sb)
  }
})

test('a prefix that is not a plain cdkt-… name is refused before anything is written', () => {
  const sb = sandbox()
  try {
    for (const prefix of ['../etc/x', 'cdkt-PRE', 'other', 'cdkt-a/b', '']) {
      const r = sb.run('scripts/backup-db.sh', ['--prefix', prefix, sb.path('backups')])
      assert.equal(r.status, 1, `prefix ${JSON.stringify(prefix)} was accepted`)
    }
    assert.ok(
      !sb.dockerLog().some((line) => line.includes('mysqldump')),
      'a refused prefix still dumped',
    )
  } finally {
    cleanup(sb)
  }
})
