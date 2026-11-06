import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { ratchet, REPO_ROOT, trackedFiles, type FileRatchet } from './_ratchet'

/**
 * Lint-warning ratchet (quality part 9).
 *
 * `npm run lint` is at 0 warnings and 0 errors; the baseline (tests/ratchets/lint-warnings.baseline.json)
 * is therefore `{}`: a tracked file with ANY ESLint message — a warning or an error — fails
 * this test and is listed with its `line:col rule`. The `--max-warnings=0` flag on the
 * `lint` script says the same thing at the command line, but CI does not run `npm run lint`;
 * this test runs in `npm test` (and the CI unit job), so a new warning cannot merge unseen.
 *
 * The metric is the per-file message count of ONE `eslint . --format json` run (the same
 * config, plugins and ignores as `npm run lint`, so the two cannot drift). The ratchet
 * engine measures a file with `measure(text, file)`; here it looks the answer up in that
 * run, and a tracked file ESLint did not lint (a `.md`, an ignored path) is out of scope.
 *
 * The run costs one lint pass over the repo, once per process and only when the ratchet
 * measures. There is no escape hatch by design: fix the warning at its root, or add a
 * targeted `eslint-disable-next-line <rule> -- <why>` comment that says why it is safe.
 *
 * Baseline: tests/ratchets/lint-warnings.baseline.json. Regenerate (lowers only; stays `{}`
 * while the repo is clean):
 *   node --experimental-strip-types --import ./scripts/ts-resolver.mjs tests/ratchets/lint-warnings.test.ts --update
 */

interface EslintMessage { ruleId: string | null, severity: number, line: number, column: number, message: string }
interface EslintFileResult { filePath: string, messages: EslintMessage[] }

/** Messages per repo-relative path (forward slashes) from the JSON `eslint --format json` prints. Pure. */
export function messagesByFile(results: EslintFileResult[], root: string): Map<string, EslintMessage[]> {
  const byFile = new Map<string, EslintMessage[]>()
  for (const result of results) {
    byFile.set(path.relative(root, result.filePath).split(path.sep).join('/'), result.messages)
  }
  return byFile
}

/** One line per message, for the failure text: `path:line:col rule — message`. Pure. */
export function describeMessages(file: string, messages: EslintMessage[]): string[] {
  return messages.map(m => `${file}:${m.line}:${m.column} ${m.ruleId ?? '(no rule: parse error)'} — ${m.message}`)
}

function runEslint(root: string = REPO_ROOT): Map<string, EslintMessage[]> {
  const bin = path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js')
  let stdout: string
  try {
    stdout = execFileSync(process.execPath, [bin, '.', '--format', 'json'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 256 * 1024 * 1024,
    })
  } catch (error) {
    // ESLint exits 1 when it reports an error-severity message but still prints the JSON.
    const printed = (error as { stdout?: unknown }).stdout
    if (typeof printed !== 'string' || !printed.startsWith('[')) {
      throw new Error(`eslint did not produce a JSON report in ${root}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`, { cause: error })
    }
    stdout = printed
  }
  return messagesByFile(JSON.parse(stdout) as EslintFileResult[], root)
}

let cached: Map<string, EslintMessage[]> | undefined
const lintRun = () => (cached ??= runEslint())

export const LINT_WARNINGS: FileRatchet = {
  name: 'lint-warnings',
  unit: 'ESLint messages (warnings + errors)',
  defaultForNewFiles: 0,
  inScope: file => lintRun().has(file),
  measure: (_text, file) => lintRun().get(file)?.length ?? 0,
  hint: 'Fix the warning at its root (see `npm run lint` for the full text). Only `vue/no-v-html` on an inventoried, sanitized source may be suppressed, with `eslint-disable-next-line vue/no-v-html -- nguồn: <where the HTML was sanitized>`; any other suppression needs a one-line reason in the comment and is a reviewer decision — never a blanket disable.',
  exemptAllowed: [],
}

ratchet(LINT_WARNINGS, () => {
  test('lint-warnings: messagesByFile maps absolute ESLint paths to repo-relative ones', () => {
    const root = path.join(path.sep, 'repo')
    const m: EslintMessage = { ruleId: 'no-useless-assignment', severity: 1, line: 3, column: 7, message: 'dead' }
    const byFile = messagesByFile([
      { filePath: path.join(root, 'app', 'a.vue'), messages: [m] },
      { filePath: path.join(root, 'server', 'b.ts'), messages: [] },
    ], root)
    assert.deepEqual([...byFile.keys()], ['app/a.vue', 'server/b.ts'])
    assert.equal(byFile.get('app/a.vue')?.length, 1)
    assert.deepEqual(describeMessages('app/a.vue', [m]), ['app/a.vue:3:7 no-useless-assignment — dead'])
  })

  test('lint-warnings: a parse error (no rule id) is a message too, and is described', () => {
    const fatal: EslintMessage = { ruleId: null, severity: 2, line: 1, column: 1, message: 'Parsing error' }
    assert.deepEqual(describeMessages('x.ts', [fatal]), ['x.ts:1:1 (no rule: parse error) — Parsing error'])
  })

  test('lint-warnings: the repo lints clean — every message is listed with its location', () => {
    const tracked = new Set(trackedFiles())
    const offenders = [...lintRun()]
      .filter(([file, messages]) => tracked.has(file) && messages.length > 0)
      .flatMap(([file, messages]) => describeMessages(file, messages))
    assert.deepEqual(offenders, [], `ESLint messages in tracked files:\n${offenders.join('\n')}`)
  })
})
