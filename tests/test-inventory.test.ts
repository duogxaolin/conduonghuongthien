import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * `scripts/test-inventory.ts` lists the tests that read source text and sorts them into
 * behavioural candidates, structural guards and brittle assertions
 * (docs/decisions/test-strategy.md). It runs here against a fixture tree with one fake
 * test per class. The hand review (`scripts/test-inventory-review.ts`) is switched off:
 * what is checked is the automatic pass, detection and first-pass class alike.
 */

const SCRIPT = fileURLToPath(new URL('../scripts/test-inventory.ts', import.meta.url))
const FIXTURE = fileURLToPath(new URL('./fixtures/test-inventory', import.meta.url))

function run(...args: string[]) {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', SCRIPT, '--root', FIXTURE, '--no-review', ...args], {
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

type Row = {
  file: string
  reads: string[]
  helpers: string[]
  tests: number
  sourceTests: number
  sourceBlocks: Array<{ title: string, autoClass: string, class: string }>
  autoClass: string
  class: string
  overridden: boolean
}

const report = JSON.parse(run()) as { tests: Row[], totals: { files: number, sourceTests: number, byClass: Record<string, { files: number, tests: number }> } }
const row = (file: string) => {
  const found = report.tests.find(entry => entry.file === `tests/${file}`)
  assert.ok(found, `${file} is in the inventory`)
  return found
}

test('every fake test that reads source is listed, sorted by path, and the helper is not a row', () => {
  assert.deepEqual(report.tests.map(entry => entry.file), [
    'tests/layout-size.test.ts',
    'tests/security-query-params.test.ts',
    'tests/settings-note.test.ts',
  ])
})

test('a security invariant asserted on source text is a behavioural candidate', () => {
  const entry = row('security-query-params.test.ts')
  assert.deepEqual(entry.reads, ['server/utils/search.ts'])
  assert.equal(entry.tests, 2)
  assert.equal(entry.sourceTests, 1, 'the test that runs code and reads nothing is not counted')
  assert.deepEqual(entry.sourceBlocks.map(block => block.title), ['the search query never concatenates user input into SQL'])
  assert.equal(entry.autoClass, 'behavioural')
})

test('a line-count limit read through a helper is structural; the sandbox read is not a source read', () => {
  const entry = row('layout-size.test.ts')
  assert.deepEqual(entry.reads, ['app/layouts/default.vue'])
  assert.deepEqual(entry.helpers, ['tests/_read-source.ts'])
  assert.equal(entry.tests, 2)
  assert.equal(entry.sourceTests, 1)
  assert.equal(entry.autoClass, 'structural')
})

test('assertions that pin comments are brittle; a describe-scope read taints the blocks that use it', () => {
  const entry = row('settings-note.test.ts')
  assert.deepEqual(entry.reads, ['app/pages/admin/settings.vue'])
  assert.equal(entry.tests, 2)
  assert.equal(entry.sourceTests, 2)
  assert.equal(entry.autoClass, 'brittle')
})

test('with the review off, the final class is the automatic one and nothing is marked overridden', () => {
  for (const entry of report.tests) {
    assert.equal(entry.class, entry.autoClass, entry.file)
    assert.equal(entry.overridden, false, entry.file)
    for (const block of entry.sourceBlocks) assert.equal(block.class, block.autoClass, `${entry.file}: ${block.title}`)
  }
  assert.equal(report.totals.files, 3)
  assert.equal(report.totals.sourceTests, 4)
  assert.deepEqual(report.totals.byClass, {
    behavioural: { files: 1, tests: 1 },
    brittle: { files: 1, tests: 2 },
    structural: { files: 1, tests: 1 },
  })
})

test('the output is deterministic, and --markdown renders one table row per test file', () => {
  assert.equal(run(), run())
  const markdown = run('--markdown')
  assert.equal(markdown, run('--markdown'))
  const rows = markdown.split('\n').filter(line => line.startsWith('| `tests/'))
  assert.deepEqual(rows.map(line => line.split('|')[1]!.trim()), [
    '`tests/layout-size.test.ts`',
    '`tests/security-query-params.test.ts`',
    '`tests/settings-note.test.ts`',
  ])
})
