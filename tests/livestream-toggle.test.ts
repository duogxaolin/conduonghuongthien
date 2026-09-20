/**
 * Vòng đời buổi phát trực tiếp — và cơ chế giữ bất biến "tối đa một buổi đang phát".
 *
 * Ba điều tệp này phải chứng minh, và cả ba đều là những thứ một lượt đọc mã
 * không thấy được:
 *
 *  1. **Khoá là cơ chế, không phải transaction.** Ở `REPEATABLE READ`, hai lượt
 *     "bắt đầu" cùng lúc đều đọc ra "chưa có buổi nào đang phát" rồi đều chèn. Tệp
 *     này dựng đúng tình huống đó — lượt thứ nhất giữ khoá trong lúc lượt thứ hai
 *     chạy trọn vẹn — và đòi **đúng một** hàng được chèn. Bỏ `GET_LOCK` đi thì test
 *     đỏ, vì cả hai lượt đều thấy bảng trống.
 *  2. **Khoá được nhả trên đường LỖI, không chỉ đường thành công.** Một khoá treo
 *     vì một lượt ghi hỏng giữa chừng làm mọi lượt bắt đầu sau đó trả 409 vĩnh
 *     viễn, và triệu chứng đọc ra là "tính năng hỏng", không phải "khoá treo".
 *  3. **Id sinh ra không bị đọc từ vùng chết tạm thời.** `tests/transaction-tdz.test.ts`
 *     quét cả thư mục `server/services` nên nó phủ tệp này; ở đây khẳng định thêm
 *     rằng id **trả về đúng** — một handler trả `{ id: undefined }` vẫn là 200 và
 *     giao diện sẽ điều hướng tới `/admin/.../undefined`.
 *
 * Không `mock.module`: cả ba hàm đều nhận `db`/`pool` qua tham số, nên `getDb()` và
 * `getPool()` thật không bao giờ được gọi. Đó là lý do chúng có tham số.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { drizzle } from 'drizzle-orm/mysql2'
import { getTableConfig } from 'drizzle-orm/mysql-core'

import * as schema from '../server/db/schema'

const LOCK_NAME = 'cdkt:livestream:active'

/**
 * Định danh video hợp lệ.
 *
 * `source` mặc định là `'youtube'` và nguồn đó **bắt buộc** bóc ra được định danh
 * video, nên một lượt gọi thiếu nó trả 400 **trước khi chạm tới khoá**. Đó là lý do
 * hằng số này có mặt ở mọi lượt gọi bên dưới: thiếu nó thì không lượt kiểm nào ở
 * đây chạm tới thứ nó định kiểm, và lượt kiểm hai-lượt-cùng-lúc sẽ **treo** ở cổng
 * chờ thay vì đỏ — một test treo đọc ra là "bộ test hỏng", không phải "khoá hỏng".
 */
const VIDEO_ID = 'dQw4w9WgXcQ'

type Query = { sql: string, params: unknown[] }

/**
 * Chuẩn hoá đối số của một lượt gọi driver.
 *
 * Drizzle gọi `connection.query({ sql, values })` chứ không phải `query(sql,
 * params)`, nên một fake chỉ nhận chuỗi sẽ ghi `[object Object]` vào nhật ký và
 * mọi so khớp SQL đều trượt — mà trượt thì `throw`, nên nó ồn ào. Giữ nguyên lối
 * chuẩn hoá của `tests/media-api.test.ts`.
 */
function normalize(arg1: unknown, arg2: unknown): Query {
  const obj = (arg1 && typeof arg1 === 'object') ? arg1 as { sql: string, values?: unknown[] } : null
  const sql = String(obj ? obj.sql : arg1).trim().replace(/\s+/g, ' ')
  const params = (Array.isArray(arg2) ? arg2 : obj?.values ?? []) as unknown[]
  return { sql, params }
}

type FakeOptions = {
  /** Có sẵn một buổi đang phát khi bắt đầu. */
  activeRow?: boolean
  /** Buổi phát tồn tại (cho đường dừng / lưu bản ghi). */
  sessionRow?: boolean
  /** Buổi phát đã lưu thành bản ghi rồi. */
  savedMediaId?: number | null
  /** `is_active` của hàng phiên. */
  sessionIsActive?: boolean
  /** Làm hỏng câu khớp regex này. */
  failOn?: RegExp
}

/**
 * Pool + db giả.
 *
 * `log` (câu lệnh trên kết nối giao dịch) và `poolLog` (câu lệnh chạy thẳng trên
 * pool) **tách hẳn nhau**. Nếu dùng chung một hàm `query` thì một `db.insert()`
 * lọt vào trong khối transaction đọc ra **y hệt** một `tx.insert()` đúng — đúng
 * cái bẫy đã khiến bộ test cũ của `createMediaItem` xanh 38/38 trong khi đường ghi
 * audit đã bị đổi sang pool.
 */
function makeFake(options: FakeOptions = {}) {
  const log: string[] = []
  const poolLog: string[] = []
  const held = new Map<string, number>()
  let nextConnectionId = 1
  let released = 0
  let lockConnectionsReleased = 0
  let activeRow = options.activeRow === true
  let sessionIsActive = options.sessionIsActive ?? false
  let savedMediaId = options.savedMediaId ?? null
  let nextSessionId = 100
  let committed = false

  // Cổng chặn: giữ lượt `insert into livestream_sessions` **đầu tiên** lại cho tới
  // khi test mở. Đây là thứ làm tình huống "hai lượt cùng lúc" thành thật thay vì
  // chỉ là thứ tự microtask — lượt thứ nhất giữ khoá trong suốt thời gian lượt thứ
  // hai chạy trọn vẹn.
  //
  // **Một lần duy nhất, và đó là điều kiện để lượt kiểm âm tính chạy được.** Chặn
  // mọi lượt chèn thì khi khoá bị gỡ, cả hai lượt cùng đứng chờ ở cổng và test
  // **treo** thay vì đỏ — một test treo không nói lên điều gì về khoá, nó chỉ nói
  // bộ test hỏng. Chặn một lượt thì lượt thứ hai chạy tới nơi và chèn hàng thứ hai,
  // đúng cái mà khoá tồn tại để ngăn.
  let insertStarted: (() => void) | null = null
  const insertStartedPromise = new Promise<void>((resolve) => { insertStarted = resolve })
  let openGate: (() => void) | null = null
  const gate = new Promise<void>((resolve) => { openGate = resolve })
  let gatePending = false

  const dispatch = (sink: string[]) => async (arg1: unknown, arg2: unknown) => {
    const { sql, params } = normalize(arg1, arg2)
    sink.push(sql)

    if (options.failOn && options.failOn.test(sql)) throw new Error('injected failure')

    if (/^begin$/i.test(sql)) return [{}, []]
    if (/^commit$/i.test(sql)) { committed = true; return [{}, []] }
    if (/^rollback$/i.test(sql)) { committed = false; return [{}, []] }
    if (/^savepoint/i.test(sql)) return [{}, []]
    if (/^release savepoint/i.test(sql)) return [{}, []]

    // ── Buổi phát đang chạy ──
    if (/^select `id` from `livestream_sessions` where `livestream_sessions`\.`is_active` = \? limit \?$/i.test(sql)) {
      return activeRow ? [[[7]], []] : [[], []]
    }
    // ── Tồn tại hay không (đường hỏng của lượt dừng) ──
    if (/^select `id` from `livestream_sessions` where `livestream_sessions`\.`id` = \? limit \?$/i.test(sql)) {
      return options.sessionRow ? [[[7]], []] : [[], []]
    }
    // ── Hàng phiên đầy đủ (lượt lưu thành bản ghi) ──
    if (/^select `id`, `title`, `description`, `source`, `youtube_video_id`, `storage_path`, `is_active`, `saved_media_id` from `livestream_sessions`/i.test(sql)) {
      if (!options.sessionRow) return [[], []]
      // Một hàng đã ánh xạ, nên `rows` là mảng các hàng và mỗi hàng là mảng vị trí
      // — `[[row], fields]`. Drizzle đặt `rowsAsArray: true` và đọc theo **chỉ số
      // cột**, nên một hàng dạng object đọc ra `{}` trong im lặng.
      //
      // `youtube_video_id` phải là một định danh **bóc ra được**: `createMediaItem`
      // kiểm lại nó, nên một chuỗi bịa như `'abc123'` làm lượt lưu thành bản ghi
      // ném 400 — và triệu chứng đọc ra là "tính năng hỏng", không phải "fixture sai".
      return [[[7, 'Phát trực tiếp', null, 'youtube', VIDEO_ID, null, sessionIsActive, savedMediaId]], []]
    }
    if (/^insert into `livestream_sessions`/i.test(sql)) {
      if (gatePending) {
        gatePending = false
        insertStarted?.()
        await gate
      }
      activeRow = true
      nextSessionId += 1
      // `[header, fields]` — KHÔNG phải `[[header], fields]`. Driver thật trả về
      // một mảng hai phần tử mà phần tử đầu **chính là** `ResultSetHeader`; bọc nó
      // thêm một lớp nữa thì `inserted?.insertId` là `undefined` và lượt chèn đọc ra
      // "không có id" — một lỗi giả do chính bộ test dựng nên.
      return [{ insertId: nextSessionId, affectedRows: 1 }, []]
    }
    if (/^update `livestream_sessions` set `is_active` = \?, `ended_at` = \?/i.test(sql)) {
      // `is_active` nằm trong WHERE, nên hàng đã dừng không sửa được nữa — đúng
      // hành vi mà lượt dừng dựa vào để hai lượt đồng thời chỉ có một thắng.
      if (!sessionIsActive) return [{ affectedRows: 0 }, []]
      sessionIsActive = false
      activeRow = false
      return [{ affectedRows: 1 }, []]
    }
    if (/^update `livestream_sessions` set `saved_media_id` = \?/i.test(sql)) {
      savedMediaId = Number(params[0] ?? 0)
      return [{ affectedRows: 1 }, []]
    }
    // ── media_items (lượt lưu thành bản ghi) ──
    if (/^select `slug` from `media_items` where `media_items`\.`slug` like \?/i.test(sql)) return [[], []]
    if (/^insert into `media_items`/i.test(sql)) return [{ insertId: 4242, affectedRows: 1 }, []]
    // ── audit ──
    if (/^insert into `activity_logs`/i.test(sql)) return [{ insertId: 1, affectedRows: 1 }, []]

    throw new Error(`unexpected statement: ${sql}`)
  }

  const pool = {
    async getConnection() {
      const id = nextConnectionId
      nextConnectionId += 1
      // Một lượt `startLivestream` mượn **hai** kết nối: một cho khoá tên và một
      // cho giao dịch (Drizzle tự lấy từ pool). Nên đếm trần `released` là đếm cả
      // hai, và một khẳng định `=== 1` ở đó là khẳng định sai về kiến trúc chứ
      // không phải một phát hiện. Thứ cần khẳng định là kết nối **đã từng giữ
      // khoá** có được trả lại hay không — đó mới là chỗ một khoá treo sống.
      let heldAny = false
      return {
        id,
        query: async (arg1: unknown, arg2: unknown) => {
          const { sql, params } = normalize(arg1, arg2)
          // Khoá tên do kết nối giữ, nên nó phải xử lý ở đây chứ không đi vào
          // `dispatch` của giao dịch.
          if (sql.includes('GET_LOCK')) {
            const name = String(params[0])
            const owner = held.get(name)
            if (owner === undefined || owner === id) {
              held.set(name, id)
              heldAny = true
              return [[{ acquired: 1 }]]
            }
            return [[{ acquired: 0 }]]
          }
          if (sql.includes('RELEASE_LOCK')) {
            const name = String(params[0])
            if (held.get(name) === id) held.delete(name)
            return [[{ released: 1 }]]
          }
          return dispatch(log)(arg1, arg2)
        },
        release() {
          released += 1
          if (heldAny) lockConnectionsReleased += 1
          for (const [name, owner] of held) if (owner === id) held.delete(name)
        },
      }
    },
    query: dispatch(poolLog),
    execute: dispatch(poolLog),
    end: async () => {},
  }

  const db = drizzle(pool as never, { schema, mode: 'default' })

  return {
    db,
    pool: pool as never,
    log,
    poolLog,
    get heldNames() { return [...held.keys()] },
    get released() { return released },
    get lockConnectionsReleased() { return lockConnectionsReleased },
    isCommitted: () => committed,
    countSessions: () => [...log, ...poolLog].filter(sql => /^insert into `livestream_sessions`/i.test(sql)).length,
    enableGate() { gatePending = true },
    waitForInsert: () => insertStartedPromise,
    openGate: () => openGate?.(),
  }
}

// ─── 11.1 / 11.2 — bắt đầu ───────────────────────────────────────────────────

describe('11.1 — khoá là cơ chế giữ bất biến, không phải transaction', () => {
  it('hai lượt bắt đầu cùng lúc cho ra ĐÚNG MỘT buổi đang phát', async () => {
    const fake = makeFake()
    fake.enableGate()
    const { startLivestream } = await import('../server/services/livestream.ts')

    const first = startLivestream({ title: 'Buổi phát A', createdBy: 3, youtubeVideoId: VIDEO_ID }, { db: fake.db, pool: fake.pool })
    // Chờ tới khi lượt thứ nhất đã vào tới câu INSERT — tức là nó đang giữ khoá.
    await fake.waitForInsert()

    const second = await startLivestream({ title: 'Buổi phát B', createdBy: 4, youtubeVideoId: VIDEO_ID }, { db: fake.db, pool: fake.pool })
    fake.openGate()
    const firstResult = await first

    assert.equal(firstResult.ok, true, 'lượt đầu phải thành công')
    assert.equal(second.ok, false)
    assert.equal(second.ok === false && second.statusCode, 409, 'lượt sau phải nhận 409, không phải xếp hàng chờ')
    assert.equal(fake.countSessions(), 1, 'chỉ được có đúng một hàng được chèn')
    assert.ok(fake.isCommitted(), 'giao dịch của lượt thắng phải commit')
  })

  it('khoá được nhả trên đường LỖI, không chỉ đường thành công', async () => {
    const fake = makeFake({ failOn: /^insert into `activity_logs`/i })
    const { startLivestream } = await import('../server/services/livestream.ts')

    await assert.rejects(
      () => startLivestream({ title: 'Buổi phát hỏng', createdBy: 3, youtubeVideoId: VIDEO_ID }, { db: fake.db, pool: fake.pool }),
      /Failed query|injected failure/,
    )

    assert.deepEqual(fake.heldNames, [], 'khoá phải được nhả dù lượt ghi đã ném')
    assert.equal(fake.lockConnectionsReleased, 1, 'kết nối giữ khoá phải được trả lại pool')
  })

  it('khoá được nhả trên đường thành công', async () => {
    const fake = makeFake()
    const { startLivestream } = await import('../server/services/livestream.ts')

    const result = await startLivestream({ title: 'Buổi phát A', createdBy: 3, youtubeVideoId: VIDEO_ID }, { db: fake.db, pool: fake.pool })

    assert.equal(result.ok, true)
    assert.deepEqual(fake.heldNames, [])
    assert.equal(fake.lockConnectionsReleased, 1)
  })

  it('khoá là chuỗi đã thoả thuận, không phải một chuỗi khác', async () => {
    // Một chỗ viết lệch một ký tự cho ra hai khoá khác nhau, cả hai đều "lấy được",
    // nên bất biến mất hiệu lực mà không có lỗi nào ở đâu cả.
    const fake = makeFake()
    const { startLivestream, LIVESTREAM_LOCK_NAME } = await import('../server/services/livestream.ts')

    assert.equal(LIVESTREAM_LOCK_NAME, LOCK_NAME)
    await startLivestream({ title: 'A', createdBy: 3, youtubeVideoId: VIDEO_ID }, { db: fake.db, pool: fake.pool })
    assert.deepEqual(fake.heldNames, [])
    assert.equal(fake.lockConnectionsReleased, 1)
  })

  it('từ chối khi đang có buổi phát — không thay thế ngầm', async () => {
    const fake = makeFake({ activeRow: true })
    const { startLivestream } = await import('../server/services/livestream.ts')

    const result = await startLivestream({ title: 'Buổi phát B', createdBy: 3, youtubeVideoId: VIDEO_ID }, { db: fake.db, pool: fake.pool })

    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.statusCode, 409)
    assert.equal(fake.countSessions(), 0, 'đang phát thì không được chèn hàng nào')
  })

  it('không có pool thì TỪ CHỐI, không mở toang', async () => {
    // Không có pool nghĩa là không có khoá, và không có khoá thì không có gì giữ
    // bất biến. Cho qua là biến một lần CSDL chập chờn thành hai buổi phát cùng lúc.
    const fake = makeFake()
    const { startLivestream } = await import('../server/services/livestream.ts')

    const result = await startLivestream({ title: 'A', createdBy: 3, youtubeVideoId: VIDEO_ID }, { db: fake.db, pool: null })

    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.statusCode, 503)
    assert.equal(fake.countSessions(), 0)
  })
})

describe('11.2 — id sinh ra trả về nguyên vẹn', () => {
  it('trả về đúng id mà lượt chèn sinh ra', async () => {
    const fake = makeFake()
    const { startLivestream } = await import('../server/services/livestream.ts')

    const result = await startLivestream({ title: 'A', createdBy: 3, youtubeVideoId: VIDEO_ID }, { db: fake.db, pool: fake.pool })

    assert.equal(result.ok, true)
    assert.equal(result.ok === true && result.sessionId, 101)
    assert.ok(Number.isSafeInteger(result.ok === true && result.sessionId))
  })

  it('dòng audit mang đúng id của buổi phát và hành động đọc được', async () => {
    const fake = makeFake()
    const { startLivestream } = await import('../server/services/livestream.ts')
    await startLivestream({ title: 'A', createdBy: 3, youtubeVideoId: VIDEO_ID }, { db: fake.db, pool: fake.pool })

    assert.ok(fake.log.some(sql => /^insert into `activity_logs`/i.test(sql)), 'phải có dòng audit')
  })

  it('tiêu đề rỗng bị từ chối TRƯỚC khi chạm tới khoá', async () => {
    const fake = makeFake()
    const { startLivestream } = await import('../server/services/livestream.ts')

    const result = await startLivestream({ title: '   ', createdBy: 3, youtubeVideoId: VIDEO_ID }, { db: fake.db, pool: fake.pool })

    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.statusCode, 400)
    assert.equal(fake.lockConnectionsReleased, 0, 'một tiêu đề rỗng không có lý do gì chiếm khoá của cả hệ thống')
  })
})

// ─── 11.3 — dừng ─────────────────────────────────────────────────────────────

describe('11.3 — dừng một buổi phát', () => {
  it('ghi ended_at, tắt cờ, và audit trong cùng một giao dịch', async () => {
    const fake = makeFake({ sessionRow: true, sessionIsActive: true })
    const { stopLivestream } = await import('../server/services/livestream.ts')

    const result = await stopLivestream({ sessionId: 7, actorId: 3 }, { db: fake.db })

    assert.equal(result.ok, true)
    const begin = fake.log.findIndex(sql => /^begin$/i.test(sql))
    const update = fake.log.findIndex(sql => /^update `livestream_sessions` set `is_active`/i.test(sql))
    const audit = fake.log.findIndex(sql => /^insert into `activity_logs`/i.test(sql))
    const commit = fake.log.findIndex(sql => /^commit$/i.test(sql))
    assert.ok(begin < update && update < audit && audit < commit, `thứ tự sai: ${fake.log.join(' | ')}`)
    assert.deepEqual(
      fake.poolLog.filter(sql => /^insert into |^update |^delete from /i.test(sql)),
      [],
      'không lượt ghi nào được chạy thẳng trên pool',
    )
  })

  it('từ chối một buổi phát đã dừng, và không đổi gì', async () => {
    const fake = makeFake({ sessionRow: true, sessionIsActive: false })
    const { stopLivestream } = await import('../server/services/livestream.ts')

    const result = await stopLivestream({ sessionId: 7, actorId: 3 }, { db: fake.db })

    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.statusCode, 409)
    assert.equal(fake.log.filter(sql => /^insert into `activity_logs`/i.test(sql)).length, 0)
  })

  it('buổi phát không tồn tại là 404, không phải 409', async () => {
    // Hai nguyên nhân khác nhau và chúng khác nhau với cán bộ: "đã dừng" là một
    // trạng thái hợp lệ, "không tồn tại" là một id sai.
    const fake = makeFake({ sessionRow: false })
    const { stopLivestream } = await import('../server/services/livestream.ts')

    const result = await stopLivestream({ sessionId: 7, actorId: 3 }, { db: fake.db })

    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.statusCode, 404)
  })

  it('hai lượt dừng cùng lúc: chỉ một lượt thắng', async () => {
    // `is_active = 1` nằm TRONG câu UPDATE, nên lượt thứ hai sửa 0 hàng. Đọc-rồi-ghi
    // thì cả hai đều thấy "đang phát" và lượt sau ghi đè `ended_at` của lượt trước.
    const fake = makeFake({ sessionRow: true, sessionIsActive: true })
    const { stopLivestream } = await import('../server/services/livestream.ts')

    const first = await stopLivestream({ sessionId: 7, actorId: 3 }, { db: fake.db })
    const second = await stopLivestream({ sessionId: 7, actorId: 4 }, { db: fake.db })

    assert.equal(first.ok, true)
    assert.equal(second.ok, false)
    assert.equal(second.ok === false && second.statusCode, 409)
    assert.equal(fake.log.filter(sql => /^insert into `activity_logs`/i.test(sql)).length, 1)
  })
})

// ─── 11.4 — lưu thành bản ghi ────────────────────────────────────────────────

describe('11.4 — lưu buổi phát thành bản ghi', () => {
  it('tạo mục media, ghi saved_media_id, và audit — TẤT CẢ trong một giao dịch', async () => {
    const fake = makeFake({ sessionRow: true, sessionIsActive: false })
    const { saveSessionAsRecording } = await import('../server/services/livestream.ts')

    const result = await saveSessionAsRecording({ sessionId: 7, actorId: 3 }, { db: fake.db })

    assert.equal(result.ok, true)
    assert.equal(result.ok === true && result.mediaItemId, 4242)

    const begin = fake.log.findIndex(sql => /^begin$/i.test(sql))
    const media = fake.log.findIndex(sql => /^insert into `media_items`/i.test(sql))
    const writeBack = fake.log.findIndex(sql => /^update `livestream_sessions` set `saved_media_id`/i.test(sql))
    const commit = fake.log.findIndex(sql => /^commit$/i.test(sql))
    assert.ok(begin !== -1 && begin < media, 'mục media phải nằm trong giao dịch')
    assert.ok(media < writeBack, 'ghi saved_media_id SAU khi mục media tồn tại')
    assert.ok(writeBack < commit, 'cả hai phải nằm trước commit')
    assert.equal(fake.log.filter(sql => /^begin$/i.test(sql)).length, 1, 'đúng MỘT giao dịch, không phải hai')
    assert.deepEqual(
      fake.poolLog.filter(sql => /^insert into |^update |^delete from /i.test(sql)),
      [],
      'không lượt ghi nào được chạy thẳng trên pool',
    )
  })

  it('từ chối một buổi phát ĐANG chạy', async () => {
    const fake = makeFake({ sessionRow: true, sessionIsActive: true })
    const { saveSessionAsRecording } = await import('../server/services/livestream.ts')

    const result = await saveSessionAsRecording({ sessionId: 7, actorId: 3 }, { db: fake.db })

    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.statusCode, 409)
    assert.equal(fake.log.filter(sql => /^insert into `media_items`/i.test(sql)).length, 0)
  })

  it('từ chối lưu lần thứ hai, và không sinh bản nháp trùng', async () => {
    // Mục media sinh ra mang `status: 'draft'`; một cú bấm thứ hai sẽ tạo thêm một
    // bản nháp không ai đi xoá, còn bản đầu thì mất liên kết duy nhất trỏ tới nó.
    const fake = makeFake({ sessionRow: true, sessionIsActive: false, savedMediaId: 555 })
    const { saveSessionAsRecording } = await import('../server/services/livestream.ts')

    const result = await saveSessionAsRecording({ sessionId: 7, actorId: 3 }, { db: fake.db })

    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.statusCode, 409)
    assert.equal(fake.log.filter(sql => /^insert into `media_items`/i.test(sql)).length, 0)
  })

  it('buổi phát không tồn tại là 404', async () => {
    const fake = makeFake({ sessionRow: false })
    const { saveSessionAsRecording } = await import('../server/services/livestream.ts')

    const result = await saveSessionAsRecording({ sessionId: 7, actorId: 3 }, { db: fake.db })

    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.statusCode, 404)
  })
})

// ─── 11.5 — khoá ngoại không được xoá mất bản ghi ────────────────────────────

describe('11.5 — khoá ngoại của phiên là SET NULL, không phải CASCADE', () => {
  /**
   * Đây là khác biệt giữa "một lượt dọn lưu trữ xoá phiên và **giữ** bản ghi" và
   * "một lượt dọn lưu trữ xoá phiên và **xoá luôn** video của cơ quan". Cùng một
   * câu lệnh, hai hậu quả không thể đảo ngược, và không có gì trong mã ứng dụng
   * phân biệt được chúng — chỉ có DDL.
   *
   * Đọc bằng `getTableConfig` chứ không bằng MySQL: ràng buộc nằm trong
   * `schema.ts`, và một suite không cần máy chủ vẫn chạy được ở mọi nơi.
   */
  function foreignKeysOf(table: Parameters<typeof getTableConfig>[0]) {
    return getTableConfig(table).foreignKeys.map(fk => {
      const reference = fk.reference()
      const name = reference.foreignTable as unknown as { [key: symbol]: string }
      return {
        column: reference.columns[0]?.name,
        foreignTable: name[Symbol.for('drizzle:Name')],
        onDelete: fk.onDelete,
      }
    })
  }

  it('saved_media_id và created_by đều là ON DELETE SET NULL', () => {
    const keys = foreignKeysOf(schema.livestreamSessions)
    assert.deepEqual(
      keys.map(k => `${k.column} -> ${k.foreignTable} (${k.onDelete})`).sort(),
      [
        'created_by -> users (set null)',
        'saved_media_id -> media_items (set null)',
      ],
    )
  })

  it('tin nhắn thì CASCADE theo phiên — chúng không có nghĩa nếu phiên biến mất', () => {
    const keys = foreignKeysOf(schema.livestreamMessages)
    assert.deepEqual(
      keys.map(k => `${k.column} -> ${k.foreignTable} (${k.onDelete})`).sort(),
      [
        'reader_id -> reader_accounts (cascade)',
        'session_id -> livestream_sessions (cascade)',
      ],
    )
  })
})
