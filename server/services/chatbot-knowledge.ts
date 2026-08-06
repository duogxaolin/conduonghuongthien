import { and, asc, count, desc, eq, inArray, like, or } from 'drizzle-orm'
import { chatbotKnowledge, chatbotKnowledgeTerms, activityLogs, type ChatbotKnowledge } from '../db/schema'
import { getDb } from '../utils/db'
import { buildChatbotKnowledgeAudit, type KnowledgeAuditInput } from '../utils/chatbot/audit'
import { serializeAdminKnowledge } from '../utils/chatbot/serializers'

export const KNOWLEDGE_STATUSES = ['draft', 'published', 'archived'] as const
export type KnowledgeStatus = typeof KNOWLEDGE_STATUSES[number]
/** Tri-state filter: absent means "either", so the default listing is unchanged. */
export const QUICK_QUESTION_FILTERS = ['yes', 'no'] as const
export type KnowledgeInput = {
  canonicalQuestion?: unknown
  approvedAnswer?: unknown
  topic?: unknown
  aliases?: unknown
  keywords?: unknown
  sourceLabel?: unknown
  sourceUrl?: unknown
  sourceReference?: unknown
  internalNotes?: unknown
  status?: unknown
  priority?: unknown
  isQuickQuestion?: unknown
}

export class ChatbotKnowledgeValidationError extends Error { constructor(message: string) { super(message); this.name = 'ChatbotKnowledgeValidationError' } }

function text(value: unknown, field: string, max: number, required = false): string | null {
  if (value === undefined || value === null) { if (required) throw new ChatbotKnowledgeValidationError(`${field} is required`); return null }
  if (typeof value !== 'string') throw new ChatbotKnowledgeValidationError(`${field} must be text`)
  const result = value.trim()
  if (required && !result) throw new ChatbotKnowledgeValidationError(`${field} is required`)
  if (result.length > max) throw new ChatbotKnowledgeValidationError(`${field} exceeds ${max} characters`)
  return result || null
}

function terms(value: unknown, field: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 100) throw new ChatbotKnowledgeValidationError(`${field} must contain at most 100 items`)
  const values = new Map<string, string>()
  for (const item of value) {
    if (typeof item !== 'string') throw new ChatbotKnowledgeValidationError(`${field} must contain text`)
    const term = item.trim()
    if (!term || term.length > 1000) throw new ChatbotKnowledgeValidationError(`${field} contains an invalid item`)
    const normalized = normalize(term)
    if (!values.has(normalized)) values.set(normalized, term)
  }
  return [...values.values()]
}

function normalize(value: string): string { return value.normalize('NFKC').toLocaleLowerCase('vi-VN').replace(/\s+/gu, ' ').slice(0, 191) }
function rejectLifecycleStatus(input: KnowledgeInput) {
  if (Object.prototype.hasOwnProperty.call(input, 'status')) {
    throw new ChatbotKnowledgeValidationError('status can only be changed through publish/archive endpoints')
  }
}
function priority(value: unknown, defaultValue = 0): number {
  if (value === undefined) return defaultValue
  if (!Number.isSafeInteger(value) || Number(value) < -100000 || Number(value) > 100000) throw new ChatbotKnowledgeValidationError('priority is invalid')
  return Number(value)
}
function sourceUrl(value: string | null): string | null {
  if (!value) return null
  try { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error(); return url.toString() } catch { throw new ChatbotKnowledgeValidationError('sourceUrl must be a safe HTTPS URL') }
}

export function validateKnowledgeInput(input: KnowledgeInput, partial = false) {
  rejectLifecycleStatus(input)
  const canonicalQuestion = input.canonicalQuestion === undefined && partial ? undefined : text(input.canonicalQuestion, 'canonicalQuestion', 1000, true)
  const approvedAnswer = input.approvedAnswer === undefined && partial ? undefined : text(input.approvedAnswer, 'approvedAnswer', 100000, true)
  const topic = input.topic === undefined && partial ? undefined : text(input.topic ?? 'general', 'topic', 128, true)
  const sourceLabel = input.sourceLabel === undefined && partial ? undefined : text(input.sourceLabel, 'sourceLabel', 255)
  const sourceReference = input.sourceReference === undefined && partial ? undefined : text(input.sourceReference, 'sourceReference', 512)
  const internalNotes = input.internalNotes === undefined && partial ? undefined : text(input.internalNotes, 'internalNotes', 10000)
  const sourceUrlValue = input.sourceUrl === undefined && partial ? undefined : sourceUrl(text(input.sourceUrl, 'sourceUrl', 1024))
  const aliases = input.aliases === undefined && partial ? undefined : terms(input.aliases, 'aliases')
  const keywords = input.keywords === undefined && partial ? undefined : terms(input.keywords, 'keywords')
  const nextPriority = input.priority === undefined && partial ? undefined : priority(input.priority)
  const isQuickQuestion = input.isQuickQuestion === undefined && partial ? undefined : input.isQuickQuestion === true
  if (input.isQuickQuestion !== undefined && typeof input.isQuickQuestion !== 'boolean') throw new ChatbotKnowledgeValidationError('isQuickQuestion must be boolean')
  return { canonicalQuestion, approvedAnswer, topic, sourceLabel, sourceUrl: sourceUrlValue, sourceReference, internalNotes, aliases, keywords, priority: nextPriority, isQuickQuestion }
}

type KnowledgeStore = Pick<ReturnType<typeof getDb>, 'select' | 'insert' | 'update' | 'delete'>

/**
 * `extra` khai theo đúng các field tuỳ chọn mà bộ dựng audit đọc, không phải
 * `Record<string, unknown>` rồi ép kiểu.
 *
 * Ép kiểu ở đây từng che đúng loại lỗi mà bộ dựng ra đời để chặn: nó lọc
 * `changedFields` theo một allowlist, nên một khoá gõ sai (`changedField`) không
 * bao giờ tới được allowlist — dòng audit vẫn ghi, chỉ **thiếu** đúng phần nói
 * cán bộ đã sửa gì. Khai kiểu thật thì lỗi đó đỏ ngay lượt typecheck.
 */
type KnowledgeAuditExtra = Pick<KnowledgeAuditInput, 'changedFields' | 'fromStatus' | 'toStatus' | 'termCount'>

async function audit(db: KnowledgeStore, actorId: number, operation: KnowledgeAuditInput['operation'], id: number | undefined, extra: KnowledgeAuditExtra = {}) {
  await db.insert(activityLogs).values(buildChatbotKnowledgeAudit({ actorId, operation, knowledgeId: id, ...extra }))
}

async function withTerms(db: KnowledgeStore, entry: ChatbotKnowledge): Promise<ChatbotKnowledge & { aliases: string[]; keywords: string[] }> {
  const rows = await db.select().from(chatbotKnowledgeTerms).where(eq(chatbotKnowledgeTerms.knowledgeId, entry.id))
  return { ...entry, aliases: rows.filter(row => row.kind === 'alias').map(row => row.value), keywords: rows.filter(row => row.kind === 'keyword').map(row => row.value) }
}

async function getKnowledgeFrom(db: KnowledgeStore, id: number) {
  const [entry] = await db.select().from(chatbotKnowledge).where(eq(chatbotKnowledge.id, id)).limit(1)
  return entry ? withTerms(db, entry) : null
}

export async function getKnowledge(id: number) { return getKnowledgeFrom(getDb(), id) }
export async function listKnowledge(params: { page?: number; perPage?: number; search?: string; topic?: string; status?: string; quick?: string }) {
  const db = getDb()
  if (params.page !== undefined && (!Number.isSafeInteger(params.page) || params.page < 1)) throw new ChatbotKnowledgeValidationError('page is invalid')
  if (params.perPage !== undefined && (!Number.isSafeInteger(params.perPage) || params.perPage < 1)) throw new ChatbotKnowledgeValidationError('perPage is invalid')
  const page = params.page || 1
  const perPage = Math.min(100, params.perPage || 20)
  const search = (params.search || '').trim()
  if (search.length > 200) throw new ChatbotKnowledgeValidationError('search exceeds 200 characters')
  if ((params.topic || '').length > 128) throw new ChatbotKnowledgeValidationError('topic exceeds 128 characters')
  const conditions = []
  if (search) {
    const termRows = await db.select({ knowledgeId: chatbotKnowledgeTerms.knowledgeId }).from(chatbotKnowledgeTerms).where(like(chatbotKnowledgeTerms.value, `%${search}%`)).limit(1000)
    const termIds = [...new Set(termRows.map(row => row.knowledgeId))]
    conditions.push(or(like(chatbotKnowledge.canonicalQuestion, `%${search}%`), like(chatbotKnowledge.approvedAnswer, `%${search}%`), like(chatbotKnowledge.topic, `%${search}%`), ...(termIds.length ? [inArray(chatbotKnowledge.id, termIds)] : []))!)
  }
  if (params.topic) conditions.push(eq(chatbotKnowledge.topic, params.topic))
  if (params.status) { if (!(KNOWLEDGE_STATUSES as readonly string[]).includes(params.status)) throw new ChatbotKnowledgeValidationError('status is invalid'); conditions.push(eq(chatbotKnowledge.status, params.status as KnowledgeStatus)) }
  if (params.quick) {
    if (!(QUICK_QUESTION_FILTERS as readonly string[]).includes(params.quick)) throw new ChatbotKnowledgeValidationError('quick is invalid')
    conditions.push(eq(chatbotKnowledge.isQuickQuestion, params.quick === 'yes'))
  }
  const where = conditions.length ? and(...conditions) : undefined
  const rows = await db.select().from(chatbotKnowledge).where(where).orderBy(desc(chatbotKnowledge.priority), desc(chatbotKnowledge.updatedAt), asc(chatbotKnowledge.id)).limit(perPage).offset((page - 1) * perPage)
  const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(chatbotKnowledge).where(where)
  return { items: await Promise.all(rows.map(row => withTerms(db, row))), pagination: { page, perPage, total: Number(total), totalPages: Math.ceil(Number(total) / perPage) } }
}

function validatePublish(answer: string | undefined | null, label: string | null | undefined, reference: string | null | undefined, url: string | null | undefined) { if (!answer?.trim()) throw new ChatbotKnowledgeValidationError('published knowledge requires approvedAnswer'); if (!label && !reference && !url) throw new ChatbotKnowledgeValidationError('published knowledge requires source metadata') }
async function replaceTermsWithTx(tx: KnowledgeStore, id: number, aliases: string[], keywords: string[]) { await tx.delete(chatbotKnowledgeTerms).where(eq(chatbotKnowledgeTerms.knowledgeId, id)); const values = [...aliases.map(value => ({ knowledgeId: id, kind: 'alias' as const, value, normalizedValue: normalize(value) })), ...keywords.map(value => ({ knowledgeId: id, kind: 'keyword' as const, value, normalizedValue: normalize(value) }))]; if (values.length) await tx.insert(chatbotKnowledgeTerms).values(values) }

export async function createKnowledge(actorId: number, input: KnowledgeInput) {
  const value = validateKnowledgeInput(input)
  const db = getDb()
  return db.transaction(async (tx) => {
    const [result] = await tx.insert(chatbotKnowledge).values({ canonicalQuestion: value.canonicalQuestion!, normalizedQuestion: normalize(value.canonicalQuestion!), approvedAnswer: value.approvedAnswer!, topic: value.topic!, sourceLabel: value.sourceLabel, sourceUrl: value.sourceUrl, sourceReference: value.sourceReference, internalNotes: value.internalNotes, status: 'draft', priority: value.priority!, isQuickQuestion: value.isQuickQuestion!, authorId: actorId, reviewerId: null, reviewedAt: null, publishedAt: null, archivedAt: null }).$returningId()
    if (!result) throw new Error('insert into chatbot_knowledge returned no id')
    const id = Number(result.id)
    await replaceTermsWithTx(tx, id, value.aliases || [], value.keywords || [])
    await audit(tx, actorId, 'create', id, { changedFields: Object.keys(input), termCount: (value.aliases?.length || 0) + (value.keywords?.length || 0) })
    return getKnowledgeFrom(tx, id)
  })
}

export async function updateKnowledge(actorId: number, id: number, input: KnowledgeInput) {
  const value = validateKnowledgeInput(input, true)
  const db = getDb()
  const current = await getKnowledgeFrom(db, id)
  if (!current) return null
  const next = { ...current, ...Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) } as typeof current
  if (current.status === 'published') validatePublish(next.approvedAnswer, next.sourceLabel, next.sourceReference, next.sourceUrl)
  return db.transaction(async (tx) => {
    const patch: Partial<typeof chatbotKnowledge.$inferInsert> = {}
    for (const [key, item] of Object.entries(value)) if (item !== undefined && !['aliases', 'keywords'].includes(key)) Object.assign(patch, { [key]: item })
    if (value.canonicalQuestion !== undefined) patch.normalizedQuestion = normalize(value.canonicalQuestion!)
    if (Object.keys(patch).length) await tx.update(chatbotKnowledge).set(patch).where(eq(chatbotKnowledge.id, id))
    if (value.aliases !== undefined || value.keywords !== undefined) await replaceTermsWithTx(tx, id, value.aliases ?? current.aliases, value.keywords ?? current.keywords)
    await audit(tx, actorId, 'update', id, { changedFields: Object.keys(input) })
    return getKnowledgeFrom(tx, id)
  })
}

export async function transitionKnowledge(actorId: number, id: number, target: 'published' | 'archived') { const current = await getKnowledge(id); if (!current) return null; if (target === 'published') validatePublish(current.approvedAnswer, current.sourceLabel, current.sourceReference, current.sourceUrl); const db = getDb(); const now = new Date(); await db.update(chatbotKnowledge).set({ status: target, publishedAt: target === 'published' ? now : current.publishedAt, archivedAt: target === 'archived' ? now : null, reviewerId: actorId, reviewedAt: now }).where(eq(chatbotKnowledge.id, id)); await audit(db, actorId, target === 'published' ? 'publish' : 'archive', id, { fromStatus: current.status, toStatus: target, termCount: current.aliases.length + current.keywords.length }); return getKnowledge(id) }
export async function deleteKnowledge(actorId: number, id: number) { const current = await getKnowledge(id); if (!current) return false; const db = getDb(); await db.delete(chatbotKnowledge).where(eq(chatbotKnowledge.id, id)); await audit(db, actorId, 'delete', id); return true }
export function adminKnowledge(entry: Awaited<ReturnType<typeof getKnowledge>>) { return entry ? { ...serializeAdminKnowledge(entry), aliases: entry.aliases, keywords: entry.keywords } : null }
