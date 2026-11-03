// Fixture for tests/test-inventory.test.ts — never executed. It stands for a
// BRITTLE assertion: it pins comments in a page, which carry no invariant.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'

describe('settings page', async () => {
  const page = await readFile(new URL('../app/pages/admin/settings.vue', import.meta.url), 'utf8')

  it('keeps the explanatory comment above the save button', () => {
    assert.match(page, /<!-- Lưu ý: nút lưu/)
  })

  it('keeps the reminder comment in the script', () => {
    assert.ok(page.includes('// keep in sync with the server'))
  })
})
