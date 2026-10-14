import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SECRET, cleanup, envValue, lines, makeSandbox, repoFile, type Sandbox } from './_ops-sandbox'

/**
 * BEHAVIOUR tests for production/manage.sh and the backup/restore scripts.
 *
 * Nothing here touches a real docker daemon, container, volume, backup or git
 * tree. Each test copies the scripts into a throwaway directory, puts a FAKE
 * `docker` and `git` (tests/fixtures/ops-sandbox/) first on PATH, feeds answers on
 * stdin, and then inspects (a) the exit code, (b) what the fakes were asked to do,
 * (c) the files the scripts wrote. The source-grep guards in ops-scripts.test.ts
 * prove shape; these prove the scripts actually behave. The sandbox itself lives
 * in tests/_ops-sandbox.ts, shared with tests/ops-restore-hardening.test.ts.
 */

// ─── manage.sh: Deploy ────────────────────────────────────────────────────────
// Every `prompt "..."` in a command takes one answer; blank = take the suggestion.
// The count is READ from the script rather than typed here, so adding a prompt
// (another agent did, for PUBLIC_HOST_ALLOWLIST) does not silently shift every
// answer below it. The confirm that follows the prompts takes the next line.
const managePrompts = (fn: string, until: string) => {
  const script = readFileSync(repoFile('production/manage.sh'), 'utf8')
  const start = script.indexOf(`${fn}() {`)
  const slice = script.slice(start, script.indexOf(until, start))
  assert.ok(start >= 0 && slice.length > 0, `${fn} not found`)
  return (slice.match(/\bprompt "/g) ?? []).length
}
const DEPLOY_PROMPTS = managePrompts('cmd_deploy', 'Bước 6/6')
// Update: pull-code confirm, then these prompts, then the pull-image confirm.
const UPDATE_PROMPTS = managePrompts('cmd_update', 'Pull image + restart')
const updateInput = (pullCode: string, ...afterPrompts: string[]) =>
  lines(pullCode, ...Array(UPDATE_PROMPTS).fill(''), ...afterPrompts)

function deploySandbox(ramMb: number) {
  const sb = makeSandbox()
  mkdirSync(sb.path('public/assets/fonts'), { recursive: true })
  writeFileSync(sb.path('public/assets/fonts/inter.css'), '/* self-hosted */')
  writeFileSync(sb.path('meminfo'), `MemTotal:       ${ramMb * 1024} kB\nMemFree: 1 kB\n`)
  return sb
}

test('Deploy no longer offers an "existing DB" source that compose would silently ignore', () => {
  const sb = deploySandbox(8000)
  try {
    const r = sb.run('production/manage.sh', ['deploy'], {
      input: lines(...Array(DEPLOY_PROMPTS).fill(''), 'y'),
      env: { CDKT_MEMINFO_FILE: sb.path('meminfo') },
    })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.doesNotMatch(r.stdout, /Existing DB —/)
    assert.match(r.stdout, /MySQL đi kèm docker compose/)
    // The explanation names the real reason, so nobody goes looking for the option.
    assert.match(r.stdout, /DB_HOST=mysql/)
    // DB_HOST/DB_PORT in .env are host-side only and now say so instead of
    // pointing at a hostname no host can resolve.
    const env = sb.env()
    assert.equal(envValue(env, 'DB_HOST'), '127.0.0.1')
    assert.equal(envValue(env, 'DB_PORT'), envValue(env, 'MYSQL_EXTERNAL_PORT'))
  } finally {
    cleanup(sb)
  }
})

test('Deploy respects the 4000 MB RAM floor for MEDIA_UPLOAD_ENABLED', () => {
  for (const [ram, expected] of [[2000, 'false'], [3999, 'false'], [4000, 'true'], [16000, 'true']] as const) {
    const sb = deploySandbox(ram)
    try {
      const r = sb.run('production/manage.sh', ['deploy'], {
        input: lines(...Array(DEPLOY_PROMPTS).fill(''), 'y'),
        env: { CDKT_MEMINFO_FILE: sb.path('meminfo') },
      })
      assert.equal(r.status, 0, r.stdout + r.stderr)
      assert.equal(envValue(sb.env(), 'MEDIA_UPLOAD_ENABLED'), expected, `RAM ${ram} MB`)
      if (expected === 'false') assert.match(r.stdout, /media-tuning/, 'the operator is told where to opt in')
    } finally {
      cleanup(sb)
    }
  }
})

test('Deploy pulls the CI-built image and starts the stack; it never builds on the VPS by default', () => {
  const sb = deploySandbox(8000)
  try {
    const r = sb.run('production/manage.sh', ['deploy'], {
      input: lines(...Array(DEPLOY_PROMPTS).fill(''), 'y'),
      env: { CDKT_MEMINFO_FILE: sb.path('meminfo') },
    })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    const log = sb.dockerLog()
    // `docker pull <image>`, then proof the image is really there, then `up`.
    const image = envValue(sb.env(), 'CDKT_IMAGE')
    const pull = log.findIndex((l) => l === `pull ${image}`)
    const present = log.findIndex((l, i) => i > pull && l.startsWith('image inspect') && l.endsWith(image ?? '?'))
    const up = log.findIndex((l) => l === 'compose up -d')
    assert.ok(pull >= 0 && present > pull && up > present, `expected pull, image inspect, up: ${JSON.stringify(log)}`)
    assert.ok(!log.some((l) => /--build|compose build/.test(l)), 'Deploy built on the VPS without being asked')
  } finally {
    cleanup(sb)
  }
})

test('Deploy: a failed pull falls back to a build only on explicit consent, with an OOM warning', () => {
  const declined = deploySandbox(8000)
  try {
    const r = declined.run('production/manage.sh', ['deploy'], {
      input: lines(...Array(DEPLOY_PROMPTS).fill(''), 'y', 'n'),
      env: { CDKT_MEMINFO_FILE: declined.path('meminfo'), FAKE_PULL_RC: '1' },
    })
    assert.notEqual(r.status, 0, 'declining the build must not look like a successful deploy')
    assert.match(r.stdout, /OOM/)
    assert.match(r.stdout, /docker login ghcr\.io/)
    const log = declined.dockerLog()
    assert.ok(!log.some((l) => /compose (build|up)/.test(l)), `nothing may start or build: ${JSON.stringify(log)}`)
  } finally {
    cleanup(declined)
  }

  // The dangerous variant: the pull REPORTS success (some Compose/registry
  // combinations do) but the image is not there. A plain `up -d` would then build
  // `app` on the VPS without asking, so the missing image must be caught on its own.
  const silent = deploySandbox(8000)
  try {
    const r = silent.run('production/manage.sh', ['deploy'], {
      input: lines(...Array(DEPLOY_PROMPTS).fill(''), 'y', 'n'),
      env: { CDKT_MEMINFO_FILE: silent.path('meminfo'), FAKE_PULL_RC: '0', FAKE_IMAGE_MISSING: '1' },
    })
    assert.notEqual(r.status, 0)
    assert.match(r.stdout, /OOM/)
    const log = silent.dockerLog()
    assert.ok(!log.some((l) => /compose (build|up)/.test(l)), `a missing image must never reach compose up: ${JSON.stringify(log)}`)
  } finally {
    cleanup(silent)
  }

  const accepted = deploySandbox(8000)
  try {
    const r = accepted.run('production/manage.sh', ['deploy'], {
      input: lines(...Array(DEPLOY_PROMPTS).fill(''), 'y', 'y'),
      env: { CDKT_MEMINFO_FILE: accepted.path('meminfo'), FAKE_PULL_RC: '1' },
    })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.ok(accepted.dockerLog().includes('compose build app'))
  } finally {
    cleanup(accepted)
  }
})

test('Deploy exits non-zero when the container never becomes healthy ("unhealthy" is not "healthy")', () => {
  const sb = deploySandbox(8000)
  try {
    const r = sb.run('production/manage.sh', ['deploy'], {
      input: lines(...Array(DEPLOY_PROMPTS).fill(''), 'y'),
      env: { CDKT_MEMINFO_FILE: sb.path('meminfo'), FAKE_HEALTH: 'unhealthy' },
    })
    assert.notEqual(r.status, 0)
    assert.match(r.stdout, /DEPLOY KHÔNG THÀNH CÔNG/)
    assert.doesNotMatch(r.stdout, /DEPLOY XONG/)
  } finally {
    cleanup(sb)
  }
})

// ─── manage.sh: Migrate ───────────────────────────────────────────────────────
function migrateSandbox() {
  const sb = makeSandbox(`MYSQL_ROOT_PASSWORD=${SECRET}\nMYSQL_DATABASE=custom_db\nDB_PASSWORD=app-user-pw\n`)
  mkdirSync(sb.path('production/migrations'))
  writeFileSync(sb.path('production/migrations/a_clean.sql'), "INSERT INTO articles (title) VALUES ('x');\n-- DROP TABLE just_a_comment;\n")
  writeFileSync(
    sb.path('production/migrations/b_destructive.sql'),
    'drop table if exists articles;\nCREATE TABLE articles (id int);\nTruncate Table users;\n',
  )
  return sb
}

test('Migrate targets the database from .env, not a hard-coded cdkt_admin', () => {
  const sb = migrateSandbox()
  try {
    const r = sb.run('production/manage.sh', ['migrate'], { input: lines('1', 'y') })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    const mysqlCalls = sb.dockerLog().filter((l) => l.includes(' mysql '))
    assert.ok(mysqlCalls.length >= 3, 'before-count, import, after-count')
    for (const call of mysqlCalls) {
      assert.match(call, /custom_db/, call)
      assert.doesNotMatch(call, /cdkt_admin/, call)
    }
    assert.ok(existsSync(sb.path('production/migrations/.imported-a_clean.sql')))
  } finally {
    cleanup(sb)
  }
})

test('Migrate keeps the MySQL root password out of every command line', () => {
  const sb = migrateSandbox()
  try {
    const r = sb.run('production/manage.sh', ['migrate'], { input: lines('1', 'y') })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    const log = sb.dockerLog().join('\n')
    assert.ok(!log.includes(SECRET), 'the password is visible in a docker argv (ps would show it)')
    assert.doesNotMatch(log, /\s-p\S/, 'a -p<password> style argument is present')
    // ...but it still reaches MySQL: through the environment, by name.
    const execIdx = sb.dockerLog().flatMap((l, i) => (l.startsWith('exec ') ? [i] : []))
    assert.ok(execIdx.length > 0)
    for (const i of execIdx) {
      assert.match(sb.dockerLog()[i], /-e MYSQL_PWD /, 'expected the by-name -e MYSQL_PWD form')
      assert.equal(sb.dockerPwd()[i], SECRET)
    }
    // The import itself delivered the file on stdin.
    const stdin = readdirSync(sb.dir).find((f) => f.startsWith('mysql.stdin.'))
    assert.ok(stdin)
  } finally {
    cleanup(sb)
  }
})

test('Migrate does not fall back to the app user password for the root login', () => {
  const sb = makeSandbox('DB_PASSWORD=app-user-pw\n')
  mkdirSync(sb.path('production/migrations'))
  writeFileSync(sb.path('production/migrations/a.sql'), 'SELECT 1;\n')
  try {
    const r = sb.run('production/manage.sh', ['migrate'], { input: lines('1', 'y') })
    assert.notEqual(r.status, 0)
    assert.match(r.stdout, /MYSQL_ROOT_PASSWORD/)
    assert.equal(sb.dockerLog().length, 0, 'nothing may be sent to mysql with the wrong credentials')
  } finally {
    cleanup(sb)
  }
})

test('Migrate scans each file for DROP/TRUNCATE and demands the file name before running one', () => {
  const sb = migrateSandbox()
  try {
    // "all", confirm, then a WRONG name for the destructive file: it must be skipped.
    const skipped = sb.run('production/manage.sh', ['migrate'], { input: lines('all', 'y', 'nope') })
    assert.equal(skipped.status, 0, skipped.stdout + skipped.stderr)
    const listing = skipped.stdout.split('\n')
    assert.match(listing.find((l) => l.includes('[2]')) ?? '', /b_destructive\.sql.*2 lệnh DROP\/TRUNCATE/, 'the listing flags the file')
    assert.doesNotMatch(listing.find((l) => l.includes('[1]')) ?? '', /DROP/, 'the clean file (comment only) is not flagged')
    assert.ok(existsSync(sb.path('production/migrations/.imported-a_clean.sql')), 'the clean file still imports')
    assert.ok(!existsSync(sb.path('production/migrations/.imported-b_destructive.sql')), 'the destructive file ran without its name being typed')
    const importedBodies = readdirSync(sb.dir)
      .filter((f) => f.startsWith('mysql.stdin.'))
      .map((f) => readFileSync(sb.path(f), 'utf8'))
    assert.ok(importedBodies.every((b) => !/drop table if exists|truncate table/i.test(b)), 'destructive SQL reached mysql')
  } finally {
    cleanup(sb)
  }

  const typed = migrateSandbox()
  try {
    const r = typed.run('production/manage.sh', ['migrate'], { input: lines('2', 'y', 'b_destructive.sql') })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /drop table if exists articles/i, 'the offending lines are shown')
    assert.match(r.stdout, /Truncate Table users/)
    assert.ok(existsSync(typed.path('production/migrations/.imported-b_destructive.sql')))
  } finally {
    cleanup(typed)
  }
})

test('a comment that merely mentions DROP TABLE is not flagged', () => {
  const sb = migrateSandbox()
  try {
    const r = sb.run('production/manage.sh', ['migrate'], { input: lines('1', 'y') })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.doesNotMatch(r.stdout, /Gõ đúng tên file/)
  } finally {
    cleanup(sb)
  }
})

// ─── manage.sh: Update ────────────────────────────────────────────────────────
// Prompts: pull code?, PORT, PUBLIC_BASE_URL, pull image?, (pinned? re-point), ...
function updateSandbox(cdktImage: string) {
  // PUBLIC_HOST_ALLOWLIST is set to the host of PUBLIC_BASE_URL on purpose: another
  // change makes Update offer to write that key when the value differs from what is
  // in .env, and the extra confirm would swallow the next scripted answer.
  const sb = makeSandbox(
    `MYSQL_ROOT_PASSWORD=${SECRET}\nPORT=3000\nPUBLIC_BASE_URL=https://example.test\nPUBLIC_HOST_ALLOWLIST=example.test\nCDKT_IMAGE=${cdktImage}\n`,
  )
  mkdirSync(sb.path('public/assets/fonts'), { recursive: true })
  writeFileSync(sb.path('public/assets/fonts/inter.css'), '/* self-hosted */')
  writeFileSync(sb.path('docker-compose.yml'), 'services: {}\n')
  return sb
}

test('Update restarts only the app, the way CI does — never a plain `up -d app` that can recreate MySQL', () => {
  const sb = updateSandbox('ghcr.io/x/y:latest')
  try {
    const r = sb.run('production/manage.sh', ['update'], { input: updateInput('n', 'y') })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    const log = sb.dockerLog()
    assert.ok(log.includes('compose up -d --no-recreate mysql'), JSON.stringify(log))
    assert.ok(log.includes('compose up -d --no-deps app'), JSON.stringify(log))
    assert.ok(!log.includes('compose up -d app'), 'a plain `up -d app` can recreate mysql')
    assert.match(r.stdout, /UPDATE XONG/)
  } finally {
    cleanup(sb)
  }
})

test('Update copes with a .env that lacks keys (an absent key is empty, not a silent exit)', () => {
  const sb = makeSandbox(`MYSQL_ROOT_PASSWORD=${SECRET}\n`)
  mkdirSync(sb.path('public/assets/fonts'), { recursive: true })
  writeFileSync(sb.path('public/assets/fonts/inter.css'), '/* self-hosted */')
  try {
    const r = sb.run('production/manage.sh', ['update'], { input: updateInput('n', 'n') })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /Sửa cấu hình/)
    assert.match(r.stdout, /UPDATE XONG/)
  } finally {
    cleanup(sb)
  }
})

test('Update explains a sha- pinned CDKT_IMAGE and offers to re-point it at :latest', () => {
  const sb = updateSandbox('ghcr.io/x/y:sha-0123abc')
  try {
    const r = sb.run('production/manage.sh', ['update'], { input: updateInput('n', 'y', 'y') })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /ghim/)
    assert.equal(envValue(sb.env(), 'CDKT_IMAGE'), 'ghcr.io/x/y:latest')
    assert.ok(sb.dockerLog().includes('pull ghcr.io/x/y:latest'))
  } finally {
    cleanup(sb)
  }

  // Declining the re-point keeps the pin and pulls exactly that tag.
  const kept = updateSandbox('ghcr.io/x/y:sha-0123abc')
  try {
    const r = kept.run('production/manage.sh', ['update'], {
      input: updateInput('n', 'y', 'n'),
      env: { FAKE_NEW_ID: 'sha256:prev' },
    })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.equal(envValue(kept.env(), 'CDKT_IMAGE'), 'ghcr.io/x/y:sha-0123abc')
    assert.match(r.stdout, /không có bản mới hơn/, 'same image ID → says there is nothing newer')
  } finally {
    cleanup(kept)
  }
})

test('Update fails non-zero and rolls back automatically when the new image is not healthy', () => {
  const sb = updateSandbox('ghcr.io/x/y:latest')
  try {
    const r = sb.run('production/manage.sh', ['update'], {
      input: updateInput('n', 'y'),
      env: { FAKE_HEALTH: 'unhealthy-until-rollback' },
    })
    assert.notEqual(r.status, 0, 'a failed update must not exit 0')
    assert.match(r.stdout, /đã lùi về cdkt-rollback\/app:/)
    assert.doesNotMatch(r.stdout, /UPDATE XONG/)
    const log = sb.dockerLog()
    // The image that was RUNNING (by id, not by the moving :latest tag) was tagged first...
    const tagIdx = log.findIndex((l) => /^image tag sha256:prev cdkt-rollback\/app:\d{8}T\d{6}Z$/.test(l))
    const pullIdx = log.findIndex((l) => l === 'pull ghcr.io/x/y:latest')
    assert.ok(tagIdx >= 0 && pullIdx > tagIdx, 'the rollback tag must exist BEFORE the pull moves :latest')
    // ...and is what the rollback pointed compose at.
    assert.match(envValue(sb.env(), 'CDKT_IMAGE') ?? '', /^cdkt-rollback\/app:/)
    assert.equal(log.filter((l) => l === 'compose up -d --no-deps app').length, 2, 'start, then rollback start')
  } finally {
    cleanup(sb)
  }
})

test('Update reports failure when even the rollback is not healthy', () => {
  const sb = updateSandbox('ghcr.io/x/y:latest')
  try {
    const r = sb.run('production/manage.sh', ['update'], {
      input: updateInput('n', 'y'),
      env: { FAKE_HEALTH: 'unhealthy' },
    })
    assert.notEqual(r.status, 0)
    assert.match(r.stdout, /cũng không khoẻ/)
  } finally {
    cleanup(sb)
  }
})

test('Update with nothing to roll back to says so instead of pretending', () => {
  const sb = updateSandbox('ghcr.io/x/y:latest')
  try {
    const r = sb.run('production/manage.sh', ['update'], {
      input: updateInput('n', 'y'),
      env: { FAKE_HEALTH: 'unhealthy', FAKE_PREV_ID: '' },
    })
    assert.notEqual(r.status, 0)
    assert.match(r.stdout, /Không có image trước để lùi/)
    assert.equal(sb.dockerLog().filter((l) => l === 'compose up -d --no-deps app').length, 1)
  } finally {
    cleanup(sb)
  }
})

test('Update never builds on the VPS silently when the pull fails', () => {
  const sb = updateSandbox('ghcr.io/x/y:latest')
  try {
    const r = sb.run('production/manage.sh', ['update'], {
      input: updateInput('n', 'y', 'n'),
      env: { FAKE_PULL_RC: '1' },
    })
    assert.notEqual(r.status, 0)
    assert.match(r.stdout, /OOM/)
    const log = sb.dockerLog()
    assert.ok(!log.some((l) => l.startsWith('compose build') || l.startsWith('compose up')), JSON.stringify(log))
    assert.equal(envValue(sb.env(), 'CDKT_IMAGE'), 'ghcr.io/x/y:latest', '.env must be left alone')
  } finally {
    cleanup(sb)
  }
})

test('Update drops the CI-written docker-compose.yml (backed up first) so git pull is not refused', () => {
  const sb = updateSandbox('ghcr.io/x/y:latest')
  try {
    const r = sb.run('production/manage.sh', ['update'], {
      input: updateInput('y', 'n'),
      env: { FAKE_GIT_DIFF_RC: '1' },
    })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    const log = sb.dockerLog()
    const checkout = log.indexOf('git checkout -- docker-compose.yml')
    const pull = log.indexOf('git pull origin main')
    assert.ok(checkout >= 0 && pull > checkout, `checkout must precede pull: ${JSON.stringify(log)}`)
    const backups = readdirSync(sb.path('.deploy-compose-backups'))
    assert.equal(backups.length, 1)
    assert.match(backups[0], /^docker-compose\.\d{8}T\d{6}Z\.yml$/, 'same naming as scripts/deploy-remote.sh')
    assert.match(r.stdout, /sao lưu/i, 'the operator is told local edits were saved')
  } finally {
    cleanup(sb)
  }

  // Clean tree: no checkout needed.
  const clean = updateSandbox('ghcr.io/x/y:latest')
  try {
    const r = clean.run('production/manage.sh', ['update'], { input: updateInput('y', 'n') })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.ok(!clean.dockerLog().includes('git checkout -- docker-compose.yml'))
  } finally {
    cleanup(clean)
  }
})

test('a rollback also puts docker-compose.yml back to the pre-pull version', () => {
  const sb = updateSandbox('ghcr.io/x/y:latest')
  try {
    // git "pull" is fake, so simulate the pull changing compose by making the
    // fake docker swap the file when the new app is started.
    const compose = sb.path('docker-compose.yml')
    writeFileSync(sb.path('bin/git'), `#!/usr/bin/env bash\necho "x" >/dev/null\nif [ "\${1:-}" = pull ]; then echo 'services: {changed: {}}' > "${compose}"; fi\nif [ "\${1:-}" = diff ]; then exit 0; fi\nexit 0\n`)
    chmodSync(sb.path('bin/git'), 0o755)
    const r = sb.run('production/manage.sh', ['update'], {
      input: updateInput('y', 'y'),
      env: { FAKE_HEALTH: 'unhealthy-until-rollback' },
    })
    assert.notEqual(r.status, 0)
    assert.equal(readFileSync(compose, 'utf8'), 'services: {}\n', 'compose must be restored alongside the image')
  } finally {
    cleanup(sb)
  }
})

// ─── .env permissions, failed pull, database name ────────────────────────────
const mode = (file: string) => statSync(file).mode & 0o777

test('Deploy writes .env readable by its owner only (0600), also when replacing an old 0644 one', () => {
  const fresh = deploySandbox(8000)
  try {
    const r = fresh.run('production/manage.sh', ['deploy'], {
      input: lines(...Array(DEPLOY_PROMPTS).fill(''), 'n'),
      env: { CDKT_MEMINFO_FILE: fresh.path('meminfo') },
    })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.equal(mode(fresh.path('.env')).toString(8), '600')
    assert.ok(!readdirSync(fresh.dir).some((f) => f.startsWith('.env.manage.')), 'temp file left behind')
  } finally {
    cleanup(fresh)
  }

  const old = deploySandbox(8000)
  try {
    writeFileSync(old.path('.env'), 'OLD=1\n')
    chmodSync(old.path('.env'), 0o644)
    const r = old.run('production/manage.sh', ['deploy'], {
      input: lines('y', ...Array(DEPLOY_PROMPTS).fill(''), 'n'),
      env: { CDKT_MEMINFO_FILE: old.path('meminfo') },
    })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.equal(mode(old.path('.env')).toString(8), '600', '`cat >` onto the old file kept its 0644')
    assert.ok(envValue(old.env(), 'JWT_SECRET'), 'the new .env was written')
  } finally {
    cleanup(old)
  }
})

test('Update tightens an existing world-readable .env to 0600 and says so', () => {
  const sb = updateSandbox('ghcr.io/x/y:latest')
  try {
    chmodSync(sb.path('.env'), 0o644)
    const r = sb.run('production/manage.sh', ['update'], { input: updateInput('n', 'n') })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.equal(mode(sb.path('.env')).toString(8), '600')
    assert.match(r.stdout, /quyền 644.*đã đặt lại 600/)
  } finally {
    cleanup(sb)
  }

  // Run by a user who cannot chmod .env (not its owner): warn, never abort the Update.
  const foreign = updateSandbox('ghcr.io/x/y:latest')
  try {
    chmodSync(foreign.path('.env'), 0o644)
    writeFileSync(foreign.path('bin/chmod'), '#!/usr/bin/env bash\ncase "${*: -1}" in */.env) echo "chmod: Operation not permitted" >&2; exit 1 ;; esac\nexec /bin/chmod "$@"\n')
    chmodSync(foreign.path('bin/chmod'), 0o755)
    const r = foreign.run('production/manage.sh', ['update'], { input: updateInput('n', 'y') })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /Không đặt được quyền 600 cho \.env/)
    assert.match(r.stdout, /UPDATE XONG/)
  } finally {
    cleanup(foreign)
  }
})

test('a failed git pull puts back the docker-compose.yml it had reverted to HEAD', () => {
  const sb = updateSandbox('ghcr.io/x/y:latest')
  try {
    const compose = sb.path('docker-compose.yml')
    writeFileSync(compose, 'services: {written-by-ci: {}}\n')
    // checkout really reverts the file; pull fails.
    writeFileSync(sb.path('bin/git'), `#!/usr/bin/env bash\ncase "\${1:-}" in\n  diff) [[ "$*" == *--quiet* ]] && exit 1; exit 0 ;;\n  checkout) echo 'services: {old-head: {}}' > "${compose}" ;;\n  pull) exit 1 ;;\nesac\nexit 0\n`)
    chmodSync(sb.path('bin/git'), 0o755)
    const r = sb.run('production/manage.sh', ['update'], { input: updateInput('y') })
    assert.notEqual(r.status, 0)
    assert.match(r.stdout, /git pull thất bại/)
    assert.equal(readFileSync(compose, 'utf8'), 'services: {written-by-ci: {}}\n', 'compose left at the old HEAD after a failed pull')
    assert.match(r.stdout, /đã được đặt lại như trước lượt Update/)
    assert.ok(!sb.dockerLog().some((l) => /^(compose (up|pull|build|stop|run|down)|pull )/.test(l)), 'no container was touched')
  } finally {
    cleanup(sb)
  }
})

test('Migrate uses the database compose uses (MYSQL_DATABASE, default cdkt_admin), never a stray DB_NAME', () => {
  const sb = makeSandbox(`MYSQL_ROOT_PASSWORD=${SECRET}\nDB_NAME=legacy_db\n`)
  mkdirSync(sb.path('production/migrations'))
  writeFileSync(sb.path('production/migrations/a.sql'), 'SELECT 1;\n')
  try {
    const r = sb.run('production/manage.sh', ['migrate'], { input: lines('1', 'y') })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    const mysqlCalls = sb.dockerLog().filter((l) => l.includes(' mysql '))
    assert.ok(mysqlCalls.length > 0)
    for (const call of mysqlCalls) {
      assert.match(call, / cdkt_admin( |$)/, call)
      assert.doesNotMatch(call, /legacy_db/, call)
    }
    assert.match(r.stdout + r.stderr, /DB_NAME=legacy_db khác database app thật sự dùng \(cdkt_admin/)
  } finally {
    cleanup(sb)
  }
})

test('the RAM floor is the same number in Deploy and media-tuning', () => {
  const script = readFileSync(repoFile('production/manage.sh'), 'utf8')
  const floors = [...script.matchAll(/RAM_FLOOR_MB=(\d+)/g)].map((m) => m[1])
  assert.ok(floors.length >= 2, 'both Deploy and cmd_media_tuning declare the floor')
  assert.deepEqual([...new Set(floors)], ['4000'])
})

// ─── scripts/backup-media.sh + restore-media.sh ──────────────────────────────
function mediaFixture() {
  const sb = makeSandbox('')
  mkdirSync(sb.path('fx/media/media/slug'), { recursive: true })
  writeFileSync(sb.path('fx/media/media/slug/seg-0.ts'), 'segment')
  mkdirSync(sb.path('fx/public/uploads/2026/10'), { recursive: true })
  writeFileSync(sb.path('fx/public/uploads/2026/10/photo.jpg'), 'jpeg-bytes')
  mkdirSync(sb.path('backups'))
  return sb
}
const tarList = (file: string) => spawnSync('tar', ['-tzf', file], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean)
const daysAgo = (file: string, days: number) => {
  const t = new Date(Date.now() - days * 86_400_000)
  utimesSync(file, t, t)
}

test('the cron media backup now archives the uploads volume too, in the in-app layout', () => {
  const sb = mediaFixture()
  try {
    const r = sb.run('scripts/backup-media.sh', [sb.path('backups')], { env: { BACKUP_STAMP: '20261013T020000Z' } })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    const files = readdirSync(sb.path('backups')).sort()
    const media = files.find((f) => f.startsWith('cdkt-media-20261013T020000Z-'))
    const uploads = files.find((f) => f.startsWith('cdkt-uploads-20261013T020000Z-'))
    assert.ok(media && uploads, JSON.stringify(files))
    assert.ok(tarList(sb.path('backups', uploads)).includes('uploads/2026/10/photo.jpg'), 'uploads/ is the top-level directory')
    assert.ok(tarList(sb.path('backups', media)).some((e) => e.endsWith('seg-0.ts')))
    // Both volumes were read through the running app container's mount paths.
    const cps = sb.dockerLog().filter((l) => l.startsWith('cp '))
    assert.deepEqual(cps, ['cp cdkt_app:/var/lib/cdkt/media/. -', 'cp cdkt_app:/app/public/uploads -'])
    assert.equal(r.stdout.split('\n').filter(Boolean).length, 2, 'one success event per volume')
  } finally {
    cleanup(sb)
  }
})

test('a failing uploads copy fails the run (exit 2) and leaves no partial uploads archive', () => {
  const sb = mediaFixture()
  try {
    const r = sb.run('scripts/backup-media.sh', [sb.path('backups')], {
      env: { BACKUP_STAMP: '20261013T020000Z', FAKE_CP_FAIL_PATH: '/app/public/uploads' },
    })
    assert.equal(r.status, 2, r.stdout + r.stderr)
    assert.match(r.stderr, /uploads_data/)
    assert.ok(readdirSync(sb.path('backups')).every((f) => !f.startsWith('cdkt-uploads-')))
  } finally {
    cleanup(sb)
  }
})

test('rotation removes only this script\'s own old archives, never the in-app backup\'s', () => {
  const sb = mediaFixture()
  try {
    const own = ['cdkt-media-20200101T000000Z-111.tar.gz', 'cdkt-uploads-20200101T000000Z-222.tar.gz']
    const inApp = ['cdkt-media-20200101T000000Z-scheduled.tar.gz', 'cdkt-uploads-20200101T000000Z-manual.tar.gz', 'cdkt-uploads-20200101T000000Z-pre-restore.tar.gz']
    for (const f of [...own, ...inApp]) {
      writeFileSync(sb.path('backups', f), 'old')
      daysAgo(sb.path('backups', f), 40)
    }
    const r = sb.run('scripts/backup-media.sh', [sb.path('backups')], { env: { BACKUP_STAMP: '20261013T020000Z', BACKUP_KEEP_DAYS: '14' } })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    const left = readdirSync(sb.path('backups'))
    for (const f of own) assert.ok(!left.includes(f), `${f} is ours and old: should rotate`)
    for (const f of inApp) assert.ok(left.includes(f), `${f} belongs to the in-app backup: must survive`)
  } finally {
    cleanup(sb)
  }
})

/**
 * Builds a gzip tarball from {path: content}. Only the top-level names are handed to
 * tar (no `./` entry); `transform` is a GNU tar --transform expression that rewrites
 * entry names, used to forge the `../` escape.
 */
function makeArchive(sb: Sandbox, file: string, entries: Record<string, string>, transform?: string) {
  const src = sb.path('arch-src')
  rmSync(src, { recursive: true, force: true })
  mkdirSync(src, { recursive: true })
  for (const [name, content] of Object.entries(entries)) {
    mkdirSync(join(src, name, '..'), { recursive: true })
    writeFileSync(join(src, name), content)
  }
  const tops = [...new Set(Object.keys(entries).map((n) => n.split('/')[0]))]
  const args = ['-C', src, '-czf', file, ...(transform ? ['--transform', transform] : []), ...tops]
  assert.equal(spawnSync('tar', args).status, 0)
  return file
}

test('restore-media restores an uploads archive into /app/public/uploads as root, then hands it to node', () => {
  const sb = mediaFixture()
  try {
    const arc = sb.path('backups/cdkt-uploads-20261013T020000Z-1.tar.gz')
    assert.equal(spawnSync('tar', ['-C', sb.path('fx/public'), '-czf', arc, 'uploads']).status, 0)
    // Something already in the volume, which the restore must replace.
    mkdirSync(sb.path('vol/app/public/uploads/old'), { recursive: true })
    writeFileSync(sb.path('vol/app/public/uploads/old/stale.jpg'), 'stale')
    const r = sb.run('scripts/restore-media.sh', [arc, '--replace'])
    assert.equal(r.status, 0, r.stdout + r.stderr)
    // The fake `compose run` executes the container script against vol/ (see
    // tests/fixtures/ops-sandbox/docker), so the end state is checked, not the text.
    const runs = sb.dockerLog().filter((l) => l.startsWith('compose run'))
    assert.ok(runs.length > 0, 'compose run was not invoked')
    for (const run of runs) {
      assert.match(run, /--no-deps --user root /, 'uploads are restored as root')
      assert.doesNotMatch(run, /\/var\/lib\/cdkt\/media/, 'the media volume must not be touched')
    }
    // The validated archive is what reached the container's stdin
    // (restore-media decompresses first, so the container sees a plain tar stream).
    const restoreCall = readFileSync(sb.path('docker.log'), 'utf8').split('\n').find((l) => l.includes('\tcompose run') && l.includes('tar -xf -'))!
    const listing = spawnSync('tar', ['-tf', '-'], { input: readFileSync(sb.path(`run.stdin.${restoreCall.split('\t')[0]}`)), encoding: 'utf8' })
    assert.ok(listing.stdout.split('\n').includes('uploads/2026/10/photo.jpg'), listing.stdout)
    // Landed in the uploads volume itself, the old contents are gone, then handed to node.
    assert.equal(readFileSync(sb.path('vol/app/public/uploads/2026/10/photo.jpg'), 'utf8'), 'jpeg-bytes')
    assert.ok(!existsSync(sb.path('vol/app/public/uploads/old')), 'the previous contents were not replaced')
    assert.ok(!existsSync(sb.path('vol/app/public/uploads/uploads')), 'uploads/ was nested inside the volume')
    assert.deepEqual(readdirSync(sb.path('vol/app/public/uploads')).sort(), ['2026'], 'staging leftovers in the volume')
    assert.match(readFileSync(sb.path('chown.log'), 'utf8'), /^chown -R node:node .*\/vol\/app\/public\/uploads$/m)
  } finally {
    cleanup(sb)
  }
})

test('restore-media restores a media archive into the media volume only', () => {
  const sb = mediaFixture()
  try {
    const arc = sb.path('backups/cdkt-media-20261013T020000Z-1.tar.gz')
    assert.equal(spawnSync('tar', ['-C', sb.path('fx/media'), '-czf', arc, '.']).status, 0)
    const r = sb.run('scripts/restore-media.sh', [arc, '--replace'])
    assert.equal(r.status, 0, r.stdout + r.stderr)
    const runs = sb.dockerLog().filter((l) => l.startsWith('compose run'))
    assert.ok(runs.length > 0)
    for (const run of runs) {
      assert.match(run, /\/var\/lib\/cdkt\/media/)
      assert.doesNotMatch(run, /--user root/)
      assert.doesNotMatch(run, /\/app\/public\/uploads/)
    }
    assert.equal(readFileSync(sb.path('vol/var/lib/cdkt/media/media/slug/seg-0.ts'), 'utf8'), 'segment')
    assert.ok(!existsSync(sb.path('chown.log')), 'media keeps the image user: no chown')
  } finally {
    cleanup(sb)
  }
})

test('restore-media refuses what it cannot restore safely, and never reaches docker compose run', () => {
  const sb = mediaFixture()
  try {
    const cases: Array<[string, () => string, RegExp, string[]?]> = [
      ['no --replace', () => { const a = sb.path('backups/cdkt-uploads-20261013T020000Z-1.tar.gz'); makeArchive(sb, a, { 'uploads/a.jpg': 'x' }); return a }, /usage/, []],
      ['unknown name', () => { const a = sb.path('backups/whatever.tar.gz'); makeArchive(sb, a, { 'uploads/a.jpg': 'x' }); return a }, /unrecognised archive name/, ['--replace']],
      ['in-app media layout', () => { const a = sb.path('backups/cdkt-media-20261013T020000Z-scheduled.tar.gz'); makeArchive(sb, a, { 'media/a.ts': 'x' }); return a }, /in-app media archive/, ['--replace']],
      ['uploads with a foreign top-level dir', () => { const a = sb.path('backups/cdkt-uploads-20261013T020000Z-2.tar.gz'); makeArchive(sb, a, { 'media/a.ts': 'x' }); return a }, /outside uploads\//, ['--replace']],
      ['parent-directory escape', () => { const a = sb.path('backups/cdkt-uploads-20261013T020000Z-3.tar.gz'); makeArchive(sb, a, { 'uploads/a.jpg': 'x' }, 's,^,../,'); return a }, /unsafe path/, ['--replace']],
      ['corrupt gzip', () => { const a = sb.path('backups/cdkt-uploads-20261013T020000Z-4.tar.gz'); writeFileSync(a, 'not gzip'); return a }, /corrupt/, ['--replace']],
    ]
    for (const [label, build, message, extra = ['--replace']] of cases) {
      const arc = build()
      const r = sb.run('scripts/restore-media.sh', [arc, ...extra])
      assert.notEqual(r.status, 0, `${label}: should refuse`)
      assert.match(r.stderr, message, label)
    }
    assert.ok(!sb.dockerLog().some((l) => l.startsWith('compose run')), 'a refused archive reached the volume')
  } finally {
    cleanup(sb)
  }
})

test('restore-media refuses while the app is running (exit 2)', () => {
  const sb = mediaFixture()
  try {
    const arc = sb.path('backups/cdkt-uploads-20261013T020000Z-1.tar.gz')
    makeArchive(sb, arc, { 'uploads/a.jpg': 'x' })
    const r = sb.run('scripts/restore-media.sh', [arc, '--replace'], { env: { FAKE_APP_RUNNING: '1' } })
    assert.equal(r.status, 2, r.stdout + r.stderr)
    assert.ok(!sb.dockerLog().some((l) => l.startsWith('compose run')))
  } finally {
    cleanup(sb)
  }
})

// ─── scripts/restore-db.sh ────────────────────────────────────────────────────
function dbSandbox() {
  const sb = makeSandbox(`MYSQL_ROOT_PASSWORD=${SECRET}\nMYSQL_DATABASE=cdkt_admin\n`)
  mkdirSync(sb.path('backups'))
  // A real backup-db.sh-shaped dump, produced by the same fake mysqldump path.
  const dump = [
    ...Array.from({ length: 25 }, (_, i) => `DROP TABLE IF EXISTS \`t${i}\`;\nCREATE TABLE \`t${i}\` (id int);\nINSERT INTO \`t${i}\` VALUES (1);`),
    '-- Dump completed on 2026-01-01 00:00:00',
    '',
  ].join('\n')
  const file = sb.path('backups/cdkt-cdkt_admin-20261013T020000Z-99.sql.gz')
  writeFileSync(sb.path('dump.sql'), dump)
  assert.equal(spawnSync('bash', ['-c', `gzip -c "${sb.path('dump.sql')}" > "${file}"`]).status, 0)
  return { sb, file, dump }
}
const gzipTo = (sb: Sandbox, name: string, body: string) => {
  const plain = sb.path(`${name}.sql`)
  writeFileSync(plain, body)
  const out = sb.path('backups', `${name}.sql.gz`)
  spawnSync('bash', ['-c', `gzip -c "${plain}" > "${out}"`])
  return out
}

test('restore-db: pre-restore dump, then restore, password only via the environment', () => {
  const { sb, file, dump } = dbSandbox()
  try {
    const r = sb.run('scripts/restore-db.sh', [file, 'cdkt_admin', '--replace'])
    assert.equal(r.status, 0, r.stdout + r.stderr)
    const log = sb.dockerLog()
    const dumpIdx = log.findIndex((l) => l.includes(' mysqldump '))
    const restoreIdx = log.findIndex((l, i) => l.includes(' -i ') && l.endsWith('cdkt_admin') && i > dumpIdx)
    assert.ok(dumpIdx >= 0 && restoreIdx > dumpIdx, `the pre-restore dump must come first: ${JSON.stringify(log)}`)
    // The pre-restore dump is a verified file outside backup-db.sh's rotation pattern.
    const pre = readdirSync(sb.path('backups')).find((f) => f.startsWith('cdkt-prerestore-cdkt_admin-'))
    assert.ok(pre, 'no pre-restore dump was kept')
    assert.ok(!/^cdkt-cdkt_admin-/.test(pre), 'it would be rotated away by backup-db.sh')
    // The dump itself reached mysql, unmodified.
    const stdin = readdirSync(sb.dir).find((f) => f.startsWith('mysql.stdin.'))!
    assert.equal(readFileSync(sb.path(stdin), 'utf8'), dump)
    // Secret handling.
    assert.ok(!log.join('\n').includes(SECRET), 'password in a docker argv')
    assert.ok(sb.dockerPwd().filter((p, i) => log[i].startsWith('exec')).every((p) => p === SECRET))
    assert.match(r.stdout, /"event":"restore_db.succeeded"/)
  } finally {
    cleanup(sb)
  }
})

test('restore-db refuses without a target database name, without --replace, or with a bad name', () => {
  const { sb, file } = dbSandbox()
  try {
    for (const [args, message] of [
      [[file], /usage/],
      [[file, 'cdkt_admin'], /--replace/],
      [[file, 'cdkt_admin; DROP DATABASE mysql', '--replace'], /\[A-Za-z0-9_\]/],
      [['/nonexistent.sql.gz', 'cdkt_admin', '--replace'], /no such file/],
    ] as const) {
      const r = sb.run('scripts/restore-db.sh', [...args])
      assert.equal(r.status, 1, `${args.join(' ')} → ${r.stdout}${r.stderr}`)
      assert.match(r.stderr, message)
    }
    assert.equal(sb.dockerLog().length, 0, 'docker must not even be consulted')
  } finally {
    cleanup(sb)
  }
})

test('restore-db refuses a dump that is truncated, too small, or picks its own database', () => {
  const { sb } = dbSandbox()
  try {
    const tables = Array.from({ length: 25 }, (_, i) => `CREATE TABLE t${i} (id int);`).join('\n')
    const cases: Array<[string, string, RegExp]> = [
      ['truncated', `${tables}\n`, /truncated/],
      ['few tables', 'CREATE TABLE a (id int);\n-- Dump completed on x\n', /only 1 tables/],
      ['USE statement', `USE \`other_db\`;\n${tables}\n-- Dump completed on x\n`, /selects its own database/],
      ['CREATE DATABASE', `CREATE DATABASE other_db;\n${tables}\n-- Dump completed on x\n`, /selects its own database/],
    ]
    for (const [label, body, message] of cases) {
      const f = gzipTo(sb, label.replace(/\W/g, '_'), body)
      const r = sb.run('scripts/restore-db.sh', [f, 'cdkt_admin', '--replace'])
      assert.equal(r.status, 2, `${label}: ${r.stdout}${r.stderr}`)
      assert.match(r.stderr, message, label)
    }
    assert.ok(!readdirSync(sb.dir).some((f) => f.startsWith('mysql.stdin.')), 'a refused dump reached mysql')
    const corrupt = sb.path('backups/corrupt.sql.gz')
    writeFileSync(corrupt, 'not gzip')
    assert.equal(sb.run('scripts/restore-db.sh', [corrupt, 'cdkt_admin', '--replace']).status, 2)
  } finally {
    cleanup(sb)
  }
})

test('restore-db refuses while the app runs, or when the target database does not exist', () => {
  const { sb, file } = dbSandbox()
  try {
    const running = sb.run('scripts/restore-db.sh', [file, 'cdkt_admin', '--replace'], { env: { FAKE_APP_RUNNING: '1' } })
    assert.equal(running.status, 2)
    assert.match(running.stderr, /docker compose stop app/)
    const missing = sb.run('scripts/restore-db.sh', [file, 'cdkt_adnim', '--replace'], { env: { FAKE_DB_EXISTS: '0' } })
    assert.equal(missing.status, 2)
    assert.match(missing.stderr, /does not exist/)
    assert.ok(!readdirSync(sb.dir).some((f) => f.startsWith('mysql.stdin.')))
    assert.ok(!sb.dockerLog().some((l) => l.includes(' mysqldump ')), 'nothing to dump when refusing')
  } finally {
    cleanup(sb)
  }
})

test('restore-db restores nothing if the pre-restore dump cannot be taken (exit 3)', () => {
  const { sb, file } = dbSandbox()
  try {
    const r = sb.run('scripts/restore-db.sh', [file, 'cdkt_admin', '--replace'], { env: { FAKE_MYSQLDUMP_FAIL: '1' } })
    assert.equal(r.status, 3, r.stdout + r.stderr)
    assert.match(r.stderr, /nothing was restored/)
    assert.ok(!readdirSync(sb.dir).some((f) => f.startsWith('mysql.stdin.')), 'restore ran without a safety dump')
    assert.ok(readdirSync(sb.path('backups')).every((f) => !f.startsWith('cdkt-prerestore-')), 'a partial pre-dump was left behind')

    // A pre-dump without its completion marker is a failure too.
    const truncated = sb.run('scripts/restore-db.sh', [file, 'cdkt_admin', '--replace'], { env: { FAKE_DUMP_TRUNCATED: '1' } })
    assert.equal(truncated.status, 3)
    assert.ok(!readdirSync(sb.dir).some((f) => f.startsWith('mysql.stdin.')))
  } finally {
    cleanup(sb)
  }
})

test('restore-db into an empty database skips the pre-dump (fresh host) and still restores', () => {
  const { sb, file } = dbSandbox()
  try {
    const r = sb.run('scripts/restore-db.sh', [file, 'cdkt_admin', '--replace'], { env: { FAKE_TABLE_COUNT: '0' } })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /pre_dump_skipped/)
    assert.ok(!sb.dockerLog().some((l) => l.includes(' mysqldump ')))
    assert.ok(readdirSync(sb.dir).some((f) => f.startsWith('mysql.stdin.')))
  } finally {
    cleanup(sb)
  }
})

test('restore-db reports a failed restore as exit 4 and points at the pre-restore dump', () => {
  const { sb, file } = dbSandbox()
  try {
    const r = sb.run('scripts/restore-db.sh', [file, 'cdkt_admin', '--replace'], { env: { FAKE_MYSQL_RC: '1' } })
    assert.equal(r.status, 4, r.stdout + r.stderr)
    assert.match(r.stderr, /cdkt-prerestore-cdkt_admin-/)
  } finally {
    cleanup(sb)
  }
})

// ─── MYSQL_PWD by name in the existing scripts ───────────────────────────────
test('backup-db.sh and verify-restore.sh pass the root password by environment, not in the docker argv', () => {
  const { sb, file } = dbSandbox()
  try {
    const backup = sb.run('scripts/backup-db.sh', [sb.path('backups')], { env: { BACKUP_STAMP: '20261013T020000Z' } })
    assert.equal(backup.status, 0, backup.stdout + backup.stderr)
    const verify = sb.run('scripts/verify-restore.sh', [file], { env: { FAKE_RESTORED_TABLES: '62' } })
    assert.equal(verify.status, 0, verify.stdout + verify.stderr)
    const log = sb.dockerLog()
    assert.ok(log.some((l) => l.includes(' mysqldump ')) && log.some((l) => l.includes('CREATE DATABASE')))
    assert.ok(!log.join('\n').includes(SECRET), 'password found in a docker argv')
    const pwds = sb.dockerPwd()
    log.forEach((l, i) => {
      if (l.startsWith('exec')) {
        assert.match(l, /-e MYSQL_PWD /)
        assert.equal(pwds[i], SECRET)
      }
    })
  } finally {
    cleanup(sb)
  }
})
