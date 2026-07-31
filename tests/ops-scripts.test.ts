import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, statSync } from 'node:fs'

/**
 * The operational scripts and the CI definition. They are not imported by the
 * app, so nothing else would notice them rotting.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// ─── Backup ──────────────────────────────────────────────────────────────────
test('the backup script is executable and fails loudly', () => {
  const mode = statSync(new URL('../scripts/backup-db.sh', import.meta.url)).mode
  assert.ok(mode & 0o111, 'scripts/backup-db.sh is not executable, so cron cannot run it')
  assert.match(read('scripts/backup-db.sh'), /set -Eeuo pipefail/)
})

test('a backup is verified before it is trusted', () => {
  const script = read('scripts/backup-db.sh')
  // A dump that fails halfway leaves a plausible-looking file behind.
  assert.match(script, /Dump completed/, 'no completion marker check — a truncated dump would pass')
  assert.match(script, /gzip -t/, 'the archive is never integrity-checked')
  assert.match(script, /CREATE TABLE/, 'the table count is never checked')
  assert.match(script, /PLAIN_BYTES.*-ge/s, 'no size floor')
})

test('a rejected backup is deleted, not left looking valid', () => {
  // Found by running the script against a stubbed docker: a failed verification
  // used to leave the bad archive in the backup directory.
  assert.match(read('scripts/backup-db.sh'), /"\$1" == "verify".*rm -f "\$TARGET"/s)
})

test('the size floor is measured on the SQL, not on the compressed archive', () => {
  // Also found by running it: a highly repetitive dump compresses so well that a
  // threshold on the .gz size rejects a perfectly good backup.
  const script = read('scripts/backup-db.sh')
  assert.match(script, /PLAIN_BYTES="\$\(gzip -dc "\$TARGET" \| wc -c/)
  assert.doesNotMatch(script, /\[\[ "\$BYTES" -ge/, 'the floor is back on the compressed size')
})

test('two runs in the same second cannot collide', () => {
  assert.match(read('scripts/backup-db.sh'), /\$STAMP-\$\$\.sql\.gz/)
})

test('the database password never reaches the process list', () => {
  const script = read('scripts/backup-db.sh')
  assert.match(script, /-e MYSQL_PWD="\$MYSQL_ROOT_PASSWORD"/)
  // `-p<password>` on the command line is readable via `ps` by every local user.
  assert.doesNotMatch(script, /-p\$\{?MYSQL_ROOT_PASSWORD/)
})

test('the dump is consistent and complete', () => {
  const script = read('scripts/backup-db.sh')
  for (const flag of ['--single-transaction', '--routines', '--triggers', '--events']) {
    assert.ok(script.includes(flag), `mysqldump is missing ${flag}`)
  }
})

test('old backups are rotated rather than accumulating forever', () => {
  assert.match(read('scripts/backup-db.sh'), /-mtime "\+\$KEEP_DAYS"/)
})

// ─── Restore verification ────────────────────────────────────────────────────
test('the restore check never touches the live database', () => {
  const script = read('scripts/verify-restore.sh')
  assert.match(script, /SCRATCH="cdkt_restore_check_\$\$"/)
  assert.match(script, /refusing to use the live database as scratch/)
  assert.match(script, /DROP DATABASE IF EXISTS/)
  assert.match(script, /trap cleanup EXIT/, 'the scratch database survives an early exit')
})

test('backups are not committed to the repository', () => {
  assert.match(read('.gitignore'), /^backups\/$/m)
})

// ─── CI ──────────────────────────────────────────────────────────────────────
test('CI runs the tests, the drift check and a real build', () => {
  const workflow = read('.github/workflows/ci.yml')
  assert.match(workflow, /run: npm test/)
  assert.match(workflow, /run: npm run db:drift/)
  assert.match(workflow, /run: npm run build/)
  assert.match(workflow, /on:\s*\n\s*push:/)
})

test('the build job supplies the secret nuxt.config demands in production', () => {
  // `nuxt build` forces NODE_ENV=production, and the config throws without it.
  // Without this the build job would fail on every run.
  const workflow = read('.github/workflows/ci.yml')
  const secret = /ANALYTICS_HMAC_SECRET: (\S+)/.exec(workflow)?.[1] ?? ''
  assert.ok(secret.length >= 32, `the CI placeholder is ${secret.length} characters; the config requires 32`)
  assert.match(secret, /placeholder|not-a-real/, 'the CI value does not read as a throwaway')
})

test('CI refuses a committed .env or a known-default secret', () => {
  const workflow = read('.github/workflows/ci.yml')
  assert.match(workflow, /git ls-files --error-unmatch \.env/)
  // The grep pattern in ci.yml brackets its final character (change_m[e]) so
  // the pattern line does not match itself; the assertion mirrors that form.
  assert.match(workflow, /cdkt_admin_secret_change_m\[e\]/)
  assert.match(workflow, /PRIVATE KEY/)
})

// ─── Deploy ──────────────────────────────────────────────────────────────────
test('nothing reaches the VPS without passing every gate first', () => {
  const workflow = read('.github/workflows/ci.yml')
  // The image job depends on all four gates, and deploy depends on the image
  // job. Drop one name here and a commit that fails typecheck ships anyway.
  const imageNeeds = /image:\s*\n[\s\S]*?needs: \[([^\]]+)\]/.exec(workflow)?.[1] ?? ''
  for (const gate of ['test', 'typecheck', 'build', 'hygiene']) {
    assert.ok(imageNeeds.includes(gate), `the image job does not wait for the ${gate} job`)
  }
  assert.match(workflow, /deploy:\s*\n[\s\S]*?needs: image/, 'deploy does not wait for the image')
  // Deploying a pull request would push a fork's code onto the server.
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main' && github\.event_name != 'pull_request'/)
})

test('the deployed image is pinned to a commit, not to a moving tag', () => {
  const workflow = read('.github/workflows/ci.yml')
  // `latest` can move between the image job finishing and the deploy starting,
  // and it is useless for rolling back.
  assert.match(workflow, /image=ghcr\.io\/\$repo:sha-\$\{\{ github\.sha \}\}/)
  assert.match(workflow, /IMAGE: \$\{\{ needs\.image\.outputs\.image \}\}/)
})

test('the SSH host key is pinned rather than accepted on sight', () => {
  const workflow = read('.github/workflows/ci.yml')
  // ssh-keyscan at run time trusts whoever answers, on every run — which is the
  // one party that must not be trusted, since they would receive the session.
  assert.match(workflow, /StrictHostKeyChecking=yes/)
  // Only as a command — the comment above it names ssh-keyscan to explain why
  // the key is pinned instead.
  assert.doesNotMatch(workflow, /^(?!\s*#).*ssh-keyscan/m, 'the host key is discovered instead of pinned')
  assert.match(workflow, /SSH_KNOWN_HOSTS: \$\{\{ secrets\.VPS_SSH_KNOWN_HOSTS \}\}/)
})

test('a deploy run is never cancelled halfway through', () => {
  const workflow = read('.github/workflows/ci.yml')
  // The workflow-level group sets cancel-in-progress, which is right for tests
  // and wrong here: a cancelled deploy leaves .env pointing at an image the
  // running container is not using.
  const deploy = workflow.slice(workflow.indexOf('\n  deploy:'))
  assert.match(deploy, /group: deploy-production/)
  assert.match(deploy, /cancel-in-progress: false/)
})

test('the remote deploy script is executable and fails loudly', () => {
  const mode = statSync(new URL('../scripts/deploy-remote.sh', import.meta.url)).mode
  assert.ok(mode & 0o111, 'scripts/deploy-remote.sh is not executable')
  assert.match(read('scripts/deploy-remote.sh'), /set -euo pipefail/)
})

test('the deploy verifies the new container instead of assuming it started', () => {
  const script = read('scripts/deploy-remote.sh')
  // `docker compose up -d` returns as soon as the container is created, long
  // before the app has connected to MySQL or answered a request.
  assert.match(script, /State\.Health\.Status/)
  assert.match(script, /wait_healthy/)
  // A missing HEALTHCHECK means we are looking at the wrong image; it must not
  // read as success.
  assert.match(script, /none\)[\s\S]*?return 1/, 'a container without a healthcheck passes silently')
})

test('a failed deploy rolls back to the image that was running', () => {
  const script = read('scripts/deploy-remote.sh')
  assert.match(script, /PREVIOUS=\$\(current_image\)/)
  assert.match(script, /set_image "\$PREVIOUS"/)
  // The first deploy has nothing to roll back to; saying so beats a confusing
  // failure inside the rollback path.
  assert.match(script, /không có image trước đó để lùi về/)
  // Every exit from the failure path is non-zero, including the one where the
  // rollback succeeded — the commit did not ship.
  assert.match(script, /exit 1\s*$/m)
})

test('the deploy pulls before it touches .env', () => {
  const script = read('scripts/deploy-remote.sh')
  // A bad tag or an unreachable registry must leave the running deployment
  // untouched, so the pull has to come first.
  assert.ok(
    script.indexOf('docker pull') < script.indexOf('set_image "$IMAGE"'),
    'the image reference is written before the image is known to exist',
  )
})

test('rewriting .env cannot truncate it or widen its permissions', () => {
  const script = read('scripts/deploy-remote.sh')
  // .env holds JWT_SECRET and the database password. An interrupted rewrite
  // that leaves a half-file takes the site down and loses secrets.
  assert.match(script, /mktemp/)
  assert.match(script, /mv "\$TMP_ENV" \.env/)
  // A fresh temp file is world-readable by default; the copy carries the
  // original owner and mode across.
  assert.match(script, /cp -p \.env "\$TMP_ENV"/)
})

test('compose can pull a prebuilt image and still build locally', () => {
  const compose = read('docker-compose.yml')
  // `docker compose pull` does nothing for a service that only declares build:.
  assert.match(compose, /image: \$\{CDKT_IMAGE:-cdkt\/app:local\}/)
  // The local default keeps `docker compose build` working for development.
  assert.match(compose, /build:\s*\n\s*context: \./)
})
