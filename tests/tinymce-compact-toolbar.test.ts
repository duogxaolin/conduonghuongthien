import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compactEditorToolbar } from '../app/utils/tinymce-compact-toolbar.ts'

/**
 * The toolbar of components/admin/TinyMceEditor.vue (Page Builder rich-text fields, the translation panel): the same
 * order as the article editor's — the labelled full-screen toggle FIRST, the list buttons after the insert group
 * (CHANGELOG § 105, § 106). The editor itself on the real build: tests/e2e/admin-editor-fullscreen.spec.ts.
 */
const groups = (withSave: boolean) => compactEditorToolbar(withSave).split('|').map(group => group.trim().split(/\s+/))
const at = (list: string[][], name: string) => list.findIndex(group => group.includes(name))

test('the toggle is the first group; "Lưu" shares it only when asked for', () => {
  assert.deepEqual(groups(false)[0], ['cdktfullscreen'])
  assert.deepEqual(groups(true)[0], ['cdktfullscreen', 'cdktsave'])
})

test('lists come after the insert group and the table; TinyMCE\'s own icon-only fullscreen button is gone', () => {
  for (const withSave of [false, true]) {
    const g = groups(withSave)
    assert.ok(at(g, 'bullist') > at(g, 'table') && at(g, 'bullist') > at(g, 'cdktimage'), 'lists after the insert group')
    assert.equal(at(g, 'numlist'), at(g, 'bullist'))
    assert.equal(at(g, 'fullscreen'), -1)
    assert.ok(at(g, 'bold') < at(g, 'cdktimage'), 'inline format stays before the insert group')
  }
})

test('the component builds its toolbar through the helper from its own prop, and registers the buttons', () => {
  const source = readFileSync(new URL('../app/components/admin/TinyMceEditor.vue', import.meta.url), 'utf8')
  assert.match(source, /toolbar: compactEditorToolbar\(props\.saveButton\)/)
  assert.match(source, /registerFullscreenButton\(ed, props\.saveButton \?/)
  assert.match(source, /saveButton: false/, 'opt-in: a host that does not ask has no Save')
  assert.match(source, /push\(\); emit\('save'\)/, 'the model is brought up to date before the host saves')
})
