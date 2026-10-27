// Fixture for tests/test-inventory.test.ts — never executed (the `npm test` glob is
// `tests/*.test.ts`, not recursive). It stands for a BEHAVIOURAL CANDIDATE: a security
// invariant (no user input concatenated into SQL) asserted by reading source text.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../server/utils/search.ts', import.meta.url), 'utf8')
const handler = source.slice(source.indexOf('export default'))

test('the search query never concatenates user input into SQL', () => {
  assert.doesNotMatch(handler, /sql\.raw\(/)
})

test('a percent sign in the search term is escaped', () => {
  // Runs code, reads no source: must not be counted as source-dependent.
  assert.equal('50%'.replace(/%/g, '\\%'), '50\\%')
})
