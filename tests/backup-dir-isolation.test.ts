import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

/**
 * A test or dev server must never touch a real backup directory.
 *
 * The app's backup directory was always `<cwd>/backups`, and 1B added a cleanup
 * that deletes app-named backup files without a `backups` row (a run killed between
 * rename and commit). E2E and `nuxt dev` run with cwd = the checkout and a FRESH
 * database whose `backups` table is empty — so every local backup a developer kept
 * in `./backups` looked like an orphan: 60 s after the E2E server started, the
 * startup sweep would delete them all (found by the integration pass; one checkout
 * held 36 such files).
 *
 * Three layers, each tested here:
 *  1. `CDKT_BACKUPS_DIR` relocates the app's backup directory (one function,
 *     `backupsDir()`, is the only place that builds the path — grep guard below).
 *     Unset = `<cwd>/backups` = `/app/backups` in the container: production unchanged.
 *  2. The E2E harness gives every run its own temp directory and turns the backup
 *     scheduler off.
 *  3. The startup sweep only runs where the backup scheduler runs; a server whose
 *     switch is off sweeps nothing at boot (the per-run sweep inside `runBackup`
 *     stays — it only runs when someone starts a backup).
 */

const calls: string[] = []
mock.module('../server/services/backup-scheduler', {
  namedExports: {
    scheduleStartupBackupSweep: () => { calls.push('sweep') },
    startBackupScheduler: () => { calls.push('start') },
    stopBackupScheduler: () => { calls.push('stop') },
  },
})
const globals = globalThis as unknown as Record<string, unknown>
globals.defineNitroPlugin = (plugin: unknown) => plugin
type Plugin = (app: { hooks: { hook: (name: string, fn: unknown) => void } }) => void
const plugin = (await import('../server/plugins/backup-scheduler')).default as unknown as Plugin
const { backupsDir } = await import('../server/services/backup')

function withEnv<T>(env: Record<string, string | undefined>, run: () => T): T {
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    return run()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test('backupsDir() honours CDKT_BACKUPS_DIR, and defaults to <cwd>/backups', () => {
  assert.equal(withEnv({ CDKT_BACKUPS_DIR: '/tmp/cdkt-e2e-backups-x' }, backupsDir), '/tmp/cdkt-e2e-backups-x')
  assert.equal(withEnv({ CDKT_BACKUPS_DIR: 'relative/dir/' }, backupsDir), path.resolve(process.cwd(), 'relative/dir'))
  for (const unset of [undefined, '', '   ']) {
    assert.equal(withEnv({ CDKT_BACKUPS_DIR: unset }, backupsDir), path.resolve(process.cwd(), 'backups'), `CDKT_BACKUPS_DIR=${JSON.stringify(unset)}`)
  }
})

function boot(env: Record<string, string | undefined>): string[] {
  calls.length = 0
  const hooks: string[] = []
  withEnv(env, () => plugin({ hooks: { hook: (name: string) => { hooks.push(name) } } }))
  assert.deepEqual(hooks, ['close'], 'the close hook is registered on every branch')
  return [...calls]
}

test('the plugin schedules the startup sweep only where the backup scheduler runs', () => {
  for (const off of ['0', 'false', 'off', 'no']) {
    assert.deepEqual(boot({ NODE_ENV: 'production', BACKUP_SCHEDULER: off }), [], `BACKUP_SCHEDULER=${off} swept or started`)
  }
  assert.deepEqual(boot({ NODE_ENV: 'development', BACKUP_SCHEDULER: undefined }), [], 'dev default (off) swept or started')
  assert.deepEqual(boot({ NODE_ENV: 'production', BACKUP_SCHEDULER: undefined }), ['sweep', 'start'])
  assert.deepEqual(boot({ NODE_ENV: 'development', BACKUP_SCHEDULER: '1' }), ['sweep', 'start'])
})

test('the E2E harness gives the server its own temp backup directory, removes it, and turns the backup scheduler off', () => {
  const setup = readFileSync(new URL('./e2e/global-setup.ts', import.meta.url), 'utf8')
  assert.match(setup, /mkdtempSync\(path\.join\(tmpdir\(\), 'cdkt-e2e-backups-'\)\)/)
  assert.match(setup, /CDKT_BACKUPS_DIR: backupsDirForRun,/)
  assert.match(setup, /BACKUP_SCHEDULER: '0',/)
  assert.ok((setup.match(/rmSync\(backupsDirForRun, \{ recursive: true, force: true \}\)/g) ?? []).length >= 2, 'removed on teardown and when the server never came up')
  assert.doesNotMatch(setup, /Both schedulers off/, 'the comment still claims two schedulers')
})

test('no server code builds a backups path outside backupsDir()', () => {
  const offenders: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry)
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (!entry.endsWith('.ts')) continue
      readFileSync(full, 'utf8').split('\n').forEach((line, index) => {
        if (/^\s*(\/\/|\*)/.test(line)) return
        // A `backups` string literal or path segment (not the `backupsDir()` call itself).
        if (/['"`/]backups(['"`/]|$)/.test(line) && /(path\.(join|resolve)\(|process\.cwd\(\)|\bfs\.)/.test(line)) offenders.push(`${full}:${index + 1}: ${line.trim()}`)
      })
    }
  }
  walk(new URL('../server', import.meta.url).pathname)
  const backupTs = new URL('../server/services/backup.ts', import.meta.url).pathname
  const allowed = offenders.filter(line => line.startsWith(`${backupTs}:`) && /'backups'\)/.test(line) && /process\.cwd\(\)/.test(line))
  assert.equal(allowed.length, 1, `backupsDir() default not found exactly once:\n${offenders.join('\n')}`)
  assert.deepEqual(offenders.filter(line => !allowed.includes(line)), [], 'build the path with backupsDir()')
})
