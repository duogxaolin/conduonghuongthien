import assert from 'node:assert/strict'
import test from 'node:test'
import { lowestCovered, parseCoverageReport, renderCoverageSummary } from '../scripts/coverage-summary'

/**
 * Node's built-in test runner prints coverage as an indented table. CI appends a
 * short summary of it to the run page so a drop is visible without opening 3000
 * lines of log. It reports and never blocks: no threshold exists yet, because a
 * number picked before anyone has seen the baseline is just a new way to be red.
 */

const REPORT = `
ℹ tests 3
ℹ start of coverage report
ℹ ------------------------------------------------------------------------------------------
ℹ file                              | line % | branch % | funcs % | uncovered lines
ℹ ------------------------------------------------------------------------------------------
ℹ app                               |        |          |         |
ℹ  composables                      |        |          |         |
ℹ   useChatbot.ts                   |  21.49 |   100.00 |    0.00 | 28-30 69-72
ℹ   useThing.ts                     |  96.62 |    67.90 |   92.31 | 68-70
ℹ  utils                            |        |          |         |
ℹ   markdown.ts                     |  88.00 |    70.00 |  100.00 |
ℹ server                            |        |          |         |
ℹ  utils                            |        |          |         |
ℹ   chatbot                         |        |          |         |
ℹ    chat-policy.ts                 |  40.00 |    50.00 |   30.00 | 1-20
ℹ   rate-limit-store.ts             |  95.00 |    90.00 |  100.00 |
ℹ  db                              |        |          |         |
ℹ   schema-tables                   |        |          |         |
ℹ    core.ts                        |   5.00 |   100.00 |    0.00 |
ℹ ------------------------------------------------------------------------------------------
ℹ all files                         |  73.43 |    80.03 |   70.08 |
ℹ ------------------------------------------------------------------------------------------
ℹ end of coverage report
`

test('the overall row and every file row are read, with the directory path rebuilt from indentation', () => {
  const report = parseCoverageReport(REPORT)
  assert.deepEqual(report.overall, { line: 73.43, branch: 80.03, funcs: 70.08 })
  assert.deepEqual(report.files.map(file => file.path), [
    'app/composables/useChatbot.ts',
    'app/composables/useThing.ts',
    'app/utils/markdown.ts',
    'server/utils/chatbot/chat-policy.ts',
    'server/utils/rate-limit-store.ts',
    'server/db/schema-tables/core.ts',
  ])
  assert.equal(report.files[0]!.line, 21.49)
})

test('text without a coverage table yields an empty report rather than throwing', () => {
  assert.deepEqual(parseCoverageReport('ℹ tests 3\nℹ pass 3'), { overall: null, files: [] })
  assert.deepEqual(parseCoverageReport(''), { overall: null, files: [] })
})

test('the lowest-covered files are listed worst first and can be limited to a directory', () => {
  const { files } = parseCoverageReport(REPORT)
  assert.deepEqual(lowestCovered(files, { prefix: 'server/', limit: 5 }).map(file => file.path), [
    'server/utils/chatbot/chat-policy.ts',
    'server/utils/rate-limit-store.ts',
  ])
  assert.deepEqual(lowestCovered(files, { limit: 2 }).map(file => file.path), [
    'app/composables/useChatbot.ts',
    'server/utils/chatbot/chat-policy.ts',
  ])
})

test('DDL that only the integration suites execute does not crowd the worst-files list', () => {
  const { files } = parseCoverageReport(REPORT)
  assert.ok(files.some(file => file.path === 'server/db/schema-tables/core.ts'), 'it is still parsed')
  assert.ok(!lowestCovered(files, { limit: 50 }).some(file => file.path.startsWith('server/db/schema-tables/')))
})

test('the summary is markdown with the overall figures and a worst-files table', () => {
  const markdown = renderCoverageSummary(parseCoverageReport(REPORT), { limit: 3 })
  assert.match(markdown, /### Test coverage/)
  assert.match(markdown, /73\.43% lines/)
  assert.match(markdown, /80\.03% branches/)
  assert.match(markdown, /\| `app\/composables\/useChatbot\.ts` \| 21\.49 \|/)
  assert.match(markdown, /report only/i, 'it must say that nothing is enforced')
})

test('a missing report renders a clear note instead of an empty table', () => {
  assert.match(renderCoverageSummary({ overall: null, files: [] }), /no coverage table/i)
})
