import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * The `changes` job's `deploy` output, RUN — not read.
 *
 * Every merge to `main` deploys, except one whose changes since the commit that is
 * ACTUALLY LIVE touch only `*.md`, `docs/` and `openspec/`. The base used to be
 * `github.event.before` — the previous tip of `main`, not what production runs. With a
 * deploy in progress (run A), a code push B pending and a docs-only push C arriving,
 * GitHub cancels the pending B; C then diffed B..C = docs only, skipped the deploy, and
 * B's code never reached production while every run was green. The same happened when
 * B failed a flaky gate before `image` and C was docs-only.
 *
 * The base is now resolved, in order:
 *   (a) the version `/api/public/health` reports through `vars.VPS_SMOKE_URL`;
 *   (b) the head commit of the newest run on `main` whose `Deploy to VPS` job succeeded;
 *   (c) neither, or a base that is not an ancestor of the pushed commit → deploy.
 *
 * The step's own script is taken out of ci.yml (as YAML, the way GitHub reads it) and
 * run with bash in a throwaway git repository. `curl` and `gh` are ALWAYS stubbed (and
 * fail unless a test gives them an answer): the real `gh` on a developer machine is
 * authenticated, and nothing here may reach GitHub or a real site. `git` and `jq` are
 * real, so the script's own filters are what is exercised.
 */

type Step = { id?: string; run?: string; env?: Record<string, string> }
type Job = { name?: string; permissions?: Record<string, string>; steps?: Step[] }

const ci = await (async () => {
  const { default: yaml } = await import('js-yaml')
  return yaml.load(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')) as {
    jobs: Record<string, Job>
  }
})()
const step = ci.jobs.changes?.steps?.find((s) => s.id === 'deploy')
const script = step?.run ?? ''

const roots: string[] = []
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})
const tempDir = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

function repo() {
  const root = tempDir('cdkt-docs-only-')
  const git = (...args: string[]) => {
    const r = spawnSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args],
      { cwd: root, encoding: 'utf8' },
    )
    assert.equal(r.status, 0, r.stderr)
    return r.stdout.trim()
  }
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  git('init', '-q', '-b', 'main')
  write('server/app.ts', 'export {}\n')
  write('README.md', '# app\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  const base = git('rev-parse', 'HEAD')
  const commit = (files: Record<string, string | null>) => {
    for (const [path, text] of Object.entries(files)) {
      if (text === null) git('rm', '-q', path)
      else write(path, text)
    }
    git('add', '-A')
    git('commit', '-q', '--allow-empty', '-m', 'change')
    return git('rev-parse', 'HEAD')
  }
  return { root, base, commit, git }
}

const REPO = 'Owner/Repo'
const RUN_ID = '4242'
const SMOKE = 'https://portal.example.test/'

/** What the stubbed network answers. Absent = that request fails. */
interface Fakes {
  /** Body of GET <SMOKE_URL>/api/public/health. */
  health?: unknown
  /** `gh api …/actions/workflows/ci.yml/runs?…` — newest run first, as GitHub lists them. */
  runs?: Array<{ id: number; head_sha: string; run_started_at: string; deploy: string }>
}

function decide(cwd: string, env: Record<string, string>, fakes: Fakes = {}) {
  const dir = tempDir('cdkt-docs-only-fakes-')
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  // curl: logs argv; answers the health endpoint only when the test gave a body.
  writeFileSync(
    join(bin, 'curl'),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${dir}/curl.log"\n[ -f "${dir}/health.json" ] || exit 7\ncat "${dir}/health.json"\n`,
  )
  // gh: logs argv; `api <path>` answers from runs.json / jobs-<id>.json, else fails.
  writeFileSync(
    join(bin, 'gh'),
    [
      '#!/usr/bin/env bash',
      `printf '%s\\n' "$*" >> "${dir}/gh.log"`,
      '[ "${1:-}" = api ] || exit 1',
      'case "${2:-}" in',
      `  */actions/runs/*/jobs*) id=\${2#*/actions/runs/}; id=\${id%%/*}; f="${dir}/jobs-$id.json" ;;`,
      `  */actions/workflows/*/runs*) f="${dir}/runs.json" ;;`,
      '  *) exit 1 ;;',
      'esac',
      '[ -f "$f" ] || exit 1',
      'cat "$f"',
      '',
    ].join('\n'),
  )
  chmodSync(join(bin, 'curl'), 0o755)
  chmodSync(join(bin, 'gh'), 0o755)
  if (fakes.health !== undefined) {
    // A string is sent as-is (an HTML error page), anything else as JSON.
    writeFileSync(join(dir, 'health.json'), typeof fakes.health === 'string' ? fakes.health : JSON.stringify(fakes.health))
  }
  if (fakes.runs) {
    writeFileSync(
      join(dir, 'runs.json'),
      JSON.stringify({
        total_count: fakes.runs.length,
        workflow_runs: fakes.runs.map(({ id, head_sha, run_started_at }) => ({
          id, head_sha, run_started_at, head_branch: 'main', event: 'push', status: 'completed',
        })),
      }),
    )
    for (const run of fakes.runs) {
      // A real run has ~25 jobs; the deploy job is one of them.
      const jobs = [
        { name: 'Plan', conclusion: 'success' },
        { name: 'Unit and typecheck', conclusion: 'success' },
        { name: 'Build and push image', conclusion: run.deploy === 'skipped' ? 'skipped' : 'success' },
        { name: 'Deploy to VPS', conclusion: run.deploy },
      ]
      writeFileSync(join(dir, `jobs-${run.id}.json`), JSON.stringify({ total_count: jobs.length, jobs }))
    }
  }

  const out = join(cwd, '.github-output')
  const summary = join(cwd, '.github-summary')
  writeFileSync(out, '')
  writeFileSync(summary, '')
  const r = spawnSync('bash', ['-e', '-c', script], {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      HOME: dir,
      GITHUB_OUTPUT: out,
      GITHUB_STEP_SUMMARY: summary,
      EVENT: 'push',
      SHA: '',
      REPO,
      RUN_ID,
      WORKFLOW_REF: `${REPO}/.github/workflows/ci.yml@refs/heads/main`,
      SMOKE_URL: SMOKE,
      GH_TOKEN: 'not-a-token',
      ...env,
    },
  })
  assert.equal(r.status, 0, `the step itself failed: ${r.stderr}`)
  const lines = readFileSync(out, 'utf8')
    .split('\n')
    .filter((l) => l.startsWith('deploy='))
  assert.equal(lines.length, 1, `expected one deploy= output line, got ${JSON.stringify(lines)}`)
  const log = (name: string) =>
    existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8').split('\n').filter(Boolean) : []
  return {
    deploy: lines[0]!.slice('deploy='.length),
    summary: readFileSync(summary, 'utf8'),
    curl: log('curl.log'),
    gh: log('gh.log'),
  }
}

const short = (sha: string) => sha.slice(0, 12)
const live = (sha: string) => ({ ok: true, version: short(sha) })
const deployedRun = (id: number, head_sha: string, minute: number, deploy = 'success') => ({
  id,
  head_sha,
  run_started_at: `2026-10-23T10:${String(minute).padStart(2, '0')}:00Z`,
  deploy,
})

// ─── Wiring ──────────────────────────────────────────────────────────────────

test('the step reads the commit that is live, not `github.event.before`', () => {
  assert.ok(script, 'the changes job has no `deploy` step')
  const env = step?.env ?? {}
  assert.equal(env.BEFORE, undefined, '`before` is the previous tip of main, not what production runs')
  assert.doesNotMatch(script, /\bBEFORE\b|event\.before/)
  assert.equal(env.SMOKE_URL, '${{ vars.VPS_SMOKE_URL }}')
  assert.equal(env.GH_TOKEN, '${{ github.token }}')
  assert.equal(env.REPO, '${{ github.repository }}')
  assert.equal(env.RUN_ID, '${{ github.run_id }}')
  assert.equal(env.WORKFLOW_REF, '${{ github.workflow_ref }}')
  assert.equal(env.SHA, '${{ github.sha }}')
  assert.equal(env.EVENT, '${{ github.event_name }}')
  // (b) lists runs and their jobs with the job token: `actions: read`, on this job only.
  assert.deepEqual(ci.jobs.changes?.permissions, { contents: 'read', 'pull-requests': 'read', 'actions': 'read' })
  for (const [name, job] of Object.entries(ci.jobs)) {
    if (name !== 'changes') assert.equal(job.permissions?.actions, undefined, `${name} does not need actions access`)
  }
  // (b) looks for the deploy job by its display name — renaming it must break here.
  const pinned = /^\s*deploy_job='([^']+)'$/m.exec(script)?.[1]
  assert.equal(pinned, ci.jobs.deploy?.name, 'the step looks for a deploy job name that does not exist')
})

// ─── Docs-only against the live commit ───────────────────────────────────────

test('docs-only changes since the live commit do not deploy', () => {
  const r = repo()
  const sha = r.commit({
    'openspec/changes/x/tasks.md': '- [ ] a\n',
    'docs/notes.txt': 'n\n',
    'README.md': '# app v2\n',
    'production/README.md': 'x\n',
  })
  const out = decide(r.root, { SHA: sha }, { health: live(r.base) })
  assert.equal(out.deploy, 'false')
  assert.match(out.summary, /tài liệu/i, 'the run summary does not say why nothing deployed')
  assert.match(out.summary, new RegExp(r.base), 'the run summary does not name the base it compared with')
  // Cache-busted, redirects followed, against the configured site.
  assert.equal(out.curl.length, 1)
  assert.match(out.curl[0]!, /(^| )-[a-zA-Z]*L/, 'curl does not follow redirects')
  assert.ok(out.curl[0]!.includes(`https://portal.example.test/api/public/health?t=${RUN_ID}`), out.curl[0])
  assert.deepEqual(out.gh, [], 'the live version was known — no need to ask GitHub')
})

// Every test that expects `true` also checks WHICH base produced it: without that, a
// broken (a) or (b) silently falls through to (c) — "no base, deploy" — and the test
// stays green for the wrong reason. The summary names the base and its source.
const viaHealth = (summary: string, base: string) => {
  assert.ok(summary.includes(base), `the decision did not use base ${base}: ${summary}`)
  assert.match(summary, /VPS_SMOKE_URL/, `the base did not come from the live version: ${summary}`)
}
const viaRuns = (summary: string, base: string) => {
  assert.ok(summary.includes(base), `the decision did not use base ${base}: ${summary}`)
  assert.match(summary, /Deploy to VPS/, `the base did not come from the last deploy run: ${summary}`)
}

test('a .md AND a .ts since the live commit deploys', () => {
  const r = repo()
  const sha = r.commit({ 'docs/a.md': 'a\n', 'server/app.ts': 'export const x = 1\n' })
  const out = decide(r.root, { SHA: sha }, { health: live(r.base) })
  assert.equal(out.deploy, 'true')
  viaHealth(out.summary, r.base)
})

test('a .ts renamed into docs/ deploys — the removed source counts', () => {
  const r = repo()
  mkdirSync(join(r.root, 'docs'))
  r.git('mv', 'server/app.ts', 'docs/app.md')
  r.git('commit', '-q', '-m', 'move')
  const sha = r.git('rev-parse', 'HEAD')
  const out = decide(r.root, { SHA: sha }, { health: live(r.base) })
  assert.equal(out.deploy, 'true')
  viaHealth(out.summary, r.base)
})

test('cancelled pending code push: a docs-only push after it still deploys the code', () => {
  // A is live. B (code) was pending behind A's deploy and got cancelled when C (docs
  // only) arrived. C's `before` is B, so `before..C` is docs-only — the old base
  // skipped the deploy and B never reached production.
  const r = repo()
  const a = r.base
  const b = r.commit({ 'server/app.ts': 'export const fix = 1\n' })
  const c = r.commit({ 'docs/notes.md': 'n\n' })
  const out = decide(r.root, { SHA: c, BEFORE: b }, { health: live(a), runs: [deployedRun(1, a, 0)] })
  assert.equal(out.deploy, 'true', 'B\'s code would never reach production')
  viaHealth(out.summary, a)
  // Same when the live version is unknown and GitHub says A was the last deploy.
  const viaGitHub = decide(r.root, { SHA: c, BEFORE: b, SMOKE_URL: '' }, { runs: [deployedRun(2, b, 5, 'skipped'), deployedRun(1, a, 0)] })
  assert.equal(viaGitHub.deploy, 'true')
  viaRuns(viaGitHub.summary, a)
})

test('a code push that failed a gate before `image`, then a docs-only push, deploys', () => {
  const r = repo()
  const a = r.base
  const b = r.commit({ 'server/app.ts': 'export const flaky = 1\n' })
  const c = r.commit({ 'openspec/x.md': 'x\n' })
  // B's run concluded failure with deploy skipped (a gate failed before `image`).
  const runs = [deployedRun(2, b, 5, 'skipped'), deployedRun(1, a, 0)]
  const out = decide(r.root, { SHA: c, BEFORE: b, SMOKE_URL: '' }, { runs })
  assert.equal(out.deploy, 'true')
  viaRuns(out.summary, a)
})

// ─── Where the base comes from ───────────────────────────────────────────────

test('(a) the live version wins over the last deploy run GitHub knows of', () => {
  // GitHub's last successful deploy is X, but the site serves A (e.g. a manage.sh
  // Update, or a deploy whose smoke step failed after the swap). X..C has code; A..C
  // is docs-only. `false` proves the live version was used.
  const r = repo()
  const x = r.base
  const a = r.commit({ 'server/app.ts': 'export const a = 1\n' })
  const c = r.commit({ 'docs/a.md': 'a\n' })
  assert.equal(decide(r.root, { SHA: c }, { health: live(a), runs: [deployedRun(1, x, 0)] }).deploy, 'false')
})

test('(b) live version unreachable, `dev` or unknown → the last successful deploy run', () => {
  const r = repo()
  const a = r.commit({ 'server/app.ts': 'export const a = 1\n' })
  const c = r.commit({ 'docs/a.md': 'a\n' })
  const runs = [deployedRun(1, a, 0)]
  // `false` proves (b) was used: without a base the answer would be `true`.
  const unreachable = decide(r.root, { SHA: c }, { runs })
  assert.equal(unreachable.deploy, 'false')
  assert.equal(unreachable.curl.length, 1, 'the live version was not asked for')
  viaRuns(unreachable.summary, a)
  assert.equal(decide(r.root, { SHA: c }, { health: { ok: true, version: 'dev' }, runs }).deploy, 'false')
  assert.equal(decide(r.root, { SHA: c }, { health: { ok: true, version: 'abcdef012345' }, runs }).deploy, 'false')
  assert.equal(decide(r.root, { SHA: c }, { health: '<html>maintenance</html>', runs }).deploy, 'false')
  // An answer that is not a short SHA never reaches git as an argument.
  assert.equal(decide(r.root, { SHA: c }, { health: { ok: true, version: '--output=/tmp/x' }, runs }).deploy, 'false')
  // No VPS_SMOKE_URL: straight to (b), no request at all.
  const unset = decide(r.root, { SHA: c, SMOKE_URL: '' }, { runs })
  assert.equal(unset.deploy, 'false')
  assert.deepEqual(unset.curl, [])
  assert.ok(unset.gh.some((l) => /actions\/workflows\/ci\.yml\/runs\?/.test(l) && /branch=main/.test(l) && /status=completed/.test(l)), JSON.stringify(unset.gh))
})

test('(b) picks the newest run whose deploy JOB succeeded — not a skipped or failed deploy', () => {
  // A deployed. B (code) deployed and failed (rolled back). B2 (docs) ran with deploy
  // skipped — its run concluded `success`. The live commit is A, so A..C has code.
  const r = repo()
  const a = r.base
  const b = r.commit({ 'server/app.ts': 'export const b = 1\n' })
  const b2 = r.commit({ 'docs/b2.md': 'x\n' })
  const c = r.commit({ 'docs/c.md': 'x\n' })
  const runs = [deployedRun(3, b2, 20, 'skipped'), deployedRun(2, b, 10, 'failure'), deployedRun(1, a, 0)]
  const out = decide(r.root, { SHA: c, SMOKE_URL: '' }, { runs })
  assert.equal(out.deploy, 'true')
  viaRuns(out.summary, a)
})

test('(b) orders runs by when they last started — a re-run of an older deploy is what is live', () => {
  // GitHub lists runs by creation. Run 1 (A) was re-run after run 2 (B) deployed, so
  // production runs A again; B's code is not live.
  const r = repo()
  const a = r.base
  const b = r.commit({ 'server/app.ts': 'export const b = 1\n' })
  const c = r.commit({ 'docs/c.md': 'x\n' })
  const runs = [deployedRun(2, b, 10), deployedRun(1, a, 30)]
  const out = decide(r.root, { SHA: c, SMOKE_URL: '' }, { runs })
  assert.equal(out.deploy, 'true')
  viaRuns(out.summary, a)
})

test('(c) neither source available → deploy', () => {
  const r = repo()
  const c = r.commit({ 'docs/a.md': 'a\n' })
  const out = decide(r.root, { SHA: c })
  assert.equal(out.deploy, 'true')
  assert.ok(out.gh.length >= 1, 'GitHub was not asked')
  // GitHub answers, but no run ever deployed successfully.
  assert.equal(decide(r.root, { SHA: c, SMOKE_URL: '' }, { runs: [deployedRun(1, r.base, 0, 'skipped')] }).deploy, 'true')
  // GitHub names a commit the clone does not have (history rewritten).
  assert.equal(decide(r.root, { SHA: c, SMOKE_URL: '' }, { runs: [deployedRun(1, 'f'.repeat(40), 0)] }).deploy, 'true')
})

test('(c) a live commit that is not an ancestor of the push → deploy', () => {
  const r = repo()
  r.git('checkout', '-q', '-b', 'side')
  const side = r.commit({ 'server/side.ts': 'export {}\n' })
  r.git('checkout', '-q', 'main')
  const c = r.commit({ 'docs/a.md': 'a\n' })
  // The diff side..C would be docs + a removed .ts; even a docs-only diff must not
  // decide when production runs something off this line of history.
  const health = decide(r.root, { SHA: c }, { health: live(side) })
  assert.equal(health.deploy, 'true')
  viaHealth(health.summary, side)
  assert.match(health.summary, /tổ tiên/, 'deployed for another reason than "not an ancestor"')
  const runs = decide(r.root, { SHA: c, SMOKE_URL: '' }, { runs: [deployedRun(1, side, 0)] })
  assert.equal(runs.deploy, 'true')
  viaRuns(runs.summary, side)
  assert.match(runs.summary, /tổ tiên/)
})

test('the pushed commit is already live → nothing new to deploy', () => {
  const r = repo()
  const sha = r.commit({ 'server/app.ts': 'export const x = 1\n' })
  const out = decide(r.root, { SHA: sha }, { health: live(sha) })
  assert.equal(out.deploy, 'false')
  assert.match(out.summary, /Run workflow/, 'the summary does not say how to force a redeploy')
  // A different commit with an identical tree is not "already live": deploy.
  const empty = r.commit({})
  const same = decide(r.root, { SHA: empty }, { health: live(sha) })
  assert.equal(same.deploy, 'true')
  viaHealth(same.summary, sha)
})

test('a manual run deploys; a pull request never does (and needs no git history)', () => {
  const empty = tempDir('cdkt-docs-only-nogit-')
  const manual = decide(empty, { EVENT: 'workflow_dispatch' })
  assert.equal(manual.deploy, 'true')
  assert.deepEqual([manual.curl, manual.gh], [[], []])
  const pr = decide(empty, { EVENT: 'pull_request' })
  assert.equal(pr.deploy, 'false')
  assert.deepEqual([pr.curl, pr.gh], [[], []])
})
