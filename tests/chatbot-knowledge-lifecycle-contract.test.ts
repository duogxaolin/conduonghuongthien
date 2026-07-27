import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = (path: string) => readFile(new URL(path, root), 'utf8')

test('ordinary API routes authorize content actions and delegate status rejection to the service', async () => {
  const createRoute = await read('server/api/admin/chatbot/knowledge/index.post.ts')
  const updateRoute = await read('server/api/admin/chatbot/knowledge/[id].put.ts')

  assert.match(createRoute, /requireChatbotKnowledgePermission\(event, 'create'\)/)
  assert.match(createRoute, /createKnowledge\(actor\.id, await readBody\(event\)/)
  assert.doesNotMatch(createRoute, /'publish'|'archive'|transitionKnowledge/)

  assert.match(updateRoute, /requireChatbotKnowledgePermission\(event, 'update'\)/)
  assert.match(updateRoute, /updateKnowledge\(actor\.id, id, await readBody\(event\)/)
  assert.doesNotMatch(updateRoute, /'publish'|'archive'|transitionKnowledge/)
})

test('dedicated lifecycle routes authorize and execute only their matching action', async () => {
  const publishRoute = await read('server/api/admin/chatbot/knowledge/[id]/publish.post.ts')
  const archiveRoute = await read('server/api/admin/chatbot/knowledge/[id]/archive.post.ts')

  assert.match(publishRoute, /requireChatbotKnowledgePermission\(event, 'publish'\)/)
  assert.match(publishRoute, /transitionKnowledge\(actor\.id, id, 'published'\)/)
  assert.doesNotMatch(publishRoute, /'archive'|status\s*:/)

  assert.match(archiveRoute, /requireChatbotKnowledgePermission\(event, 'archive'\)/)
  assert.match(archiveRoute, /transitionKnowledge\(actor\.id, id, 'archived'\)/)
  assert.doesNotMatch(archiveRoute, /'publish'|status\s*:/)
})

test('service contract fixes create to draft and keeps update lifecycle fields immutable', async () => {
  const service = await read('server/services/chatbot-knowledge.ts')

  assert.match(service, /status: 'draft'/)
  assert.match(service, /reviewerId: null, reviewedAt: null, publishedAt: null, archivedAt: null/)
  assert.match(service, /rejectLifecycleStatus\(input\)/)
  assert.doesNotMatch(service, /patch\.status\s*=/)
  assert.doesNotMatch(service, /value\.status/)
  assert.match(service, /if \(current\.status === 'published'\) validatePublish/)
  assert.match(service, /reviewerId: actorId, reviewedAt: now/)
})

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
