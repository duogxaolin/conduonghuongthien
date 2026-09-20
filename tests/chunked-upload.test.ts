/**
 * Tải lên theo từng phần — bốn tính chất mà một lượt chạy "trông đúng" vẫn có
 * thể vi phạm, và không có cổng nào khác bắt được.
 *
 * Cả bốn đều thuộc loại **im lặng**: chúng không làm test nào khác đỏ, không làm
 * `typecheck` đỏ, và triệu chứng của chúng khi ra tới người dùng là một thứ khác
 * hẳn nguyên nhân.
 *
 *   1. **Quyền sở hữu nằm trong câu truy vấn.** Một bản đọc hàng rồi `if (row
 *      .adminUserId !== me)` cũng cho ra kết quả đúng ở mọi test chỉ kiểm "người
 *      khác thì bị từ chối" — nhưng nó là hai bước, và bước bị quên ở một đường
 *      mới là một cán bộ đọc được tệp của cán bộ khác. Test khẳng định **câu
 *      truy vấn** mang cả hai điều kiện, trên cả bốn thao tác.
 *   2. **Đường dẫn chỉ dựng từ mã do máy chủ sinh.** Test cố tình **gieo một
 *      hàng có mã traversal** vào bảng giả: nếu chốt chặn là "hàng không tồn
 *      tại" thì test này xanh vì lý do sai, còn nếu chốt chặn là phép kiểm hình
 *      dạng thì nó xanh vì lý do đúng. Không có hàng đó, hai cơ chế trông y hệt
 *      nhau.
 *   3. **Nội dung được kiểm bằng byte đầu.** Một tệp tên `phim.mp4` chứa văn bản
 *      phải bị từ chối, **và** lượt từ chối đó phải để lại **không hàng nào**
 *      trong `media_items`. Khẳng định thứ hai mới là khẳng định có giá trị:
 *      nhánh sai (tạo hàng trước rồi kiểm sau) vẫn "từ chối" đúng cách, và chỉ
 *      để lại một hàng `pending` trông y hệt một video đang chờ xử lý.
 *   4. **Ngưỡng dọn là thời điểm sửa đổi, không phải thời điểm tạo.** Một lượt
 *      tải 10 GB chạy vài giờ phải sống sót; một lượt bỏ dở một tuần phải bị
 *      dọn. Hai nhánh, và chỉ nhánh thứ hai được kiểm thì một bản dùng
 *      `created_at` vẫn xanh.
 *
 * Cơ sở dữ liệu ở đây là một **bảng trong bộ nhớ** sau một pool giả, không phải
 * một stub trả lời cố định: một lượt ghi rồi đọc lại phải thấy giá trị vừa ghi,
 * nếu không thì "gửi lại một phần đã nhận không đổi trạng thái" và "bỏ qua lượt
 * ghi" là hai thứ không phân biệt được.
 */
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { after, before, describe, it } from 'node:test'

import { drizzle } from 'drizzle-orm/mysql2'

import * as schema from '../server/db/schema.ts'
import {
  accumulatedBytes,
  completeUpload,
  declaredChunks,
  formatBytes,
  housekeepUploads,
  initUpload,
  isValidUploadId,
  missingIndexes,
  receiveChunk,
  resolvePartPath,
  resolveUploadDir,
  titleFromFilename,
  uploadStatus,
  withReceivedPart,
} from '../server/services/chunked-upload.ts'
import { MEDIA_DEFAULTS, type MediaConfig } from '../server/utils/media-config.ts'

// ─── Cơ sở dữ liệu giả ───────────────────────────────────────────────────────

type Row = Record<string, unknown>
type QueryCall = { sql: string; params: unknown[] }

/** `upload_id` → `uploadId`. Drizzle ánh xạ theo **vị trí**, nên bảng giả phải
 *  trả về đúng các cột đã chọn, đúng thứ tự đã chọn. */
function camel(name: string): string {
  return name.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase())
}

/**
 * Các cột kiểu JSON: **ghi thì driver đã tuần tự hoá, đọc thì driver giải mã**.
 *
 * Drizzle chỉ làm một nửa việc — `mapToDriverValue` của cột `json` là
 * `JSON.stringify`, và nó **không có** `mapFromDriverValue`; chiều đọc do mysql2
 * lo. Nghĩa là tham số đến bảng giả này đã là chuỗi `'["720p"]'`, còn giá trị
 * mysql2 trả về cho nơi gọi là một **mảng đã giải mã**.
 *
 * Một bảng giả tuần tự hoá thêm lần nữa ở chiều ghi sẽ lưu hai lớp và mọi lượt
 * đọc sau thấy chuỗi `'[1]'` ở chỗ nơi gọi chờ một mảng — triệu chứng là
 * `receivedParts.includes(index)` luôn `false`, tức mọi phần đã nhận bị coi là
 * chưa nhận. Bảng giả ở đây mô phỏng **đúng** cả hai chiều.
 */
const JSON_COLUMNS: ReadonlySet<string> = new Set(['receivedParts', 'resolutionsReady', 'meta', 'data'])

function decodeValue(column: string, value: unknown): unknown {
  if (!JSON_COLUMNS.has(column)) return value
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

/** Một giá trị thời gian thành `Date`. Drizzle gửi timestamp dưới dạng chuỗi
 *  `YYYY-MM-DD HH:MM:SS.mmm` (driver mới là bên đổi sang kiểu của MySQL). */
function asDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value).replace(' ', 'T') + 'Z')
}

/** Hình dạng một giá trị truy vấn: mysql2 nhận cả chuỗi trần và object `{sql, values}`. */
function sqlOf(first: unknown): string {
  if (typeof first === 'string') return first
  return String((first as { sql?: unknown })?.sql ?? '')
}

function paramsOf(second: unknown, first: unknown): unknown[] {
  if (Array.isArray(second)) return second
  const values = (first as { values?: unknown })?.values
  return Array.isArray(values) ? values : []
}

function projectRow(row: Row, sql: string): unknown[] {
  const columns = selectedColumns(sql)
  return columns.map(column => decodeValue(column, row[column] ?? null))
}

/**
 * Danh sách cột đã chọn của một câu `SELECT`.
 *
 * Drizzle không phát ra `select \`id\`, \`slug\`` mà là
 * ``select `media_items`.`id`, `media_items`.`slug` `` — tên bảng cũng nằm trong
 * dấu huyền. Gom mọi định danh trong mệnh đề select sẽ sinh ra một cột tên
 * `mediaItems` không tồn tại, và hàng trả về sai **vị trí** so với thứ drizzle
 * chờ (ánh xạ của nó theo vị trí). Lấy định danh **cuối cùng** của từng mục: với
 * `` `t`.`c` `` đó là `c`, với `` `c` `` cũng là `c`.
 *
 * Cắt theo dấu phẩy ở mức ngoặc ngoài cùng để một `coalesce(a, b)` không bị chẻ
 * đôi — hôm nay chưa có hàm nào như vậy trong tệp này, nhưng một lượt sửa thêm
 * một cột tính toán sẽ không làm bảng giả trả về sai một cách im lặng.
 */
function selectedColumns(sql: string): string[] {
  const selected = /^select (.+?) from /is.exec(sql.trim())
  if (!selected) throw new Error(`không đọc được danh sách cột: ${sql}`)
  const items: string[] = []
  let depth = 0
  let current = ''
  for (const ch of selected[1]!) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      items.push(current)
      current = ''
      continue
    }
    current += ch
  }
  items.push(current)

  return items.map((item) => {
    const identifiers = [...item.matchAll(/`([a-z_]+)`/g)].map(match => match[1]!)
    const last = identifiers[identifiers.length - 1]
    if (!last) throw new Error(`không đọc được tên cột trong: ${item}`)
    return camel(last)
  })
}

/**
 * Giá trị mà **driver** đưa xuống cho một cột JSON.
 *
 * Drizzle đã tuần tự hoá trước khi gọi pool (`mapToDriverValue` của cột `json`
 * chính là `JSON.stringify`), nên giá trị đến đây phải là một **chuỗi** — đúng
 * thứ MySQL nhận và cũng đúng thứ mysql2 sẽ giải mã ở chiều đọc.
 *
 * Khẳng định điều đó thay vì tự tuần tự hoá thêm một lần nữa: một bảng giả
 * tuần tự hoá hai lớp sẽ lưu `'"[]"'`, và mọi lượt đọc sau thấy chuỗi `'[]'` ở
 * chỗ nơi gọi chờ một mảng. Triệu chứng là `receivedParts.includes(index)` luôn
 * `false` — mọi phần đã nhận bị coi là chưa nhận, tức là cơ chế tiếp tục tải
 * hỏng, mà không có gì chỉ vào bảng giả.
 */
function driverValue(column: string, value: unknown): unknown {
  if (!JSON_COLUMNS.has(column)) return value
  if (typeof value !== 'string') {
    throw new Error(`cột JSON \`${column}\` nhận ${typeof value} từ driver, chờ một chuỗi`)
  }
  return value
}

/** Các cột trong mệnh đề `set`, kèm giá trị lấy từ tham số theo đúng thứ tự. */
function setClause(sql: string, params: unknown[]): { columns: string[]; values: unknown[] } {
  const start = sql.indexOf(' set ') + 5
  const end = sql.indexOf(' where ')
  const body = end === -1 ? sql.slice(start) : sql.slice(start, end)
  const columns = [...body.matchAll(/`([a-z_]+)` = \?/g)].map(match => camel(match[1]!))
  const values = params.slice(0, columns.length)
    .map((value, index) => driverValue(columns[index]!, value))
  return { columns, values }
}

/** Các cột và giá trị của một câu `insert … values (…)`, bỏ qua `default`. */
function insertClause(sql: string, params: unknown[]): Row {
  const columnsPart = /insert into `[a-z_]+` \((.+?)\) values/is.exec(sql)
  const valuesPart = /values \((.+)\)/is.exec(sql)
  if (!columnsPart || !valuesPart) throw new Error(`không đọc được câu insert: ${sql}`)
  const columns = [...columnsPart[1]!.matchAll(/`([a-z_]+)`/g)].map(match => camel(match[1]!))
  const tokens = valuesPart[1]!.split(',').map(token => token.trim())
  const row: Row = {}
  let cursor = 0
  columns.forEach((column, index) => {
    if (tokens[index] !== '?') return
    row[column] = driverValue(column, params[cursor++])
  })
  return row
}

type FakeOptions = {
  sessions?: Row[]
  mediaItems?: Row[]
  /** Số bản ghi `media_items` được chèn, để đếm sau một lượt hoàn tất. */
  nextMediaId?: number
  /**
   * Móc chạy **trước** mỗi câu lệnh, để một test khẳng định được thứ tự giữa các
   * lượt chạm cơ sở dữ liệu và một tác dụng phụ bên ngoài (ví dụ: một tiến trình
   * con được sinh ra).
   */
  onQuery?: (sql: string, params: unknown[]) => void
}

function fakePool(options: FakeOptions = {}) {
  const sessions = new Map<string, Row>(
    (options.sessions ?? []).map(row => [String(row.uploadId), { ...row }]),
  )
  const media: Row[] = [...(options.mediaItems ?? [])]
  const queries: QueryCall[] = []
  const mediaInserts: Row[] = []
  const auditInserts: Row[] = []
  let nextMediaId = options.nextMediaId ?? 500
  let released = 0
  let connections = 0

  function handle(first: unknown, second: unknown): unknown {
    const sql = sqlOf(first)
    const params = paramsOf(second, first)
    queries.push({ sql, params })
    options.onQuery?.(sql, params)
    const trimmed = sql.trim()

    // ── Điều khiển transaction ───────────────────────────────────────────────
    // `db.transaction` phát ra `begin` / `commit` / `rollback` trên **kết nối**
    // lấy từ `getConnection`, không qua `query` của pool. Bảng giả bỏ qua chúng
    // thì mọi đường ghi có transaction đều ném ngay ở câu đầu tiên.
    if (trimmed === 'begin' || trimmed === 'commit' || trimmed === 'rollback') {
      return [{ affectedRows: 0 }]
    }

    // ── media_upload_sessions ────────────────────────────────────────────────
    if (/^select .+ from `media_upload_sessions`/i.test(trimmed)) {
      let rows = [...sessions.values()]
      if (trimmed.includes('`admin_user_id` = ?')) {
        const [uploadId, adminUserId] = params
        rows = rows.filter(row => row.uploadId === uploadId && row.adminUserId === adminUserId)
      } else if (trimmed.includes('`updated_at` < ?')) {
        // Tham số đến dưới dạng chuỗi `YYYY-MM-DD HH:MM:SS.mmm` — drizzle không
        // gửi một đối tượng `Date` qua driver này. So sánh trên `Date` chứ không
        // trên chuỗi: so chuỗi chỉ đúng khi mọi giá trị cùng định dạng và cùng
        // múi giờ, tức là đúng một cách tình cờ.
        const cutoff = asDate(params[0])
        rows = rows.filter(row => asDate(row.updatedAt).getTime() < cutoff.getTime())
      }
      return [rows.map(row => projectRow(row, trimmed)), []]
    }

    if (trimmed.startsWith('insert into `media_upload_sessions`')) {
      const row = insertClause(trimmed, params)
      sessions.set(String(row.uploadId), { receivedParts: [], status: 'pending', ...row })
      return [{ insertId: 0, affectedRows: 1 }]
    }

    if (trimmed.startsWith('update `media_upload_sessions`')) {
      const { columns, values } = setClause(trimmed, params)
      const [uploadId, adminUserId] = params.slice(columns.length)
      const row = sessions.get(String(uploadId))
      if (!row || row.adminUserId !== adminUserId) return [{ affectedRows: 0 }]
      columns.forEach((column, index) => { row[column] = values[index] })
      return [{ affectedRows: 1 }]
    }

    if (trimmed.startsWith('delete from `media_upload_sessions`')) {
      const uploadId = String(params[0])
      return [{ affectedRows: sessions.delete(uploadId) ? 1 : 0 }]
    }

    // ── media_items ──────────────────────────────────────────────────────────
    if (/^select .+ from `media_items`/i.test(trimmed)) {
      return [media.map(row => projectRow(row, trimmed)), []]
    }

    if (trimmed.startsWith('insert into `media_items`')) {
      const row = insertClause(trimmed, params)
      nextMediaId += 1
      media.push({ ...row, id: nextMediaId })
      mediaInserts.push(row)
      return [{ insertId: nextMediaId, affectedRows: 1 }]
    }

    if (trimmed.startsWith('update `media_items`')) {
      const { columns, values } = setClause(trimmed, params)
      const id = params[columns.length]
      const row = media.find(item => item.id === id)
      if (!row) return [{ affectedRows: 0 }]
      columns.forEach((column, index) => { row[column] = values[index] })
      return [{ affectedRows: 1 }]
    }

    // ── activity_logs ────────────────────────────────────────────────────────
    if (trimmed.startsWith('insert into `activity_logs`')) {
      auditInserts.push(insertClause(trimmed, params))
      return [{ insertId: 1, affectedRows: 1 }]
    }

    throw new Error(`câu lệnh không được mô phỏng: ${trimmed.slice(0, 160)}`)
  }

  const connection = {
    async query(first: unknown, second: unknown) { return handle(first, second) },
    release() { released += 1 },
  }

  const pool = {
    async query(first: unknown, second: unknown) { return handle(first, second) },
    async execute(first: unknown, second: unknown) { return handle(first, second) },
    async getConnection() { connections += 1; return connection },
    async end() {},
  }

  return {
    pool,
    queries,
    sessions,
    mediaInserts,
    auditInserts,
    /** Một hàng phiên đã giải mã, đúng như một lượt đọc thật sẽ thấy. */
    session(uploadId: string): Row | undefined {
      const row = sessions.get(uploadId)
      if (!row) return undefined
      const out = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, decodeValue(String(key), value)]))
      return out
    },
    get released() { return released },
    get connections() { return connections },
  }
}

// ─── Bối cảnh chung ──────────────────────────────────────────────────────────

let root = ''
let config: MediaConfig

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cdkt-chunked-'))
  config = { ...resolveTestConfig(root), uploadEnabled: true }
})

after(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

function resolveTestConfig(workdir: string): MediaConfig {
  return {
    uploadEnabled: false,
    maxUploadSize: 4096,
    chunkSize: 1024,
    sessionInactivityHours: MEDIA_DEFAULTS.sessionInactivityHours,
    diskFloorBytes: MEDIA_DEFAULTS.diskFloorBytes,
    processingHeartbeatSeconds: MEDIA_DEFAULTS.processingHeartbeatSeconds,
    processingStaleMinutes: MEDIA_DEFAULTS.processingStaleMinutes,
    workdir,
  }
}

function dbOver(fake: ReturnType<typeof fakePool>) {
  return drizzle(fake.pool as never, { schema, mode: 'default' })
}

/** Một tệp "video" thật: hộp ISO tối thiểu mà `detectVideoMime` nhận ra. */
function mp4Header(padding = 64): Buffer {
  const size = Buffer.alloc(4)
  size.writeUInt32BE(24)
  return Buffer.concat([size, Buffer.from('ftyp'), Buffer.from('isom'), Buffer.alloc(padding)])
}

/** Nội dung không phải video, dài đúng bằng một phần. */
function notVideo(length: number): Buffer {
  return Buffer.alloc(length, 0x41)
}

function chunk(content: Buffer, size = 1024): Buffer {
  return Buffer.concat([content, Buffer.alloc(Math.max(0, size - content.length))])
}

// ─── 6.1 — Khởi tạo ──────────────────────────────────────────────────────────

describe('6.1 initUpload', () => {
  it('tạo hàng phiên gắn với cán bộ, mã do máy chủ sinh', async () => {
    const fake = fakePool()
    const result = await initUpload(
      { adminUserId: 7, filename: 'Phóng sự tái hoà nhập.mp4', declaredSize: 2048 },
      { db: dbOver(fake), config },
    )

    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.ok(isValidUploadId(result.uploadId), `mã không phải UUID: ${result.uploadId}`)
    assert.equal(result.totalChunks, 2)
    assert.equal(result.chunkSize, config.chunkSize)

    const stored = fake.session(result.uploadId)!
    assert.equal(stored.adminUserId, 7)
    assert.equal(stored.status, 'pending')
    assert.deepEqual(stored.receivedParts, [])
    // Tên tệp được lưu để **hiển thị**, không bao giờ để dựng đường dẫn.
    assert.equal(stored.filename, 'Phóng sự tái hoà nhập.mp4')
  })

  it('thư mục tạm được tạo dưới thư mục tải lên, không nơi nào khác', async () => {
    const fake = fakePool()
    const result = await initUpload({ adminUserId: 1, filename: 'a.mp4', declaredSize: 2048 }, { db: dbOver(fake), config })
    assert.equal(result.ok, true)
    if (!result.ok) return

    const dir = resolveUploadDir(config.workdir, result.uploadId)
    const stat = await fs.stat(dir)
    assert.ok(stat.isDirectory())
    assert.equal(path.dirname(dir), path.resolve(config.workdir, 'uploads'))
  })

  it('từ chối khi máy chủ tắt nhận tải lên — ở MÁY CHỦ, không chỉ ở giao diện', async () => {
    const fake = fakePool()
    const result = await initUpload(
      { adminUserId: 1, filename: 'a.mp4', declaredSize: 2048 },
      { db: dbOver(fake), config: { ...config, uploadEnabled: false } },
    )

    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.status, 503)
    assert.equal(result.code, 'upload_disabled')
    // Không hàng, không thư mục: một công tắc chỉ từ chối sau khi đã ghi là một
    // công tắc để lại rác.
    assert.equal(fake.sessions.size, 0)
    assert.equal(fake.queries.filter(q => q.sql.startsWith('insert into `media_upload_sessions`')).length, 0)
  })

  it('từ chối dung lượng khai báo vượt trần, trước khi ghi bất cứ gì', async () => {
    const fake = fakePool()
    const result = await initUpload(
      { adminUserId: 1, filename: 'a.mp4', declaredSize: config.maxUploadSize + 1 },
      { db: dbOver(fake), config },
    )

    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.status, 413)
    assert.equal(result.code, 'size_limit')
    assert.equal(fake.sessions.size, 0, 'một hàng rác cho mỗi lượt thử quá cỡ trông y hệt một lượt tải đang dở')
  })

  it('từ chối dung lượng khai báo không dùng được', async () => {
    for (const declaredSize of [0, -1, 'abc', 1.5, null, undefined, Number.MAX_SAFE_INTEGER + 2]) {
      const fake = fakePool()
      const result = await initUpload(
        { adminUserId: 1, filename: 'a.mp4', declaredSize },
        { db: dbOver(fake), config },
      )
      assert.equal(result.ok, false, `chấp nhận declaredSize=${String(declaredSize)}`)
      assert.equal(fake.sessions.size, 0)
    }
  })
})

// ─── 6.1 — Nhận phần, gửi lại, tiếp tục ──────────────────────────────────────

describe('6.1 receiveChunk — thứ tự đến không quan trọng', () => {
  async function openSession(declaredSize = 3072) {
    const fake = fakePool()
    const db = dbOver(fake)
    const init = await initUpload({ adminUserId: 7, filename: 'a.mp4', declaredSize }, { db, config })
    assert.equal(init.ok, true)
    if (!init.ok) throw new Error('init thất bại')
    return { fake, db, uploadId: init.uploadId, totalChunks: init.totalChunks }
  }

  it('các phần đến ngược thứ tự vẫn được ghi nhận đủ', async () => {
    const { fake, db, uploadId } = await openSession()

    for (const index of [2, 0, 1]) {
      const result = await receiveChunk(
        { adminUserId: 7, uploadId, index, body: chunk(notVideo(1024)) },
        { db, config },
      )
      assert.equal(result.ok, true, `phần ${index} bị từ chối`)
    }

    // Sắp xếp khi lưu: JSON này là thứ người vận hành đọc khi soi một lượt hỏng,
    // và `[2, 0, 1]` đọc ra như một lỗi trong khi nó là kết quả đúng.
    assert.deepEqual(fake.session(uploadId)!.receivedParts, [0, 1, 2])

    const status = await uploadStatus({ adminUserId: 7, uploadId }, { db, config })
    assert.equal(status.ok, true)
    if (!status.ok) return
    assert.deepEqual(status.missing, [])
  })

  it('gửi lại một phần đã nhận là thành công và KHÔNG đổi trạng thái', async () => {
    const { fake, db, uploadId } = await openSession()
    await receiveChunk({ adminUserId: 7, uploadId, index: 0, body: chunk(notVideo(1024)) }, { db, config })

    const before = fake.queries.filter(q => q.sql.startsWith('update `media_upload_sessions`')).length
    const again = await receiveChunk(
      { adminUserId: 7, uploadId, index: 0, body: chunk(notVideo(1024)) },
      { db, config },
    )

    assert.equal(again.ok, true)
    if (!again.ok) return
    assert.equal(again.duplicate, true)
    assert.deepEqual(again.receivedParts, [0])
    // Không lượt ghi nào: đây là nhánh làm cho việc thử lại sau khi mạng đứt trở
    // nên an toàn, và nó chỉ an toàn nếu nó không chạm hàng.
    assert.equal(
      fake.queries.filter(q => q.sql.startsWith('update `media_upload_sessions`')).length,
      before + 1,
      'retry renews activity without changing receivedParts',
    )
  })

  it('trạng thái trả về đúng những phần còn thiếu — đây là cơ chế tiếp tục', async () => {
    const { db, uploadId } = await openSession(4096)
    await receiveChunk({ adminUserId: 7, uploadId, index: 1, body: chunk(notVideo(1024)) }, { db, config })
    await receiveChunk({ adminUserId: 7, uploadId, index: 3, body: notVideo(1024) }, { db, config })

    const status = await uploadStatus({ adminUserId: 7, uploadId }, { db, config })
    assert.equal(status.ok, true)
    if (!status.ok) return
    assert.deepEqual(status.missing, [0, 2])
    assert.deepEqual(status.session.receivedParts, [1, 3])
  })

  it('phần không phải cuối phải dài đúng một phần — một phần ngắn để lại lỗ trong tệp ghép', async () => {
    const { db, uploadId } = await openSession(3072)
    const short = await receiveChunk(
      { adminUserId: 7, uploadId, index: 0, body: notVideo(10) },
      { db, config },
    )
    assert.equal(short.ok, false)
    if (short.ok) return
    assert.equal(short.code, 'bad_chunk_size')

    // Last-part length must also match the declared file geometry.
    const last = await receiveChunk({ adminUserId: 7, uploadId, index: 2, body: notVideo(37) }, { db, config })
    assert.equal(last.ok, false)
  })

  it('chỉ số nằm ngoài khoảng đã khai bị từ chối', async () => {
    const { db, uploadId } = await openSession(2048) // 2 phần: 0, 1
    for (const index of [-1, 2, 99, 0.5, '0', null, undefined, Number.NaN]) {
      const result = await receiveChunk(
        { adminUserId: 7, uploadId, index, body: chunk(notVideo(1024)) },
        { db, config },
      )
      assert.equal(result.ok, false, `chấp nhận index=${String(index)}`)
      if (result.ok) continue
      assert.equal(result.code, 'bad_index')
    }
  })

  it('một phiên đã hoàn tất không nhận thêm phần', async () => {
    const { fake, db, uploadId } = await openSession(1024)
    fake.sessions.get(uploadId)!.status = 'completed'
    const result = await receiveChunk({ adminUserId: 7, uploadId, index: 0, body: chunk(notVideo(1024)) }, { db, config })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, 'state')
  })
})

// ─── 6.2 — Quyền sở hữu nằm trong câu truy vấn ───────────────────────────────

describe('6.2 quyền sở hữu', () => {
  it('mã không tồn tại và mã của cán bộ khác cho ra phản hồi GIỐNG HỆT NHAU', async () => {
    const fake = fakePool()
    const db = dbOver(fake)
    const init = await initUpload({ adminUserId: 7, filename: 'a.mp4', declaredSize: 1024 }, { db, config })
    assert.equal(init.ok, true)
    if (!init.ok) return

    const unknown = await uploadStatus({ adminUserId: 7, uploadId: '00000000-0000-4000-8000-000000000000' }, { db, config })
    const someoneElse = await uploadStatus({ adminUserId: 8, uploadId: init.uploadId }, { db, config })

    assert.equal(unknown.ok, false)
    assert.equal(someoneElse.ok, false)
    // Cùng một hằng số, nên hai nhánh không thể lệch nhau ở lần sửa thứ nhất —
    // và một thông báo có ích ở nhánh này mà không ở nhánh kia là một kênh dò mã
    // lượt tải đang có.
    assert.deepEqual(unknown, someoneElse)
  })

  it('cả bốn thao tác đều mang điều kiện chủ sở hữu trong câu truy vấn', async () => {
    const fake = fakePool()
    const db = dbOver(fake)
    const content = Buffer.concat([mp4Header(64), Buffer.alloc(2048 - mp4Header(64).length)])
    assert.equal(content.length, 2048)

    const init = await initUpload({ adminUserId: 7, filename: 'a.mp4', declaredSize: 2048 }, { db, config })
    assert.equal(init.ok, true)
    if (!init.ok) return
    const uploadId = init.uploadId

    // Cả bốn thao tác, và lượt hoàn tất phải **thành công** — một lượt hoàn tất
    // dừng ở nhánh `incomplete` chỉ chạm bảng phiên một lần, nên nó không chứng
    // minh được gì về hai lượt ghi còn lại.
    fake.queries.length = 0
    await receiveChunk({ adminUserId: 7, uploadId, index: 1, body: content.subarray(1024) }, { db, config })
    await receiveChunk({ adminUserId: 7, uploadId, index: 0, body: content.subarray(0, 1024) }, { db, config })
    const status = await uploadStatus({ adminUserId: 7, uploadId }, { db, config })
    const completed = await completeUpload({ adminUserId: 7, uploadId }, { db, config })
    assert.equal(status.ok, true)
    assert.equal(completed.ok, true, 'lượt hoàn tất phải đi hết đường mới kiểm được mọi lượt ghi')

    const touching = fake.queries.filter(q => q.sql.includes('`media_upload_sessions`'))
    assert.ok(touching.length >= 6, `chỉ thấy ${touching.length} câu chạm bảng phiên`)
    for (const call of touching) {
      assert.match(
        call.sql,
        /`admin_user_id` = \?/,
        `câu truy vấn không mang điều kiện chủ sở hữu: ${call.sql.slice(0, 140)}`,
      )
    }
  })

  it('cán bộ khác không ghi được phần nào, và không hàng nào bị sửa', async () => {
    const fake = fakePool()
    const db = dbOver(fake)
    const init = await initUpload({ adminUserId: 7, filename: 'a.mp4', declaredSize: 2048 }, { db, config })
    assert.equal(init.ok, true)
    if (!init.ok) return

    const result = await receiveChunk(
      { adminUserId: 8, uploadId: init.uploadId, index: 0, body: chunk(notVideo(1024)) },
      { db, config },
    )
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, 'not_found')
    assert.deepEqual(fake.session(init.uploadId)!.receivedParts, [])
  })
})

// ─── 6.3 — Đường dẫn chỉ từ mã do máy chủ sinh ───────────────────────────────

describe('6.3 đường dẫn tạm', () => {
  const traversals = [
    '../escape',
    '../../escape',
    '../../../../etc/passwd',
    '/etc/passwd',
    'a/../../b',
    '..',
    '.',
    '',
    'abc',
    'e3b0c442-98fc-1c14-9afb-f4c8996fb924' + '/../../x',
    'e3b0c442-98fc-1c14-9afb-f4c8996fb924\n',
    null,
    undefined,
    42,
  ]

  it('resolveUploadDir từ chối mọi hình dạng traversal, và không trả đường dẫn nào', () => {
    for (const bad of traversals) {
      assert.throws(() => resolveUploadDir(config.workdir, bad), `chấp nhận: ${String(bad)}`)
    }
  })

  it('resolvePartPath từ chối chỉ số không nguyên', () => {
    const id = 'e3b0c442-98fc-1c14-9afb-f4c8996fb924'
    for (const index of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
      assert.throws(() => resolvePartPath(config.workdir, id, index), `chấp nhận chỉ số ${String(index)}`)
    }
  })

  it('một HÀNG mang mã traversal vẫn không mở được đường ra ngoài', async () => {
    // Đây là điểm mấu chốt: gieo sẵn một hàng có mã traversal nghĩa là nhánh
    // "hàng không tồn tại" không thể là thứ làm test này xanh. Thứ duy nhất còn
    // chặn được là phép kiểm hình dạng — và nếu phép kiểm đó biến mất, test này
    // đỏ vì một lượt ghi đã xảy ra ngoài thư mục tải lên.
    const escape = '../../escaped-by-upload-id'
    const fake = fakePool({
      sessions: [{
        uploadId: escape,
        adminUserId: 7,
        filename: 'a.mp4',
        declaredSize: 1024,
        chunkSize: 1024,
        totalChunks: 1,
        receivedParts: [],
        status: 'pending',
        updatedAt: new Date(),
      }],
    })
    const db = dbOver(fake)

    const received = await receiveChunk(
      { adminUserId: 7, uploadId: escape, index: 0, body: chunk(notVideo(1024)) },
      { db, config },
    )
    const status = await uploadStatus({ adminUserId: 7, uploadId: escape }, { db, config })
    const completed = await completeUpload({ adminUserId: 7, uploadId: escape }, { db, config })

    for (const result of [received, status, completed]) {
      assert.equal(result.ok, false)
      if (result.ok) continue
      assert.equal(result.code, 'not_found')
    }

    // Và không có tệp nào được ghi ra ngoài thư mục tải lên.
    const escaped = path.resolve(config.workdir, escape)
    await assert.rejects(fs.stat(escaped), 'một lượt ghi đã thoát khỏi thư mục tải lên')
  })

  it('tên tệp client gửi không đi vào đường dẫn', async () => {
    const fake = fakePool()
    const db = dbOver(fake)
    const init = await initUpload(
      { adminUserId: 7, filename: '../../../etc/passwd.mp4', declaredSize: 1024 },
      { db, config },
    )
    assert.equal(init.ok, true)
    if (!init.ok) return

    const dir = resolveUploadDir(config.workdir, init.uploadId)
    assert.equal(path.dirname(dir), path.resolve(config.workdir, 'uploads'))
    // Tên tệp chỉ được lưu để hiển thị, và bị cắt hết thành phần đường dẫn.
    assert.equal(fake.session(init.uploadId)!.filename, 'passwd.mp4')
  })
})

// ─── 6.4 — Trần dung lượng, hai đường ────────────────────────────────────────

describe('6.4 trần dung lượng', () => {
  it('đường khai báo: init từ chối', async () => {
    const fake = fakePool()
    const result = await initUpload(
      { adminUserId: 1, filename: 'a.mp4', declaredSize: 8192 },
      { db: dbOver(fake), config },
    )
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, 'size_limit')
    assert.equal(result.status, 413)
  })

  it('đường tích luỹ: dung lượng thật vượt trần thì phiên bị đánh dấu hỏng', async () => {
    // Dung lượng khai báo hợp lệ (4096 = trần) nhưng client gửi phần dài hơn
    // khai báo. Từ chối riêng phần này là chưa đủ: client khai một đằng gửi một
    // nẻo thì gửi lại cũng vậy, nên phiên phải dừng hẳn.
    const fake = fakePool()
    const db = dbOver(fake)
    const init = await initUpload({ adminUserId: 1, filename: 'a.mp4', declaredSize: 4096 }, { db, config })
    assert.equal(init.ok, true)
    if (!init.ok) return

    // Ghi thẳng một phần dài hơn `chunkSize` là không qua được phép kiểm độ dài,
    // nên đường tích luỹ được chạm bằng cách hạ trần xuống dưới dung lượng một
    // phần: đúng tình huống "khai báo đúng nhưng cấu hình đã đổi giữa chừng".
    const tight: MediaConfig = { ...config, maxUploadSize: 512 }
    const result = await receiveChunk(
      { adminUserId: 1, uploadId: init.uploadId, index: 0, body: chunk(notVideo(1024)) },
      { db, config: tight },
    )

    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, 'size_limit')
    assert.equal(result.status, 413)
    const row = fake.session(init.uploadId)!
    assert.equal(row.status, 'failed', 'phiên vẫn ở trạng thái nhận tiếp sau khi vượt trần')
    assert.match(String(row.errorMessage), /giới hạn/)
  })

  it('đường tích luỹ tính cả những phần đã nhận trước đó', async () => {
    const fake = fakePool()
    const db = dbOver(fake)
    const init = await initUpload({ adminUserId: 1, filename: 'a.mp4', declaredSize: 4096 }, { db, config })
    assert.equal(init.ok, true)
    if (!init.ok) return

    const before = await receiveChunk(
      { adminUserId: 1, uploadId: init.uploadId, index: 0, body: chunk(notVideo(1024)) },
      { db, config },
    )
    assert.equal(before.ok, true)

    // Trần 1500: phần thứ hai đẩy tổng lên 2048, vượt. Một bản chỉ so độ dài
    // từng phần sẽ cho qua.
    const result = await receiveChunk(
      { adminUserId: 1, uploadId: init.uploadId, index: 1, body: chunk(notVideo(1024)) },
      { db, config: { ...config, maxUploadSize: 1500 } },
    )
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, 'size_limit')
  })

  it('accumulatedBytes tính đúng, kể cả phần cuối ngắn', () => {
    assert.equal(accumulatedBytes([], 4, 1000, null), 0)
    assert.equal(accumulatedBytes([0, 1], 4, 1000, null), 2000)
    // Phần cuối mang phần dư, nên độ dài của nó phải được đọc thật.
    assert.equal(accumulatedBytes([0, 1, 2, 3], 4, 1000, 250), 3250)
    // Phần cuối đã nhận nhưng `stat` hỏng: đọc là 0, không ném ra.
    assert.equal(accumulatedBytes([3], 4, 1000, null), 0)
    // Chỉ số không dùng được bị bỏ qua thay vì làm hỏng con số.
    assert.equal(accumulatedBytes([0, 9, -1], 4, 1000, null), 1000)
  })

  it('declaredChunks làm tròn lên, và phần cuối mang phần dư', () => {
    assert.equal(declaredChunks(4096, 1024), 4)
    assert.equal(declaredChunks(4097, 1024), 5)
    assert.equal(declaredChunks(1, 1024), 1)
    // Chia hết cho chunkSize không sinh ra một phần rỗng thứ N+1.
    assert.equal(declaredChunks(2048, 1024), 2)
    assert.equal(declaredChunks(0, 1024), 0)
    assert.equal(declaredChunks(1024, 0), 0)
  })
})

// ─── 6.5 — Hoàn tất: ghép, kiểm byte đầu, không hàng rác ─────────────────────

describe('6.5 completeUpload', () => {
  async function uploadFile(content: Buffer, declaredSize = content.length) {
    const fake = fakePool()
    const db = dbOver(fake)
    const init = await initUpload({ adminUserId: 7, filename: 'phim.mp4', declaredSize }, { db, config })
    assert.equal(init.ok, true)
    if (!init.ok) throw new Error('init thất bại')
    for (let index = 0; index < init.totalChunks; index++) {
      const slice = content.subarray(index * config.chunkSize, (index + 1) * config.chunkSize)
      const result = await receiveChunk({ adminUserId: 7, uploadId: init.uploadId, index, body: slice }, { db, config })
      assert.equal(result.ok, true, `phần ${index} bị từ chối`)
    }
    return { fake, db, uploadId: init.uploadId }
  }

  it('tệp tên .mp4 chứa nội dung không phải video bị TỪ CHỐI', async () => {
    const { fake, db, uploadId } = await uploadFile(notVideo(1024))
    const result = await completeUpload({ adminUserId: 7, uploadId }, { db, config })

    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, 'unsupported_video')
    assert.equal(result.status, 415)

    // Và lượt từ chối để lại KHÔNG hàng `media_items` nào. Đây mới là khẳng định
    // có giá trị: nhánh sai (tạo hàng trước rồi kiểm sau) vẫn "từ chối" đúng, và
    // chỉ để lại một hàng `pending` trông y hệt một video đang chờ xử lý.
    assert.equal(fake.mediaInserts.length, 0, 'một hàng media_items đã được tạo cho một tệp không phải video')
    assert.equal(fake.auditInserts.length, 0, 'một dòng nhật ký đã được ghi cho một lượt hoàn tất bị từ chối')
    assert.equal(fake.session(uploadId)!.status, 'failed')
    assert.equal(fake.session(uploadId)!.mediaItemId ?? null, null)
  })

  it('dữ liệu tạm bị xoá sau một lượt từ chối', async () => {
    const { db, uploadId } = await uploadFile(notVideo(1024))
    const dir = resolveUploadDir(config.workdir, uploadId)
    assert.ok((await fs.stat(dir)).isDirectory())

    await completeUpload({ adminUserId: 7, uploadId }, { db, config })
    // Một tệp rác 10 GB nằm lại sẽ chiếm đúng chỗ mà lần tải sau cần, và lượt
    // dọn chỉ vớt được nó sau khi hết cửa sổ không hoạt động.
    await assert.rejects(fs.stat(dir))
  })

  it('nội dung video thật thì được nhận, và hàng được tạo cùng dòng nhật ký', async () => {
    const { fake, db, uploadId } = await uploadFile(mp4Header())
    const result = await completeUpload({ adminUserId: 7, uploadId }, { db, config })

    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.contentType, 'video/mp4')
    assert.equal(fake.mediaInserts.length, 1)
    assert.equal(fake.auditInserts.length, 1)
    assert.equal(fake.auditInserts[0]!.resource, 'media_portal')
    assert.equal(fake.auditInserts[0]!.resourceId, result.mediaItemId)
    assert.equal(fake.session(uploadId)!.status, 'completed')
    assert.equal(fake.session(uploadId)!.mediaItemId, result.mediaItemId)
  })

  it('tệp gốc được lưu dưới đuôi suy từ NỘI DUNG, không từ tên tệp', async () => {
    // Tên tệp là `phim.mp4` nhưng nội dung là QuickTime không có hộp `ftyp`.
    const quicktime = Buffer.concat([
      (() => { const size = Buffer.alloc(4); size.writeUInt32BE(1024); return size })(),
      Buffer.from('moov'),
      Buffer.alloc(1016),
    ])
    const { db, uploadId } = await uploadFile(quicktime)
    const result = await completeUpload({ adminUserId: 7, uploadId }, { db, config })

    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.contentType, 'video/quicktime')
    const stored = path.resolve(config.workdir, 'media', uploadId, 'original.mov')
    assert.ok((await fs.stat(stored)).isFile(), 'tệp gốc không được lưu dưới đuôi suy từ nội dung')
  })

  it('thiếu phần thì không ghép, không tạo hàng, không xoá dữ liệu đã nhận', async () => {
    const fake = fakePool()
    const db = dbOver(fake)
    const init = await initUpload({ adminUserId: 7, filename: 'a.mp4', declaredSize: 2048 }, { db, config })
    assert.equal(init.ok, true)
    if (!init.ok) return
    await receiveChunk({ adminUserId: 7, uploadId: init.uploadId, index: 0, body: chunk(notVideo(1024)) }, { db, config })

    const result = await completeUpload({ adminUserId: 7, uploadId: init.uploadId }, { db, config })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, 'incomplete')
    assert.equal(fake.mediaInserts.length, 0)
    // Dữ liệu đã nhận còn nguyên: client gửi tiếp phần thiếu rồi hoàn tất lại.
    assert.deepEqual(fake.session(init.uploadId)!.receivedParts, [0])
    assert.ok((await fs.stat(resolveUploadDir(config.workdir, init.uploadId))).isDirectory())
  })

  it('hoàn tất hai lần trả về cùng mục, không tạo mục thứ hai', async () => {
    const { fake, db, uploadId } = await uploadFile(mp4Header())
    const first = await completeUpload({ adminUserId: 7, uploadId }, { db, config })
    const second = await completeUpload({ adminUserId: 7, uploadId }, { db, config })

    assert.equal(first.ok, true)
    assert.equal(second.ok, true)
    if (!first.ok || !second.ok) return
    assert.equal(second.mediaItemId, first.mediaItemId)
    assert.equal(fake.mediaInserts.length, 1, 'một lượt gọi lại đã tạo mục media thứ hai')
  })

  it('ghép các phần theo ĐÚNG thứ tự chỉ số, không theo thứ tự đến', async () => {
    // Một mục `a` đã tồn tại, nên slug sinh ra là `a-2` — cố định, không phụ
    // thuộc thư mục làm việc còn gì từ test trước. Đường dẫn đọc lại phải là một
    // đường dẫn đã biết trước, không phải một đường dẫn đoán theo trạng thái đĩa.
    const fake = fakePool({ mediaItems: [{ slug: 'a' }] })
    const db = dbOver(fake)
    // Hai phần, mỗi phần 1024 byte, phần đầu mang header MP4.
    const header = mp4Header(64)
    const head = Buffer.concat([header, Buffer.alloc(1024 - header.length, 0x11)])
    const tail = Buffer.alloc(1024, 0x22)
    assert.equal(head.length, 1024)

    const init = await initUpload({ adminUserId: 7, filename: 'a.mp4', declaredSize: 2048 }, { db, config })
    assert.equal(init.ok, true)
    if (!init.ok) return

    // Gửi phần CUỐI trước.
    await receiveChunk({ adminUserId: 7, uploadId: init.uploadId, index: 1, body: tail }, { db, config })
    await receiveChunk({ adminUserId: 7, uploadId: init.uploadId, index: 0, body: head }, { db, config })

    const result = await completeUpload({ adminUserId: 7, uploadId: init.uploadId }, { db, config })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.slug, 'a-2')

    const stored = path.resolve(config.workdir, 'media', init.uploadId, 'original.mp4')
    const bytes = await fs.readFile(stored)
    assert.equal(bytes.length, 2048)
    // Header ở đầu, đuôi ở cuối — ghép theo thứ tự đến sẽ cho ra ngược lại và
    // `detectVideoMime` sẽ không nhận ra tệp.
    assert.equal(bytes.subarray(4, 8).toString('ascii'), 'ftyp')
    assert.equal(bytes[1024], 0x22)
  })

  it('lỗi lưu tệp gốc đánh dấu mục hỏng kèm lý do, không để nó ở trạng thái chờ', async () => {
    const fake = fakePool({ mediaItems: [{ slug: 'a' }] })
    const db = dbOver(fake)
    const init = await initUpload({ adminUserId: 7, filename: 'a.mp4', declaredSize: 1024 }, { db, config })
    assert.equal(init.ok, true)
    if (!init.ok) return
    await receiveChunk({ adminUserId: 7, uploadId: init.uploadId, index: 0, body: chunk(mp4Header()) }, { db, config })

    // Thư mục `media/` bị một tệp cùng tên chặn đường: `mkdir` sẽ hỏng.
    const blocker = path.resolve(config.workdir, 'media')
    await fs.rm(blocker, { recursive: true, force: true })
    await fs.writeFile(blocker, 'not a directory')

    try {
      const result = await completeUpload({ adminUserId: 7, uploadId: init.uploadId }, { db, config })
      assert.equal(result.ok, false)
      if (result.ok) return
      assert.equal(result.code, 'assemble_failed')

      const updates = fake.queries.filter(q => q.sql.startsWith('update `media_items`'))
      assert.equal(updates.length, 0)
      assert.equal(fake.mediaInserts.length, 0, 'no media row may precede a durable original')
      assert.equal(fake.session(init.uploadId)!.status, 'pending', 'retain uploaded chunks for an IO retry')
      assert.match(String(fake.session(init.uploadId)!.errorMessage), /Không hoàn tất/)
    } finally {
      // Dọn ở `finally`: một khẳng định đỏ ở giữa sẽ bỏ qua lượt dọn và để lại
      // `media` là một **tệp**, làm mọi test sau trong tệp này hỏng vì `ENOTDIR`.
      await fs.rm(blocker, { force: true })
    }
  })
})

// ─── 6.6 — Dọn lượt tải bỏ dở ────────────────────────────────────────────────

describe('6.6 housekeepUploads', () => {
  it('dọn lượt quá hạn và thư mục của nó', async () => {
    const fake = fakePool()
    const db = dbOver(fake)
    const init = await initUpload({ adminUserId: 7, filename: 'a.mp4', declaredSize: 1024 }, { db, config })
    assert.equal(init.ok, true)
    if (!init.ok) return
    const dir = resolveUploadDir(config.workdir, init.uploadId)

    const old = new Date(Date.now() - 72 * 60 * 60 * 1000)
    fake.sessions.get(init.uploadId)!.updatedAt = old

    const result = await housekeepUploads({ db, config, now: new Date() })
    assert.equal(result.sessions, 1)
    assert.equal(fake.sessions.size, 0)
    await assert.rejects(fs.stat(dir))
  })

  it('KHÔNG đụng một lượt vừa được sửa — kể cả khi nó đã mở từ lâu', async () => {
    // Đây là nhánh làm cho ngưỡng phải là `updated_at` chứ không phải
    // `created_at`. Một lượt tải 10 GB qua đường truyền chậm chạy vài giờ; đo từ
    // lúc tạo thì nó bị xoá giữa chừng, và mất đúng công việc mà tính năng tải
    // lên theo phần sinh ra để bảo vệ.
    const fake = fakePool()
    const db = dbOver(fake)
    const init = await initUpload({ adminUserId: 7, filename: 'a.mp4', declaredSize: 1024 }, { db, config })
    assert.equal(init.ok, true)
    if (!init.ok) return
    const dir = resolveUploadDir(config.workdir, init.uploadId)

    const row = fake.sessions.get(init.uploadId)!
    row.createdAt = new Date(Date.now() - 72 * 60 * 60 * 1000)
    row.updatedAt = new Date(Date.now() - 60 * 1000)

    const result = await housekeepUploads({ db, config, now: new Date() })
    assert.equal(result.sessions, 0, 'một lượt đang chạy bị dọn vì nó được mở từ lâu')
    assert.equal(fake.sessions.size, 1)
    assert.ok((await fs.stat(dir)).isDirectory())
  })

  it('dọn thư mục mồ côi không còn hàng nào trỏ tới', async () => {
    const fake = fakePool()
    const db = dbOver(fake)
    const orphanId = '11111111-2222-4333-8444-555555555555'
    const dir = resolveUploadDir(config.workdir, orphanId)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, '0.part'), 'leftover')
    const longAgo = new Date(Date.now() - 72 * 60 * 60 * 1000)
    await fs.utimes(dir, longAgo, longAgo)

    const result = await housekeepUploads({ db, config, now: new Date() })
    assert.equal(result.orphans, 1)
    await assert.rejects(fs.stat(dir))
  })

  it('thư mục mồ côi VỪA được sửa thì để yên', async () => {
    // `init` tạo thư mục trước rồi mới ghi hàng. Giữa hai bước đó thư mục trông y
    // hệt một thư mục mồ côi, và xoá nó là làm hỏng đúng lượt tải đang mở.
    const fake = fakePool()
    const db = dbOver(fake)
    const orphanId = '99999999-8888-4777-8666-555555555555'
    const dir = resolveUploadDir(config.workdir, orphanId)
    await fs.mkdir(dir, { recursive: true })

    const result = await housekeepUploads({ db, config, now: new Date() })
    assert.equal(result.orphans, 0)
    assert.ok((await fs.stat(dir)).isDirectory())
    await fs.rm(dir, { recursive: true, force: true })
  })
})

// ─── Hàm thuần ───────────────────────────────────────────────────────────────

describe('hàm thuần', () => {
  it('isValidUploadId chỉ nhận UUID', () => {
    assert.equal(isValidUploadId('e3b0c442-98fc-1c14-9afb-f4c8996fb924'), true)
    assert.equal(isValidUploadId('E3B0C442-98FC-1C14-9AFB-F4C8996FB924'), true)
    for (const bad of ['', 'abc', 'e3b0c44298fc1c149afbf4c8996fb924', 'e3b0c442-98fc-1c14-9afb-f4c8996fb92', null, 7, {}]) {
      assert.equal(isValidUploadId(bad), false, `chấp nhận: ${String(bad)}`)
    }
  })

  it('missingIndexes liệt kê đúng phần còn thiếu, tăng dần', () => {
    assert.deepEqual(missingIndexes([], 3), [0, 1, 2])
    assert.deepEqual(missingIndexes([0, 1, 2], 3), [])
    assert.deepEqual(missingIndexes([2, 0], 3), [1])
    // Chỉ số rác không làm hỏng con số, và không che một phần thật sự thiếu.
    assert.deepEqual(missingIndexes([0, 99, -3], 2), [1])
  })

  it('withReceivedPart khử trùng và sắp xếp', () => {
    assert.deepEqual(withReceivedPart([], 0), [0])
    assert.deepEqual(withReceivedPart([2, 0], 1), [0, 1, 2])
    assert.deepEqual(withReceivedPart([1], 1), [1])
  })

  it('titleFromFilename bỏ đuôi, gọn khoảng trắng, có dự phòng', () => {
    assert.equal(titleFromFilename('Phóng sự tái hoà nhập.mp4'), 'Phóng sự tái hoà nhập')
    assert.equal(titleFromFilename('phong_su_2026.mov'), 'phong su 2026')
    assert.equal(titleFromFilename('.mp4'), 'Video')
    assert.equal(titleFromFilename(''), 'Video')
    assert.equal(titleFromFilename(null), 'Video')
    assert.equal(titleFromFilename('🎬'), '🎬')
  })

  it('formatBytes đọc được bằng tiếng Việt', () => {
    assert.equal(formatBytes(0), '0 B')
    assert.equal(formatBytes(1024), '1 KB')
    assert.equal(formatBytes(10 * 1024 * 1024), '10 MB')
    assert.equal(formatBytes(Number.NaN), '0 B')
  })
})
