import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import {
  validateSmallTalkInput,
  serializeSmallTalk,
  ChatbotSmallTalkValidationError,
  SMALL_TALK_MAX,
} from '../server/services/chatbot-small-talk'
import { requireChatbotSmallTalkPermission, CHATBOT_RESOURCES } from '../server/utils/permissions'

/**
 * The admin surface for the everyday-reply store. Validation, sanitization, and
 * permission gating are pure and tested directly; the CRUD mutations go through
 * getDb() and are exercised by the DDL integration suite, so here we assert the
 * source contract for the DB-touching guarantees (system-row delete refusal,
 * duplicate-key mapping, and that every endpoint gates).
 */

// ── validation ──────────────────────────────────────────────────────────────────

test('a category outside the closed set is rejected', () => {
  assert.throws(() => validateSmallTalkInput({ category: 'weather', question: 'q', answer: 'a'.repeat(20) }), ChatbotSmallTalkValidationError)
  assert.doesNotThrow(() => validateSmallTalkInput({ category: 'social', question: 'q', answer: 'a'.repeat(20) }))
})

test('question and answer are required and length-bounded', () => {
  assert.throws(() => validateSmallTalkInput({ category: 'social', question: '', answer: 'x' }), ChatbotSmallTalkValidationError)
  assert.throws(() => validateSmallTalkInput({ category: 'social', question: 'a'.repeat(SMALL_TALK_MAX.question + 1), answer: 'x' }), ChatbotSmallTalkValidationError)
  assert.throws(() => validateSmallTalkInput({ category: 'social', question: 'q', answer: 'a'.repeat(SMALL_TALK_MAX.answer + 1) }), ChatbotSmallTalkValidationError)
})

test('patterns must be an array of strings within the count and length caps', () => {
  assert.throws(() => validateSmallTalkInput({ category: 'social', question: 'q', answer: 'aaaaaaaaaaaaaaaaaaaa', patterns: 'nope' }), ChatbotSmallTalkValidationError)
  assert.throws(() => validateSmallTalkInput({ category: 'social', question: 'q', answer: 'aaaaaaaaaaaaaaaaaaaa', patterns: [42] }), ChatbotSmallTalkValidationError)
  assert.throws(() => validateSmallTalkInput({ category: 'social', question: 'q', answer: 'aaaaaaaaaaaaaaaaaaaa', patterns: Array(SMALL_TALK_MAX.patternCount + 1).fill('x') }), ChatbotSmallTalkValidationError)
  assert.throws(() => validateSmallTalkInput({ category: 'social', question: 'q', answer: 'aaaaaaaaaaaaaaaaaaaa', patterns: ['a'.repeat(SMALL_TALK_MAX.patternLength + 1)] }), ChatbotSmallTalkValidationError)
})

test('patterns are normalized to plain form, de-duplicated, and emptied entries dropped', () => {
  const value = validateSmallTalkInput({ category: 'social', question: 'Xin chào', answer: 'aaaaaaaaaaaaaaaaaaaa', patterns: ['Xin Chào', 'xin chao', '   ', 'Cảm Ơn'] })
  assert.deepEqual(value.patterns, ['xin chao', 'cam on'])
})

// ── sanitization on BOTH write paths ─────────────────────────────────────────────

test('sanitize strips a script tag from the answer on create', () => {
  const value = validateSmallTalkInput({ category: 'social', question: 'Xin chào', answer: 'Chào anh/chị<script>alert(1)</script> ạ' })
  assert.ok(!/<script/i.test(value.answer!), value.answer!)
})

test('sanitize strips a script tag from the answer on update (partial)', () => {
  const value = validateSmallTalkInput({ answer: 'Nội dung<script>alert(1)</script> mới ạ' }, true)
  assert.ok(!/<script/i.test(value.answer!), value.answer!)
})

test('a question that sanitizes down to nothing is rejected', () => {
  assert.throws(() => validateSmallTalkInput({ category: 'social', question: '<script></script>', answer: 'aaaaaaaaaaaaaaaaaaaa' }), ChatbotSmallTalkValidationError)
})

test('serializeSmallTalk exposes the admin-facing shape with patterns defaulted to []', () => {
  const now = new Date('2026-01-01T00:00:00Z')
  const shaped = serializeSmallTalk({ id: 5, category: 'social', question: 'q', answer: 'a', patterns: null, isEnabled: true, isSystem: true, displayOrder: 3, createdAt: now, updatedAt: now, normalizedQuestion: 'q' } as any)
  assert.deepEqual(shaped.patterns, [])
  assert.equal(shaped.isSystem, true)
  assert.equal(shaped.id, 5)
})

// ── permission gating (pure) ──────────────────────────────────────────────────────

function event(adminUser?: unknown) { return { context: adminUser ? { adminUser } : {} } as any }
function permission(resource: string, grants: Partial<Record<string, boolean>> = {}) {
  return { resource, canCreate: false, canRead: false, canUpdate: false, canDelete: false, canPublish: false, canArchive: false, canTest: false, ...grants }
}
const hasStatus = (statusCode: number) => (error: any) => error?.statusCode === statusCode

test('small-talk gate returns 401 without an authenticated admin', () => {
  for (const action of ['read', 'create', 'update', 'delete'] as const) {
    assert.throws(() => requireChatbotSmallTalkPermission(event(), action), hasStatus(401))
  }
})

test('small-talk gate reuses the chatbot_knowledge resource and denies missing grants (403)', () => {
  const reader = event({ id: 2, isSuperAdmin: false, permissions: [permission(CHATBOT_RESOURCES.knowledge, { canRead: true })] })
  assert.equal(requireChatbotSmallTalkPermission(reader, 'read').id, 2)
  assert.throws(() => requireChatbotSmallTalkPermission(reader, 'create'), hasStatus(403))
  assert.throws(() => requireChatbotSmallTalkPermission(reader, 'update'), hasStatus(403))
  assert.throws(() => requireChatbotSmallTalkPermission(reader, 'delete'), hasStatus(403))

  const superadmin = event({ id: 1, isSuperAdmin: true, permissions: [] })
  for (const action of ['read', 'create', 'update', 'delete'] as const) {
    assert.equal(requireChatbotSmallTalkPermission(superadmin, action).id, 1)
  }
})

// ── source contract for the DB-touching guarantees ────────────────────────────────

test('deleteSmallTalk refuses system rows and maps duplicate keys to a validation error', () => {
  const source = readFileSync(new URL('../server/services/chatbot-small-talk.ts', import.meta.url), 'utf8')
  assert.match(source, /if \(current\.isSystem\) throw new ChatbotSmallTalkValidationError/u, 'system rows must not be deletable')
  assert.match(source, /isDuplicateKeyError\(error\)/u, 'duplicate key must be caught')
  assert.match(source, /ER_DUP_ENTRY/u)
  // sanitizeHtml applied on the shared write-validation path (create + update).
  assert.match(source, /sanitizeHtml/u)
})

test('every small-talk endpoint gates through requireChatbotSmallTalkPermission', () => {
  const dir = new URL('../server/api/admin/chatbot/small-talk/', import.meta.url)
  const files: { path: URL; label: string }[] = []
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.ts')) files.push({ path: new URL(name, dir), label: name })
  }
  // the [id]/toggle.patch.ts nested route
  files.push({ path: new URL('[id]/toggle.patch.ts', dir), label: '[id]/toggle.patch.ts' })
  assert.ok(files.length >= 8, `expected at least 8 endpoints, found ${files.length}`)
  for (const file of files) {
    const source = readFileSync(file.path, 'utf8')
    assert.match(source, /requireChatbotSmallTalkPermission\(event, '(read|create|update|delete)'\)/u, `${file.label} must gate`)
  }
})
