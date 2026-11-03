// Fixture for tests/test-inventory.test.ts — never executed. It stands for a
// STRUCTURAL guard: a line-count limit on a layout file, read through a helper.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { readSource } from './_read-source.ts'

test('the default layout stays under 400 lines', () => {
  const lines = readSource('app/layouts/default.vue').split('\n').length
  assert.ok(lines <= 400, `${lines} lines`)
})

test('a layout copied into a sandbox is read back unchanged', () => {
  // Stages a source file into a sandbox and reads the temporary copy: no assertion is
  // made on source text, so this block must not be counted.
  const dir = mkdtempSync(join(tmpdir(), 'inventory-fixture-'))
  writeFileSync(join(dir, 'app.vue'), readSource('app/layouts/default.vue'))
  assert.ok(readFileSync(join(dir, 'app.vue'), 'utf8').length > 0)
})
