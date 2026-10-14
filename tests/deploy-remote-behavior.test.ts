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
 *   - the database container is never recreated by an app deploy.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'

const SCRIPT = readFileSync(new URL('../scripts/deploy-remote.sh', import.meta.url), 'utf8')

const OLD_IMAGE = 'ghcr.io/owner/repo:sha-old'
const NEW_IMAGE = 'ghcr.io/owner/repo:sha-new'
const OLD_COMPOSE = 'services:\n  app:\n    image: ${CDKT_IMAGE}\n# old\n'
const NEW_COMPOSE = 'services:\n  app:\n    image: ${CDKT_IMAGE}\n    environment:\n      TZ: Asia/Ho_Chi_Minh\n# new\n'
const ENV_FILE = `JWT_SECRET=keep-this-secret\nTRUSTED_PROXY_IPS=172.16.0.0/12\nCDKT_IMAGE=${OLD_IMAGE}\n`
const INCOMING = '.docker-compose.incoming.yml'

/**
 * Fake `docker`. Every call appends one line:
 *   <args> | image=<CDKT_IMAGE in .env> | compose=<sha256 of docker-compose.yml>
 * Outcomes are scripted through FAKE_* variables; the default is "everything
 * works and the container is healthy".
 */
const FAKE_DOCKER = `#!/usr/bin/env bash
img=$(sed -n 's/^CDKT_IMAGE=//p' .env 2>/dev/null | tail -n 1)
sum=$(sha256sum docker-compose.yml 2>/dev/null | cut -d' ' -f1)
echo "$* | image=$img | compose=$sum" >> "$FAKE_DOCKER_LOG"
case "$1" in
  pull)
    [ "\${FAKE_PULL_FAIL:-}" = 1 ] && exit 1
    exit 0 ;;
  compose)
    case "$2" in
      config)
        if grep -q 'INVALID_COMPOSE' docker-compose.yml; then
          echo "service app: invalid" >&2
          exit 15
        fi
        exit 0 ;;
      up)
        if [ -n "\${FAKE_UP_FAIL_IMAGE:-}" ] && [ "$img" = "$FAKE_UP_FAIL_IMAGE" ]; then exit 1; fi
        exit 0 ;;
      *) exit 0 ;;
    esac ;;
  inspect)
    # "none" makes wait_healthy fail at once instead of polling for 300 s.
    if [ "$img" = "\${FAKE_UNHEALTHY_IMAGE:-}" ]; then echo none; else echo healthy; fi
    exit 0 ;;
  logs) echo "fake container log"; exit 0 ;;
  *) exit 0 ;;
esac
`

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

function makeFixture(options: { compose?: string | null; incoming?: string | null } = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'cdkt-deploy-remote-'))
  fixtures.push(root)
  const dir = join(root, 'app')
  const bin = join(root, 'bin')
  mkdirSync(dir)
  mkdirSync(bin)
  writeFileSync(join(bin, 'docker'), FAKE_DOCKER)
  chmodSync(join(bin, 'docker'), 0o755)
  writeFileSync(join(dir, '.env'), ENV_FILE)
  chmodSync(join(dir, '.env'), 0o600)
  const compose = options.compose === undefined ? OLD_COMPOSE : options.compose
  if (compose !== null) writeFileSync(join(dir, 'docker-compose.yml'), compose)
  const incoming = options.incoming === undefined ? NEW_COMPOSE : options.incoming
  if (incoming !== null) writeFileSync(join(dir, INCOMING), incoming)
  return { dir, log: join(root, 'docker.log'), bin }
}

function runDeploy(fx: Fixture, env: Record<string, string> = {}) {
  // Same invocation as the CI deploy job: the script arrives on stdin.
  const result = spawnSync('bash', ['-s', '--', fx.dir, NEW_IMAGE], {
    input: SCRIPT,
    encoding: 'utf8',
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

const shipped = (incoming = NEW_COMPOSE) => ({
  INCOMING_COMPOSE: INCOMING,
  INCOMING_COMPOSE_SHA256: sha256(incoming),
})

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
