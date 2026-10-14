import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * The CI step "No accidental UTC date usage outside analytics" — run for real.
 *
 * The step greps `server/` for `getUTC*`/`utcDay`: scheduler and retention code must
 * compare LOCAL days (a UTC comparison skips the nightly pass at UTC+7). Analytics is
 * UTC on purpose, and so is `server/utils/utc-query.ts` — the adapter that formats
 * `Date` parameters as UTC for the analytics tables. Without an exemption for that one
 * file the step goes red on a correct tree; with a loose one (a substring match) any
 * file called `utc-query.ts` anywhere would slip through.
 *
 * This test reads the step's `run` script out of ci.yml (as YAML, like GitHub does)
 * and executes it with bash in throw-away fixture trees, so the assertion is about the
 * script CI actually runs, not about how it is spelled.
 */

const ROOT = new URL('..', import.meta.url).pathname
const STEP_NAME = 'No accidental UTC date usage outside analytics'

async function stepScript(): Promise<string> {
  const { default: yaml } = await import('js-yaml')
  const ci = yaml.load(readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8')) as { jobs: Record<string, { steps?: Array<{ name?: string, run?: string }> }> }
  const matches = Object.values(ci.jobs).flatMap(job => job.steps ?? []).filter(step => step.name === STEP_NAME)
  assert.equal(matches.length, 1, `exactly one CI step named "${STEP_NAME}"`)
  assert.equal(typeof matches[0]!.run, 'string')
  return matches[0]!.run!
}

/** Run the step in a fixture tree holding `files` (path → content); GitHub's bash flags. */
async function runStep(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'cdkt-ci-utc-'))
  try {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), content)
    }
    const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', await stepScript()], { cwd: dir, encoding: 'utf8' })
    return { status: r.status, output: `${r.stdout}${r.stderr}` }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const adapter = readFileSync(join(ROOT, 'server/utils/utc-query.ts'), 'utf8')
const violation = 'export const day = (d: Date) => d.getUTCDate()\n'
const clean = 'export const day = (d: Date) => d.getDate()\n'

test('the real utc-query adapter does not trip the step (exempt by exact path)', async () => {
  assert.match(adapter, /getUTC/, 'fixture premise: the adapter really uses getUTC*')
  const r = await runStep({
    'server/utils/utc-query.ts': adapter,
    'server/services/analytics-noc.ts': violation, // analytics/* stays exempt
    'server/services/data-retention.ts': clean,
  })
  assert.equal(r.status, 0, r.output)
})

test('getUTC* in any other server file still fails the step', async () => {
  const r = await runStep({
    'server/utils/utc-query.ts': adapter,
    'server/utils/foo.ts': violation,
  })
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /server\/utils\/foo\.ts/)
  assert.doesNotMatch(r.output, /server\/utils\/utc-query\.ts/, 'the exempt file is not reported')
})

test('the exemption is anchored: a utc-query.ts in another directory is still checked', async () => {
  const r = await runStep({ 'server/services/utc-query.ts': adapter })
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /server\/services\/utc-query\.ts/)
})

test('utcDay outside analytics still fails the step', async () => {
  const r = await runStep({ 'server/plugins/retention-scheduler.ts': 'const x = utcDay(new Date())\n' })
  assert.equal(r.status, 1, r.output)
})
