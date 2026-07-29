import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

class ValidationError extends Error {}
let nextId = 1
const created: Array<{ id: number; question: string }> = []
const published: number[] = []
const logged: unknown[] = []

mock.module(new URL('../server/utils/permissions.ts', import.meta.url), {
  namedExports: {
    requireChatbotKnowledgePermission: (event: any) => event.context.actor,
  },
})

mock.module(new URL('../server/services/chatbot-knowledge.ts', import.meta.url), {
  namedExports: {
    ChatbotKnowledgeValidationError: ValidationError,
    createKnowledge: async (_actorId: number, input: Record<string, unknown>) => {
      const question = String(input.canonicalQuestion || '')
      if (question === 'Lỗi nội bộ') throw new Error('ER_DUP_ENTRY secret_table SQLSTATE 23000')
      if (question === 'Preview dài') throw new ValidationError('approvedAnswer exceeds 100000 characters')
      if (question === 'Tham chiếu dài') throw new ValidationError('sourceReference exceeds 512 characters')
      const entry = { id: nextId++, question }
      created.push(entry)
      return entry
    },
    transitionKnowledge: async (_actorId: number, id: number) => {
      const entry = created.find(item => item.id === id)
      if (entry?.question === 'Không xuất bản được') throw new Error('database host and SQL leaked detail')
      published.push(id)
      return { id, status: 'published' }
    },
  },
})

mock.module(new URL('../server/utils/logger.ts', import.meta.url), {
  namedExports: {
    logError: (fields: unknown) => { logged.push(fields) },
  },
})

Object.assign(globalThis, {
  defineEventHandler: (handler: (event: any) => unknown) => handler,
  readMultipartFormData: async (event: any) => event.context.form,
  createError: (input: { statusCode: number; statusMessage: string }) => Object.assign(new Error(input.statusMessage), input),
})

const handler = (await import('../server/api/admin/chatbot/knowledge/import.post')).default

function part(name: string, value: string, filename?: string) {
  return { name, data: Buffer.from(value, 'utf8'), ...(filename ? { filename } : {}) }
}

function event(csv: string, fields: Record<string, string> = {}) {
  return {
    context: {
      actor: { id: 9 },
      form: [part('file', csv, 'knowledge.csv'), ...Object.entries(fields).map(([name, value]) => part(name, value))],
    },
  } as any
}

function reset() {
  nextId = 1
  created.length = 0
  published.length = 0
  logged.length = 0
}

test('partial import returns every parse issue rather than capping errors at 20', async () => {
  reset()
  const malformed = Array.from({ length: 25 }, (_, index) => `${index + 1},Câu hỏi ${index + 1},`).join('\n')
  const response = await handler(event(`STT,Câu hỏi,Trả lời,Ghi chú\n${malformed}\n26,Câu hợp lệ,Đáp án,nguồn\n`))

  assert.equal(response.total, 26)
  assert.equal(response.imported, 1)
  assert.equal(response.skipped, 25)
  assert.equal(response.errors.length, 25)
  assert.deepEqual(response.errors[0], {
    stage: 'parse',
    row: 2,
    endRow: 2,
    code: 'missing_answer',
    message: 'Thiếu Trả lời.',
    raw: { stt: '1', question: 'Câu hỏi 1', answer: '', note: '' },
    truncatedFields: [],
  })
})

test('unmapped-column data is returned as a parse issue with bounded raw preview', async () => {
  reset()
  const extraValue = 'x'.repeat(700)
  const response = await handler(event(`STT,Câu hỏi,Trả lời,Ghi chú,Cột lạ\n1,Hỏi?,Đáp án,,${extraValue}\n`))
  const [error] = response.errors

  assert.equal(response.total, 1)
  assert.equal(response.imported, 0)
  assert.equal(response.skipped, 1)
  assert.equal(error.code, 'unmapped_data')
  assert.deepEqual(error.raw.rawExtraColumns?.map((item: any) => item.column), ['E'])
  assert.equal(error.raw.rawExtraColumns?.[0].value.length, 513)
  assert.deepEqual(error.truncatedFields, ['rawExtraColumns.0.value'])
})

test('source-reference length errors have a field-specific Vietnamese message', async () => {
  reset()
  const response = await handler(event('STT,Câu hỏi,Trả lời,Ghi chú\n1,Tham chiếu dài,Đáp án,nguồn\n'))

  assert.equal(response.errors[0].code, 'source_reference_too_long')
  assert.equal(response.errors[0].message, 'Ghi chú/Tham chiếu nguồn vượt quá giới hạn cho phép.')
})

test('raw previews are bounded and retain truncation metadata', async () => {
  reset()
  const longAnswer = `Dòng đầu\n${'x'.repeat(5000)}`
  const response = await handler(event(`STT,Câu hỏi,Trả lời\n1,Preview dài,"${longAnswer}"\n`))
  const [error] = response.errors

  assert.equal(response.imported, 0)
  assert.equal(error.stage, 'save')
  assert.equal(error.code, 'answer_too_long')
  assert.equal(error.message, 'Trả lời vượt quá giới hạn cho phép.')
  assert.ok(error.raw.answer.startsWith('Dòng đầu\n'))
  assert.ok(error.raw.answer.length <= 4001)
  assert.deepEqual(error.truncatedFields, ['answer'])
})

test('unknown save errors are hidden while partial success continues', async () => {
  reset()
  const response = await handler(event('STT,Câu hỏi,Trả lời\n1,Lỗi nội bộ,Đáp một\n2,Câu hợp lệ,Đáp hai\n'))
  const [error] = response.errors

  assert.equal(response.total, 2)
  assert.equal(response.imported, 1)
  assert.equal(response.skipped, 1)
  assert.equal(error.stage, 'save')
  assert.equal(error.code, 'save_error')
  assert.equal(error.message, 'Không thể lưu dòng do lỗi hệ thống.')
  assert.doesNotMatch(JSON.stringify(error), /SQL|secret_table|23000/)
  assert.equal(logged.length, 1)
})

test('a publish failure keeps the imported draft and reports publish state separately', async () => {
  reset()
  const response = await handler(event(
    'STT,Câu hỏi,Trả lời,Ghi chú\n1,Không xuất bản được,Đáp một,nguồn\n2,Xuất bản được,Đáp hai,nguồn\n',
    { publish: '1' },
  ))
  const [error] = response.errors

  assert.equal(response.total, 2)
  assert.equal(response.imported, 2)
  assert.equal(response.published, 1)
  assert.equal(response.skipped, 0)
  assert.equal(error.stage, 'publish')
  assert.equal(error.code, 'publish_error')
  assert.equal(error.message, 'Đã nhập bản nháp nhưng không thể xuất bản do lỗi hệ thống.')
  assert.doesNotMatch(JSON.stringify(error), /database host|SQL leaked/)
  assert.equal(created.length, 2)
  assert.equal(published.length, 1)
})
