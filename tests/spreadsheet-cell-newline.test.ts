import assert from 'node:assert/strict'
import test from 'node:test'

import { csvCell, neutralizeSpreadsheetText } from '../server/utils/spreadsheet-cell'

/**
 * A leading line feed is stripped by some spreadsheet importers exactly like a
 * leading tab or carriage return, after which the next character is read as the
 * start of a formula. `\t` and `\r` were neutralised; `\n` was not, so a title
 * "\n=HYPERLINK(...)" exported as a live formula.
 */

test('a leading line feed is neutralised like a tab or carriage return', () => {
  assert.equal(neutralizeSpreadsheetText('\n=1+1'), "'\n=1+1")
  assert.equal(neutralizeSpreadsheetText('\n=HYPERLINK("https://evil/")'), `'\n=HYPERLINK("https://evil/")`)
  assert.equal(csvCell('\n=1'), `"'\n=1"`)
  for (const lead of ['\t', '\r', '\n']) assert.ok(neutralizeSpreadsheetText(`${lead}@SUM(A1)`).startsWith("'"), JSON.stringify(lead))
})

test('a line feed in the middle is still plain data', () => {
  assert.equal(neutralizeSpreadsheetText('Dòng 1\n=2'), 'Dòng 1\n=2')
  assert.equal(csvCell('a\nb'), '"a\nb"')
})
