import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test, { describe } from 'node:test'
import {
  CLAUDE_MD, END, LINE_COUNTED, REPO_ROOT, START, WRITE_COMMAND,
  blockDiff, computeFacts, extractFactsBlock, integrationMatrixFiles, lineCount, measureTree,
  renderFactsBlock, replaceFactsBlock, run, viFallbackKeyCount,
} from '../scripts/docs-facts.ts'

/**
 * CLAUDE.md quotes repo counts in ONE generated table between `<!-- facts:start -->` and
 * `<!-- facts:end -->` (wave3-long-term, design D-FACTS). The counts used to be typed by
 * hand in several places and went stale with the next merge ("Hiện 335 endpoint" beside
 * "172 endpoint cũ" while the tree had 336 and 173). This test recomputes the table from
 * the tracked tree and fails when CLAUDE.md does not carry it verbatim; the fix is one
 * command, printed with the failure. How each count is measured, and which numbers stay
 * prose (test totals, lint warnings), is in scripts/docs-facts.ts.
 */

const doc = readFileSync(path.join(REPO_ROOT, CLAUDE_MD), 'utf8')
const facts = computeFacts()

test('the CLAUDE.md facts block matches the tree', () => {
  const current = extractFactsBlock(doc)
  const expected = renderFactsBlock(facts)
  if (current !== expected) {
    assert.fail([
      `${CLAUDE_MD} facts block is stale:`,
      ...blockDiff(current, expected).map(line => `  ${line}`),
      `Regenerate it with: ${WRITE_COMMAND}`,
    ].join('\n'))
  }
})

describe('the block', () => {
  const block = renderFactsBlock(facts)

  test('a count changed by hand is stale, and the diff names exactly that row', () => {
    const row = block.split('\n').find(line => line.startsWith('| Endpoint '))
    assert.ok(row, 'the endpoint row is rendered')
    const tampered = block.replace(row, row.replace(`| ${facts.endpoints} · `, `| ${facts.endpoints - 1} · `))
    assert.notEqual(tampered, block)
    assert.deepEqual(blockDiff(tampered, block), [
      `- ${row.replace(`| ${facts.endpoints} · `, `| ${facts.endpoints - 1} · `)}`,
      `+ ${row}`,
    ])
    assert.deepEqual(blockDiff(block, block), [])
  })

  test('is a two-column table between the markers, with no date that would change every run', () => {
    const lines = block.split('\n')
    assert.equal(lines[0], START)
    assert.equal(lines.at(-1), END)
    assert.ok(lines[1]!.includes(WRITE_COMMAND), 'the block says how to regenerate it')
    for (const line of lines.slice(2, -1)) assert.match(line, /^\|.*\|.*\|$/, line)
    assert.doesNotMatch(block, /\d{4}-\d{2}-\d{2}/)
  })

  test('replacing it touches nothing outside the markers, and is idempotent', () => {
    const before = 'head\n\n' + START + '\nold\n' + END + '\n\ntail\n'
    const once = replaceFactsBlock(before, block)
    assert.equal(once, 'head\n\n' + block + '\n\ntail\n')
    assert.equal(replaceFactsBlock(once, block), once)
    assert.equal(extractFactsBlock(once), block)
  })

  test('each marker must appear exactly once, start before end', () => {
    assert.throws(() => extractFactsBlock('no markers here'), /exactly once/)
    assert.throws(() => extractFactsBlock(`${START}\n${END}\n${START}\n${END}`), /exactly once/)
    assert.throws(() => extractFactsBlock(`${END}\n${START}`), /comes before/)
  })

  test('integration suites the CI matrix does not name show as "lệch"', () => {
    assert.match(block, /\| Suite `\*-integration` \(so matrix CI\) \| \d+ \(khớp\) \|/)
    const off = renderFactsBlock({ ...facts, integrationMatrixMismatch: facts.integrationSuites - 1 })
    assert.match(off, new RegExp(`\\| ${facts.integrationSuites} \\(matrix ${facts.integrationSuites - 1} — lệch\\) \\|`))
  })
})

describe('measureTree', () => {
  const ciYaml = [
    'jobs:',
    '  unit-tests:',
    '    strategy: { matrix: { include: [{ file: tests/not-this-integration.test.ts }] } }',
    '  integration-tests:',
    '    strategy:',
    '      matrix:',
    '        include:',
    '          - { suite: a, file: tests/a-integration.test.ts }',
    '          - { suite: b, file: tests/b-integration.test.ts }',
  ].join('\n')
  const lineFiles = Object.fromEntries(LINE_COUNTED.map(({ file }, index) => [file, 'x\n'.repeat(index + 1)]))
  const dictionary = [
    "import { extraDictionaries } from './i18n-extra'",
    'const baseDictionary: Record<string, Record<string, string>> = {',
    "  vi: { home: 'Trang chủ', 'quoted_key': 'x', about: 'Giới thiệu' },",
    "  en: { home: 'Home' },",
    '}',
    'export const hardcodedDictionary = { ...baseDictionary, ...extraDictionaries }',
  ].join('\n')
  const tree: Record<string, string> = {
    ...lineFiles,
    'app/composables/i18n-default-dictionary.ts': dictionary,
    '.github/workflows/ci.yml': ciYaml,
    'server/api/a.get.ts': "import { listThings } from '../services/things'\nconst db = getDb()\nrequireResourcePermission(event, 'x', 'read')\n",
    'server/api/nested/b.post.ts': "import { rateLimitDeps } from '../../utils/rate-limit-deps'\nconst deps = rateLimitDeps()\n",
    'server/api/c.put.ts': "import {\n  readValidated,\n  rateLimitDeps,\n} from '#imports'\nrequireResourcePermission(event, 'x', 'update')\n",
    'server/api/notes.md': 'getDb() requireResourcePermission',
    'server/utils/permissions.ts': 'export function requireResourcePermission() {}\n',
    'server/utils/rate-limit-deps.ts': 'export function rateLimitDeps(): Deps { return { execute: pool ? run : null } }\n',
    'server/services/purge.ts': '/** counters are written through (`rateLimitDeps()`) */\n',
    'tests/a-integration.test.ts': '',
    'tests/b-integration.test.ts': '',
    'tests/nested/c-integration.test.ts': '',
    'tests/helper.test.ts': '',
  }
  const tracked = [...Object.keys(tree), 'server/api/deleted.get.ts']
  const untracked = { 'server/api/untracked.get.ts': 'getDb()', 'tests/d-integration.test.ts': '' }
  const read = (file: string) => tree[file] ?? (untracked as Record<string, string>)[file] ?? null
  const measured = measureTree(tracked, read)

  test('counts endpoints, getDb() and services imports among tracked server/api .ts files only', () => {
    assert.equal(measured.endpoints, 3, 'a.get, nested/b.post, c.put — not notes.md, not the deleted or the untracked file')
    assert.equal(measured.endpointsWithGetDb, 1)
    assert.equal(measured.endpointsImportingServices, 1)
  })

  test('requireResourcePermission counts every server/ file naming it (definer included), as grep -rl does', () => {
    assert.equal(measured.permissionFilesServer, 4, 'a.get, c.put, notes.md, permissions.ts')
    assert.equal(measured.permissionFilesApi, 3, 'a.get, c.put, notes.md')
  })

  test('rateLimitDeps counts the files that import it — not the definer, not a comment', () => {
    assert.equal(measured.rateLimitDepsImporters, 2, 'nested/b.post and the multi-line import in c.put')
  })

  test('integration suites are tracked top-level tests/*-integration.test.ts, matched against the integration-tests job', () => {
    assert.equal(measured.integrationSuites, 2)
    assert.equal(measured.integrationMatrixMismatch, null)
    const missing = measureTree([...tracked, 'tests/e-integration.test.ts'], file => (file === 'tests/e-integration.test.ts' ? '' : read(file)))
    assert.equal(missing.integrationSuites, 3)
    assert.equal(missing.integrationMatrixMismatch, 2)
  })

  test('line counts follow wc -l, and a line-counted file that disappeared is an error, not a zero', () => {
    for (const [index, { file }] of LINE_COUNTED.entries()) assert.equal(measured.lines[file], index + 1, file)
    const gone = LINE_COUNTED[0]!.file
    assert.throws(() => measureTree(tracked.filter(file => file !== gone), read), /not a tracked file/)
  })

  test('the Vietnamese fallback is counted from the dictionary TEXT, and an uncountable shape is an error', () => {
    assert.equal(measured.i18nViFallback, 3)
    assert.throws(() => viFallbackKeyCount(dictionary.replace("vi: { home:", 'vi: { ...shared, home:')), /spread or computed key/)
    assert.throws(() => viFallbackKeyCount(dictionary.replace("vi: { home:", "vi: { [name]: 'x', home:")), /spread or computed key/)
    assert.throws(() => viFallbackKeyCount('export const other = {}'), /no `baseDictionary/)
  })

  test('lineCount and integrationMatrixFiles', () => {
    assert.equal(lineCount(''), 0)
    assert.equal(lineCount('one line, no newline'), 0)
    assert.equal(lineCount('a\nb\n'), 2)
    assert.deepEqual(integrationMatrixFiles(ciYaml), ['tests/a-integration.test.ts', 'tests/b-integration.test.ts'])
    assert.deepEqual(integrationMatrixFiles('jobs: {}'), [])
  })
})

test('the CLI rejects an unknown argument before touching CLAUDE.md', () => {
  const errors: string[] = []
  assert.equal(run(['--wirte'], REPO_ROOT, () => {}, line => errors.push(line)), 2)
  assert.match(errors.join('\n'), /unknown argument --wirte/)
})
