/**
 * `scripts/deploy-remote.sh`, RUN — not read.
 *
 * The script runs on the production VPS on every merge to `main`, with nobody
 * watching. `tests/ops-scripts.test.ts` pins its shape by reading source text;
 * that proves a line exists, not that the order of operations does what the
 * comments promise. Here the real script is fed to `bash -s` exactly the way
 * the CI deploy job feeds it over SSH, in a throwaway app directory, with a fake
 * `docker` first on PATH. The fake logs every call together with the image that
 * `.env` names and the SHA-256 of `docker-compose.yml` AT THAT MOMENT, so each
 * test can say which compose file and which image a container was started on.
 *
 * What each case pins, in the words of the failure it prevents:
 *   - a compose file the VPS cannot read never reaches a running container, and
 *     `.env` is left byte-identical;
 *   - a compose file cut short in transit is refused before anything is pulled;
 *   - a failed deploy rolls back the image AND the compose file together;
 *   - a failing `docker compose up` goes through the rollback instead of exiting
 *     under `set -e` with `.env` pointing at the new image;
 *   - the database container is never recreated by an app deploy;
 *   - a verified database dump is taken before anything on the server changes,
 *     and a failed dump stops the deploy with compose, `.env` and the container
 *     untouched (Wave 1 · D26);
 *   - a container that crash-loops fails the wait within three polls instead of
 *     after the full health timeout (D29);
 *   - after a healthy deploy, old app images are removed by tag — the running one
 *     and the 5 newest others stay — and a nearly full Docker disk is reported,
 *     without either chore ever failing a deploy that succeeded (D31);
 *   - the uploads volume is chowned only when its root is not node's (D32).
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'

const SCRIPT = readFileSync(new URL('../scripts/deploy-remote.sh', import.meta.url), 'utf8')
const BACKUP_SCRIPT = readFileSync(new URL('../scripts/backup-db.sh', import.meta.url), 'utf8')

const OLD_IMAGE = 'ghcr.io/owner/repo:sha-old'
const NEW_IMAGE = 'ghcr.io/owner/repo:sha-new'
const OLD_COMPOSE = 'services:\n  app:\n    image: ${CDKT_IMAGE}\n# old\n'
const NEW_COMPOSE = 'services:\n  app:\n    image: ${CDKT_IMAGE}\n    environment:\n      TZ: Asia/Ho_Chi_Minh\n# new\n'
const ENV_FILE = `JWT_SECRET=keep-this-secret\nMYSQL_ROOT_PASSWORD=fixture-root-pw\nTRUSTED_PROXY_IPS=172.16.0.0/12\nCDKT_IMAGE=${OLD_IMAGE}\n`
const INCOMING = '.docker-compose.incoming.yml'
const INCOMING_BACKUP = '.deploy-incoming/backup-db.sh'
const DUMP_DIR = '.deploy-db-backups'

/**
 * Fake `docker` (tests/fixtures/deploy-remote/docker). Every call appends one line:
 *   <args> | image=<CDKT_IMAGE in .env> | compose=<sha256 of docker-compose.yml>
 * Outcomes are scripted through FAKE_* variables listed in that file; the default
 * is "everything works and the container is healthy".
 */
const FAKE_DOCKER = new URL('./fixtures/deploy-remote/docker', import.meta.url)

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

interface Fixture {
  dir: string
  log: string
  bin: string
}

const fixtures: string[] = []

afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function makeFixture(options: { compose?: string | null; incoming?: string | null; backupScript?: string | null } = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'cdkt-deploy-remote-'))
  fixtures.push(root)
  const dir = join(root, 'app')
  const bin = join(root, 'bin')
  mkdirSync(dir)
  mkdirSync(bin)
  copyFileSync(FAKE_DOCKER, join(bin, 'docker'))
  chmodSync(join(bin, 'docker'), 0o755)
  writeFileSync(join(dir, '.env'), ENV_FILE)
  chmodSync(join(dir, '.env'), 0o600)
  const compose = options.compose === undefined ? OLD_COMPOSE : options.compose
  if (compose !== null) writeFileSync(join(dir, 'docker-compose.yml'), compose)
  const incoming = options.incoming === undefined ? NEW_COMPOSE : options.incoming
  if (incoming !== null) writeFileSync(join(dir, INCOMING), incoming)
  // The VPS checkout's own copy (used by a manual run) and the copy CI ships.
  mkdirSync(join(dir, 'scripts'))
  writeFileSync(join(dir, 'scripts', 'backup-db.sh'), BACKUP_SCRIPT)
  chmodSync(join(dir, 'scripts', 'backup-db.sh'), 0o755)
  const backupScript = options.backupScript === undefined ? BACKUP_SCRIPT : options.backupScript
  if (backupScript !== null) {
    mkdirSync(join(dir, '.deploy-incoming'))
    writeFileSync(join(dir, INCOMING_BACKUP), backupScript)
  }
  return { dir, log: join(root, 'docker.log'), bin }
}

function runDeploy(fx: Fixture, env: Record<string, string> = {}, timeout = 60_000) {
  // Same invocation as the CI deploy job: the script arrives on stdin.
  const result = spawnSync('bash', ['-s', '--', fx.dir, NEW_IMAGE], {
    input: SCRIPT,
    encoding: 'utf8',
    timeout,
    env: {
      PATH: `${fx.bin}:${process.env.PATH ?? ''}`,
      HOME: process.env.HOME ?? fx.dir,
      FAKE_DOCKER_LOG: fx.log,
      ...env,
    },
  })
  const calls = existsSync(fx.log) ? readFileSync(fx.log, 'utf8').trim().split('\n').filter(Boolean) : []
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, calls }
}

/** What the CI deploy job sets: the shipped compose and the shipped backup script, each with its SHA-256. */
const shipped = (incoming = NEW_COMPOSE, backupScript = BACKUP_SCRIPT) => ({
  INCOMING_COMPOSE: INCOMING,
  INCOMING_COMPOSE_SHA256: sha256(incoming),
  INCOMING_BACKUP_SCRIPT: INCOMING_BACKUP,
  INCOMING_BACKUP_SCRIPT_SHA256: sha256(backupScript),
})
const dumpsIn = (fx: Fixture) => {
  const dir = join(fx.dir, DUMP_DIR)
  return existsSync(dir) ? readdirSync(dir).sort() : []
}

const file = (fx: Fixture, name: string) => readFileSync(join(fx.dir, name), 'utf8')
const backups = (fx: Fixture) => {
  const dir = join(fx.dir, '.deploy-compose-backups')
  return existsSync(dir) ? readdirSync(dir).sort() : []
}
const ups = (calls: string[]) => calls.filter((c) => c.startsWith('compose up'))

describe('deploy-remote.sh — the compose file travels with the image', () => {
  it('installs the shipped compose, keeps a backup, and starts only the app on it', () => {
    const fx = makeFixture()
    chmodSync(join(fx.dir, 'docker-compose.yml'), 0o640)
    const run = runDeploy(fx, shipped())

    assert.equal(run.status, 0, run.stderr)
    assert.equal(file(fx, 'docker-compose.yml'), NEW_COMPOSE)
    // The replaced file keeps the mode of the one it replaced.
    assert.equal(statSync(join(fx.dir, 'docker-compose.yml')).mode & 0o777, 0o640)
    const saved = backups(fx)
    assert.equal(saved.length, 1)
    assert.equal(readFileSync(join(fx.dir, '.deploy-compose-backups', saved[0]!), 'utf8'), OLD_COMPOSE)
    assert.equal(existsSync(join(fx.dir, INCOMING)), false, 'the shipped temp file was left behind')

    const env = file(fx, '.env')
    assert.match(env, new RegExp(`^CDKT_IMAGE=${NEW_IMAGE}$`, 'm'))
    assert.match(env, /^JWT_SECRET=keep-this-secret$/m)

    // Pull first, validate the compose second, start third.
    const pull = run.calls.findIndex((c) => c.startsWith(`pull ${NEW_IMAGE}`))
    const config = run.calls.findIndex((c) => c.startsWith('compose config -q'))
    assert.ok(pull >= 0 && config > pull, `pull must come before validation:\n${run.calls.join('\n')}`)
    assert.ok(run.calls[config]!.endsWith(`compose=${sha256(NEW_COMPOSE)}`), 'validation did not see the new compose')

    const app = ups(run.calls).find((c) => c.startsWith('compose up -d --no-deps app'))
    assert.ok(app, 'the app was not started with --no-deps')
    assert.ok(app.includes(`image=${NEW_IMAGE}`) && app.endsWith(`compose=${sha256(NEW_COMPOSE)}`))
    // The database is started if stopped, never recreated by an app deploy.
    for (const up of ups(run.calls)) {
      assert.ok(
        up.startsWith('compose up -d --no-deps app') || up.startsWith('compose up -d --no-recreate mysql'),
        `unexpected compose up: ${up}`,
      )
    }
  })

  it('refuses a compose the VPS cannot read, touching neither .env nor any container', () => {
    const broken = `${NEW_COMPOSE}# INVALID_COMPOSE\n`
    const fx = makeFixture({ incoming: broken })
    const run = runDeploy(fx, shipped(broken))

    assert.notEqual(run.status, 0)
    assert.equal(file(fx, 'docker-compose.yml'), OLD_COMPOSE, 'the previous compose was not restored')
    assert.equal(file(fx, '.env'), ENV_FILE, '.env changed although the deploy was refused')
    assert.deepEqual(ups(run.calls), [], 'a container was (re)started on a compose that failed validation')
    assert.match(run.stderr, /docker compose config/)
  })

  it('refuses a compose cut short in transit before pulling anything', () => {
    const fx = makeFixture({ incoming: NEW_COMPOSE.slice(0, 30) })
    const run = runDeploy(fx, shipped(NEW_COMPOSE))

    assert.notEqual(run.status, 0)
    assert.deepEqual(run.calls, [], 'docker was called for a corrupted transfer')
    assert.equal(file(fx, 'docker-compose.yml'), OLD_COMPOSE)
    assert.equal(file(fx, '.env'), ENV_FILE)
    assert.match(run.stderr, /sha256/)
  })

  it('will not trust a shipped compose that comes without its checksum', () => {
    const fx = makeFixture()
    const run = runDeploy(fx, { INCOMING_COMPOSE: INCOMING })

    assert.notEqual(run.status, 0)
    assert.deepEqual(run.calls, [])
    assert.equal(file(fx, 'docker-compose.yml'), OLD_COMPOSE)
  })

  it('a missing shipped file is an error, not a silent "keep the old one"', () => {
    const fx = makeFixture({ incoming: null })
    const run = runDeploy(fx, shipped())

    assert.notEqual(run.status, 0)
    assert.deepEqual(run.calls, [])
  })

  it('a wrong app directory (no .env) stops at once and leaves no shipped file behind', () => {
    const fx = makeFixture()
    rmSync(join(fx.dir, '.env'))
    const run = runDeploy(fx, shipped())

    assert.notEqual(run.status, 0)
    assert.deepEqual(run.calls, [])
    assert.equal(file(fx, 'docker-compose.yml'), OLD_COMPOSE)
    assert.equal(existsSync(join(fx.dir, INCOMING)), false)
  })

  it('an identical compose is left alone and no backup is written', () => {
    const fx = makeFixture({ incoming: OLD_COMPOSE })
    const run = runDeploy(fx, shipped(OLD_COMPOSE))

    assert.equal(run.status, 0, run.stderr)
    assert.equal(file(fx, 'docker-compose.yml'), OLD_COMPOSE)
    assert.deepEqual(backups(fx), [])
  })

  it('a manual run without a shipped compose keeps the file on the server', () => {
    const fx = makeFixture({ incoming: null })
    const run = runDeploy(fx)

    assert.equal(run.status, 0, run.stderr)
    assert.equal(file(fx, 'docker-compose.yml'), OLD_COMPOSE)
    assert.match(run.stderr, /INCOMING_COMPOSE/)
  })

  it('keeps only the ten most recent compose backups', () => {
    const fx = makeFixture()
    const dir = join(fx.dir, '.deploy-compose-backups')
    mkdirSync(dir)
    for (let day = 10; day < 22; day++) {
      writeFileSync(join(dir, `docker-compose.200001${day}T000000Z.yml`), `old ${day}\n`)
    }
    const run = runDeploy(fx, shipped())

    assert.equal(run.status, 0, run.stderr)
    const left = backups(fx)
    assert.equal(left.length, 10)
    // The oldest go first; this run's own backup survives.
    assert.ok(!left.includes('docker-compose.20000110T000000Z.yml'))
    assert.ok(!left.includes('docker-compose.20000112T000000Z.yml'))
    assert.ok(left.includes('docker-compose.20000121T000000Z.yml'))
    assert.ok(left.some((name) => !name.startsWith('docker-compose.2000')), 'this run\'s backup was pruned')
  })
})

describe('deploy-remote.sh — rollback restores what was running', () => {
  it('an unhealthy image rolls back both the image and the compose file', () => {
    const fx = makeFixture()
    const run = runDeploy(fx, { ...shipped(), FAKE_UNHEALTHY_IMAGE: NEW_IMAGE })

    assert.equal(run.status, 1)
    assert.equal(file(fx, 'docker-compose.yml'), OLD_COMPOSE, 'the old image was restarted on the new compose')
    assert.match(file(fx, '.env'), new RegExp(`^CDKT_IMAGE=${OLD_IMAGE}$`, 'm'))
    const last = ups(run.calls).at(-1) ?? ''
    assert.ok(last.startsWith('compose up -d --no-deps app'))
    assert.ok(last.includes(`image=${OLD_IMAGE}`) && last.endsWith(`compose=${sha256(OLD_COMPOSE)}`),
      `the rollback did not start the previous image on the previous compose: ${last}`)
    assert.match(run.stderr, /đã lùi về/)
  })

  it('a failing `docker compose up` goes through the rollback instead of exiting mid-way', () => {
    const fx = makeFixture()
    const run = runDeploy(fx, { ...shipped(), FAKE_UP_FAIL_IMAGE: NEW_IMAGE })

    assert.equal(run.status, 1)
    assert.match(file(fx, '.env'), new RegExp(`^CDKT_IMAGE=${OLD_IMAGE}$`, 'm'),
      '.env still names the image that failed to start')
    assert.equal(file(fx, 'docker-compose.yml'), OLD_COMPOSE)
  })

  it('a failed pull leaves the deployment exactly as it was', () => {
    const fx = makeFixture()
    const run = runDeploy(fx, { ...shipped(), FAKE_PULL_FAIL: '1' })

    assert.notEqual(run.status, 0)
    assert.equal(file(fx, '.env'), ENV_FILE)
    assert.equal(file(fx, 'docker-compose.yml'), OLD_COMPOSE)
    assert.deepEqual(ups(run.calls), [])
    assert.equal(existsSync(join(fx.dir, INCOMING)), false)
    assert.equal(existsSync(join(fx.dir, INCOMING_BACKUP)), false, 'the shipped backup script was left behind')
  })
})

describe('deploy-remote.sh — a verified database dump comes first (D26)', () => {
  it('dumps after the pull and before the compose, .env or container are touched', () => {
    const fx = makeFixture()
    const run = runDeploy(fx, shipped())

    assert.equal(run.status, 0, run.stderr)
    const pull = run.calls.findIndex((c) => c.startsWith(`pull ${NEW_IMAGE}`))
    const dump = run.calls.findIndex((c) => / cdkt_mysql mysqldump /.test(c))
    const config = run.calls.findIndex((c) => c.startsWith('compose config -q'))
    const firstUp = run.calls.findIndex((c) => c.startsWith('compose up'))
    assert.ok(pull >= 0 && dump > pull, `the dump must follow the pull:\n${run.calls.join('\n')}`)
    assert.ok(config > dump && firstUp > dump, `the dump must precede every change:\n${run.calls.join('\n')}`)
    // Taken while the OLD compose and the OLD image were still in place.
    assert.ok(run.calls[dump]!.includes(`image=${OLD_IMAGE}`) && run.calls[dump]!.endsWith(`compose=${sha256(OLD_COMPOSE)}`))
    // The root password reaches docker by environment only.
    assert.ok(!run.calls.join('\n').includes('fixture-root-pw'), 'the database password is in a docker argv')

    const dumps = dumpsIn(fx)
    assert.equal(dumps.length, 1)
    assert.match(dumps[0]!, /^cdkt-predeploy-cdkt_admin-\d{8}T\d{6}Z-\d+\.sql\.gz$/)
    assert.equal(existsSync(join(fx.dir, INCOMING_BACKUP)), false, 'the shipped backup script was left behind')
    assert.match(run.stdout, /cdkt-predeploy-cdkt_admin-/, 'the deploy log does not say where the dump is')
  })

  it('a failed dump stops the deploy: compose, .env and the container stay exactly as they were', () => {
    const fx = makeFixture()
    const run = runDeploy(fx, { ...shipped(), FAKE_DUMP_FAIL: '1' })

    assert.notEqual(run.status, 0)
    assert.equal(file(fx, '.env'), ENV_FILE, '.env changed although the dump failed')
    assert.equal(file(fx, 'docker-compose.yml'), OLD_COMPOSE, 'the compose was replaced although the dump failed')
    assert.deepEqual(ups(run.calls), [], 'a container was (re)started after a failed dump')
    assert.ok(!run.calls.some((c) => c.startsWith('compose config')), 'the deploy carried on past the failed dump')
    assert.deepEqual(dumpsIn(fx), [], 'a rejected dump was left behind')
    assert.match(run.stderr, /sao lưu CSDL trước deploy thất bại/)
    assert.equal(existsSync(join(fx.dir, INCOMING)), false)
    assert.equal(existsSync(join(fx.dir, INCOMING_BACKUP)), false)
  })

  it('keeps the 5 newest pre-deploy dumps', () => {
    const fx = makeFixture()
    mkdirSync(join(fx.dir, DUMP_DIR))
    for (let day = 10; day < 17; day++) writeFileSync(join(fx.dir, DUMP_DIR, `cdkt-predeploy-cdkt_admin-200001${day}T000000Z-1.sql.gz`), 'old')
    const run = runDeploy(fx, shipped())

    assert.equal(run.status, 0, run.stderr)
    const left = dumpsIn(fx)
    assert.equal(left.length, 5, JSON.stringify(left))
    assert.ok(left.some((name) => !name.includes('T000000Z-1.')), 'this deploy\'s dump was rotated away')
  })

  it('refuses a backup script cut short in transit before pulling anything', () => {
    const fx = makeFixture({ backupScript: BACKUP_SCRIPT.slice(0, 200) })
    const run = runDeploy(fx, shipped())

    assert.notEqual(run.status, 0)
    assert.deepEqual(run.calls, [], 'docker was called for a corrupted transfer')
    assert.equal(file(fx, '.env'), ENV_FILE)
    assert.match(run.stderr, /sha256/)
  })

  it('a manual run uses the checkout\'s scripts/backup-db.sh, and stops if there is none', () => {
    const fx = makeFixture({ incoming: null, backupScript: null })
    const run = runDeploy(fx)
    assert.equal(run.status, 0, run.stderr)
    assert.equal(dumpsIn(fx).length, 1)

    const bare = makeFixture({ incoming: null, backupScript: null })
    rmSync(join(bare.dir, 'scripts'), { recursive: true })
    const refused = runDeploy(bare)
    assert.notEqual(refused.status, 0)
    assert.deepEqual(ups(refused.calls), [])
    assert.equal(file(bare, '.env'), ENV_FILE)
  })
})

describe('deploy-remote.sh — a crash-looping container fails fast (D29)', () => {
  it('stops waiting once the new container has restarted more than twice, then rolls back', () => {
    const fx = makeFixture()
    const started = Date.now()
    // 20 s cap: without the RestartCount check the wait polls every 5 s for 300 s.
    const run = runDeploy(fx, { ...shipped(), FAKE_RESTART_LOOP_IMAGE: NEW_IMAGE, CDKT_HEALTH_INTERVAL: '0' }, 20_000)

    assert.equal(run.status, 1, `the deploy did not fail fast (status ${run.status}) — still waiting out the health timeout?`)
    assert.ok(Date.now() - started < 20_000)
    const looks = run.calls.filter((c) => c.includes('RestartCount') && c.includes(`image=${NEW_IMAGE}`))
    assert.ok(looks.length <= 4, `RestartCount was read ${looks.length} times — more than 3 polls`)
    assert.match(run.stderr, /khởi động lại \d+ lần/, 'the crash loop is not named')
    assert.match(run.stderr, /fake container log/, 'the container log tail was not printed')
    // The existing rollback ran: previous image, previous compose.
    assert.match(file(fx, '.env'), new RegExp(`^CDKT_IMAGE=${OLD_IMAGE}$`, 'm'))
    assert.equal(file(fx, 'docker-compose.yml'), OLD_COMPOSE)
    assert.match(run.stderr, /đã lùi về/)
  })

  it('a RestartCount already high before this deploy is not mistaken for a crash loop', () => {
    // compose does not recreate an unchanged container, so its count can be days
    // old. Seven old restarts, four "starting" polls, then healthy: no rollback.
    const fx = makeFixture()
    const run = runDeploy(fx, { ...shipped(), FAKE_RESTART_BASE: '7', FAKE_STARTING_POLLS: '4', CDKT_HEALTH_INTERVAL: '0' })
    assert.equal(run.status, 0, run.stderr)
    assert.doesNotMatch(run.stderr, /crash loop/)
    assert.match(file(fx, '.env'), new RegExp(`^CDKT_IMAGE=${NEW_IMAGE}$`, 'm'))
  })
})

describe('deploy-remote.sh — housekeeping after a healthy deploy (D31, D32)', () => {
  const repo = 'ghcr.io/owner/repo'
  // 12 sha-* tags: the one just deployed (newest) and 11 older ones.
  const older = Array.from({ length: 11 }, (_, i) => String(i + 1).padStart(2, '0'))
  const images = [
    `${NEW_IMAGE}|2026-10-23T12:00:00.000000000Z|sha256:new`,
    `${repo}:latest|2026-10-23T12:00:00.000000000Z|sha256:new`,
    ...older.map((n) => `${repo}:sha-${n}|2026-10-${n}T00:00:00.000000000Z|sha256:id${n}`),
    `cdkt-rollback/app:20261001T000000Z|2026-09-01T00:00:00.000000000Z|sha256:rollback`,
  ].join(' ')

  it('keeps the running image and the 5 newest others; removes the rest by tag, never by force', () => {
    const fx = makeFixture()
    const run = runDeploy(fx, { ...shipped(), FAKE_IMAGES: images })

    assert.equal(run.status, 0, run.stderr)
    const removed = run.calls.filter((c) => c.startsWith('image rm')).map((c) => c.split(' | ')[0])
    assert.deepEqual(removed.sort(), ['01', '02', '03', '04', '05', '06'].map((n) => `image rm ${repo}:sha-${n}`),
      `6 should remain (running + sha-07…sha-11):\n${run.calls.join('\n')}`)
    assert.ok(!run.calls.some((c) => / -f |--force/.test(c) && c.startsWith('image rm')), 'an image was force-removed')
    assert.ok(!run.calls.some((c) => c.includes('rm') && c.includes('cdkt-rollback')), 'the manage.sh rollback image was touched')
    const lastRm = run.calls.map((c) => c.startsWith('image rm')).lastIndexOf(true)
    const prune = run.calls.findIndex((c) => c.startsWith('image prune -f'))
    assert.ok(prune > lastRm, 'dangling layers are not pruned after the tags are removed')
  })

  it('a failing image listing or disk check never fails a deploy that succeeded', () => {
    const fx = makeFixture()
    const run = runDeploy(fx, { ...shipped(), FAKE_IMAGES: images, FAKE_IMAGE_LS_FAIL: '1', FAKE_DOCKER_ROOT: '/nonexistent/docker-root' })
    assert.equal(run.status, 0, run.stderr)
  })

  it('warns when the Docker data filesystem is more than 80% full', () => {
    const fx = makeFixture()
    writeFileSync(join(fx.bin, 'df'), '#!/usr/bin/env bash\nprintf "Use%%\\n 91%%\\n"\n')
    chmodSync(join(fx.bin, 'df'), 0o755)
    const run = runDeploy(fx, { ...shipped(), FAKE_DOCKER_ROOT: '/var/lib/docker' })
    assert.equal(run.status, 0, run.stderr)
    assert.match(run.stdout + run.stderr, /::warning::[^\n]*91%/)

    const roomy = makeFixture()
    writeFileSync(join(roomy.bin, 'df'), '#!/usr/bin/env bash\nprintf "Use%%\\n 42%%\\n"\n')
    chmodSync(join(roomy.bin, 'df'), 0o755)
    const ok = runDeploy(roomy, shipped())
    assert.doesNotMatch(ok.stdout + ok.stderr, /42%/)
  })

  it('chowns the uploads volume only when its root is not owned by node', () => {
    const fx = makeFixture()
    const owned = runDeploy(fx, shipped())
    assert.equal(owned.status, 0, owned.stderr)
    assert.ok(owned.calls.some((c) => c.startsWith('exec cdkt_app stat -c %U /app/public/uploads')), 'the owner was never checked')
    assert.ok(!owned.calls.some((c) => c.includes('chown')), 'a node-owned uploads tree was chowned again')

    const rooted = makeFixture()
    const fixed = runDeploy(rooted, { ...shipped(), FAKE_UPLOADS_OWNER: 'root' })
    assert.equal(fixed.status, 0, fixed.stderr)
    assert.ok(fixed.calls.some((c) => c.startsWith('exec -u root cdkt_app chown -R node:node /app/public/uploads')), fixed.calls.join('\n'))
  })
})

describe('deploy-remote.sh — a git checkout on the VPS', () => {
  it('says how to unblock `git pull` once the tracked compose differs from HEAD', (t) => {
    const fx = makeFixture()
    const git = (...args: string[]) =>
      spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], {
        cwd: fx.dir,
        encoding: 'utf8',
      })
    if (git('init', '-q').status !== 0) {
      t.skip('git is not installed here')
      return
    }
    git('add', 'docker-compose.yml')
    git('commit', '-q', '-m', 'old compose')

    const run = runDeploy(fx, shipped())

    assert.equal(run.status, 0, run.stderr)
    assert.match(run.stdout, /git checkout -- docker-compose\.yml/)
  })
})

/**
 * wave2 D-LOG: compose sends the app's logs to journald. A VPS without
 * systemd-journald would fail EVERY deploy at `up` ("journald is not enabled on
 * this host") and roll back — so the deploy itself writes a marked
 * docker-compose.override.yml with rotated json-file logs, and removes its own file
 * again once journald is there. An override the operator wrote is never touched.
 */
describe('deploy-remote.sh — journald, or the json-file fallback (D-LOG)', () => {
  const OVERRIDE = 'docker-compose.override.yml'
  const withJournald = async (fx: Fixture, fn: (env: Record<string, string>) => void) => {
    // Both halves of the check: the socket Docker writes to, and journalctl to read it.
    writeFileSync(join(fx.bin, 'journalctl'), '#!/bin/sh\nexit 0\n')
    chmodSync(join(fx.bin, 'journalctl'), 0o755)
    const socket = join(fx.dir, '..', 'journal.sock')
    const server = createServer()
    await new Promise<void>(resolve => server.listen(socket, resolve))
    try {
      fn({ CDKT_JOURNALD_SOCKET: socket })
    } finally {
      await new Promise(resolve => server.close(resolve))
    }
  }
  const noJournald = (fx: Fixture) => ({ CDKT_JOURNALD_SOCKET: join(fx.dir, 'no-such-journal-socket') })
  /** A deploy removes the files CI shipped; a second deploy needs them shipped again. */
  const reship = (fx: Fixture) => {
    writeFileSync(join(fx.dir, INCOMING), NEW_COMPOSE)
    mkdirSync(join(fx.dir, '.deploy-incoming'), { recursive: true })
    writeFileSync(join(fx.dir, INCOMING_BACKUP), BACKUP_SCRIPT)
  }

  it('no journald: writes the marked json-file override before the app starts, and says so', () => {
    const fx = makeFixture()
    const run = runDeploy(fx, { ...shipped(), ...noJournald(fx) })

    assert.equal(run.status, 0, run.stderr)
    const override = file(fx, OVERRIDE)
    assert.match(override.split('\n')[0]!, /^# cdkt-log-fallback/)
    assert.match(override, /driver: json-file/)
    assert.match(override, /max-size: "10m"/)
    assert.match(run.stderr, /::warning::[^\n]*journald/)
    // It exists before the compose check and the start: both ran after it was written.
    assert.ok(run.calls.some(c => c.startsWith('compose config -q')))
    assert.ok(ups(run.calls).some(c => c.startsWith('compose up -d --no-deps app')))
  })

  it('a second run without journald leaves the same file (idempotent)', () => {
    const fx = makeFixture()
    runDeploy(fx, { ...shipped(), ...noJournald(fx) })
    const first = file(fx, OVERRIDE)
    reship(fx)
    const again = runDeploy(fx, { ...shipped(), ...noJournald(fx) })
    assert.equal(again.status, 0, again.stderr)
    assert.equal(file(fx, OVERRIDE), first)
  })

  it('an override the operator wrote is never overwritten — only a warning', () => {
    const fx = makeFixture()
    const own = 'services:\n  app:\n    environment:\n      EXTRA: "1"\n'
    writeFileSync(join(fx.dir, OVERRIDE), own)
    const run = runDeploy(fx, { ...shipped(), ...noJournald(fx) })
    assert.equal(run.status, 0, run.stderr)
    assert.equal(file(fx, OVERRIDE), own)
    assert.match(run.stderr, /không do script này sinh/)
  })

  it('journald present: nothing is written', async () => {
    const fx = makeFixture()
    await withJournald(fx, (env) => {
      const run = runDeploy(fx, { ...shipped(), ...env })
      assert.equal(run.status, 0, run.stderr)
      assert.equal(existsSync(join(fx.dir, OVERRIDE)), false)
    })
  })

  it('journald arrived: the deploy removes ITS fallback, and leaves an operator override alone', async () => {
    const ours = makeFixture()
    runDeploy(ours, { ...shipped(), ...noJournald(ours) })
    assert.ok(existsSync(join(ours.dir, OVERRIDE)))
    reship(ours)
    await withJournald(ours, (env) => {
      const run = runDeploy(ours, { ...shipped(), ...env })
      assert.equal(run.status, 0, run.stderr)
      assert.equal(existsSync(join(ours.dir, OVERRIDE)), false, 'the fallback outlived the reason for it')
      assert.match(run.stdout, /journald/)
    })

    const theirs = makeFixture()
    writeFileSync(join(theirs.dir, OVERRIDE), 'services: {}\n')
    await withJournald(theirs, (env) => {
      assert.equal(runDeploy(theirs, { ...shipped(), ...env }).status, 0)
      assert.equal(file(theirs, OVERRIDE), 'services: {}\n')
    })
  })

  it('a dump that fails stops the deploy before the fallback is written (nothing changes before the dump)', () => {
    const fx = makeFixture({ backupScript: '#!/usr/bin/env bash\nexit 2\n' })
    const run = runDeploy(fx, { ...shipped(undefined, '#!/usr/bin/env bash\nexit 2\n'), ...noJournald(fx) })
    assert.notEqual(run.status, 0)
    assert.equal(existsSync(join(fx.dir, OVERRIDE)), false)
  })
})
