import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * The `changes` job's `deploy` output, RUN — not read.
 *
 * Every merge to `main` deploys. A merge that only touches documentation or plans
 * used to rebuild the image and restart the production container anyway. The step
 * below decides, for a push, whether anything outside `*.md`, `docs/` and
 * `openspec/` changed between `before` and the pushed commit. Every way of not
 * knowing (new branch, all-zero `before`, a `before` the clone does not have after
 * a force-push, an empty diff) must answer "deploy".
 *
 * The step's own script is taken out of ci.yml (as YAML, the way GitHub reads it)
 * and run with bash in a throwaway git repository, with the same environment the
 * workflow gives it. Tests still run for docs-only pushes — only `image`/`deploy`
 * read this output (tests/ops-scripts.test.ts pins that wiring).
 */

const ZERO = '0000000000000000000000000000000000000000'

const script = await (async () => {
  const { default: yaml } = await import('js-yaml')
  const ci = yaml.load(
    readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'),
  ) as {
    jobs: Record<
      string,
      { steps?: Array<{ id?: string; run?: string; env?: Record<string, string> }> }
    >
  }
  const step = ci.jobs.changes?.steps?.find((s) => s.id === 'deploy')
  assert.ok(step?.run, 'the changes job has no `deploy` step')
  assert.deepEqual(Object.keys(step.env ?? {}).sort(), ['BEFORE', 'EVENT', 'SHA'])
  return step.run
})()

const roots: string[] = []
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'cdkt-docs-only-'))
  roots.push(root)
  const git = (...args: string[]) => {
    const r = spawnSync(
      'git',
      [
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@example.invalid',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { cwd: root, encoding: 'utf8' },
    )
    assert.equal(r.status, 0, r.stderr)
    return r.stdout.trim()
  }
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  git('init', '-q')
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

function decide(cwd: string, env: { EVENT: string; BEFORE?: string; SHA?: string }) {
  const out = join(cwd, '.github-output')
  const summary = join(cwd, '.github-summary')
  writeFileSync(out, '')
  writeFileSync(summary, '')
  const r = spawnSync('bash', ['-e', '-c', script], {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      GITHUB_OUTPUT: out,
      GITHUB_STEP_SUMMARY: summary,
      BEFORE: '',
      SHA: '',
      ...env,
    },
  })
  assert.equal(r.status, 0, `the step itself failed: ${r.stderr}`)
  const lines = readFileSync(out, 'utf8')
    .split('\n')
    .filter((l) => l.startsWith('deploy='))
  assert.equal(lines.length, 1, `expected one deploy= output line, got ${JSON.stringify(lines)}`)
  return { deploy: lines[0]!.slice('deploy='.length), summary: readFileSync(summary, 'utf8') }
}

test('a push that only changes openspec/, docs/ and Markdown does not deploy', () => {
  const r = repo()
  const sha = r.commit({
    'openspec/changes/x/tasks.md': '- [ ] a\n',
    'docs/notes.txt': 'n\n',
    'README.md': '# app v2\n',
    'production/README.md': 'x\n',
  })
  const { deploy, summary } = decide(r.root, { EVENT: 'push', BEFORE: r.base, SHA: sha })
  assert.equal(deploy, 'false')
  assert.match(summary, /tài liệu|docs/i, 'the run summary does not say why nothing deployed')
})

test('a push that changes a .md AND a .ts deploys', () => {
  const r = repo()
  const sha = r.commit({ 'docs/a.md': 'a\n', 'server/app.ts': 'export const x = 1\n' })
  assert.equal(decide(r.root, { EVENT: 'push', BEFORE: r.base, SHA: sha }).deploy, 'true')
})

test('a .ts renamed into docs/ deploys — the removed source counts', () => {
  const r = repo()
  mkdirSync(join(r.root, 'docs'))
  r.git('mv', 'server/app.ts', 'docs/app.md')
  r.git('commit', '-q', '-m', 'move')
  const sha = r.git('rev-parse', 'HEAD')
  assert.equal(decide(r.root, { EVENT: 'push', BEFORE: r.base, SHA: sha }).deploy, 'true')
})

test('an all-zero or empty `before` (new branch, first push) deploys', () => {
  const r = repo()
  const sha = r.commit({ 'docs/a.md': 'a\n' })
  assert.equal(decide(r.root, { EVENT: 'push', BEFORE: ZERO, SHA: sha }).deploy, 'true')
  assert.equal(decide(r.root, { EVENT: 'push', BEFORE: '', SHA: sha }).deploy, 'true')
})

test('a `before` the clone does not have (force-push) deploys', () => {
  const r = repo()
  const sha = r.commit({ 'docs/a.md': 'a\n' })
  assert.equal(decide(r.root, { EVENT: 'push', BEFORE: 'f'.repeat(40), SHA: sha }).deploy, 'true')
})

test('an empty diff (a re-run of the same commit) deploys rather than guessing', () => {
  const r = repo()
  const sha = r.commit({})
  assert.equal(decide(r.root, { EVENT: 'push', BEFORE: sha, SHA: sha }).deploy, 'true')
})

test('a manual run deploys; a pull request never does (and needs no git history)', () => {
  const empty = mkdtempSync(join(tmpdir(), 'cdkt-docs-only-nogit-'))
  roots.push(empty)
  assert.equal(decide(empty, { EVENT: 'workflow_dispatch' }).deploy, 'true')
  assert.equal(decide(empty, { EVENT: 'pull_request' }).deploy, 'false')
})
