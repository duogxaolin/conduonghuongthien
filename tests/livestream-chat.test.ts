/**
 * Chat trực tiếp — gửi, lịch sử, kiểm duyệt, và luồng SSE.
 *
 * Năm điều tệp này phải chứng minh, và mỗi điều là một chỗ mà một lượt đọc mã nói
 * dối:
 *
 *  1. **Hạn mức được tiêu NGAY TRƯỚC câu INSERT.** Trừ ở đầu hàm nghĩa là một người
 *     mà cả hai mươi lần thử đều rơi vào lúc không có buổi phát nào vẫn tiêu hết
 *     hạn mức của chính mình — và một kẻ tấn công tiêu được hạn mức của người khác
 *     bằng những request **luôn luôn thất bại**. Khẳng định ở đây là hành vi (bộ đếm
 *     còn nguyên sau một lượt bị từ chối) **và** thứ tự trong mã nguồn.
 *  2. **Lưu TRƯỚC, phát SAU.** Phát trước rồi mới lưu thì một lượt INSERT hỏng để lại
 *     một tin nhắn đã hiện trên màn hình hàng trăm người và không nằm trong lịch sử
 *     của ai.
 *  3. **Tên được CHỤP lúc gửi.** Đổi tên sau đó không được viết lại thứ người khác
 *     đã đọc — nên tên là một chuỗi chụp vào hàng, không phải một khoá ngoại đọc lại
 *     lúc render.
 *  4. **Gỡ là ĐÁNH DẤU, và gỡ hai lần không sinh bản ghi thứ hai.** Điều kiện
 *     `is_deleted = 0` nằm trong câu UPDATE chứ không trong một lượt đọc trước đó.
 *  5. **`stream.get.ts` phải đẩy một sự kiện TRƯỚC `send()`, và đẩy bằng `void`.**
 *     Không đẩy gì thì header **không bao giờ** ra khỏi máy chủ — `fetch` treo, không
 *     lỗi, không mã trạng thái. `await` thì **treo hẳn handler**. Cả hai đã đo trên
 *     một máy chủ h3 thật; lượt kiểm cuối tệp dựng lại đúng phép đo đó.
 *
 * Lượt mô-đun-hoá `db.ts` nằm **trước mọi import chạm tới nó**: `mock.module` chỉ áp
 * cho những import xảy ra **sau** nó, nên đặt nó sau lượt import đầu tiên kéo `db.ts`
 * vào là một lượt mock không có tác dụng — và nó không báo lỗi, chỉ trả về một db
 * thật không kết nối được. Cùng lý do, `livestream-chat.ts` và `sse-manager.ts` được
 * nạp bằng `await import` ngay sau lượt mock: cả hai đi qua `db.ts`, nên nạp tĩnh ở
 * đầu tệp là nạp bản thật.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { after, describe, it, mock } from 'node:test'

import { drizzle } from 'drizzle-orm/mysql2'
import { getTableConfig } from 'drizzle-orm/mysql-core'
import { createApp, createRouter, toNodeListener } from 'h3'

import * as schema from '../server/db/schema'

// ─── DB giả dùng chung ───────────────────────────────────────────────────────

type Query = { sql: string, params: unknown[] }

function normalize(arg1: unknown, arg2: unknown): Query {
  const obj = (arg1 && typeof arg1 === 'object') ? arg1 as { sql: string, values?: unknown[] } : null
  const sql = String(obj ? obj.sql : arg1).trim().replace(/\s+/g, ' ')
  const params = (Array.isArray(arg2) ? arg2 : obj?.values ?? []) as unknown[]
  return { sql, params }
}

/** Buổi phát đang chạy dùng cho mọi lượt kiểm ở đây. */
const SESSION_ID = 7

/**
 * Một cột DATETIME ở dạng **driver thật trả về**: chuỗi `'YYYY-MM-DD HH:MM:SS.mmm'`.
 *
 * Không phải một đối tượng `Date`. `mapFromDriverValue` của Drizzle gọi
 * `value.replace(' ', 'T')`, nên một `Date` ném `Cannot read properties of undefined
 * (reading 'replace')` — và triệu chứng đọc ra là endpoint trả **500**, tức là một
 * lỗi fixture đội lốt một tính năng hỏng.
 */
function sqlDateTime(value: Date): string {
  return value.toISOString().replace('T', ' ').replace('Z', '')
}

/**
 * Mô-đun-hoá `db.ts` **trước** lượt import nào chạm tới nó.
 *
 * `getPool: () => null` là nhánh quan trọng: nó làm `rateLimitDeps()` lùi về bộ đếm
 * trong tiến trình thay vì mở toang — cùng lý do như trong `tests/media-api.test.ts`.
 */
const liveRow = [SESSION_ID, 'Phát trực tiếp', null, 'youtube', 'dQw4w9WgXcQ', null, null, sqlDateTime(new Date())]

/**
 * Trả về **mảng hàng**, không phải một cặp `[rows, fields]`.
 *
 * `streamPool` bên dưới mới là chỗ bọc thành cặp. Bọc hai lần thì Drizzle đọc hàng
 * đầu tiên ra một mảng một phần tử, và cột `started_at` nhận `undefined` —
 * `mapFromDriverValue` gọi `value.replace(...)` trên nó và ném, nên endpoint trả
 * **500**. Triệu chứng đọc ra là "luồng SSE hỏng", không phải "fixture sai".
 */
const activeResponder = (sql: string): unknown[] => {
  if (/from `livestream_sessions`/i.test(sql)) return [liveRow]
  throw new Error(`unexpected statement: ${sql}`)
}
let streamResponder: (sql: string) => unknown[] = activeResponder

const streamPool = {
  query: async (arg1: unknown) => { const { sql } = normalize(arg1, null); return [streamResponder(sql), []] },
  execute: async (arg1: unknown) => { const { sql } = normalize(arg1, null); return [streamResponder(sql), []] },
  getConnection: async () => ({ query: async () => [[], []], release() {} }),
  end: async () => {},
}
const streamDb = drizzle(streamPool as never, { schema, mode: 'default' })

mock.module(new URL('../server/utils/db.ts', import.meta.url), {
  namedExports: {
    getDb: () => streamDb,
    getPool: () => null,
    closeDb: async () => {},
  },
})

const chat = await import('../server/services/livestream-chat.ts')
const sse = await import('../server/utils/sse-manager.ts')

const sender = { id: 42, displayName: 'Nguyễn Văn A', customDisplayName: null }

/** Bộ đếm trong bộ nhớ — không cần bảng `rate_limit_counters` thật. */
const memoryLimiter = () => ({ memory: new Map<string, { count: number, expiresAt: number }>() })

type FakeOptions = {
  /** Có một buổi phát đang chạy hay không. */
  active?: boolean
  /** `is_deleted` của hàng tin nhắn mà lượt kiểm duyệt đọc ra. */
  messageIsDeleted?: boolean
  /** Hàng tin nhắn có tồn tại hay không (đường "không tìm thấy"). */
  messageExists?: boolean
  /** `affectedRows` của câu UPDATE đánh dấu — mô phỏng thua cuộc đua. */
  updateAffects?: number
  /** Lịch sử trả về, theo thứ tự **mới nhất trước** (đúng như truy vấn hỏi). */
  history?: Array<{ id: number, name: string, content: string, at: string }>
}

/**
 * Pool + db giả, cùng lối của `tests/livestream-toggle.test.ts`.
 *
 * `log` (câu lệnh trên kết nối giao dịch) và `poolLog` (câu chạy thẳng trên pool)
 * **tách hẳn nhau**: dùng chung một hàm thì một `db.insert(activityLogs)` lọt vào
 * trong khối transaction đọc ra **y hệt** một `tx.insert(activityLogs)` đúng.
 */
function makeFake(options: FakeOptions = {}) {
  const log: string[] = []
  const poolLog: string[] = []
  const inserts: Array<{ sql: string, params: unknown[] }> = []
  let committed = false

  const dispatch = (sink: string[]) => async (arg1: unknown, arg2: unknown) => {
    const { sql, params } = normalize(arg1, arg2)
    sink.push(sql)

    if (/^begin$/i.test(sql)) return [{}, []]
    if (/^commit$/i.test(sql)) { committed = true; return [{}, []] }
    if (/^rollback$/i.test(sql)) { committed = false; return [{}, []] }
    if (/^savepoint/i.test(sql)) return [{}, []]
    if (/^release savepoint/i.test(sql)) return [{}, []]

    // ── Buổi phát đang chạy (chỉ id + title, như `activeSession()`) ──
    if (/^select `id`, `title` from `livestream_sessions` where `livestream_sessions`\.`is_active` = \? limit \?$/i.test(sql)) {
      return options.active === false ? [[], []] : [[[SESSION_ID, 'Phát trực tiếp']], []]
    }

    // ── Lịch sử: N tin MỚI NHẤT trước, rồi service đảo lại ──
    if (/^select `id`, `display_name`, `content`, `created_at` from `livestream_messages`/i.test(sql)) {
      const rows = (options.history ?? []).map(row => [row.id, row.name, row.content, row.at])
      return [rows, []]
    }

    // ── Kiểm duyệt: đọc hàng rồi mới sửa ──
    if (/^select `session_id`, `is_deleted` from `livestream_messages` where `livestream_messages`\.`id` = \? limit \?$/i.test(sql)) {
      if (options.messageExists === false) return [[], []]
      return [[[SESSION_ID, options.messageIsDeleted === true ? 1 : 0]], []]
    }
    if (/^update `livestream_messages` set `is_deleted` = \? where/i.test(sql)) {
      return [{ affectedRows: options.updateAffects ?? 1 }, []]
    }

    // ── Gửi: chèn hàng tin nhắn ──
    if (/^insert into `livestream_messages`/i.test(sql)) {
      inserts.push({ sql, params })
      return [{ insertId: 555, affectedRows: 1 }, []]
    }
    if (/^insert into `activity_logs`/i.test(sql)) {
      inserts.push({ sql, params })
      return [{ insertId: 1, affectedRows: 1 }, []]
    }

    throw new Error(`unexpected statement: ${sql}`)
  }

  const pool = {
    query: dispatch(poolLog),
    execute: dispatch(poolLog),
    getConnection: async () => ({ query: dispatch(log), release() {} }),
    end: async () => {},
  }

  return {
    db: drizzle(pool as never, { schema, mode: 'default' }),
    log,
    poolLog,
    inserts,
    isCommitted: () => committed,
    auditInserts: () => inserts.filter(row => /^insert into `activity_logs`/i.test(row.sql)),
  }
}

describe('12.8 — nội dung: văn bản thuần, chặn ký tự điều khiển, quá dài thì TỪ CHỐI', () => {
  it('gom CRLF về LF và cắt khoảng trắng hai đầu', () => {
    const result = chat.validateChatContent('  xin chào\r\nmọi người  ')
    assert.equal(result.ok, true)
    assert.equal(result.ok && result.content, 'xin chào\nmọi người')
  })

  it('từ chối ký tự điều khiển — kể cả ký tự không nhìn thấy được', () => {
    // Dựng bằng `String.fromCharCode` chứ không viết byte thẳng vào mã nguồn: một ký
    // tự điều khiển nằm nguyên văn ở đây thì **vô hình** trong mọi trình soạn thảo,
    // nên một lần dọn dẹp sau này xoá nó mà không ai thấy gì đổi — đúng điều mà
    // `server/utils/plain-text.ts` đã trả giá để biết.
    const bel = String.fromCharCode(7)
    const result = chat.validateChatContent(`xin chào${bel}mọi người`)
    assert.equal(result.ok, false)
    assert.match(result.ok ? '' : result.message, /ký tự không được phép/)
  })

  it('xuống dòng và tab thì ĐƯỢC — chúng không nằm trong danh sách chặn', () => {
    assert.equal(chat.validateChatContent('dòng một\ndòng hai\tthụt lề').ok, true)
  })

  it('quá dài thì TỪ CHỐI kèm nêu rõ giới hạn, KHÔNG cắt ngầm', () => {
    const tooLong = 'a'.repeat(chat.LIVESTREAM_CHAT_MAX_LENGTH + 1)
    const result = chat.validateChatContent(tooLong)
    assert.equal(result.ok, false)
    // Con số phải có trong thông báo: người gửi bị mất đoạn cuối mà không biết giới
    // hạn là bao nhiêu thì không có cách nào sửa cho vừa.
    assert.match(result.ok ? '' : result.message, new RegExp(String(chat.LIVESTREAM_CHAT_MAX_LENGTH)))
  })

  it('đúng bằng giới hạn thì nhận', () => {
    assert.equal(chat.validateChatContent('a'.repeat(chat.LIVESTREAM_CHAT_MAX_LENGTH)).ok, true)
  })

  it('rỗng và không phải chuỗi đều bị từ chối', () => {
    for (const raw of ['', '   ', '\n\n', null, 42, {}, undefined]) {
      assert.equal(chat.validateChatContent(raw).ok, false, `phải từ chối: ${String(raw)}`)
    }
  })

  it('giới hạn trong mã phải khớp bề rộng cột trong schema', () => {
    // Hai con số này sống ở hai tệp khác nhau và không có gì buộc chúng khớp: MySQL ở
    // chế độ mặc định **từ chối** câu INSERT dài hơn cột, nên một hằng số lớn hơn cột
    // biến mọi tin nhắn dài thành lỗi 500 — người gửi thấy ô chat của mình hỏng và
    // không có gì chỉ vào nguyên nhân.
    const columns = getTableConfig(schema.livestreamMessages).columns
    const content = columns.find(column => column.name === 'content')
    const displayName = columns.find(column => column.name === 'display_name')

    assert.ok(content && displayName, 'cột content / display_name không còn trong schema')
    assert.equal(content.getSQLType(), `varchar(${chat.LIVESTREAM_CHAT_MAX_LENGTH})`)
    assert.equal(displayName.getSQLType(), `varchar(${chat.LIVESTREAM_CHAT_NAME_MAX_LENGTH})`)
  })
})

describe('12.9 — tên người gửi được CHỤP lúc gửi', () => {
  it('tên riêng thắng tên Google, và không có tên nào thì vẫn ra một chuỗi dùng được', () => {
    assert.equal(
      chat.snapshotDisplayName({ id: 1, displayName: 'Google Name', customDisplayName: 'Bác Ba' }),
      'Bác Ba',
    )
    assert.equal(
      chat.snapshotDisplayName({ id: 1, displayName: 'Google Name', customDisplayName: null }),
      'Google Name',
    )
    // Một hàng mang `display_name` rỗng hiện ra thành một bong bóng chat không có ai
    // nói — nên hàm này không bao giờ được trả về chuỗi rỗng.
    assert.ok(chat.snapshotDisplayName({ id: 1, displayName: null, customDisplayName: null }).length > 0)
  })

  it('tên dài hơn cột thì CẮT, không từ chối tin nhắn', () => {
    // `reader_accounts.display_name` rộng 255 còn cột này rộng 100. Từ chối gửi tin
    // vì tên Google của ai đó dài quá là biến một chuyện không liên quan thành một ô
    // chat hỏng.
    const long = chat.snapshotDisplayName({ id: 1, displayName: 'x'.repeat(300), customDisplayName: null })
    assert.equal(long.length, chat.LIVESTREAM_CHAT_NAME_MAX_LENGTH)
  })

  it('hàng đã lưu giữ tên CŨ sau khi người gửi đổi tên', async () => {
    // 12.9 nói thẳng: "a later rename does not change a stored message". Cách kiểm
    // không cần MySQL: chụp tham số của câu INSERT, rồi đổi tên trên chính đối tượng
    // người gửi và khẳng định giá trị đã chụp **không đổi**. Một hàng khoá ngoại đọc
    // lại tên lúc render sẽ trượt lượt kiểm này.
    const fake = makeFake()
    const mutable = { id: 42, displayName: 'Google', customDisplayName: 'Bác Ba' }

    const result = await chat.sendChatMessage(
      { sender: mutable, ip: '203.0.113.9', content: 'chào cả nhà', sessionId: SESSION_ID },
      { db: fake.db, rateLimit: memoryLimiter() },
    )
    assert.equal(result.ok, true)

    const insert = fake.inserts.find(row => /^insert into `livestream_messages`/i.test(row.sql))
    assert.ok(insert, 'không thấy câu chèn tin nhắn')
    assert.ok(
      insert.params.includes('Bác Ba'),
      `tên chụp lúc gửi phải nằm trong câu INSERT, thấy: ${JSON.stringify(insert.params)}`,
    )

    mutable.customDisplayName = 'Bác Tư'

    assert.ok(
      insert.params.includes('Bác Ba') && !insert.params.includes('Bác Tư'),
      'hàng đã lưu đổi theo lượt đổi tên — tên phải được CHỤP, không phải đọc lại',
    )
  })
})

describe('12.7 — hạn mức tiêu NGAY TRƯỚC câu INSERT, không phải ở đầu hàm', () => {
  it('một lượt bị từ chối vì nội dung KHÔNG tiêu hạn mức', async () => {
    const fake = makeFake()
    const limiter = memoryLimiter()

    const result = await chat.sendChatMessage(
      { sender, ip: '203.0.113.9', content: '   ', sessionId: SESSION_ID },
      { db: fake.db, rateLimit: limiter },
    )

    assert.equal(result.ok, false)
    assert.equal(limiter.memory.size, 0, 'nội dung rỗng vẫn tiêu hạn mức — người gửi bị khoá vì những lần thử vô hiệu')
  })

  it('một lượt bị từ chối vì KHÔNG CÓ BUỔI PHÁT cũng không tiêu hạn mức', async () => {
    // Đây là ca nguy hiểm nhất: một kẻ tấn công tiêu hạn mức của người khác bằng
    // những request **luôn luôn thất bại** — chúng không cần thoả điều kiện nào.
    const fake = makeFake({ active: false })
    const limiter = memoryLimiter()

    const result = await chat.sendChatMessage(
      { sender, ip: '203.0.113.9', content: 'chào', sessionId: SESSION_ID },
      { db: fake.db, rateLimit: limiter },
    )

    assert.equal(result.ok, false)
    assert.equal(result.ok ? 0 : result.statusCode, 409)
    assert.equal(limiter.memory.size, 0, 'lượt bị từ chối vì chưa có buổi phát vẫn tiêu hạn mức')
  })

  it('từ chối tin gắn với buổi phát cũ trước khi tiêu hạn mức', async () => {
    const fake = makeFake()
    const limiter = memoryLimiter()

    const result = await chat.sendChatMessage(
      { sender, ip: '203.0.113.9', content: 'chào', sessionId: SESSION_ID + 1 },
      { db: fake.db, rateLimit: limiter },
    )

    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.statusCode, 409)
    assert.equal(limiter.memory.size, 0, 'một POST đến muộn cho phiên cũ không được tiêu hạn mức')
    assert.equal(fake.inserts.length, 0, 'tin của phiên cũ không được chèn vào buổi phát mới')
  })

  it('một lượt THÀNH CÔNG thì tiêu hạn mức, trên CẢ HAI khoá', async () => {
    const fake = makeFake()
    const limiter = memoryLimiter()

    const result = await chat.sendChatMessage(
      { sender, ip: '203.0.113.9', content: 'chào cả nhà', sessionId: SESSION_ID },
      { db: fake.db, rateLimit: limiter },
    )

    assert.equal(result.ok, true)
    // Hai khoá: theo tài khoản **và** theo địa chỉ. Chỉ theo tài khoản thì tạo tài
    // khoản mới là thoát; chỉ theo địa chỉ thì một cơ quan dùng chung đường truyền bị
    // phạt vì hành vi của một người.
    assert.equal(limiter.memory.size, 2, `phải có đúng hai khoá hạn mức, thấy ${[...limiter.memory.keys()].join(', ')}`)
    assert.ok([...limiter.memory.keys()].some(key => key.includes(`reader:${sender.id}`)))
    assert.ok([...limiter.memory.keys()].some(key => key.includes('ip:203.0.113.9')))
  })

  it('chặn theo tài khoản: từ chối kèm lời nói rõ đang gửi quá nhanh, và không chèn hàng nào', async () => {
    const fake = makeFake()
    const limiter = memoryLimiter()
    // Điền sẵn bộ đếm của **tài khoản** tới mức trần. Khoá địa chỉ để trống nên lượt
    // kiểm này cô lập đúng nhánh theo tài khoản.
    limiter.memory.set(`livestream:chat:reader:${sender.id}`, { count: 20, expiresAt: Date.now() + 60_000 })

    const result = await chat.sendChatMessage(
      { sender, ip: '203.0.113.9', content: 'chào', sessionId: SESSION_ID },
      { db: fake.db, rateLimit: limiter },
    )

    assert.equal(result.ok, false)
    assert.equal(result.ok ? 0 : result.statusCode, 429)
    assert.match(result.ok ? '' : result.message, /quá nhanh/)
    assert.ok((result.ok ? 0 : result.retryAfterSeconds ?? 0) >= 1, 'phải nói cho người gửi biết chờ bao lâu')
    assert.equal(fake.inserts.length, 0, 'bị chặn thì không được chèn hàng nào')
  })

  it('chặn theo ĐỊA CHỈ áp cho nhiều tài khoản khác nhau', async () => {
    const fake = makeFake()
    const limiter = memoryLimiter()
    limiter.memory.set('livestream:chat:ip:203.0.113.9', { count: 50, expiresAt: Date.now() + 60_000 })

    const result = await chat.sendChatMessage(
      // Tài khoản khác hẳn — tạo tài khoản mới không được là đường vòng.
      { sender: { id: 9999, displayName: 'Người khác', customDisplayName: null }, ip: '203.0.113.9', content: 'chào', sessionId: SESSION_ID },
      { db: fake.db, rateLimit: limiter },
    )

    assert.equal(result.ok, false)
    assert.equal(result.ok ? 0 : result.statusCode, 429)
    assert.match(result.ok ? '' : result.message, /địa chỉ này/)
  })

  it('địa chỉ không đọc được thì gom vào một ô chung, không bỏ qua hạn mức theo địa chỉ', async () => {
    const fake = makeFake()
    const limiter = memoryLimiter()
    limiter.memory.set('livestream:chat:ip:anonymous', { count: 50, expiresAt: Date.now() + 60_000 })

    const result = await chat.sendChatMessage(
      { sender, ip: 'unknown', content: 'chào', sessionId: SESSION_ID },
      { db: fake.db, rateLimit: limiter },
    )

    assert.equal(result.ok, false, 'địa chỉ unknown không được miễn hạn mức theo địa chỉ')
  })

  it('thứ tự trong mã nguồn: mọi lý do TỪ CHỐI đứng trước lượt tiêu hạn mức, câu INSERT đứng sau', async () => {
    // Khẳng định hành vi ở trên phủ hai nhánh cụ thể. Khẳng định này bám vào **thứ
    // tự** cho mọi nhánh còn lại — kể cả nhánh thêm sau này. Đây là lượt kiểm âm tính
    // của 12.7: dời hai lượt gọi lên đầu hàm thì nó đỏ.
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('../server/services/livestream-chat.ts', import.meta.url), 'utf8')
    const body = source.slice(source.indexOf('export async function sendChatMessage'))

    const contentCheck = body.indexOf('validateChatContent(')
    const sessionCheck = body.indexOf('const session = await activeSession(db)')
    const firstHit = body.indexOf('recordRateLimitHit(')
    const insert = body.indexOf('db.insert(livestreamMessages)')

    assert.ok(contentCheck !== -1 && sessionCheck !== -1 && firstHit !== -1 && insert !== -1, 'không tìm thấy đủ bốn mốc')
    assert.ok(contentCheck < firstHit, 'hạn mức được tiêu TRƯỚC khi kiểm nội dung')
    assert.ok(sessionCheck < firstHit, 'hạn mức được tiêu TRƯỚC khi biết có buổi phát nào đang chạy')
    assert.ok(firstHit < insert, 'hạn mức phải được tiêu trước câu INSERT')
  })
})

describe('12.6 — gửi: lưu trước, phát sau', () => {
  it('hàng được chèn TRƯỚC khi sự kiện được phát, và phản hồi mang id thật', async () => {
    const fake = makeFake()
    const stream = makeStream()
    sse.registerStream(stream.stream, SESSION_ID)

    try {
      const result = await chat.sendChatMessage(
        { sender, ip: '203.0.113.9', content: 'chào cả nhà', sessionId: SESSION_ID },
        { db: fake.db, rateLimit: memoryLimiter() },
      )

      assert.equal(result.ok, true)
      // `id: 0` là hình dạng của lượt đọc `.insertId` trên mảng chưa destructure — một
      // hàng thật đã vào CSDL mà phản hồi khai không có id.
      assert.equal(result.ok && result.id, 555, 'phản hồi phải mang id thật, không phải 0')

      assert.equal(fake.inserts.length, 1, 'đúng một hàng được chèn')
      assert.equal(stream.pushed.length, 1)
      assert.equal(stream.pushed[0]?.event, sse.SSE_EVENT_MESSAGE)

      const payload = JSON.parse(String(stream.pushed[0]?.data)) as { id: number, content: string, displayName: string }
      assert.equal(payload.id, 555)
      assert.equal(payload.content, 'chào cả nhà')
      assert.equal(payload.displayName, 'Nguyễn Văn A')
    } finally {
      sse.releaseStream(stream.stream)
    }
  })

  it('một lượt INSERT hỏng thì KHÔNG phát gì cho ai', async () => {
    // Phát trước rồi mới lưu thì một tin nhắn đã hiện trên màn hình hàng trăm người,
    // không nằm trong lịch sử của ai, và người đã đọc nó không có cách nào biết nó
    // chưa từng tồn tại.
    const stream = makeStream()
    sse.registerStream(stream.stream, SESSION_ID)

    try {
      await assert.rejects(
        chat.sendChatMessage(
          { sender, ip: '203.0.113.9', content: 'chào', sessionId: SESSION_ID },
          { db: makeStrictFake().db, rateLimit: memoryLimiter() },
        ),
        /livestream_messages/,
      )
      assert.equal(stream.pushed.length, 0, 'một lượt lưu hỏng vẫn phát tin cho người đang xem')
    } finally {
      sse.releaseStream(stream.stream)
    }
  })
})

describe('12.6 — lịch sử: có trần, theo thứ tự thời gian, bỏ tin đã gỡ', () => {
  it('trả về theo thứ tự CŨ → MỚI dù truy vấn hỏi mới nhất trước', async () => {
    const now = Date.now()
    const fake = makeFake({
      history: [
        { id: 3, name: 'C', content: 'ba', at: sqlDateTime(new Date(now + 2000)) },
        { id: 2, name: 'B', content: 'hai', at: sqlDateTime(new Date(now + 1000)) },
        { id: 1, name: 'A', content: 'một', at: sqlDateTime(new Date(now)) },
      ],
    })

    const result = await chat.listChatHistory({}, { db: fake.db })

    assert.equal(result.sessionId, SESSION_ID)
    assert.deepEqual(result.messages.map(m => m.id), [1, 2, 3], 'lịch sử phải đọc xuôi theo thời gian')
    assert.equal(result.messages[0]?.displayName, 'A')
  })

  it('`is_deleted = 0` nằm trong mệnh đề WHERE, không phải lọc ở tầng giao diện', async () => {
    const fake = makeFake({ history: [] })
    await chat.listChatHistory({}, { db: fake.db })

    const query = fake.poolLog.find(sql => sql.includes('from `livestream_messages`'))
    assert.ok(query, 'không thấy truy vấn lịch sử')
    assert.match(query, /`is_deleted` = \?/, 'tin đã kiểm duyệt phải bị loại ở tầng CSDL')
  })

  it('lấy N tin GẦN NHẤT rồi đảo lại, không lấy N tin đầu', async () => {
    const fake = makeFake({ history: [] })
    await chat.listChatHistory({}, { db: fake.db })

    const query = fake.poolLog.find(sql => sql.includes('from `livestream_messages`'))
    assert.ok(query)
    // Người vào muộn cần thấy câu vừa nói, không phải câu mở đầu buổi phát.
    assert.match(query, /order by `livestream_messages`\.`created_at` desc/i)
    // `created_at` là DATETIME(3): hai tin trong cùng một mili giây là chuyện bình
    // thường, nên `id` phải là khoá phụ — thiếu nó thì thứ tự do máy chủ quyết định
    // và đổi giữa hai lượt đọc.
    assert.match(query, /`livestream_messages`\.`id` desc/i)
  })

  it('xin quá trần thì phục vụ Ở MỨC TRẦN, không từ chối', async () => {
    const fake = makeFake({ history: [] })
    const result = await chat.listChatHistory({ limit: 100_000 }, { db: fake.db })

    assert.equal(result.sessionId, SESSION_ID)
    // Một lượt hỏi xin nhiều hơn mức máy chủ cho là chuyện bình thường; trả lỗi cho nó
    // là biến một yêu cầu hợp lệ thành một ô chat trống.
    assert.ok(fake.poolLog.some(sql => sql.includes('from `livestream_messages`')))
  })

  it('không có buổi phát nào thì trả về rỗng với phiên null — trạng thái hợp lệ, không phải lỗi', async () => {
    const fake = makeFake({ active: false })
    const result = await chat.listChatHistory({}, { db: fake.db })
    assert.deepEqual(result, { sessionId: null, messages: [] })
  })

  it('`?limit=abc` và `?limit=1e999` đều cho ra một lượt đọc hợp lệ', async () => {
    // Cùng quy tắc `finitePositive`: `Math.max(1, Number('abc'))` là `NaN`, và mọi so
    // sánh với `NaN` đều `false` — nên giá trị đó đi thẳng vào `limit()`.
    for (const raw of ['abc', '1e999', '-5', '', null, undefined]) {
      const fake = makeFake({ history: [] })
      const result = await chat.listChatHistory({ limit: raw }, { db: fake.db })
      assert.equal(result.sessionId, SESSION_ID, `limit=${String(raw)} phải vẫn cho ra một lượt đọc hợp lệ`)
    }
  })
})

describe('12.6 — kiểm duyệt: đánh dấu, phát sự kiện gỡ, ghi audit trong cùng transaction', () => {
  it('gỡ một tin: hàng ở LẠI, audit nằm trong cùng transaction, và sự kiện được phát', async () => {
    const fake = makeFake()
    const stream = makeStream()
    sse.registerStream(stream.stream, SESSION_ID)

    try {
      const result = await chat.removeChatMessage({ messageId: 555, actorId: 9 }, { db: fake.db })

      assert.equal(result.ok, true)
      assert.equal(result.ok && result.alreadyRemoved, false)
      assert.equal(fake.isCommitted(), true, 'lượt gỡ không được commit')

      const audit = fake.auditInserts()[0]
      assert.ok(audit, 'lượt gỡ không ghi dòng audit nào')
      assert.ok(audit.params.includes('delete'), 'action phải là delete')
      assert.ok(audit.params.includes('livestream'), 'resource phải là livestream')
      assert.ok(audit.params.includes(555), 'dòng audit phải mang id tin nhắn')
      assert.ok(audit.params.includes(9), 'dòng audit phải mang id cán bộ')

      assert.equal(stream.pushed.length, 1)
      assert.equal(stream.pushed[0]?.event, sse.SSE_EVENT_REMOVAL)
      assert.deepEqual(JSON.parse(String(stream.pushed[0]?.data)), { id: 555 })
    } finally {
      sse.releaseStream(stream.stream)
    }
  })

  it('KHÔNG xoá hàng — gỡ là đánh dấu', async () => {
    const fake = makeFake()
    await chat.removeChatMessage({ messageId: 555, actorId: 9 }, { db: fake.db })

    const deletes = [...fake.log, ...fake.poolLog].filter(sql => /^delete from/i.test(sql))
    assert.deepEqual(deletes, [], 'gỡ phải là UPDATE is_deleted, không phải DELETE — hàng còn lại mới đối chiếu được với dòng audit')
  })

  it('gỡ một tin ĐÃ gỡ: thành công, và KHÔNG sinh bản ghi thứ hai', async () => {
    const fake = makeFake({ messageIsDeleted: true })
    const stream = makeStream()
    sse.registerStream(stream.stream, SESSION_ID)

    try {
      const result = await chat.removeChatMessage({ messageId: 555, actorId: 9 }, { db: fake.db })

      assert.equal(result.ok, true)
      assert.equal(result.ok && result.alreadyRemoved, true)
      assert.deepEqual(fake.auditInserts(), [], 'một hành động đã xảy ra rồi không được ghi lần thứ hai')
      assert.equal(stream.pushed.length, 0, 'không có gì mới để báo cho người xem')
    } finally {
      sse.releaseStream(stream.stream)
    }
  })

  it('thua cuộc đua giữa lượt đọc và lượt ghi: vẫn thành công, vẫn không có audit thứ hai', async () => {
    // Hai cán bộ bấm cùng lúc. `affectedRows` là **thẩm quyền** quyết định ai thật sự
    // gỡ — đọc-rồi-ghi mà không kiểm nó thì cả hai đều ghi audit cho một hành động.
    const fake = makeFake({ updateAffects: 0 })
    const result = await chat.removeChatMessage({ messageId: 555, actorId: 9 }, { db: fake.db })

    assert.equal(result.ok, true)
    assert.equal(result.ok && result.alreadyRemoved, true)
    assert.deepEqual(fake.auditInserts(), [], 'thua cuộc đua mà vẫn ghi audit là nhận công việc của người khác')
  })

  it('id không tồn tại: từ chối là KHÔNG TÌM THẤY, và không ghi gì', async () => {
    const fake = makeFake({ messageExists: false })
    const result = await chat.removeChatMessage({ messageId: 999_999, actorId: 9 }, { db: fake.db })

    assert.equal(result.ok, false)
    assert.equal(result.ok ? 0 : result.statusCode, 404)
    assert.equal(fake.inserts.length, 0)
  })

  it('audit dùng `tx.insert`, không phải `db.insert` trên pool', async () => {
    // `db.insert(activityLogs)` trong khối transaction vẫn chạy trên pool và commit
    // độc lập — đúng con bug đó nhưng khoác áo transaction. Hai bộ ghi tách hẳn nhau là
    // thứ làm điều này nhìn thấy được.
    const fake = makeFake()
    await chat.removeChatMessage({ messageId: 555, actorId: 9 }, { db: fake.db })

    assert.ok(
      fake.log.some(sql => /^insert into `activity_logs`/i.test(sql)),
      'dòng audit phải đi qua kết nối giao dịch',
    )
    assert.ok(
      !fake.poolLog.some(sql => /^insert into `activity_logs`/i.test(sql)),
      'dòng audit chạy trên pool — nó sẽ commit độc lập với câu UPDATE',
    )
  })
})

// ─── Luồng SSE trên một máy chủ HTTP thật ────────────────────────────────────

const router = createRouter()
router.get(
  '/api/public/livestream/chat/stream',
  (await import('../server/api/public/livestream/chat/stream.get.ts')).default,
)

const server = createServer(toNodeListener(createApp().use(router)))
await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => resolve()) })
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`

after(() => {
  server.closeAllConnections()
  server.close()
})

/**
 * Đo ba mốc **độc lập**: lúc header tới, lúc khối đầu tiên tới, và kết nối có bị đóng
 * sớm hay không.
 *
 * Không lặp `reader.read()` tới `done`: một luồng được thiết kế để **ở lại mở** thì
 * `done` không bao giờ tới, và vòng lặp đó biến một luồng khoẻ mạnh thành một dòng
 * `FAILED … AbortError`. Đọc cho tới khi có trọn một sự kiện (`\n\n`) rồi dừng.
 *
 * `onOpen` chạy **trong lúc kết nối còn mở** — ngoài hàm này mọi lượt đo đều đã đóng
 * kết nối và sổ luồng đã tự gỡ, nên không còn gì để khẳng định.
 */
async function probe(pathname: string, onOpen?: () => void) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2500)
  const started = Date.now()
  let headersAt: number | null = null
  let firstChunkAt: number | null = null
  let endedEarly = false
  let status = 0
  let body = ''
  const headers: Record<string, string> = {}

  try {
    const response = await fetch(origin + pathname, { signal: controller.signal })
    headersAt = Date.now() - started
    status = response.status
    response.headers.forEach((value, key) => { headers[key.toLowerCase()] = value })

    if (response.body) {
      const reader = response.body.getReader()
      for (let i = 0; i < 5; i += 1) {
        const { value, done } = await reader.read()
        if (done) { endedEarly = true; break }
        if (firstChunkAt === null) {
          firstChunkAt = Date.now() - started
          onOpen?.()
        }
        body += new TextDecoder().decode(value)
        if (body.includes('\n\n')) break
      }
      await reader.cancel().catch(() => undefined)
    }
  } catch {
    /* hết hạn hoặc bị huỷ — các mốc còn null chính là kết quả đo */
  } finally {
    clearTimeout(timer)
  }

  return { status, headers, headersAt, firstChunkAt, endedEarly, body }
}

/** Chờ sổ luồng tự dọn — cơ chế autoclose của h3 gỡ luồng khi khách ngắt kết nối. */
async function waitForEmptyRegistry(timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (sse.trackedStreamCount() === 0) return true
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  return sse.trackedStreamCount() === 0
}

describe('12.3 — endpoint luồng: header ra khỏi máy chủ, không bị đệm hay cache, kết nối ở lại mở', () => {
  it('trả 200 với header chống đệm/cache và KHÔNG treo ở header', async () => {
    const result = await probe('/api/public/livestream/chat/stream')

    assert.equal(result.status, 200)
    // Điều quan trọng nhất: header phải tới. Không đẩy gì trước `send()` thì
    // `createEventStream` **không bao giờ** đưa header ra, và `fetch` của khách treo ở
    // đó — không lỗi, không mã trạng thái, không gì chỉ vào nguyên nhân.
    assert.ok(result.headersAt !== null, 'header KHÔNG BAO GIỜ tới — thiếu lượt push trước send()')
    assert.ok(result.headersAt! < 2000, `header tới sau ${result.headersAt}ms`)

    assert.equal(result.headers['content-type'], 'text/event-stream')
    assert.match(result.headers['cache-control'] ?? '', /no-store/)
    assert.match(result.headers['cache-control'] ?? '', /no-cache/)
    // Header này là thứ bảo nginx đừng gom phản hồi lại. Thiếu nó thì khách thấy tin
    // nhắn theo từng đợt, hoặc không thấy gì.
    assert.equal(result.headers['x-accel-buffering'], 'no')
  })

  it('khối đầu tiên tới ngay, là sự kiện `ready` mang phiên đang phát, và kết nối KHÔNG đóng', async () => {
    const result = await probe('/api/public/livestream/chat/stream')

    assert.ok(result.firstChunkAt !== null, 'không có khối nào tới — kết nối mở nhưng im lặng')
    assert.match(result.body, /event: ready/)
    assert.match(result.body, new RegExp(`"sessionId":${SESSION_ID}`))
    assert.equal(result.endedEarly, false, 'luồng tự đóng ngay sau khối đầu — chat sẽ chết sau mỗi tin nhắn')
  })

  it('luồng được GHI DANH vào sổ trong lúc kết nối còn mở', async () => {
    // Không cookie, không header xác thực: đặc tả nói thẳng "anonymous readers may
    // watch". Và lượt ghi danh là thứ làm `broadcastToSession` tìm thấy luồng này —
    // thiếu nó thì endpoint vẫn trả 200 và vẫn gửi `ready`, nhưng không bao giờ nhận
    // được một tin nhắn nào.
    let observed = -1
    const result = await probe('/api/public/livestream/chat/stream', () => {
      observed = sse.trackedStreamCount(SESSION_ID)
    })

    assert.equal(result.status, 200)
    assert.ok(observed >= 1, 'endpoint trả 200 nhưng không ghi danh luồng nào')
  })

  it('khách ngắt kết nối thì sổ tự gỡ luồng — không rò rỉ theo số người xem', async () => {
    await probe('/api/public/livestream/chat/stream')
    assert.equal(await waitForEmptyRegistry(), true, 'sổ giữ lại luồng của khách đã ngắt kết nối')
  })

  it('không có buổi phát nào đang chạy thì trả 404, không mở một luồng rỗng', async () => {
    streamResponder = (sql: string) => {
      if (/from `livestream_sessions`/i.test(sql)) return []
      throw new Error(`unexpected statement: ${sql}`)
    }
    try {
      const result = await probe('/api/public/livestream/chat/stream')
      assert.equal(result.status, 404)
      assert.equal(result.headers['content-type']?.includes('text/event-stream'), false)
      assert.match(result.body, /không có buổi phát trực tiếp/)
    } finally {
      streamResponder = activeResponder
    }
    // Một lượt 404 không được để lại luồng nào trong sổ.
    assert.equal(await waitForEmptyRegistry(), true)
  })
})

/** Luồng giả cho các lượt kiểm ở tầng dịch vụ. Cùng khuôn `tests/media-sse-guard.test.ts`. */
function makeStream() {
  const pushed: Array<{ event?: string, data?: unknown }> = []
  let onClosedCb: (() => unknown) | null = null
  const stream = {
    push(message: { event?: string, data?: unknown }) {
      pushed.push(message)
      return Promise.resolve()
    },
    close() { onClosedCb?.(); return Promise.resolve() },
    onClosed(cb: () => unknown) { onClosedCb = cb },
  }
  return { stream, pushed }
}

/** Một db ném ở câu chèn tin nhắn — dùng cho lượt kiểm "lưu hỏng thì không phát gì". */
function makeStrictFake() {
  const strict = (sql: string): unknown[] => {
    if (/^select `id`, `title` from `livestream_sessions`/i.test(sql)) return [[SESSION_ID, 'Phát trực tiếp']]
    if (/^insert into `livestream_messages`/i.test(sql)) throw new Error('livestream_messages insert failed')
    throw new Error(`unexpected statement: ${sql}`)
  }
  const pool = {
    query: async (arg1: unknown) => { const { sql } = normalize(arg1, null); return [strict(sql), []] },
    execute: async (arg1: unknown) => { const { sql } = normalize(arg1, null); return [strict(sql), []] },
    getConnection: async () => ({ query: async () => [[], []], release() {} }),
    end: async () => {},
  }
  return { db: drizzle(pool as never, { schema, mode: 'default' }) }
}
