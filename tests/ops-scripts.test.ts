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
