import { and, asc, count, eq, like, or } from 'drizzle-orm'
import { chatbotSmallTalk, activityLogs, type ChatbotSmallTalk } from '../db/schema'
import { getDb } from '../utils/db'
import { sanitizeHtml } from '../utils/sanitize-html'
import { plain, normalizeQuestion } from '../utils/chatbot/small-talk'
import { SMALL_TALK_CATEGORIES } from '../data/chatbot-small-talk-seed'

/**
 * Admin service for the everyday-reply store (table chatbot_small_talk).
 *
 * Separate from chatbot-knowledge.ts by design: there is NO draft→published
 * flow and NO source requirement here — those belong to the approved bank. What
 * this store keeps from the knowledge service is the safety posture: every
 * write is sanitized, lengths are bounded, bad types are rejected with a typed
 * error, and system rows cannot be deleted (only edited/toggled).
 */

export const SMALL_TALK_MAX = Object.freeze({
  question: 500,
  answer: 20_000,
  patternCount: 20,
  patternLength: 200,
})

export class ChatbotSmallTalkValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'ChatbotSmallTalkValidationError' }
}

export type SmallTalkInput = {
  category?: unknown
  question?: unknown
  answer?: unknown
  patterns?: unknown
  isEnabled?: unknown
}

function textField(value: unknown, field: string, max: number, required = false): string | undefined | null {
  if (value === undefined) { if (required) throw new ChatbotSmallTalkValidationError(`${field} is required`); return undefined }
  if (value === null) { if (required) throw new ChatbotSmallTalkValidationError(`${field} is required`); return null }
  if (typeof value !== 'string') throw new ChatbotSmallTalkValidationError(`${field} must be text`)
  const result = value.trim()
  if (required && !result) throw new ChatbotSmallTalkValidationError(`${field} is required`)
  if (result.length > max) throw new ChatbotSmallTalkValidationError(`${field} exceeds ${max} characters`)
  return result
}

function category(value: unknown, partial: boolean): string | undefined {
  if (value === undefined && partial) return undefined
  if (typeof value !== 'string' || !(SMALL_TALK_CATEGORIES as readonly string[]).includes(value)) {
    throw new ChatbotSmallTalkValidationError(`category must be one of: ${SMALL_TALK_CATEGORIES.join(', ')}`)
  }
  return value
}

/**
 * Normalize the match patterns for storage: diacritic-stripped lowercase via the
 * matcher's `plain()`, empties dropped, duplicates collapsed. This mirrors what
 * the matcher does at runtime, so a pattern typed with diacritics still works.
 */
function patterns(value: unknown, partial: boolean): string[] | undefined {
  if (value === undefined && partial) return undefined
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new ChatbotSmallTalkValidationError('patterns must be an array')
  if (value.length > SMALL_TALK_MAX.patternCount) throw new ChatbotSmallTalkValidationError(`patterns must contain at most ${SMALL_TALK_MAX.patternCount} items`)
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') throw new ChatbotSmallTalkValidationError('patterns must contain text')
    if (item.length > SMALL_TALK_MAX.patternLength) throw new ChatbotSmallTalkValidationError(`patterns contains an item over ${SMALL_TALK_MAX.patternLength} characters`)
    const normalized = plain(item)
    if (normalized) seen.add(normalized)
  }
  return [...seen]
}

function boolean(value: unknown, field: string, partial: boolean): boolean | undefined {
  if (value === undefined && partial) return undefined
  if (typeof value !== 'boolean') throw new ChatbotSmallTalkValidationError(`${field} must be boolean`)
  return value
}

export function validateSmallTalkInput(input: SmallTalkInput, partial = false) {
  const cat = category(input.category, partial)
  const question = input.question === undefined && partial ? undefined : textField(input.question, 'question', SMALL_TALK_MAX.question, true)
  const rawAnswer = input.answer === undefined && partial ? undefined : textField(input.answer, 'answer', SMALL_TALK_MAX.answer, true)
  // Sanitize on every write path (create and update) before storage.
  const answer = rawAnswer === undefined ? undefined : sanitizeHtml(rawAnswer)
  if (answer !== undefined && !answer.trim()) throw new ChatbotSmallTalkValidationError('answer is required')
  const sanitizedQuestion = question === undefined ? undefined : sanitizeHtml(question)
  if (sanitizedQuestion !== undefined && !sanitizedQuestion.trim()) throw new ChatbotSmallTalkValidationError('question is required')
  const pats = patterns(input.patterns, partial)
  // isEnabled is always optional: create defaults it to true (createSmallTalk),
  // update leaves it unchanged when absent. Passing partial=true unconditionally
  // makes an absent value acceptable on both paths — otherwise a create body
  // without the flag (as the admin form sends) is wrongly rejected.
  const isEnabled = boolean(input.isEnabled, 'isEnabled', true)
  return { category: cat, question: sanitizedQuestion, answer, patterns: pats, isEnabled }
}
type SmallTalkStore = Pick<ReturnType<typeof getDb>, 'select' | 'insert' | 'update' | 'delete'>

async function audit(db: SmallTalkStore, actorId: number, action: 'create' | 'update' | 'delete' | 'toggle', id: number | undefined, meta: Record<string, unknown> = {}) {
  await db.insert(activityLogs).values({
    userId: actorId,
    action,
    resource: 'chatbot_knowledge',
    resourceId: id,
    meta: { store: 'small_talk', ...meta },
  })
}

export function serializeSmallTalk(entry: ChatbotSmallTalk) {
  return {
    id: entry.id,
    category: entry.category,
    question: entry.question,
    answer: entry.answer,
    patterns: entry.patterns ?? [],
    isEnabled: entry.isEnabled,
    isSystem: entry.isSystem,
    displayOrder: entry.displayOrder,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
}

export async function getSmallTalk(id: number) {
  const [entry] = await getDb().select().from(chatbotSmallTalk).where(eq(chatbotSmallTalk.id, id)).limit(1)
  return entry ?? null
}

export async function listSmallTalk(params: { page?: number; perPage?: number; search?: string; category?: string; enabled?: boolean }) {
  const db = getDb()
  if (params.page !== undefined && (!Number.isSafeInteger(params.page) || params.page < 1)) throw new ChatbotSmallTalkValidationError('page is invalid')
  if (params.perPage !== undefined && (!Number.isSafeInteger(params.perPage) || params.perPage < 1)) throw new ChatbotSmallTalkValidationError('perPage is invalid')
  const page = params.page || 1
  const perPage = Math.min(100, params.perPage || 20)
  const search = (params.search || '').trim()
  if (search.length > 200) throw new ChatbotSmallTalkValidationError('search exceeds 200 characters')
  const conditions = []
  if (search) conditions.push(or(like(chatbotSmallTalk.question, `%${search}%`), like(chatbotSmallTalk.answer, `%${search}%`))!)
  if (params.category) { if (!(SMALL_TALK_CATEGORIES as readonly string[]).includes(params.category)) throw new ChatbotSmallTalkValidationError('category is invalid'); conditions.push(eq(chatbotSmallTalk.category, params.category)) }
  if (params.enabled !== undefined) conditions.push(eq(chatbotSmallTalk.isEnabled, params.enabled))
  const where = conditions.length ? and(...conditions) : undefined
  const rows = await db.select().from(chatbotSmallTalk).where(where).orderBy(asc(chatbotSmallTalk.displayOrder), asc(chatbotSmallTalk.id)).limit(perPage).offset((page - 1) * perPage)
  const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(chatbotSmallTalk).where(where)
  return { items: rows.map(serializeSmallTalk), pagination: { page, perPage, total: Number(total), totalPages: Math.ceil(Number(total) / perPage) } }
}

/** Turn a unique-key collision into a clear validation error instead of a raw SQL error. */
function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ER_DUP_ENTRY'
}

export async function createSmallTalk(actorId: number, input: SmallTalkInput) {
  const value = validateSmallTalkInput(input)
  const db = getDb()
  const normalizedQuestion = normalizeQuestion(value.question!)
  if (!normalizedQuestion) throw new ChatbotSmallTalkValidationError('question is required')
  try {
    // Trả `id` RA KHỎI khối, không đọc biến ngoài từ bên trong: một
    // `const id = await db.transaction(… id …)` để `id` trong vùng chết tạm thời
    // suốt callback và ném `ReferenceError` **lúc chạy** — typecheck và build đều
    // không thấy (đã trả giá một lần ở bốn endpoint tạo mới).
    const id = await db.transaction(async (tx) => {
      const [result] = await tx.insert(chatbotSmallTalk).values({
        category: value.category!,
        question: value.question!,
        normalizedQuestion,
        answer: value.answer!,
        patterns: value.patterns ?? [],
        isEnabled: value.isEnabled ?? true,
        isSystem: false,
        displayOrder: 0,
      }).$returningId()
      if (!result) throw new Error('insert into chatbot_small_talk returned no id')
      const created = Number(result.id)
      await audit(tx, actorId, 'create', created, { category: value.category })
      return created
    })
    return getSmallTalk(id)
  } catch (error) {
    if (isDuplicateKeyError(error)) throw new ChatbotSmallTalkValidationError('Đã có mục với câu hỏi này. Vui lòng dùng câu hỏi khác.')
    throw error
  }
}

export async function updateSmallTalk(actorId: number, id: number, input: SmallTalkInput) {
  const value = validateSmallTalkInput(input, true)
  const db = getDb()
  const current = await getSmallTalk(id)
  if (!current) return null
  const patch: Partial<ChatbotSmallTalk> = {}
  if (value.category !== undefined) patch.category = value.category
  if (value.answer !== undefined) patch.answer = value.answer
  if (value.patterns !== undefined) patch.patterns = value.patterns
  if (value.isEnabled !== undefined) patch.isEnabled = value.isEnabled
  if (value.question !== undefined) {
    const normalizedQuestion = normalizeQuestion(value.question)
    if (!normalizedQuestion) throw new ChatbotSmallTalkValidationError('question is required')
    patch.question = value.question
    patch.normalizedQuestion = normalizedQuestion
  }
  // Cùng transaction, và `audit` nhận `tx` — `SmallTalkStore` được khai làm một
  // `Pick<>` chính để nhận cả handle transaction. Truyền `db` vào đây thì câu
  // audit chạy trên pool và commit độc lập: đúng con bug đó nhưng khoác áo
  // transaction.
  await db.transaction(async (tx) => {
    if (Object.keys(patch).length) {
      try {
        await tx.update(chatbotSmallTalk).set(patch).where(eq(chatbotSmallTalk.id, id))
      } catch (error) {
        if (isDuplicateKeyError(error)) throw new ChatbotSmallTalkValidationError('Đã có mục với câu hỏi này. Vui lòng dùng câu hỏi khác.')
        throw error
      }
    }
    await audit(tx, actorId, 'update', id, { changedFields: Object.keys(patch) })
  })
  return getSmallTalk(id)
}

export async function setSmallTalkEnabled(actorId: number, id: number, isEnabled: boolean) {
  const db = getDb()
  const current = await getSmallTalk(id)
  if (!current) return null
  await db.transaction(async (tx) => {
    await tx.update(chatbotSmallTalk).set({ isEnabled }).where(eq(chatbotSmallTalk.id, id))
    await audit(tx, actorId, 'toggle', id, { isEnabled })
  })
  return getSmallTalk(id)
}

/** System rows are editable and toggleable, but never deletable (pages/content_types pattern). */
export async function deleteSmallTalk(actorId: number, id: number): Promise<boolean> {
  const db = getDb()
  const current = await getSmallTalk(id)
  if (!current) return false
  if (current.isSystem) throw new ChatbotSmallTalkValidationError('Không thể xóa mục hệ thống. Anh/chị có thể tắt mục này thay vì xóa.')
  await db.transaction(async (tx) => {
    await tx.delete(chatbotSmallTalk).where(eq(chatbotSmallTalk.id, id))
    await audit(tx, actorId, 'delete', id)
  })
  return true
}

export function adminSmallTalk(entry: ChatbotSmallTalk | null) {
  return entry ? serializeSmallTalk(entry) : null
}

