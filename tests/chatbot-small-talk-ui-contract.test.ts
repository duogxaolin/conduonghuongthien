/** Structural contracts for the tabbed chatbot content administration UI. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parse } from '@vue/compiler-sfc'

const panelSource = await readFile(new URL('../app/components/admin/ChatbotSmallTalkPanel.vue', import.meta.url), 'utf8')
const knowledgeSource = await readFile(new URL('../app/pages/admin/chatbot/knowledge/index.vue', import.meta.url), 'utf8')
const legacySource = await readFile(new URL('../app/pages/admin/chatbot/small-talk/index.vue', import.meta.url), 'utf8')
const layoutSource = await readFile(new URL('../app/layouts/admin.vue', import.meta.url), 'utf8')
const settingsSource = await readFile(new URL('../app/pages/admin/chatbot/settings.vue', import.meta.url), 'utf8')
const panelSfc = parse(panelSource, { filename: 'ChatbotSmallTalkPanel.vue' })
const panelScript = panelSfc.descriptor.scriptSetup?.content ?? ''
const panelTemplate = panelSfc.descriptor.template?.content ?? ''
const knowledgeSfc = parse(knowledgeSource, { filename: 'chatbot/knowledge/index.vue' })
const knowledgeScript = knowledgeSfc.descriptor.scriptSetup?.content ?? ''
const knowledgeTemplate = knowledgeSfc.descriptor.template?.content ?? ''

for (const [filename, source] of [
  ['ChatbotSmallTalkPanel.vue', panelSource], ['chatbot/knowledge/index.vue', knowledgeSource], ['chatbot/small-talk/index.vue', legacySource],
] as const) {
  test(`${filename} parses and uses Tailwind utilities only`, () => {
    const sfc = parse(source, { filename })
    assert.equal(sfc.errors.length, 0)
    assert.equal(sfc.descriptor.styles.length, 0)
  })
}

test('one admin navigation item opens the combined chatbot content page', () => {
  assert.match(layoutSource, /label: 'Kho nội dung Chatbot'[^\n]+path: '\/admin\/chatbot\/knowledge'/)
  assert.equal((layoutSource.match(/path: '\/admin\/chatbot\/(?:knowledge|small-talk)'/g) || []).length, 1)
})

test('the combined page exposes accessible knowledge and small-talk tabs through a deep-linkable query', () => {
  assert.match(knowledgeScript, /route\.query\.tab === 'small-talk'/)
  assert.match(knowledgeScript, /router\.replace\(\{ query: tab === 'knowledge' \? \{\} : \{ tab \} \}\)/)
  assert.match(knowledgeTemplate, /role="tablist"/)
  assert.match(knowledgeTemplate, /id="knowledge-tab"[^>]+role="tab"[^>]+aria-controls="knowledge-panel"/s)
  assert.match(knowledgeTemplate, /id="small-talk-tab"[^>]+role="tab"[^>]+aria-controls="small-talk-panel"/s)
  assert.match(knowledgeTemplate, /id="knowledge-panel" role="tabpanel" aria-labelledby="knowledge-tab"/)
  assert.match(knowledgeTemplate, /id="small-talk-panel" role="tabpanel" aria-labelledby="small-talk-tab"/)
  assert.match(knowledgeTemplate, /<AdminChatbotSmallTalkPanel/)
})

test('legacy small-talk route and settings deep link preserve the small-talk tab', () => {
  assert.match(legacySource, /navigateTo\(\{ path: '\/admin\/chatbot\/knowledge', query: \{ tab: 'small-talk' \} \}, \{ replace: true \}\)/)
  assert.match(settingsSource, /to="\/admin\/chatbot\/knowledge\?tab=small-talk"/)
})

test('the two tabs keep independent API contracts and lifecycles', () => {
  assert.match(knowledgeScript, /'\/api\/admin\/chatbot\/knowledge'/)
  assert.match(knowledgeScript, /'\/api\/admin\/chatbot\/knowledge\/bulk-status'/)
  assert.match(knowledgeTemplate, /Xuất bản/)
  assert.match(panelScript, /'\/api\/admin\/chatbot\/small-talk'/)
  assert.match(panelScript, /'\/api\/admin\/chatbot\/small-talk\/bulk-enabled'/)
  assert.doesNotMatch(panelScript, /\/publish|\/archive/)
})

test('small-talk panel keeps shared bulk selection and protects system rows from deletion', () => {
  assert.match(panelScript, /useBulkSelection\(\)/)
  assert.match(panelScript, /useBulkAction\(selection\)/)
  assert.match(panelScript, /selection\.keepOnly\(/)
  assert.match(panelScript, /filter\(\(item: any\) => !item\.isSystem\)/)
  assert.match(panelTemplate, /selection\.toggleAll\(visibleIds\)/)
  assert.match(panelTemplate, /<AdminBulkActionBar/)
  assert.match(panelTemplate, /v-if="!item\.isSystem"[^>]*type="checkbox"/su)
  assert.match(panelTemplate, /<button v-if="!item\.isSystem"[^>]*@click="remove\(item\)"/su)
})

test('small-talk panel has loading, empty, error and toast feedback states', () => {
  assert.match(panelTemplate, /v-if="loading"/)
  assert.match(panelTemplate, /v-else-if="!items\.length"/)
  assert.match(panelTemplate, /v-if="error"/)
  assert.match(panelScript, /useToast\(\)/)
  assert.doesNotMatch(panelScript, /\balert\(/u)
})
