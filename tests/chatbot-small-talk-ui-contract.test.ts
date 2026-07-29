/**
 * Structural contract for the everyday-reply admin page. There is no component
 * test harness in this project, so — following tests/admin-bulk-selection-ui.test.ts —
 * these assertions read the SFC rather than rendering it, guarding the pieces that
 * a hand edit most easily drops: the bulk-selection wiring, the system-row
 * exclusion, and the "no custom CSS" project rule.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parse } from '@vue/compiler-sfc'

const source = await readFile(new URL('../app/pages/admin/chatbot/small-talk/index.vue', import.meta.url), 'utf8')
const sfc = parse(source, { filename: 'chatbot/small-talk/index.vue' })
const script = sfc.descriptor.scriptSetup?.content ?? ''
const template = sfc.descriptor.template?.content ?? ''

test('the page wires selection through the shared composable and confirms bulk actions', () => {
  assert.match(script, /useBulkSelection\(\)/, 'must build selection with the shared composable')
  assert.match(script, /useBulkAction\(selection\)/, 'must run bulk requests through useBulkAction')
  assert.doesNotMatch(script, /new Set<number>\(/, 'must not hand-roll selection state')
  assert.match(script, /const visibleIds = computed\(/, 'must derive selectable ids from what is on screen')
  assert.ok(script.includes('/api/admin/chatbot/small-talk/bulk-delete'), 'must call bulk-delete')
  assert.ok(script.includes('/api/admin/chatbot/small-talk/bulk-enabled'), 'must call bulk-enabled')
  assert.match(script, /confirm: \{/, 'a bulk action must be confirmed')
  assert.match(script, /selection\.keepOnly\(/, 'must drop ids no longer on screen after a reload/filter')
})

test('the header checkbox, row checkbox and action strip are all present', () => {
  assert.match(template, /selection\.toggleAll\(visibleIds\)/, 'must offer select-all over visible rows')
  assert.match(template, /selection\.allSelected\(visibleIds\)/, 'must reflect the all-selected state')
  assert.match(template, /selection\.someSelected\(visibleIds\)/, 'must show the indeterminate state')
  assert.match(template, /<AdminBulkActionBar/, 'must render the bulk action bar')
  assert.match(template, /v-if="selection\.count\.value"/, 'must hide the bar when nothing is selected')
  assert.match(template, /@clear="selection\.clear\(\)"/, 'must let the operator drop the selection')
  // Exactly one row-checkbox site (single desktop table, no mobile card branch).
  assert.equal(template.split('selection.toggle(Number(').length - 1, 1, 'expected one row-checkbox site')
})

test('system rows are never offered for deletion', () => {
  assert.match(script, /!item\.isSystem/, 'the selectable set must exclude system rows')
  // The per-row delete button and the row checkbox are both guarded by v-if="!item.isSystem".
  assert.match(template, /v-if="!item\.isSystem"[^>]*type="checkbox"/su, 'system rows must not render a select checkbox')
  assert.match(template, /<button v-if="!item\.isSystem"[^>]*@click="remove\(item\)"/su, 'system rows must not render a delete button')
})

test('the page has loading, empty and error states', () => {
  assert.match(template, /v-if="loading"/, 'must show a loading state')
  assert.match(template, /v-else-if="!items\.length"/, 'must show an empty state')
  assert.match(template, /v-if="error"/, 'must show an error state')
})

test('the SFC uses Tailwind utilities only — no custom CSS', () => {
  assert.equal(sfc.descriptor.styles.length, 0, 'the page must not ship a <style> block')
  assert.doesNotMatch(source, /<style/u, 'no <style scoped> or custom CSS is allowed for new pages')
})

test('feedback goes through toast, never a browser alert()', () => {
  assert.match(script, /useToast\(\)/, 'must use the toast composable')
  assert.doesNotMatch(script, /\balert\(/u, 'must not use window.alert')
})
