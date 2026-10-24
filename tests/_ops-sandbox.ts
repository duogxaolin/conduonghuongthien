import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Throwaway sandbox for running production/manage.sh and scripts/*.sh against the
 * FAKE `docker`, `git` and `crontab` in tests/fixtures/ops-sandbox/. Nothing real is touched:
 * the scripts are copied into a temp directory whose bin/ comes first on PATH.
 * Shared by tests/ops-scripts-sandbox.test.ts and the hardening suites next to it.
 */

export const repoFile = (path: string) => new URL(`../${path}`, import.meta.url).pathname
/**
 * Where the scripts under test are copied from. Defaults to this checkout;
 * OPS_SANDBOX_SCRIPTS_ROOT points it at another tree (e.g. a copy of the previous
 * revision) to show a new test failing against the old scripts. The fakes always
 * come from this checkout.
 */
const scriptFile = (path: string) => (process.env.OPS_SANDBOX_SCRIPTS_ROOT ? join(process.env.OPS_SANDBOX_SCRIPTS_ROOT, path) : repoFile(path))
export const SCRIPTS = ['backup-db.sh', 'backup-media.sh', 'backup.sh', 'restore-media.sh', 'restore-db.sh', 'verify-restore.sh']
export const SECRET = 's3cret-ROOT-pw'

export interface Sandbox {
  dir: string
  path: (...parts: string[]) => string
  run: (script: string, args: string[], opts?: { input?: string; env?: Record<string, string> }) => { status: number; stdout: string; stderr: string }
  dockerLog: () => string[]
  dockerPwd: () => string[]
  env: () => string
}

export function makeSandbox(envFile?: string): Sandbox {
  const dir = mkdtempSync(join(tmpdir(), 'cdkt-ops-'))
  const path = (...parts: string[]) => join(dir, ...parts)
  mkdirSync(path('bin'))
  mkdirSync(path('scripts'))
  mkdirSync(path('production'))
  // `crontab` too: manage.sh "Cài cron sao lưu" must never edit the real user's crontab.
  for (const fake of ['docker', 'git', 'crontab']) {
    copyFileSync(repoFile(`tests/fixtures/ops-sandbox/${fake}`), path('bin', fake))
    chmodSync(path('bin', fake), 0o755)
  }
  for (const s of SCRIPTS) {
    copyFileSync(scriptFile(`scripts/${s}`), path('scripts', s))
    chmodSync(path('scripts', s), 0o755)
  }
  copyFileSync(scriptFile('production/manage.sh'), path('production', 'manage.sh'))
  chmodSync(path('production', 'manage.sh'), 0o755)
  if (envFile !== undefined) writeFileSync(path('.env'), envFile)
  const read = (file: string) => (existsSync(path(file)) ? readFileSync(path(file), 'utf8').split('\n').filter(Boolean) : [])
  return {
    dir,
    path,
    run(script, args, opts = {}) {
      const r = spawnSync('bash', [path(script), ...args], {
        cwd: dir,
        input: opts.input ?? '',
        encoding: 'utf8',
        env: {
          PATH: `${path('bin')}:${process.env.PATH ?? ''}`,
          HOME: dir,
          SANDBOX: dir,
          CDKT_HEALTH_TIMEOUT: '1',
          CDKT_HEALTH_INTERVAL: '0',
          ...opts.env,
        },
        timeout: 60_000,
        maxBuffer: 64 * 1024 * 1024,
      })
      return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr }
    },
    dockerLog: () => read('docker.log').map((l) => l.replace(/^\d+\t/, '')),
    dockerPwd: () => read('docker.pwd').map((l) => l.replace(/^\d+\t/, '')),
    env: () => readFileSync(path('.env'), 'utf8'),
  }
}

export const cleanup = (sb: Sandbox) => rmSync(sb.dir, { recursive: true, force: true })
export const envValue = (env: string, key: string) => env.split('\n').filter((l) => l.startsWith(`${key}=`)).pop()?.slice(key.length + 1)
export const lines = (...answers: string[]) => `${answers.join('\n')}\n`
