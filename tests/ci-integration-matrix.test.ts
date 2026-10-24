import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'

/**
 * Every real-MySQL suite (`tests/*-integration.test.ts`) must actually run in CI.
 *
 * Each suite self-skips unless its switch variable is `1`, and connects with
 * `<PREFIX>_HOST/PORT/USER/PASSWORD` (falling back to values that are wrong on the
 * CI service container). The integration job runs one suite per matrix entry and
 * turns on only that entry's switch. So a suite added without a matrix entry, or
 * with a switch name that does not match the file, or with a connection variable
 * missing from the step that runs it, is green in CI while testing nothing — or
 * hangs on a refused password. This guard reads the workflow as YAML and each
 * suite's source, and names the file that is not wired.
 *
 * The "Fail if this suite skipped" step decides from the log the integration step
 * already wrote — it must not run the suite a second time.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

type Step = { name?: string; run?: string; env?: Record<string, unknown> }
type MatrixEntry = { suite?: string; file?: string; switch?: string }

export interface SuiteSource {
  file: string
  source: string
}

/** Every problem with the wiring, as human-readable lines. Pure, so its failure modes are testable. */
export async function integrationWiringProblems(
  ciYaml: string,
  suites: SuiteSource[],
): Promise<string[]> {
  const { default: yaml } = await import('js-yaml')
  const problems: string[] = []
  const ci = yaml.load(ciYaml) as {
    jobs?: Record<string, { strategy?: { matrix?: { include?: MatrixEntry[] } }; steps?: Step[] }>
  }
  const job = ci.jobs?.['integration-tests']
  if (!job) return ['ci.yml has no integration-tests job']
  const include = job.strategy?.matrix?.include ?? []
  const steps = job.steps ?? []

  // The steps that execute the matrix suite are the ones that need its variables.
  const running = steps.filter((step) =>
    /--test\s+\$\{\{\s*matrix\.file\s*\}\}/.test(step.run ?? ''),
  )
  if (running.length !== 1)
    problems.push(`expected exactly one step to run \${{ matrix.file }}, found ${running.length}`)

  const skipCheck = steps.find((step) => step.name === 'Fail if this suite skipped')
  if (!skipCheck) problems.push('the "Fail if this suite skipped" step is gone')
  else {
    if (/--test\b/.test(skipCheck.run ?? ''))
      problems.push('the skip check runs the suite a second time instead of reading its log')
    if (!/\$RUNNER_TEMP\/\$\{\{\s*matrix\.suite\s*\}\}\.log/.test(skipCheck.run ?? ''))
      problems.push("the skip check does not read the integration step's log")
  }
  for (const step of running) {
    if (!/\| tee "\$RUNNER_TEMP\/\$\{\{\s*matrix\.suite\s*\}\}\.log"/.test(step.run ?? '')) {
      problems.push(
        `step "${step.name}" does not tee its output to $RUNNER_TEMP/\${{ matrix.suite }}.log for the skip check`,
      )
    }
    if (!/--test-reporter=tap/.test(step.run ?? ''))
      problems.push(`step "${step.name}" does not pin the TAP reporter the skip check parses`)
  }

  const byFile = new Map<string, MatrixEntry[]>()
  for (const entry of include) {
    const list = byFile.get(entry.file ?? '') ?? []
    list.push(entry)
    byFile.set(entry.file ?? '', list)
  }
  const known = new Set(suites.map((suite) => suite.file))
  for (const file of byFile.keys()) {
    if (!known.has(file)) problems.push(`matrix entry ${file} names a file that does not exist`)
  }

  for (const { file, source } of suites) {
    const entries = byFile.get(file) ?? []
    if (entries.length === 0) {
      problems.push(`${file} is not in the integration matrix`)
      continue
    }
    if (entries.length > 1)
      problems.push(`${file} is in the integration matrix ${entries.length} times`)
    const switches = [
      ...new Set(
        [...source.matchAll(/process\.env\.([A-Z0-9_]+_INTEGRATION)\b/g)].map((m) => m[1]!),
      ),
    ]
    if (switches.length !== 1) {
      problems.push(`${file} reads ${switches.length} *_INTEGRATION switches; expected exactly one`)
      continue
    }
    const switchName = switches[0]!
    const entry = entries[0]!
    if (entry.switch !== switchName)
      problems.push(
        `${file}: matrix switch is ${entry.switch ?? '(none)'}, the suite reads ${switchName}`,
      )
    const prefix = switchName.replace(/_INTEGRATION$/, '')
    const needed = [
      ...new Set(
        [...source.matchAll(new RegExp(`process\\.env\\.(${prefix}_[A-Z0-9_]+)\\b`, 'g'))].map(
          (m) => m[1]!,
        ),
      ),
    ].filter((name) => name !== switchName)
    for (const step of running) {
      const env = step.env ?? {}
      if (!Object.keys(env).some((key) => /\$\{\{\s*matrix\.switch\s*\}\}/.test(key))) {
        problems.push(`step "${step.name}" never turns on the matrix switch`)
      }
      for (const name of needed) {
        if (!(name in env))
          problems.push(`${file} reads ${name}, which step "${step.name}" does not provide`)
      }
    }
  }
  return problems
}

const repoSuites = (): SuiteSource[] =>
  readdirSync(new URL('../tests/', import.meta.url))
    .filter((name) => name.endsWith('-integration.test.ts'))
    .sort()
    .map((name) => ({ file: `tests/${name}`, source: read(`tests/${name}`) }))

test('every integration suite in tests/ runs in CI with its switch and connection variables', async () => {
  const suites = repoSuites()
  assert.ok(suites.length >= 18, `only ${suites.length} integration suites found`)
  assert.ok(
    suites.some((s) => s.file === 'tests/media-category-migration-integration.test.ts'),
    'the Wave 0 suite is missing',
  )
  assert.deepEqual(await integrationWiringProblems(read('.github/workflows/ci.yml'), suites), [])
})

test('a new suite without a matrix entry fails the guard, naming the file', async () => {
  const suites = [
    ...repoSuites(),
    {
      file: 'tests/foo-integration.test.ts',
      source:
        "const on = process.env.FOO_INTEGRATION === '1'\nconst pw = process.env.FOO_PASSWORD || ''\n",
    },
  ]
  const problems = await integrationWiringProblems(read('.github/workflows/ci.yml'), suites)
  assert.deepEqual(problems, ['tests/foo-integration.test.ts is not in the integration matrix'])
})

test('a matrix entry whose suite reads a variable the step does not set fails the guard', async () => {
  const ci = read('.github/workflows/ci.yml').replace(
    /^ {10}PUBLIC_READ_PASSWORD: test_root_password\n/m,
    '',
  )
  const problems = await integrationWiringProblems(ci, repoSuites())
  assert.ok(
    problems.some((p) =>
      p.startsWith('tests/public-read-integration.test.ts reads PUBLIC_READ_PASSWORD'),
    ),
    problems.join('\n'),
  )
})

test('a renamed suite file leaves a dangling matrix entry and an unwired file', async () => {
  const suites = repoSuites().map((s) =>
    s.file === 'tests/insert-id-integration.test.ts'
      ? { ...s, file: 'tests/insert-id-renamed-integration.test.ts' }
      : s,
  )
  const problems = await integrationWiringProblems(read('.github/workflows/ci.yml'), suites)
  assert.ok(
    problems.includes(
      'matrix entry tests/insert-id-integration.test.ts names a file that does not exist',
    ),
    problems.join('\n'),
  )
  assert.ok(
    problems.includes(
      'tests/insert-id-renamed-integration.test.ts is not in the integration matrix',
    ),
    problems.join('\n'),
  )
})

test('a pull request that only refreshes the upgrade fixture runs the integration jobs', async () => {
  const { default: yaml } = await import('js-yaml')
  const ci = yaml.load(read('.github/workflows/ci.yml')) as {
    jobs: Record<string, { steps?: Step[] }>
  }
  const plan = (ci.jobs.changes?.steps ?? []).find((step) =>
    /grep -Eq '[^']+'; then\s+echo "integration=true"/.test(step.run ?? ''),
  )
  assert.ok(plan, 'the changes job no longer decides integration=true from a grep of the PR files')
  const pattern = new RegExp(/grep -Eq '([^']+)'; then\s+echo "integration=true"/.exec(plan.run!)![1]!)
  for (const file of [
    'tests/fixtures/schema-prev.sql',
    'tests/schema-upgrade-integration.test.ts',
    'server/db/seed.ts',
    'scripts/snapshot-schema.ts',
  ]) {
    assert.ok(pattern.test(file), `${file} must run the integration jobs on a PR`)
  }
  for (const file of ['docs/CHANGELOG.md', 'tests/fixtures/schema-prev.sql.bak', 'tests/coverage-summary.test.ts']) {
    assert.ok(!pattern.test(file), `${file} alone must not run the integration jobs`)
  }
})
