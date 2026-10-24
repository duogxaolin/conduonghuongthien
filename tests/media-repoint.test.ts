/**
 * Đổi domain R2 — các mảnh không cần MySQL (wave2 D-REPOINT):
 *
 *   - mẫu khớp domain (`domainRepointForms`) chạy bằng engine JS: chỉ đổi domain đứng
 *     ngay sau `scheme://` và trước `/` hoặc ranh giới URL; host giống (`xold.cdn`,
 *     `old.cdn.evil`, `old.cdn:8443`, `//old.cdn`) và tiền tố đường dẫn khác
 *     (`cdn/media2`) không đổi; cột JSON đổi cả dạng thoát `\/`;
 *   - đầu vào: chuẩn hoá domain, từ chối domain mới chứa domain cũ (không idempotent);
 *   - sao lưu hỏng → dừng TRƯỚC transaction, endpoint trả 500 với câu không lộ chi tiết
 *     máy chủ; khoá bận → 409; đầu vào sai → 400.
 *
 * Hành vi trên MySQL thật (27 cột, REGEXP_REPLACE ICU, JSON, một transaction, chạy
 * lại không đổi gì) nằm ở `media-repoint-integration.test.ts`.
 *
 * Mẫu được chạy bằng engine JS (bỏ `(?-i)` — JS vốn phân biệt hoa thường).
 */
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

const lock = { acquired: 1 }
const transactions = { opened: 0 }
mock.module('../server/utils/db', {
  namedExports: {
    getDb: () => ({ transaction: async () => { transactions.opened += 1; throw new Error('the repoint opened a transaction') } }),
    getPool: () => ({
      getConnection: async () => ({
        query: async (sql: string) => (sql.includes('GET_LOCK') ? [[{ acquired: lock.acquired }]] : [[]]),
        release: () => undefined,
      }),
    }),
  },
})
const logged: Array<Record<string, unknown>> = []
mock.module('../server/utils/logger', {
  namedExports: {
    logInfo: (r: Record<string, unknown>) => { logged.push(r) },
    logWarn: (r: Record<string, unknown>) => { logged.push(r) },
    logError: (r: Record<string, unknown>) => { logged.push(r) },
  },
})
let backupOutcome: () => Promise<unknown> = async () => ({ stamp: 's', files: [], driveUploaded: false })
mock.module('../server/services/backup', {
  namedExports: { runBackup: async () => backupOutcome() },
})
mock.module('../server/utils/permissions', { namedExports: { requireResourcePermission: () => {} } })

const { domainRepointForms } = await import('../server/services/media-sync-url-match.ts')
const repoint = await import('../server/services/media-repoint.ts')

/** Áp mọi dạng lên một chuỗi, như REGEXP_REPLACE của MySQL. */
function applyJs(kind: 'text' | 'json', oldDomain: string, newDomain: string, text: string): string {
  let out = text
  for (const form of domainRepointForms(kind, oldDomain, newDomain)) {
    assert.ok(form.pattern.startsWith('(?-i)'), 'thiếu (?-i): collation _ci làm REGEXP không phân biệt hoa thường')
    const re = new RegExp(form.pattern.slice('(?-i)'.length), 'gu')
    const literal = form.replacement.replace(/\\(.)/g, '$1')
    out = out.replace(re, () => literal)
  }
  return out
}

test('domain đứng sau scheme:// và trước / hoặc ranh giới URL thì đổi; host giống thì không', () => {
  const cases: Array<[string, string]> = [
    ['<img src="https://old.cdn/a/x.webp">', '<img src="https://new.cdn/a/x.webp">'],
    ['<a href="http://old.cdn/b.pdf">', '<a href="http://new.cdn/b.pdf">'],
    ['logo: https://old.cdn', 'logo: https://new.cdn'],
    ['(https://old.cdn)', '(https://new.cdn)'],
    ['https://old.cdn?v=2 https://old.cdn#top', 'https://new.cdn?v=2 https://new.cdn#top'],
    ['Xem https://old.cdn.', 'Xem https://new.cdn.'],
    // Host khác, không đổi:
    ['https://xold.cdn/a.png', 'https://xold.cdn/a.png'],
    ['https://old.cdn.evil/a.png', 'https://old.cdn.evil/a.png'],
    ['https://old.cdnx/a.png', 'https://old.cdnx/a.png'],
    ['https://old.cdn:8443/p.png', 'https://old.cdn:8443/p.png'],
    ['//old.cdn/rel.png', '//old.cdn/rel.png'],
    ['old.cdn/khong-scheme.png', 'old.cdn/khong-scheme.png'],
    ['https://cdn.old.cdn/a.png', 'https://cdn.old.cdn/a.png'],
  ]
  for (const [input, expected] of cases) assert.equal(applyJs('text', 'old.cdn', 'new.cdn', input), expected, input)
})

test('domain có tiền tố đường dẫn khớp đúng tiền tố đó, không khớp tiền tố dài hơn', () => {
  assert.equal(applyJs('text', 'cdn.x.vn/media', 'r2.y.vn', 'https://cdn.x.vn/media/a.png'), 'https://r2.y.vn/a.png')
  assert.equal(applyJs('text', 'cdn.x.vn/media', 'r2.y.vn', 'https://cdn.x.vn/media2/a.png'), 'https://cdn.x.vn/media2/a.png')
  assert.equal(applyJs('text', 'cdn.x.vn/media', 'r2.y.vn', 'https://cdn.x.vn/a.png'), 'https://cdn.x.vn/a.png')
})

test('cột json: đổi cả dạng thô lẫn dạng thoát \\/ (JSON trong cột TEXT), và chạy lại không đổi gì', () => {
  const value = JSON.stringify({ a: 'https://old.cdn/x.png', b: '<img src="http://old.cdn/y.png">', c: 'https://xold.cdn/z.png' })
  const escaped = value.replace(/\//g, '\\/')
  const once = applyJs('json', 'old.cdn', 'new.cdn', `${value}|${escaped}`)
  assert.equal(once, `${value.replaceAll('//old.cdn', '//new.cdn')}|${escaped.replaceAll('\\/\\/old.cdn', '\\/\\/new.cdn')}`)
  assert.equal(applyJs('json', 'old.cdn', 'new.cdn', once), once, 'idempotent')
  assert.deepEqual(JSON.parse(once.split('|')[0]!).c, 'https://xold.cdn/z.png')
})

test('chuẩn hoá domain và từ chối đầu vào không đổi được — trước khi chạm CSDL', async () => {
  assert.equal(repoint.normalizeRepointDomain('  https://Old.cdn/// ', 'Domain cũ'), 'Old.cdn')
  assert.throws(() => repoint.normalizeRepointDomain('   ', 'Domain cũ'), repoint.RepointInputError)
  assert.throws(() => repoint.normalizeRepointDomain('old cdn', 'Domain cũ'), repoint.RepointInputError)
  await assert.rejects(() => repoint.repointR2Urls('old.cdn', 'https://old.cdn/', null), repoint.RepointInputError)
  // Domain mới chứa domain cũ: chạy lại sẽ nối thêm `/v2/v2/…` — từ chối.
  await assert.rejects(() => repoint.repointR2Urls('old.cdn', 'old.cdn/v2', null), repoint.RepointInputError)
  await assert.rejects(() => repoint.repointR2Urls('old.cdn', 'new"cdn', null), repoint.RepointInputError)
  assert.equal(transactions.opened, 0)
})

test('sao lưu hỏng: dừng trước transaction, log nguyên nhân, không đổi gì', async () => {
  backupOutcome = async () => { throw new Error('mysqldump: Got errno 28 on write') }
  logged.length = 0
  await assert.rejects(() => repoint.repointR2Urls('old.cdn', 'new.cdn', 7), repoint.RepointBackupError)
  assert.equal(transactions.opened, 0, 'không transaction nào được mở khi sao lưu hỏng')
  const failure = logged.find(r => r.event === 'media.repoint_pre_backup_failed')
  assert.ok(failure, 'nguyên nhân được log')
  assert.match(String(failure.error), /errno 28/)
})

// ── Endpoint ─────────────────────────────────────────────────────────────────

const h3 = await import('h3')
type Event = { body: unknown, context: { adminUser: unknown } }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.readBody = async (event: Event) => event.body
globals.createError = h3.createError
const handler = (await import('../server/api/admin/media/repoint-r2-urls.post.ts')).default as unknown as (event: Event) => Promise<unknown>

async function failure(body: unknown): Promise<{ statusCode?: number, statusMessage?: string }> {
  try {
    await handler({ body, context: { adminUser: { id: 1 } } })
  } catch (error) {
    return error as { statusCode?: number, statusMessage?: string }
  }
  assert.fail('the handler should have thrown')
}

test('endpoint: đầu vào sai 400, khoá bận 409, sao lưu hỏng 500 với câu không lộ chi tiết máy chủ', async () => {
  assert.equal((await failure({ oldDomain: 'old.cdn' })).statusCode, 400)
  assert.equal((await failure({ oldDomain: 'old.cdn', newDomain: 'old.cdn/v2' })).statusCode, 400)

  backupOutcome = async () => { throw new Error('mysqldump: Got errno 28 on write') }
  const backupFailed = await failure({ oldDomain: 'old.cdn', newDomain: 'new.cdn' })
  assert.equal(backupFailed.statusCode, 500)
  assert.match(String(backupFailed.statusMessage), /chưa đổi URL nào/)
  assert.doesNotMatch(String(backupFailed.statusMessage), /mysqldump|errno/)

  lock.acquired = 0
  assert.equal((await failure({ oldDomain: 'old.cdn', newDomain: 'new.cdn' })).statusCode, 409)
  lock.acquired = 1
})
