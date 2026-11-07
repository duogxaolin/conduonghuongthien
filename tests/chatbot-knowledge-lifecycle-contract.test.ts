import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = (path: string) => readFile(new URL(path, root), 'utf8')

// The routes' authorisation (publish ≠ archive ≠ create ≠ update, SuperAdmin), the service's
// lifecycle contract (born draft, `status` refused, publish needs answer + source, reviewer and
// dates, audit in the same transaction) are run for real in
// tests/chatbot-knowledge-lifecycle-behavior.test.ts. What stays here is the editor page's shape.

test('editor payload excludes status and lifecycle buttons call dedicated endpoints', async () => {
  const editor = await read('app/pages/admin/chatbot/knowledge/[id].vue')
  const formDeclaration = editor.match(/const form = reactive\(\{([\s\S]*?)\n\}\)/)?.[1] || ''
  const payload = editor.match(/function contentPayload\(\) \{([\s\S]*?)\n\}/)?.[1] || ''

  assert.ok(formDeclaration)
  assert.doesNotMatch(formDeclaration, /status\s*:/)
  assert.ok(payload)
  assert.doesNotMatch(payload, /status/)
  assert.doesNotMatch(editor, /v-model="form\.status"/)
  assert.match(editor, /Trạng thái hiện tại/)
  assert.match(editor, /`\/api\/admin\/chatbot\/knowledge\/\$\{route\.params\.id\}\/\$\{action\}`/)
  assert.match(editor, /method: 'POST'/)
  // Browser confirm() was replaced by the in-app ConfirmModal (useConfirm).
  assert.match(editor, /await confirm\(\{ message: confirmation/)
  assert.match(editor, /await load\(\)/)
  assert.match(editor, /transition\('publish'\)/)
  assert.match(editor, /transition\('archive'\)/)
})
