/**
 * Đường ống chuyển mã và bộ thu hồi công việc kẹt — bốn tính chất mà một lượt
 * chạy "trông đúng" vẫn có thể vi phạm, và không cổng nào khác bắt được.
 *
 * Cả bốn đều thuộc loại **im lặng**: không làm test nào khác đỏ, không làm
 * `typecheck` đỏ, và triệu chứng khi ra tới người dùng là một thứ khác hẳn
 * nguyên nhân.
 *
 *   1. **Nhả kết nối trước khi spawn.** Một lượt chuyển mã chạy hàng chục phút.
 *      Giữ một kết nối trong pool suốt thời gian đó vét cạn pool trên VPS 1–2 GB,
 *      và triệu chứng duy nhất là "cổng chậm" — không có gì chỉ vào lượt chuyển
 *      mã. Test khẳng định **tại thời điểm mỗi tiến trình con được sinh ra**, số
 *      kết nối đang bị giữ bằng **không**, và hàng đã mang `processing_status` +
 *      `claimed_by`. Khẳng định ở *cuối* công việc thì một bản giữ kết nối suốt
 *      rồi nhả ở cuối vẫn xanh.
 *   2. **Playlist ghi qua tệp tạm rồi `rename`.** Ghi tại chỗ mở ra một cửa sổ mà
 *      người đọc tải về được **một nửa** playlist; trình phát dừng và không có
 *      lỗi nào ở đâu cả. Test chạy một vòng ghi **đồng thời với** một vòng đọc
 *      trên hệ thống tệp thật: mọi lần đọc phải thấy bản cũ nguyên vẹn hoặc bản
 *      mới nguyên vẹn, không bao giờ một mảnh.
 *   3. **Công bố lũy tiến.** Ghi cả mảng vào cuối đường ống thì một lượt hỏng để
 *      lại đúng không gì cả, và không gì nói ra là hai bản kia đã sẵn sàng từ lâu.
 *      Test khẳng định có một lượt ghi một phần **trước** lượt ghi cuối, và rằng
 *      một lượt hỏng ở bản cuối vẫn để những bản đã công bố nằm trên đĩa.
 *   4. **Reaper không thu hồi công việc còn sống.** Nhánh "còn sống" mới là nhánh
 *      dễ bỏ sót: `updated_at` cũ **không** tự nó nghĩa là công việc đã chết, vì
 *      một video dài có thể không chạm cơ sở dữ liệu trong hơn mười phút. Test
 *      chạy **cả hai** nhánh, cộng nhánh "khoá đang bị giữ thì không làm gì".
 *
 * Cơ sở dữ liệu ở đây là một **bảng trong bộ nhớ** sau một pool giả, không phải
 * một stub trả lời cố định: một lượt ghi rồi đọc lại phải thấy giá trị vừa ghi,
 * nếu không thì "nhịp tim đóng dấu `updated_at`" và "nhịp tim không chạy" là hai
 * thứ không phân biệt được.
 *
 * **Lượt chuyển mã thật ở `7.1` không dùng runner giả.** Nó sinh một video ngắn
 * bằng FFmpeg rồi chạy cả bảy giai đoạn trên đó, vì một runner giả chỉ chứng minh
 * rằng tham số đã được truyền — nó không chứng minh FFmpeg hiểu chúng.
 */
import assert from 'node:assert/strict'
import { promises as fs, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { after, before, describe, it } from 'node:test'

import { drizzle } from 'drizzle-orm/mysql2'

import * as schema from '../server/db/schema.ts'
import {
  DISK_CHECK_INTERVAL_MS,
  MAX_CONCURRENT_RENDITIONS,
  PROCESSING_ERROR_LIMIT,
  RENDITIONS,
  TRANSCODE_LOCK_NAME,
  buildMasterPlaylist,
  checkDiskSpace,
  defaultProcessRunner,
  isPlayable,
  isProcessAlive,
  parseProbeJson,
  processMediaItem,
  processingClaim,
  scaledWidth,
  selectRenditions,
  startDiskGuard,
  writeManifestAtomically,
  type ProcessRunner,
} from '../server/services/video-processing.ts'
import {
  REAP_BATCH_LIMIT,
  TICK_INTERVAL_MS,
  reclaimReason,
  reapStuckJobs,
  stalenessCutoff,
  startMediaProcessingReaper,
  stopMediaProcessingReaper,
} from '../server/services/media-processing-reaper.ts'
import { MEDIA_DEFAULTS, type MediaConfig } from '../server/utils/media-config.ts'

// ─── Bảng trong bộ nhớ sau một pool giả ──────────────────────────────────────

type Row = Record<string, unknown>
type QueryCall = { sql: string, params: unknown[] }

/** `processing_status` → `processingStatus`. Drizzle ánh xạ theo **vị trí**, nên
 *  bảng giả phải trả về đúng các cột đã chọn, đúng thứ tự đã chọn. */
function camel(name: string): string {
  return name.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase())
}

/**
 * Cột kiểu JSON: **ghi thì driver đã tuần tự hoá, đọc thì driver giải mã**.
 *
 * Drizzle chỉ làm một nửa việc — `mapToDriverValue` của cột `json` là
 * `JSON.stringify`, và nó **không có** `mapFromDriverValue`. Nên tham số đến bảng
 * giả này đã là chuỗi `'["360p"]'`, còn giá trị mysql2 trả cho nơi gọi là một
 * **mảng đã giải mã**.
 *
 * Một bảng giả tuần tự hoá thêm lần nữa ở chiều ghi sẽ lưu hai lớp, và mọi lượt
 * đọc sau thấy chuỗi `'["360p"]'` ở chỗ nơi gọi chờ một mảng — triệu chứng là
 * `resolutions_ready` **luôn rỗng** sau khi công bố, tức là mục không bao giờ phát
 * được, mà không có gì chỉ vào bảng giả.
 */
const JSON_COLUMNS: ReadonlySet<string> = new Set(['resolutionsReady'])

/** Cột thời gian: so sánh trên `Date`, không trên chuỗi. So chuỗi chỉ đúng khi
 *  mọi giá trị cùng định dạng và cùng múi giờ — tức là đúng một cách tình cờ. */
const DATE_COLUMNS: ReadonlySet<string> = new Set(['updatedAt', 'createdAt', 'publishedAt', 'startedAt', 'endedAt', 'processingHeartbeatAt', 'processingNextAttemptAt'])

function decodeValue(column: string, value: unknown): unknown {
  if (!JSON_COLUMNS.has(column)) return value
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

/**
 * Giá trị mà **driver** đưa xuống cho một cột JSON.
 *
 * Khẳng định thay vì tự tuần tự hoá thêm một lần nữa: một bảng giả tuần tự hoá
 * hai lớp sẽ lưu `'"[]"'` và mọi lượt đọc sau trả về một chuỗi ở chỗ nơi gọi chờ
 * một mảng.
 */
function driverValue(column: string, value: unknown): unknown {
  if (!JSON_COLUMNS.has(column)) return value
  if (typeof value !== 'string') {
    throw new Error(`cột JSON \`${column}\` nhận ${typeof value} từ driver, chờ một chuỗi`)
  }
  return value
}

function asDate(value: unknown): Date {
  if (value instanceof Date) return value
  return new Date(String(value).replace(' ', 'T') + 'Z')
}

function sqlOf(first: unknown): string {
  if (typeof first === 'string') return first
  return String((first as { sql?: unknown })?.sql ?? '')
}

function paramsOf(second: unknown, first: unknown): unknown[] {
  if (Array.isArray(second)) return second
  const values = (first as { values?: unknown })?.values
  return Array.isArray(values) ? values : []
}

/**
 * Danh sách cột đã chọn của một câu `SELECT`.
 *
 * Drizzle phát ra ``select `media_items`.`id`, `media_items`.`slug` `` — tên bảng
 * cũng nằm trong dấu huyền. Lấy định danh **cuối cùng** của từng mục: với
 * `` `t`.`c` `` đó là `c`, với `` `c` `` cũng là `c`.
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

function projectRow(row: Row, sql: string): unknown[] {
  return selectedColumns(sql).map(column => decodeValue(column, row[column] ?? null))
}

/** Các cột trong mệnh đề `set`, kèm giá trị lấy từ tham số theo đúng thứ tự. */
function setClause(sql: string, params: unknown[]): { columns: string[], values: unknown[] } {
  const start = sql.indexOf(' set ') + 5
  const end = sql.indexOf(' where ')
  const body = end === -1 ? sql.slice(start) : sql.slice(start, end)
  const columns = [...body.matchAll(/`([a-z_]+)` = \?/g)].map(match => camel(match[1]!))
  const values = params.slice(0, columns.length)
    .map((value, index) => driverValue(columns[index]!, value))
  return { columns, values }
}

type Condition = { column: string, op: string }

/**
 * Đọc các điều kiện của mệnh đề `WHERE` **theo thứ tự xuất hiện**, để tham số
 * được tiêu thụ đúng thứ tự đó.
 *
 * Không viết một bộ phân tích SQL: hình dạng cần đọc chỉ là
 * `` `bảng`.`cột` <toán tử> ? `` và `` `bảng`.`cột` is [not] null ``, và một bộ
 * phân tích đầy đủ ở đây là một thứ thứ hai có thể sai.
 */
function whereConditions(sql: string): Condition[] {
  const match = / where (.+?)(?: order by | limit |$)/is.exec(sql)
  if (!match) return []
  const conditions: Condition[] = []
  const pattern = /`[a-z_]+`\.`([a-z_]+)`\s*(<=|>=|<>|=|<|>)\s*\?|`[a-z_]+`\.`([a-z_]+)`\s+is\s+(not\s+)?null/gi
  for (const found of match[1]!.matchAll(pattern)) {
    if (found[1]) conditions.push({ column: camel(found[1]), op: found[2]! })
    else conditions.push({ column: camel(found[3]!), op: found[4] ? 'is not null' : 'is null' })
  }
  return conditions
}

function matchesWhere(row: Row, conditions: Condition[], params: unknown[]): boolean {
  let cursor = 0
  for (const condition of conditions) {
    const left = row[condition.column] ?? null
    if (condition.op === 'is null') {
      if (left !== null) return false
      continue
    }
    if (condition.op === 'is not null') {
      if (left === null) return false
      continue
    }

    const right = params[cursor++] ?? null
    const dated = DATE_COLUMNS.has(condition.column)
    const a = dated ? (left === null ? null : asDate(left).getTime()) : left
    const b = dated ? (right === null ? null : asDate(right).getTime()) : right

    // `NULL = x` là UNKNOWN, tức là không khớp — đúng như MySQL.
    if (a === null || b === null) return false

    switch (condition.op) {
      case '=': if (a !== b) return false; break
      case '<>': if (a === b) return false; break
      case '<': if (!(Number(a) < Number(b))) return false; break
      case '>': if (!(Number(a) > Number(b))) return false; break
      case '<=': if (!(Number(a) <= Number(b))) return false; break
      case '>=': if (!(Number(a) >= Number(b))) return false; break
      default: throw new Error(`toán tử không hỗ trợ: ${condition.op}`)
    }
  }
  return true
}

function evaluateWhere(row: Row, sql: string, params: unknown[]): boolean {
  const expression = / where (.+?)(?: order by | limit |$)/is.exec(sql)?.[1]
  if (!expression) return true
  let cursor = 0
  function evaluate(raw: string): boolean {
    let text = raw.trim()
    if (text.startsWith('(')) {
      let depth = 0
      let outer = true
      for (let i = 0; i < text.length - 1; i++) {
        if (text[i] === '(') depth++
        if (text[i] === ')') depth--
        if (depth === 0) { outer = false; break }
      }
      if (outer) text = text.slice(1, -1)
    }
    for (const operator of [' or ', ' and ']) {
      let depth = 0
      for (let i = 0; i < text.length; i++) {
        if (text[i] === '(') depth++
        if (text[i] === ')') depth--
        if (depth === 0 && text.slice(i).startsWith(operator)) {
          const left = evaluate(text.slice(0, i))
          const right = evaluate(text.slice(i + operator.length))
          return operator === ' or ' ? left || right : left && right
        }
      }
    }
    const count = (text.match(/\?/g) ?? []).length
    const values = params.slice(cursor, cursor + count)
    cursor += count
    return matchesWhere(row, whereConditions(`select x where ${text}`), values)
  }
  return evaluate(expression)
}

type PoolState = {
  /** Số kết nối đang bị **giữ** (đã `getConnection` mà chưa `release`). */
  held: number
  items: Row[]
}

type FakeOptions = {
  items?: Row[]
  /** `GET_LOCK` trả 0 — một bản sao khác đang giữ khoá. */
  lockBusy?: boolean
  /**
   * Móc chạy **trước** mỗi câu lệnh, kèm trạng thái pool lúc đó. Đây là thứ cho
   * phép khẳng định "nhả kết nối trước khi spawn": tại mỗi lần sinh tiến trình
   * con, `held` phải bằng 0.
   */
  onQuery?: (sql: string, params: unknown[], state: PoolState) => void
}

function fakeMediaPool(options: FakeOptions = {}) {
  const items: Row[] = (options.items ?? []).map(row => ({ ...row }))
  const queries: QueryCall[] = []
  const locks: string[] = []
  let held = 0
  let leasedTotal = 0
  let releasedTotal = 0

  function handle(first: unknown, second: unknown): unknown {
    const sql = sqlOf(first)
    const params = paramsOf(second, first)
    queries.push({ sql, params })
    options.onQuery?.(sql, params, { held, items })
    const trimmed = sql.trim()

    // `db.transaction` phát ra `begin` / `commit` / `rollback` trên **kết nối**,
    // không qua `query` của pool.
    if (trimmed === 'begin' || trimmed === 'commit' || trimmed === 'rollback') {
      return [{ affectedRows: 0 }]
    }

    if (/^select .+ from `media_items`/i.test(trimmed)) {
      const conditions = whereConditions(trimmed)
      const whereParams = params.slice(0, conditions.length)
      const rows = items.filter(row => evaluateWhere(row, trimmed, whereParams))
      return [rows.map(row => projectRow(row, trimmed)), []]
    }

    if (trimmed.startsWith('update `media_items`')) {
      const { columns, values } = setClause(trimmed, params)
      const conditions = whereConditions(trimmed)
      const whereParams = params.slice(columns.length, columns.length + conditions.length)
      let affected = 0
      for (const row of items) {
        if (!evaluateWhere(row, trimmed, whereParams)) continue
        columns.forEach((column, index) => { row[column] = values[index] })
        affected += 1
      }
      return [{ affectedRows: affected }]
    }

    throw new Error(`câu lệnh không được mô phỏng: ${trimmed.slice(0, 200)}`)
  }

  const connection = {
    async query(first: unknown, second: unknown) {
      const sql = sqlOf(first)
      const params = paramsOf(second, first)
      // Lượt hỏi khoá cũng vào `queries` và cũng đi qua `onQuery` như mọi câu
      // lệnh khác: nó là một câu lệnh thật, và một bộ ghi bỏ qua nó sẽ làm phép
      // đối chiếu "khoá được nhả trước lượt spawn đầu tiên" im lặng bỏ qua đúng
      // câu cần đối chiếu.
      if (/GET_LOCK/i.test(sql)) {
        queries.push({ sql, params })
        locks.push(String(params[0]))
        options.onQuery?.(sql, params, { held, items })
        return [[{ acquired: options.lockBusy ? 0 : 1 }], []]
      }
      if (/RELEASE_LOCK/i.test(sql)) {
        queries.push({ sql, params })
        locks.push(`release:${String(params[0])}`)
        options.onQuery?.(sql, params, { held, items })
        return [[{ released: 1 }], []]
      }
      return handle(first, second)
    },
    release() {
      held -= 1
      releasedTotal += 1
    },
  }

  // `pool.query` mô phỏng đúng mysql2: thuê một kết nối, chạy, trả lại **trong
  // cùng một lời gọi**. Nhờ vậy `held` chỉ đếm những kết nối bị giữ qua
  // `getConnection` — đúng thứ cần đo. Đếm cả `pool.query` vào đây sẽ làm mọi câu
  // lệnh trông như đang giữ một kết nối, kể cả lượt ghi của chính nhịp tim; một
  // phép đo luôn báo động là một phép đo không báo được gì.
  const pool = {
    async query(first: unknown, second: unknown) { return handle(first, second) },
    async execute(first: unknown, second: unknown) { return handle(first, second) },
    async getConnection() {
      held += 1
      leasedTotal += 1
      return connection
    },
    async end() {},
  }

  return {
    pool,
    queries,
    locks,
    items,
    get held() { return held },
    get leasedTotal() { return leasedTotal },
    get releasedTotal() { return releasedTotal },
    /** Một hàng đã giải mã, đúng như một lượt đọc thật sẽ thấy. */
    item(id: number): Row | undefined {
      const row = items.find(entry => entry.id === id)
      if (!row) return undefined
      return Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, decodeValue(key, value)]),
      )
    },
    /** Các giá trị đã ghi vào một cột, theo thứ tự, đã giải mã. */
    writes(column: string): unknown[] {
      const out: unknown[] = []
      for (const call of queries) {
        if (!call.sql.trim().startsWith('update `media_items`')) continue
        const { columns, values } = setClause(call.sql, call.params)
        const index = columns.indexOf(column)
        if (index >= 0) out.push(decodeValue(column, values[index]))
      }
      return out
    },
    /**
     * Những lượt **công bố một bản**, không phải lượt đóng công việc.
     *
     * Điều kiện là `resolutions_ready` đứng **đầu** mệnh đề `set` — đúng hình dạng
     * của lượt công bố lũy tiến. Lượt đóng công việc cũng mang cột này nhưng nằm
     * sau `processing_status`, và nó lặp lại giá trị đầy đủ. Tính nó vào đây sẽ
     * làm phép đếm "mỗi bản một lượt" không còn phân biệt được công bố lũy tiến
     * với công bố một lần ở cuối — tức là đúng thứ hai test dưới đây tồn tại để
     * phân biệt. Một định nghĩa duy nhất cho cả hai, vì hai định nghĩa sẽ lệch.
     */
    publishWrites(): string[][] {
      const out: string[][] = []
      for (const call of queries) {
        if (!/^update `media_items`/.test(call.sql.trim()) || !call.sql.includes('`storage_path` = ?') || call.sql.includes('`processing_status` = ?,')) continue
        const { columns, values } = setClause(call.sql, call.params)
        out.push(decodeValue('resolutionsReady', values[columns.indexOf('resolutionsReady')]) as string[])
      }
      return out
    },
  }
}

function dbOver(fake: ReturnType<typeof fakeMediaPool>) {
  return drizzle(fake.pool as never, { schema, mode: 'default' })
}

// ─── Bối cảnh chung ──────────────────────────────────────────────────────────

let root = ''
let config: MediaConfig

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cdkt-media-processing-'))
  config = testConfig(root)
})

after(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

function testConfig(workdir: string): MediaConfig {
  return {
    uploadEnabled: true,
    maxUploadSize: MEDIA_DEFAULTS.maxUploadSize,
    chunkSize: MEDIA_DEFAULTS.chunkSize,
    sessionInactivityHours: MEDIA_DEFAULTS.sessionInactivityHours,
    // Sàn đĩa thật của production là 1 GB, và một thư mục tạm trong `/tmp` có
    // thể có ít hơn thế — lượt chuyển mã thật sẽ bị dừng vì lý do không liên
    // quan gì tới điều nó khẳng định. 1 MB là sàn thật, chỉ nhỏ hơn.
    diskFloorBytes: 1024 * 1024,
    processingHeartbeatSeconds: MEDIA_DEFAULTS.processingHeartbeatSeconds,
    processingStaleMinutes: MEDIA_DEFAULTS.processingStaleMinutes,
    processingMaxAttempts: 1,
    workdir,
    // R2 mặc định tắt trong test — transcode giữ local như cũ.
    videoStorage: { provider: 'local' },
  }
}

/** Một mục đã tải lên, đang chờ chuyển mã. */
function pendingItem(overrides: Row = {}): Row {
  return {
    id: 1,
    slug: 'phim-thu-nghiem',
    title: 'Phim thử nghiệm',
    source: 'upload',
    processingStatus: 'pending',
    processingError: null,
    resolutionsReady: '[]',
    claimedBy: null,
    processingAttempts: 0,
    processingNextAttemptAt: null,
    processingHeartbeatAt: null,
    status: 'draft',
    updatedAt: new Date(),
    createdAt: new Date(),
    durationSeconds: null,
    width: null,
    height: null,
    ...overrides,
  }
}

/**
 * Hộp ISO tối thiểu mà `detectVideoMime` nhận ra — **tên tệp không được dùng**,
 * nên một test chỉ đặt tên `.mp4` mà nội dung là văn bản sẽ đi đúng vào nhánh
 * `unsupported_video`.
 */
function mp4Header(padding = 64): Buffer {
  const size = Buffer.alloc(4)
  size.writeUInt32BE(24)
  return Buffer.concat([size, Buffer.from('ftyp'), Buffer.from('isom'), Buffer.alloc(padding)])
}

/**
 * Đặt tệp gốc vào đúng chỗ `completeUpload` sẽ đặt nó: `media/<slug>/original.mp4`.
 *
 * Không có bước này thì mọi test chạy đường ống dừng ở `source_missing` — và tệ
 * hơn, chúng **dừng ở đó một cách im lặng**: `processMediaItem` trả về một kết quả
 * hợp lệ, chỉ là kết quả của một lượt chạy chưa từng tới giai đoạn nào được kiểm.
 */
async function seedOriginal(workdir: string, slug: string, content: Buffer = mp4Header()): Promise<string> {
  const dir = path.join(workdir, 'media', slug)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'original.mp4'), content)
  return dir
}

/** Thư mục làm việc riêng, đã có tệp gốc — dùng cho mọi test chạy đường ống. */
async function workdirWith(slug: string, content?: Buffer): Promise<string> {
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'cdkt-proc-'))
  await seedOriginal(workdir, slug, content)
  return workdir
}

function captureLogs() {
  const lines: Record<string, unknown>[] = []
  const originalError = console.error
  const originalLog = console.log
  const parse = (value: unknown) => {
    try {
      lines.push(JSON.parse(String(value)) as Record<string, unknown>)
    } catch {
      // Dòng không phải JSON không phải thứ đang được kiểm ở đây.
    }
  }
  console.error = parse as typeof console.error
  console.log = parse as typeof console.log
  return {
    lines,
    events: () => lines.map(line => String(line.event)),
    restore() {
      console.error = originalError
      console.log = originalLog
    },
  }
}

/** Bỏ chú thích trước khi khẳng định về mã. Xem chỗ dùng để biết vì sao. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n')
}

/**
 * Một runner giả **sinh ra đúng những tệp mà FFmpeg sẽ sinh**, để đường ống chạy
 * được tới cuối mà không cần một lượt chuyển mã thật.
 *
 * Dùng cho các test về **thứ tự** và **trạng thái** — những thứ không phụ thuộc
 * vào việc FFmpeg hiểu tham số hay không. Lượt chuyển mã thật ở `7.1` dùng
 * `defaultProcessRunner`.
 */
function scriptedRunner(options: {
  onSpawn?: (command: string, args: string[]) => void
  /** Hỏng khi bản **có tên này** được chuyển mã — xác định, không đếm thứ tự. */
  failRendition?: string
  failAll?: boolean
  /** Độ trễ theo từng bản. Dùng để **ghim thứ tự công bố** thay vì hy vọng vào nó. */
  delayForRendition?: (name: string) => number
  probe?: { durationSeconds?: number, width?: number, height?: number }
} = {}): ProcessRunner {
  return async (command, args, { signal }) => {
    options.onSpawn?.(command, args)

    if (command === 'ffprobe') {
      const probe = options.probe ?? { durationSeconds: 12, width: 1920, height: 1080 }
      return {
        code: 0,
        stdout: JSON.stringify({
          format: { duration: String(probe.durationSeconds ?? 12) },
          streams: [{ codec_type: 'video', width: probe.width ?? 1920, height: probe.height ?? 1080 }],
        }),
        stderr: '',
      }
    }

    // Chốt bằng **chỉ số dương**, không bằng giá trị trả về.
    //
    // `args.indexOf(...) + 1` trả về `args[0]` khi cờ không có mặt — ở đây là
    // `-hide_banner`, một chuỗi **truthy**. Nhánh HLS vì thế chạy cho cả lượt gọi
    // `extractThumbnail`, và `path.dirname('-hide_banner')` là `'.'`: hai tệp
    // `index.m3u8` / `seg_000.ts` được ghi thẳng vào thư mục làm việc của tiến
    // trình. Triệu chứng im lặng vì `publishFile` sau đó ném ENOENT (thư mục
    // `scratch/` không tồn tại) và khối `catch` bao quanh nuốt nó theo thiết kế.
    const segmentAt = args.indexOf('-hls_segment_filename')
    if (segmentAt !== -1) {
      const outputDir = path.dirname(args[segmentAt + 1]!)
      const rendition = path.basename(outputDir)
      const delay = options.delayForRendition?.(rendition) ?? 0
      if (delay > 0) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, delay)
          signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
        })
      }
      if (signal.aborted) return { code: -1, stdout: '', stderr: 'killed' }
      if (options.failAll || options.failRendition === rendition) {
        return { code: 1, stdout: '', stderr: `ffmpeg: lỗi mô phỏng ở bản ${rendition}` }
      }
      await fs.mkdir(outputDir, { recursive: true })
      await fs.writeFile(path.join(outputDir, 'seg_000.ts'), 'segment', 'utf8')
      await fs.writeFile(
        path.join(outputDir, 'index.m3u8'),
        '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4.0,\nseg_000.ts\n#EXT-X-ENDLIST\n',
        'utf8',
      )
      return { code: 0, stdout: '', stderr: '' }
    }

    const output = args[args.length - 1]!
    if (output.endsWith('.jpg')) {
      await fs.writeFile(output, Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]), 'binary')
      return { code: 0, stdout: '', stderr: '' }
    }

    return { code: 0, stdout: '', stderr: '' }
  }
}

/** Thứ tự công bố đã ghim: 360p xong trước, rồi 720p, rồi 1080p. */
function steadyRunner() {
  return scriptedRunner({
    delayForRendition: name => (name === '360p' ? 5 : name === '720p' ? 15 : 25),
  })
}

function runPipeline(
  fake: ReturnType<typeof fakeMediaPool>,
  options: { runner?: ProcessRunner, config?: MediaConfig, mediaItemId?: number } & ProcessingDeps = {},
) {
  // `config` và `mediaItemId` được rút ra **trước** khi phần còn lại rải vào deps:
  // để chúng trong `rest` thì một lượt gọi không truyền `config` sẽ ghi đè giá trị
  // mặc định bằng `undefined`, và `deps()` lặng lẽ rơi về `resolveMediaConfig()` —
  // tức là về thư mục làm việc thật của máy, nơi không có tệp gốc nào.
  const { runner, config: overrideConfig, mediaItemId, ...rest } = options
  return processMediaItem(
    { mediaItemId: mediaItemId ?? 1 },
    { db: dbOver(fake), pool: fake.pool as never, config: overrideConfig ?? config, run: runner, ...rest },
  )
}

// ─── 7.1 Đường ống bảy giai đoạn, chuyển mã THẬT ─────────────────────────────

describe('7.1 đường ống chuyển mã — lượt chạy thật bằng FFmpeg', () => {
  let workdir = ''
  let realConfig: MediaConfig

  before(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'cdkt-transcode-real-'))
    realConfig = testConfig(workdir)

    // FFmpeg là **điều kiện của chính test này**, không phải một tiện nghi. Không
    // có nó thì phép khẳng định duy nhất còn lại là "tham số đã được truyền", và
    // một runner giả nói đúng điều đó kể cả khi tham số sai hoàn toàn. Báo đỏ kèm
    // lý do, không bỏ qua im lặng: một lượt bỏ qua đọc ra y hệt một lượt xanh.
    const probe = await defaultProcessRunner('ffmpeg', ['-version'], { signal: new AbortController().signal })
    assert.equal(probe.code, 0, 'FFmpeg phải có trên PATH — tác vụ 7.1 cần nó, xem Dockerfile 15.1')

    const slugDir = path.join(workdir, 'media', 'phim-thu-nghiem')
    await fs.mkdir(slugDir, { recursive: true })

    // Nguồn 480×720: chiều cao 720 khớp **hai** bản trong ba bản, nên lượt chạy
    // vừa đủ nhanh vừa thật sự đi qua nhánh nhiều bản — nhánh mà việc công bố lũy
    // tiến và playlist nhiều biến thể chỉ có nghĩa khi có từ hai bản trở lên.
    const generated = await defaultProcessRunner('ffmpeg', [
      '-hide_banner', '-nostdin', '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=480x720:rate=15:duration=2',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-shortest',
      path.join(slugDir, 'original.mp4'),
    ], { signal: new AbortController().signal })
    assert.equal(generated.code, 0, `không sinh được video thử: ${generated.stderr.slice(-400)}`)
  })

  after(async () => {
    await fs.rm(workdir, { recursive: true, force: true })
  })

  it('sinh ra các bản, đoạn HLS, playlist và ảnh đại diện trên đĩa', async () => {
    const fake = fakeMediaPool({ items: [pendingItem()] })
    const result = await runPipeline(fake, { config: realConfig })

    if (!result.ok) assert.fail(`lượt chuyển mã thật phải thành công: ${JSON.stringify(result)}`)
    // Sắp xếp trước khi so: hai bản chạy song song nên thứ tự hoàn tất của chúng
    // là chuyện của bộ định thời, không phải của đường ống. So nguyên thứ tự là
    // ghim một thứ không ai hứa.
    assert.deepEqual([...result.renditions].sort(), ['360p', '720p'],
      'nguồn 720p chỉ được sinh hai bản, không nâng cấp độ phân giải')

    const published = path.join(workdir, String(fake.item(1)!.storagePath))

    // Mỗi bản: một playlist có thứ tự đoạn và một đoạn thật.
    for (const rendition of ['360p', '720p']) {
      const playlist = await fs.readFile(path.join(published, rendition, 'index.m3u8'), 'utf8')
      assert.match(playlist, /#EXTM3U/)
      assert.match(playlist, /seg_000\.ts/)
      assert.match(playlist, /#EXT-X-ENDLIST/, 'playlist phải là VOD, không phải một luồng đang mở')
      const segment = await fs.stat(path.join(published, rendition, 'seg_000.ts'))
      assert.ok(segment.size > 0, 'đoạn HLS phải có dữ liệu thật')
    }

    // Playlist chính trỏ tới **cả hai** bản, và bề rộng suy từ tỉ lệ nguồn.
    const master = await fs.readFile(path.join(published, 'master.m3u8'), 'utf8')
    assert.match(master, /360p\/index\.m3u8/)
    assert.match(master, /720p\/index\.m3u8/)
    assert.match(master, /RESOLUTION=240x360/, 'bề rộng phải suy từ tỉ lệ nguồn, không phải bịa')
    assert.match(master, /RESOLUTION=480x720/)

    // Ảnh đại diện: phải là JPEG thật, không phải một tệp rỗng.
    const thumb = await fs.readFile(path.join(published, 'thumb.jpg'))
    assert.deepEqual([...thumb.subarray(0, 3)], [0xFF, 0xD8, 0xFF], 'ảnh đại diện phải là JPEG')
    assert.ok(thumb.length > 200, `ảnh đại diện quá nhỏ: ${thumb.length} byte`)

    // Thư mục nháp phải được dọn — nếu không, mỗi lượt chuyển mã để lại một bản
    // sao đầy đủ của video trên đĩa.
    assert.deepEqual(
      await fs.readdir(path.join(workdir, 'processing')).catch(() => []),
      [],
      'thư mục nháp phải được dọn sau khi xong',
    )
  })

  it('ghi kết quả dò metadata và trạng thái cuối lên hàng', async () => {
    const workdirB = await fs.mkdtemp(path.join(os.tmpdir(), 'cdkt-transcode-meta-'))
    await seedOriginal(
      workdirB,
      'phim-metadata',
      await fs.readFile(path.join(workdir, 'media', 'phim-thu-nghiem', 'original.mp4')),
    )

    const fake = fakeMediaPool({ items: [pendingItem({ slug: 'phim-metadata' })] })
    try {
      const result = await runPipeline(fake, { config: testConfig(workdirB) })
      if (!result.ok) assert.fail(`lượt chuyển mã thật phải thành công: ${JSON.stringify(result)}`)

      const row = fake.item(1)!
      assert.equal(row.processingStatus, 'ready')
      assert.equal(row.claimedBy, null)
      assert.equal(row.processingError, null)
      assert.deepEqual([...(row.resolutionsReady as string[])].sort(), ['360p', '720p'])
      assert.equal(row.durationSeconds, 2, 'thời lượng phải đọc từ ffprobe, không phải đoán')
      assert.equal(row.width, 480)
      assert.equal(row.height, 720)
    } finally {
      await fs.rm(workdirB, { recursive: true, force: true })
    }
  })
})

// ─── 7.2 Nhả kết nối trước khi spawn ─────────────────────────────────────────

describe('7.2 nhả kết nối trước khi spawn FFmpeg', () => {
  it('mất ownership ở heartbeat hủy runner và không ghi đè claim mới', async () => {
    const workdir = await workdirWith('lease-lost')
    const fake = fakeMediaPool({ items: [pendingItem({ slug: 'lease-lost' })], onQuery(sql, _params, state) {
      if (sql.includes('set `processing_heartbeat_at` = ?')) state.items[0]!.claimedBy = 'new-owner'
    } })
    try {
      const result = await runPipeline(fake, { config: testConfig(workdir), heartbeatMs: 2,
        runner: scriptedRunner({ delayForRendition: () => 40 }) })
      assert.equal(result.ok, false)
      assert.equal(fake.item(1)!.claimedBy, 'new-owner')
      assert.equal(fake.item(1)!.processingStatus, 'processing')
      assert.equal(fake.item(1)!.storagePath, undefined)
    } finally { await fs.rm(workdir, { recursive: true, force: true }) }
  })
  it('tại MỖI lần sinh tiến trình con, không kết nối nào đang bị giữ', async () => {
    const workdirB = await workdirWith('phim-thu-nghiem')
    const fake = fakeMediaPool({ items: [pendingItem()] })
    const seen: Array<{ command: string, held: number, status: unknown, claim: unknown }> = []

    const runner = scriptedRunner({
      onSpawn: (command) => {
        seen.push({
          command,
          held: fake.held,
          status: fake.item(1)?.processingStatus,
          claim: fake.item(1)?.claimedBy,
        })
      },
    })

    try {
      const result = await runPipeline(fake, { runner, config: testConfig(workdirB) })
      assert.equal(result.ok, true, JSON.stringify(result))
      assert.ok(seen.length >= 4, `chờ ít nhất bốn tiến trình con, thấy ${seen.length}`)

      for (const spawn of seen) {
        // Khẳng định ở **thời điểm spawn**, không ở cuối công việc: một bản giữ
        // kết nối suốt rồi nhả ở cuối vẫn cho ra `held === 0` sau khi xong, và đó
        // đúng là kiểu hỏng mà tác vụ này tồn tại để chặn.
        assert.equal(spawn.held, 0, `còn kết nối bị giữ khi spawn ${spawn.command}`)
        assert.equal(spawn.status, 'processing', `hàng phải mang trạng thái xử lý trước khi spawn ${spawn.command}`)
        assert.equal(typeof spawn.claim, 'string', 'hàng phải mang danh tính tiến trình trước khi spawn')
        assert.match(String(spawn.claim), /^[a-f0-9]{8}:[a-f0-9-]{36}$/)
      }
    } finally {
      await fs.rm(workdirB, { recursive: true, force: true })
    }
  })

  it('khoá danh nghĩa đã được nhả trước lượt spawn đầu tiên', async () => {
    const workdirB = await workdirWith('phim-thu-nghiem')
    const order: string[] = []
    const fake = fakeMediaPool({
      items: [pendingItem()],
      onQuery: (sql) => {
        if (/RELEASE_LOCK/i.test(sql)) order.push('release')
      },
    })

    const runner = scriptedRunner({ onSpawn: (command) => { order.push(`spawn:${command}`) } })

    try {
      const result = await runPipeline(fake, { runner, config: testConfig(workdirB) })
      assert.equal(result.ok, true, JSON.stringify(result))

      const releaseAt = order.indexOf('release')
      const firstSpawn = order.findIndex(entry => entry.startsWith('spawn:'))
      assert.ok(releaseAt >= 0, 'khoá phải được nhả')
      assert.ok(firstSpawn >= 0, 'phải có lượt spawn')
      assert.ok(
        releaseAt < firstSpawn,
        `khoá phải được nhả TRƯỚC lượt spawn đầu tiên, thứ tự thật: ${JSON.stringify(order.slice(0, 6))}`,
      )
    } finally {
      await fs.rm(workdirB, { recursive: true, force: true })
    }
  })

  it('mọi kết nối đã thuê đều được trả lại khi công việc xong', async () => {
    const workdirB = await workdirWith('phim-thu-nghiem')
    const fake = fakeMediaPool({ items: [pendingItem()] })
    try {
      await runPipeline(fake, { runner: steadyRunner(), config: testConfig(workdirB) })

      assert.equal(fake.held, 0, 'không được để lại kết nối nào bị giữ')
      assert.equal(fake.leasedTotal, fake.releasedTotal, 'số kết nối thuê phải bằng số kết nối trả')
      assert.ok(fake.leasedTotal > 0, 'phải thật sự có thuê kết nối, nếu không phép so trên là rỗng')
    } finally {
      await fs.rm(workdirB, { recursive: true, force: true })
    }
  })

  it('nhịp tim chạy trong lúc chuyển mã, và đóng dấu `updated_at` tường minh', async () => {
    const workdirB = await workdirWith('phim-thu-nghiem')
    const heartbeatHeld: number[] = []
    const fake = fakeMediaPool({
      items: [pendingItem()],
      // Móc soi trạng thái pool tại thời điểm từng câu lệnh: lượt ghi nhịp tim
      // phải chạy khi không có kết nối nào bị giữ.
      onQuery: (sql, _params, state) => {
        if (sql.includes('set `processing_heartbeat_at` = ?')) {
          heartbeatHeld.push(state.held)
        }
      },
    })

    try {
      const result = await runPipeline(fake, {
        runner: scriptedRunner({ delayForRendition: () => 80 }),
        config: testConfig(workdirB),
        heartbeatMs: 10,
      })

      assert.equal(result.ok, true, JSON.stringify(result))
      assert.ok(heartbeatHeld.length > 0, 'nhịp tim phải chạy ít nhất một lần trong lượt dài')
      for (const held of heartbeatHeld) {
        assert.equal(held, 0, 'nhịp tim không được chạy trong lúc một kết nối đang bị giữ')
      }

      // `updated_at` phải được đóng dấu **tường minh**. MySQL chỉ tự cập nhật dấu
      // thời gian khi một cột khác đổi giá trị, và một nhịp tim không đổi gì cả
      // sẽ lặng lẽ không đóng dấu gì — nghĩa là mục bị reaper thu hồi ở nhịp sau.
      const stamped = fake.writes('processingHeartbeatAt')
      assert.ok(stamped.length > 0, 'nhịp tim phải ghi `updated_at`')
      for (const value of stamped) {
        assert.ok(value !== null && value !== undefined, 'nhịp tim phải đóng dấu một mốc thời gian, không phải NULL')
      }
    } finally {
      await fs.rm(workdirB, { recursive: true, force: true })
    }
  })

  it('bỏ lượt khi khoá đang bị giữ, và không spawn gì cả', async () => {
    const fake = fakeMediaPool({ items: [pendingItem()], lockBusy: true })
    const spawned: string[] = []
    const result = await runPipeline(fake, { runner: scriptedRunner({ onSpawn: c => spawned.push(c) }) })

    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.code, 'busy')
    assert.deepEqual(spawned, [], 'không được sinh tiến trình nào khi không giữ được khoá')
    assert.equal(fake.item(1)?.processingStatus, 'pending', 'hàng phải giữ nguyên khi bỏ lượt')
    assert.ok(fake.locks.includes(TRANSCODE_LOCK_NAME), `khoá phải là ${TRANSCODE_LOCK_NAME}`)
  })

  it('bỏ qua khi mục không phải nguồn tự lưu trữ', async () => {
    const fake = fakeMediaPool({ items: [pendingItem({ source: 'youtube' })] })
    const result = await runPipeline(fake, { runner: scriptedRunner() })
    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.code, 'not_upload')
  })

  it('mục đã sẵn sàng thì không chạy lại', async () => {
    const fake = fakeMediaPool({
      items: [pendingItem({ processingStatus: 'ready', resolutionsReady: '["360p"]' })],
    })
    const spawned: string[] = []
    const result = await runPipeline(fake, { runner: scriptedRunner({ onSpawn: c => spawned.push(c) }) })

    assert.equal(result.ok, true)
    assert.deepEqual(result.ok && result.renditions, ['360p'])
    assert.deepEqual(spawned, [], 'mục đã xong thì không spawn lại')
  })

  it('mục không tồn tại trả `not_found` chứ không ném', async () => {
    const fake = fakeMediaPool({ items: [] })
    const result = await runPipeline(fake, { runner: scriptedRunner() })
    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.code, 'not_found')
  })
})

// ─── 7.3 Công bố lũy tiến ────────────────────────────────────────────────────

describe('7.3 công bố lũy tiến từng bản', () => {
  it('ghi `resolutions_ready` ngay khi mỗi bản xong, không đợi bản cuối', async () => {
    const workdirB = await workdirWith('phim-thu-nghiem')
    const fake = fakeMediaPool({ items: [pendingItem()] })
    try {
      const result = await runPipeline(fake, { runner: steadyRunner(), config: testConfig(workdirB) })
      assert.equal(result.ok, true, JSON.stringify(result))

      const published = fake.publishWrites()
      assert.deepEqual(
        published.map(entry => entry.length),
        [1, 2, 3],
        `mỗi bản phải được công bố ngay khi xong, thấy ${JSON.stringify(published)}`,
      )
      assert.deepEqual(published[0], ['360p'], 'bản nhỏ nhất phải được công bố trước')
      assert.deepEqual(published[2], ['360p', '720p', '1080p'])
      // Bản giữa phải là **bản giữa**, không phải một bản nào khác: một đường ống
      // công bố `['360p','1080p']` rồi `['360p','720p','1080p']` cũng cho ra độ
      // dài 1-2-3, nhưng thứ tự công bố đã sai và playlist giữa lượt sẽ trỏ tới
      // một bản chưa xong.
      assert.deepEqual(published[1], ['360p', '720p'])
    } finally {
      await fs.rm(workdirB, { recursive: true, force: true })
    }
  })

  it('playlist sau mỗi lượt công bố chỉ trỏ tới những bản đã xong', async () => {
    const slug = 'phim-dan-dan'
    const workdirB = await workdirWith(slug)
    const snapshots: string[] = []
    const fake = fakeMediaPool({
      items: [pendingItem({ slug })],
      // Đọc playlist ngay sau mỗi lượt ghi `resolutions_ready`: một playlist trỏ
      // tới bản chưa cắt xong là một liên kết chết giữa lượt phát.
      onQuery: (sql, params) => {
        if (!sql.startsWith('update') || !sql.includes('`storage_path` = ?')) return
        try {
          const fields = setClause(sql, params)
          snapshots.push(readFileSync(path.join(workdirB, String(fields.values[fields.columns.indexOf('storagePath')]), 'master.m3u8'), 'utf8'))
        } catch {
          snapshots.push('')
        }
      },
    })

    try {
      const result = await runPipeline(fake, { runner: steadyRunner(), config: testConfig(workdirB) })
      assert.equal(result.ok, true, JSON.stringify(result))
      assert.equal(snapshots.length, 3, `chờ ba lượt công bố, thấy ${snapshots.length}`)

      assert.match(snapshots[0]!, /360p\/index\.m3u8/)
      assert.doesNotMatch(snapshots[0]!, /720p\/index\.m3u8/, 'playlist không được trỏ tới bản chưa cắt xong')
      assert.doesNotMatch(snapshots[0]!, /1080p\/index\.m3u8/)

      assert.match(snapshots[1]!, /720p\/index\.m3u8/)
      assert.doesNotMatch(snapshots[1]!, /1080p\/index\.m3u8/)

      assert.match(snapshots[2]!, /1080p\/index\.m3u8/)
    } finally {
      await fs.rm(workdirB, { recursive: true, force: true })
    }
  })

  it('một lượt hỏng ở bản cuối vẫn để những bản đã công bố nằm trên đĩa', async () => {
    const slug = 'phim-hong-giua-duong'
    const workdirB = await workdirWith(slug)
    const fake = fakeMediaPool({ items: [pendingItem({ slug })] })

    try {
      const result = await runPipeline(fake, {
        // Bản hỏng được chọn **theo tên**, không theo thứ tự hoàn tất: ba bản chạy
        // song song, nên "bản thứ hai hỏng" là một sự kiện không tất định và một
        // test dựa vào nó sẽ đỏ theo lịch trình của máy.
        runner: scriptedRunner({
          failRendition: '1080p',
          delayForRendition: name => (name === '1080p' ? 40 : 5),
        }),
        config: testConfig(workdirB),
      })

      assert.equal(result.ok, false, JSON.stringify(result))
      assert.match(result.ok === false ? result.message : '', /1080p/)

      const row = fake.item(1)!
      assert.equal(row.processingStatus, 'failed')
      assert.match(String(row.processingError), /1080p/)
      assert.equal(row.claimedBy, null, 'mục hỏng không được giữ danh tính tiến trình')

      // Hai bản đầu đã công bố **trước** khi bản cuối hỏng, nên chúng phải còn
      // nguyên: công bố lũy tiến chỉ có nghĩa nếu phần đã công bố sống qua lượt hỏng.
      assert.deepEqual([...(row.resolutionsReady as string[])].sort(), ['360p', '720p'])

      const published = path.join(workdirB, String(row.storagePath))
      const onDisk = await fs.readdir(published)
      assert.ok(onDisk.includes('360p'), `bản đã công bố phải còn trên đĩa, thấy ${JSON.stringify(onDisk)}`)
      assert.ok(onDisk.includes('720p'))
      assert.ok(!onDisk.includes('1080p'), 'bản hỏng không được nằm trong cây công bố')

      // Playlist phải khớp với những gì thật sự có, không trỏ tới bản hỏng.
      const master = await fs.readFile(path.join(published, 'master.m3u8'), 'utf8')
      assert.doesNotMatch(master, /1080p\/index\.m3u8/)

      // Thư mục nháp phải được dọn kể cả khi hỏng — nếu không, mỗi lượt hỏng để
      // lại một bản sao đầy đủ của video.
      assert.deepEqual(await fs.readdir(path.join(workdirB, 'processing')).catch(() => []), [])
    } finally {
      await fs.rm(workdirB, { recursive: true, force: true })
    }
  })

  it('chạy nhiều bản song song nhưng có trần', async () => {
    assert.equal(MAX_CONCURRENT_RENDITIONS, 3, 'trần ba bản: 3 × 2 luồng ≤ 6 nhân')

    const workdirB = await workdirWith('phim-thu-nghiem')
    const fake = fakeMediaPool({ items: [pendingItem()] })
    const inner = scriptedRunner()
    let inFlight = 0
    let peak = 0

    const runner: ProcessRunner = async (command, args, ctx) => {
      if (!args.includes('-hls_segment_filename')) return inner(command, args, ctx)
      inFlight += 1
      peak = Math.max(peak, inFlight)
      try {
        await new Promise(resolve => setTimeout(resolve, 20))
        return await inner(command, args, ctx)
      } finally {
        inFlight -= 1
      }
    }

    try {
      const result = await runPipeline(fake, { runner, config: testConfig(workdirB) })
      assert.equal(result.ok, true, JSON.stringify(result))
      assert.ok(peak <= MAX_CONCURRENT_RENDITIONS, `số bản chạy song song vượt trần: ${peak}`)
      assert.ok(peak >= 2, `ba bản phải thật sự chạy song song, đỉnh đo được ${peak}`)
    } finally {
      await fs.rm(workdirB, { recursive: true, force: true })
    }
  })
})

// ─── 7.4 Playlist ghi nguyên tử ──────────────────────────────────────────────

describe('7.4 playlist được thay nguyên tử', () => {
  it('người đọc không bao giờ thấy một playlist viết dở', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cdkt-atomic-'))
    const target = path.join(dir, 'master.m3u8')
    // 256 KB: đủ lớn để một lượt ghi tại chỗ có một cửa sổ quan sát được, đủ nhỏ
    // để hàng trăm lượt ghi diễn ra trong khoảng thời gian test cho phép.
    const before = `#EXTM3U\n${'A'.repeat(256 * 1024)}\n`
    const after = `#EXTM3U\n${'B'.repeat(256 * 1024)}\n`
    await fs.writeFile(target, before, 'utf8')

    try {
      let writing = true
      let reads = 0
      let torn = 0
      let rounds = 0

      const reader = (async () => {
        while (writing) {
          const content = await fs.readFile(target, 'utf8')
          reads += 1
          if (content !== before && content !== after) torn += 1
        }
      })()

      // Vòng ghi và vòng đọc chạy **đồng thời** trong một khoảng thời gian, thay
      // vì một số vòng ghi cố định: số lượt đọc được phụ thuộc vào tốc độ đĩa, và
      // một ngưỡng cứng trên số đó là một test đỏ theo cấu hình máy.
      while (rounds < 40) {
        await writeManifestAtomically(target, after)
        await writeManifestAtomically(target, before)
        rounds += 1
      }
      writing = false
      await reader

      assert.equal(rounds, 40)
      assert.ok(reads > 0, 'reader must overlap the writes')
      assert.equal(torn, 0, `có ${torn} lượt đọc thấy playlist viết dở trên ${reads} lượt`)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('dọn tệp tạm và để lại nội dung đúng', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cdkt-atomic2-'))
    const target = path.join(dir, 'master.m3u8')
    try {
      await writeManifestAtomically(target, '#EXTM3U\n')
      assert.equal(await fs.readFile(target, 'utf8'), '#EXTM3U\n')
      assert.deepEqual(await fs.readdir(dir), ['master.m3u8'], 'không được để lại tệp tạm')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('không có đường ghi nào khác cho `master.m3u8`', async () => {
    // Quét toàn bộ `server/`: tên tệp manifest chỉ được xuất hiện ở **đúng hai**
    // chỗ, cả hai đều nêu tên dưới đây. Một lối ghi tại chỗ thứ hai mở lại đúng
    // cửa sổ mà `writeManifestAtomically` tồn tại để đóng, và triệu chứng của nó
    // là "trình phát thỉnh thoảng đứng", không có lỗi ở đâu cả.
    //
    // Cổng này từng đòi **mọi** lần xuất hiện của chuỗi phải nằm trong lời gọi
    // ghi. Điều đó chỉ đúng chừng nào chưa ai cần **đọc** manifest; endpoint phát
    // HLS là người đầu tiên, vì nó phải gọi tên tệp ra để phục vụ. Không nới cổng
    // thành "chỉ soi các lời gọi ghi" — nhưng cũng không để nó khớp theo chuỗi
    // trần, vì khi đó lối đi tiếp duy nhất là **chép tên tệp sang chỗ thứ ba**,
    // tức là tự tay tạo ra thứ cổng này tồn tại để ngăn. Thay vào đó: mặc định là
    // cấm, và hai chỗ được phép thì **nêu tên kèm lý do** — cùng lối
    // `SERVICE_EXEMPTIONS` / `LOCAL_TIME_EXEMPTIONS` của dự án.
    const files = readdirSync('server', { recursive: true, encoding: 'utf8' })
      .filter(entry => entry.endsWith('.ts'))

    /** Chỗ duy nhất được phép **ghi**: lời gọi bọc tệp tạm rồi `rename`. */
    const WRITE_SITE = 'services/video-processing.ts'
    /** Chỗ duy nhất được phép **gọi tên**: hằng số mà đường đọc dùng để phục vụ
     *  manifest. Khai một lần, ở tệp sở hữu đường đọc công khai. */
    const NAME_SITE = 'services/media-portal.ts'
    const NAME_DECLARATION = /^const MEDIA_MASTER_PLAYLIST = 'master\.m3u8'$/

    const hits: string[] = []
    let writeSites = 0
    let nameSites = 0

    for (const file of files) {
      const lines = readFileSync(path.join('server', file), 'utf8').split('\n')
      lines.forEach((line, index) => {
        if (!line.includes("'master.m3u8'")) return
        const at = `${file}:${index + 1}`
        hits.push(at)
        // Ngữ cảnh là dòng này cộng dòng ngay trên: tên tệp thường nằm ở dòng
        // tham số, còn lời gọi ghi ở dòng trên nó.
        const context = [lines[index - 1] ?? '', line].join('\n')

        if (context.includes('writeManifestAtomically(')) {
          writeSites += 1
          assert.equal(
            file,
            WRITE_SITE,
            `${at} ghi master.m3u8 ngoài writeManifestAtomically — chỉ ${WRITE_SITE} được ghi tệp này`,
          )
          return
        }

        assert.ok(
          file === NAME_SITE && NAME_DECLARATION.test(line.trim()),
          `${at} dùng tên master.m3u8 ở chỗ không được phép. Chỉ hai chỗ được nêu tên tệp này: lời gọi ghi trong ${WRITE_SITE}, và hằng số trong ${NAME_SITE}. Muốn đọc manifest thì import hằng số đó, đừng viết lại chuỗi.`,
        )
        nameSites += 1
      })
    }

    assert.equal(writeSites, 1, `chờ đúng một lối ghi master.m3u8, thấy ${writeSites} trong ${JSON.stringify(hits)}`)
    assert.equal(nameSites, 1, `chờ đúng một chỗ khai tên master.m3u8, thấy ${nameSites} trong ${JSON.stringify(hits)}`)
    assert.equal(hits.length, 2, `chờ đúng hai chỗ nêu tên master.m3u8, thấy ${JSON.stringify(hits)}`)
  })

  it('bản dựng playlist bỏ qua bản chưa sẵn sàng', () => {
    const playlist = buildMasterPlaylist([
      { name: '360p', height: 360, width: 640, bandwidth: 896_000 },
    ])
    assert.match(playlist, /360p\/index\.m3u8/)
    assert.doesNotMatch(playlist, /720p/)
    assert.match(playlist, /BANDWIDTH=896000/)
    assert.match(playlist, /RESOLUTION=640x360/)
    // `CODECS` cố ý vắng mặt: một chuỗi codec sai làm trình phát **từ chối** cả
    // playlist, còn thiếu nó thì trình phát tự dò.
    assert.doesNotMatch(playlist, /CODECS=/)
  })
})

// ─── 7.5 Phép kiểm dung lượng đĩa ────────────────────────────────────────────

describe('7.5 phép kiểm dung lượng đĩa', () => {
  const ok = async () => ({ bavail: 100_000, bsize: 4096 })
  const low = async () => ({ bavail: 10, bsize: 4096 })

  it('cho qua khi còn trên sàn, và báo đúng dung lượng', async () => {
    const check = await checkDiskSpace('/tmp', 1024 * 1024, ok)
    assert.equal(check.ok, true)
    assert.equal(check.ok && check.freeBytes, 100_000 * 4096)
  })

  it('dừng khi xuống dưới sàn, kèm lý do đọc được', async () => {
    const check = await checkDiskSpace('/tmp', 1024 * 1024, low)
    assert.equal(check.ok, false)
    assert.equal(check.ok === false && check.kind, 'low')
    assert.match(check.ok === false ? check.reason : '', /Hết chỗ/)
    assert.match(check.ok === false ? check.reason : '', /KB|MB|GB/, 'lý do phải nêu con số, không chỉ nói chung')
  })

  it('lỗi của chính phép kiểm cũng là một lý do dừng', async () => {
    const check = await checkDiskSpace('/tmp', 1024 * 1024, async () => { throw new Error('EIO') })
    assert.equal(check.ok, false)
    assert.equal(check.ok === false && check.kind, 'error')
    assert.match(check.ok === false ? check.reason : '', /EIO/)
  })

  it('sàn bằng 0 là tắt hẳn phép kiểm, không phải lỗi', async () => {
    const check = await checkDiskSpace('/tmp', 0, async () => { throw new Error('không được gọi') })
    assert.equal(check.ok, true)
  })

  it('bộ kiểm chạy nền lặp lại, và chỉ báo dừng MỘT lần', async () => {
    let calls = 0
    const failures: string[] = []
    const guard = startDiskGuard({
      path: '/tmp',
      floorBytes: 1024,
      intervalMs: 5,
      // Hai lượt đầu còn chỗ, từ lượt thứ ba thì hết: nếu bộ kiểm chỉ chạy một
      // lần ở đầu công việc thì nó đã cho qua, và nhánh dừng không bao giờ chạy.
      statfs: async () => {
        calls += 1
        return calls <= 2 ? { bavail: 100_000, bsize: 4096 } : { bavail: 1, bsize: 1 }
      },
      onAbort: (failure) => failures.push(failure.reason),
    })

    await new Promise(resolve => setTimeout(resolve, 150))
    guard.stop()
    assert.ok(calls >= 3, `bộ kiểm phải chạy lặp lại, chỉ gọi ${calls} lần`)
    assert.equal(failures.length, 1, `nhánh dừng phải được gọi đúng một lần, thấy ${failures.length}`)
  })

  it('dừng công việc khi đĩa vơi dần TRONG LÚC chuyển mã', async () => {
    const slug = 'phim-het-dia'
    const workdirB = await workdirWith(slug)
    const fake = fakeMediaPool({ items: [pendingItem({ slug })] })
    const logs = captureLogs()

    // Lượt kiểm **đầu tiên** (trước khi vào việc) thấy còn chỗ; mọi lượt sau thấy
    // hết. Đếm theo **số lượt gọi**, không theo đồng hồ: lượt kiểm trước khi vào
    // việc chạy trước mọi nhịp của bộ kiểm nền (nó là một microtask, còn nhịp nền
    // là một macrotask), nên phép đếm này không phụ thuộc tốc độ máy — trong khi
    // một mốc thời gian thì phụ thuộc, và một test đỏ theo lịch trình của máy là
    // một test sẽ bị tắt đi.
    let calls = 0
    const statfs = async () => {
      calls += 1
      return calls === 1 ? { bavail: 100_000, bsize: 4096 } : { bavail: 1, bsize: 1 }
    }

    try {
      const result = await runPipeline(fake, {
        runner: scriptedRunner({ delayForRendition: () => 700 }),
        config: testConfig(workdirB),
        statfs,
        diskCheckIntervalMs: 50,
      })

      assert.equal(result.ok, false, JSON.stringify(result))
      assert.equal(result.ok === false && result.code, 'failed')
      assert.match(result.ok === false ? result.message : '', /Hết chỗ/)

      const row = fake.item(1)!
      assert.equal(row.processingStatus, 'failed')
      assert.match(String(row.processingError), /Hết chỗ/, 'lý do trong cột phải là lý do hết đĩa')
      assert.ok(
        logs.events().includes('media.disk_full'),
        `phải ghi sự kiện media.disk_full, thấy ${JSON.stringify(logs.events())}`,
      )
      // Dữ liệu tạm phải được dọn sau khi dừng.
      assert.deepEqual(await fs.readdir(path.join(workdirB, 'processing')).catch(() => []), [])
    } finally {
      logs.restore()
      await fs.rm(workdirB, { recursive: true, force: true })
    }
  })

  it('dừng công việc khi chính phép kiểm đĩa hỏng, thay vì chạy tiếp không có cổng', async () => {
    const slug = 'phim-loi-dia'
    const workdirB = await workdirWith(slug)
    const fake = fakeMediaPool({ items: [pendingItem({ slug })] })
    const logs = captureLogs()

    let calls = 0
    const statfs = async () => {
      calls += 1
      if (calls === 1) return { bavail: 100_000, bsize: 4096 }
      throw new Error('statfs: EACCES')
    }

    try {
      const result = await runPipeline(fake, {
        runner: scriptedRunner({ delayForRendition: () => 700 }),
        config: testConfig(workdirB),
        statfs,
        diskCheckIntervalMs: 50,
      })

      assert.equal(result.ok, false, JSON.stringify(result))
      assert.match(result.ok === false ? result.message : '', /EACCES/)
      assert.equal(fake.item(1)?.processingStatus, 'failed')
      assert.ok(
        logs.events().includes('media.disk_guard_failed'),
        `phải ghi sự kiện media.disk_guard_failed, thấy ${JSON.stringify(logs.events())}`,
      )
    } finally {
      logs.restore()
      await fs.rm(workdirB, { recursive: true, force: true })
    }
  })

  it('chu kỳ kiểm đĩa mặc định là một phút', () => {
    assert.equal(DISK_CHECK_INTERVAL_MS, 60 * 1000)
  })
})

// ─── 7.6 Ghi nhận lượt hỏng ──────────────────────────────────────────────────

describe('7.6 lượt hỏng được ghi nhận kèm lý do', () => {
  it('đánh dấu hỏng, kèm lý do, và giải phóng danh tính tiến trình', async () => {
    const workdirB = await workdirWith('phim-thu-nghiem')
    const fake = fakeMediaPool({ items: [pendingItem()] })
    const logs = captureLogs()
    try {
      const result = await runPipeline(fake, {
        runner: scriptedRunner({ failAll: true }),
        config: testConfig(workdirB),
      })
      assert.equal(result.ok, false)

      const row = fake.item(1)!
      assert.equal(row.processingStatus, 'failed')
      assert.ok(String(row.processingError).length > 0)
      assert.equal(row.claimedBy, null)
      assert.ok(logs.events().includes('media.transcode_failed'))
    } finally {
      logs.restore()
      await fs.rm(workdirB, { recursive: true, force: true })
    }
  })

  it('cắt lý do theo độ dài cột, không để câu INSERT bị từ chối', async () => {
    const slug = 'phim-ly-do-dai'
    const workdirB = await workdirWith(slug)
    const fake = fakeMediaPool({ items: [pendingItem({ slug })] })
    const inner = scriptedRunner()

    try {
      const result = await runPipeline(fake, {
        config: testConfig(workdirB),
        runner: async (command, args, ctx) => {
          if (command === 'ffprobe') return inner(command, args, ctx)
          return { code: 1, stdout: '', stderr: 'x'.repeat(2000) }
        },
      })

      assert.equal(result.ok, false)
      const stored = String(fake.item(1)?.processingError ?? '')
      assert.ok(stored.length > 0, 'lý do không được rỗng')
      assert.ok(
        stored.length <= PROCESSING_ERROR_LIMIT,
        `cột processing_error chỉ chứa ${PROCESSING_ERROR_LIMIT} ký tự, đã ghi ${stored.length}`,
      )
    } finally {
      await fs.rm(workdirB, { recursive: true, force: true })
    }
  })

  it('tệp gốc không phải video bị từ chối kèm mã riêng, trước khi tới FFmpeg', async () => {
    const slug = 'khong-phai-video'
    // Tên tệp nói `.mp4`, nội dung là văn bản — đúng ca mà phép kiểm byte đầu
    // tồn tại để chặn. Đường xử lý nền phải từ chối nó **trước** khi gọi FFmpeg.
    const workdirB = await workdirWith(slug, Buffer.from('day khong phai video', 'utf8'))
    const fake = fakeMediaPool({ items: [pendingItem({ slug })] })
    const spawned: string[] = []
    try {
      const result = await runPipeline(fake, {
        runner: scriptedRunner({ onSpawn: c => spawned.push(c) }),
        config: testConfig(workdirB),
      })

      assert.equal(result.ok, false)
      assert.equal(result.ok === false && result.code, 'unsupported_video')
      assert.deepEqual(spawned, [], 'không được đưa một tệp không nhận diện được vào FFmpeg')
      assert.equal(fake.item(1)?.processingStatus, 'failed')
    } finally {
      await fs.rm(workdirB, { recursive: true, force: true })
    }
  })

  it('thiếu tệp gốc là một lượt hỏng có mã riêng, không phải một lượt im lặng', async () => {
    const slug = 'khong-co-tep'
    const workdirB = await fs.mkdtemp(path.join(os.tmpdir(), 'cdkt-nosource-'))
    const fake = fakeMediaPool({ items: [pendingItem({ slug })] })
    try {
      const result = await runPipeline(fake, { runner: scriptedRunner(), config: testConfig(workdirB) })
      assert.equal(result.ok, false)
      assert.equal(result.ok === false && result.code, 'source_missing')
      assert.equal(fake.item(1)?.processingStatus, 'failed')
    } finally {
      await fs.rm(workdirB, { recursive: true, force: true })
    }
  })

  it('mục hỏng KHÔNG bao giờ được trình bày như phát được', () => {
    // Yêu cầu "Failed job is recorded" của đặc tả: một mục hỏng không được
    // trình bày như phát được, kể cả khi vài bản đã nằm trên đĩa. Một mục hiện ra
    // như đang chạy tốt thì không ai đi xử lý nó.
    assert.equal(isPlayable({ processingStatus: 'failed', resolutionsReady: ['360p'] }), false)
    assert.equal(isPlayable({ processingStatus: 'failed', resolutionsReady: [] }), false)
    // Nhưng `processing` **vẫn** phát được khi đã có bản sẵn sàng — đó chính là
    // nhánh mà việc công bố lũy tiến sinh ra để mở.
    assert.equal(isPlayable({ processingStatus: 'processing', resolutionsReady: ['360p'] }), true)
    assert.equal(isPlayable({ processingStatus: 'ready', resolutionsReady: ['360p'] }), true)
    // Chưa có bản nào thì không đưa cho trình phát: nó sẽ thất bại mà không nói
    // được vì sao.
    assert.equal(isPlayable({ processingStatus: 'ready', resolutionsReady: [] }), false)
    assert.equal(isPlayable({ processingStatus: 'pending', resolutionsReady: null }), false)
    assert.equal(isPlayable({ processingStatus: 'pending', resolutionsReady: undefined }), false)
  })
})

// ─── 8.1 Bộ thu hồi — cả hai nhánh ───────────────────────────────────────────

describe('8.1 bộ thu hồi công việc kẹt', () => {
  const staleMinutes = MEDIA_DEFAULTS.processingStaleMinutes
  const now = new Date('2026-09-19T12:00:00Z')

  /** Một mục đang xử lý với `updated_at` đã cũ. */
  function stuckItem(overrides: Row = {}): Row {
    return pendingItem({
      processingStatus: 'processing',
      claimedBy: 'may-chu:4242',
      updatedAt: new Date(now.getTime() - (staleMinutes + 5) * 60 * 1000),
      ...overrides,
    })
  }

  function reap(fake: ReturnType<typeof fakeMediaPool>, _alive: (claim: string | null | undefined) => boolean) {
    return reapStuckJobs({
      db: dbOver(fake),
      pool: fake.pool as never,
      config: { ...config, processingMaxAttempts: 3 },
      now,
    })
  }

  it('thu hồi mục có tiến trình KHÔNG còn chạy', async () => {
    const fake = fakeMediaPool({ items: [stuckItem()] })
    const logs = captureLogs()
    try {
      const outcome = await reap(fake, () => false)
      assert.ok(outcome, 'lượt chạy phải lấy được khoá')
      assert.equal(outcome.reclaimed, 1)
      assert.equal(outcome.refreshed, 0)

      const row = fake.item(1)!
      assert.equal(row.processingStatus, 'pending', 'mục phải trở về trạng thái thử lại được')
      assert.equal(row.claimedBy, null)
      assert.match(String(row.processingError), /dừng đột ngột/)
      assert.ok(logs.events().includes('media.processing_reclaimed'))
    } finally {
      logs.restore()
    }
  })

  it('PID còn sống không gia hạn một lease đã hết hạn', async () => {
    const fake = fakeMediaPool({ items: [stuckItem()] })
    const logs = captureLogs()
    try {
      const outcome = await reap(fake, () => true)
      assert.ok(outcome)
      assert.equal(outcome.reclaimed, 1)
      assert.equal(outcome.refreshed, 0)

      const row = fake.item(1)!
      assert.equal(row.processingStatus, 'pending')
      assert.equal(row.claimedBy, null)
      assert.ok(
        asDate(row.updatedAt).getTime() >= now.getTime(),
        'nhịp tim phải được đóng dấu tường minh, không dựa vào ON UPDATE CURRENT_TIMESTAMP',
      )
      assert.ok(fake.writes('updatedAt').length > 0, 'phải có một lượt ghi `updated_at`')
      assert.ok(logs.events().includes('media.processing_reclaimed'))
    } finally {
      logs.restore()
    }
  })

  it('không đụng mục vừa được cập nhật', async () => {
    const fake = fakeMediaPool({
      items: [stuckItem({ updatedAt: new Date(now.getTime() - 60 * 1000) })],
    })
    const outcome = await reap(fake, () => false)
    assert.ok(outcome)
    assert.equal(outcome.scanned, 0)
    assert.equal(fake.item(1)?.processingStatus, 'processing')
  })

  it('heartbeat được gia hạn giữa SELECT và CAS ngăn thu hồi', async () => {
    const fake = fakeMediaPool({ items: [stuckItem()], onQuery(sql, _params, state) {
      if (sql.startsWith('update')) state.items[0]!.processingHeartbeatAt = now
    } })
    const result = await reap(fake, () => false)
    assert.equal(result?.reclaimed, 0)
    assert.equal(fake.item(1)!.processingStatus, 'processing')
    assert.equal(fake.item(1)!.claimedBy, 'may-chu:4242')
  })

  it('không đụng mục ở trạng thái khác', async () => {
    const fake = fakeMediaPool({
      items: [
        stuckItem({ id: 1, processingStatus: 'pending', claimedBy: null }),
        stuckItem({ id: 2, processingStatus: 'ready' }),
        stuckItem({ id: 3, processingStatus: 'failed' }),
      ],
    })
    const outcome = await reap(fake, () => false)
    assert.ok(outcome)
    assert.equal(outcome.scanned, 0)
    assert.equal(outcome.reclaimed, 0)
  })

  it('chỉ quét một lô mỗi lượt, không kéo cả bảng về', async () => {
    assert.equal(REAP_BATCH_LIMIT, 200)
    const fake = fakeMediaPool({ items: [stuckItem()] })
    await reap(fake, () => false)
    const select = fake.queries.find(call => call.sql.includes('processing_status'))
    assert.ok(select, 'phải có một câu chọn')
    assert.match(select.sql, /limit \?/, 'phải có trần số bản ghi')
    assert.equal(select.params[select.params.length - 1], REAP_BATCH_LIMIT)
    // Cả hai điều kiện nằm trong câu truy vấn: lọc sau khi đọc sẽ kéo về mọi mục
    // đang xử lý trên toàn bảng.
    assert.match(select.sql, /`processing_status` = \?/)
    assert.match(select.sql, /`updated_at` < \?/)
  })

  it('giữ nguyên những bản đã công bố khi thu hồi', async () => {
    // Một công việc chết ở bản thứ ba đã công bố hai bản đầu. Thu hồi là đưa nó
    // về hàng chờ, không phải xoá dấu vết của những gì đã làm được.
    const fake = fakeMediaPool({ items: [stuckItem({ resolutionsReady: '["360p","720p"]' })] })
    await reap(fake, () => false)
    assert.deepEqual(fake.item(1)?.resolutionsReady, ['360p', '720p'])
  })

  it('không ghi đè một mục đã tự kết thúc giữa lượt đọc và lượt ghi', async () => {
    // Giữa lượt đọc và lượt ghi, lượt chuyển mã có thể đã xong và trả `claimed_by`
    // về NULL. Ghi đè lúc đó là đưa một mục vừa `ready` trở lại hàng chờ.
    const fake = fakeMediaPool({ items: [stuckItem()], onQuery: (sql, _params, state) => {
      if (sql.startsWith('update')) {
        state.items[0]!.processingStatus = 'ready'
        state.items[0]!.claimedBy = null
      }
    } })
    const outcome = await reapStuckJobs({
      db: dbOver(fake),
      pool: fake.pool as never,
      config,
      now,
    })
    assert.ok(outcome)
    assert.equal(outcome.reclaimed, 0, 'lượt ghi phải bị từ chối vì `processing_status` đã đổi')
    assert.equal(fake.item(1)?.processingStatus, 'ready')
  })

  it('`stalenessCutoff` và `reclaimReason` là hàm thuần', () => {
    assert.equal(
      stalenessCutoff(now, 10).toISOString(),
      new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
    )
    // Ngưỡng không dùng được thì lùi về mặc định, không cho ra `Invalid Date`.
    assert.ok(Number.isFinite(stalenessCutoff(now, Number.NaN).getTime()))
    assert.ok(Number.isFinite(stalenessCutoff(now, 0).getTime()))

    assert.match(reclaimReason('may:1'), /may:1/)
    assert.match(reclaimReason(null), /không rõ/)
  })

  it('`isProcessAlive` phân biệt được tiến trình chết, tiến trình khác máy, và danh tính hỏng', () => {
    assert.equal(isProcessAlive(processingClaim()), false, 'token chưa nhận việc không phải worker đang chạy')
    // PID 0 và số âm không phải tiến trình; `process.kill(0, 0)` sẽ hỏi cả nhóm
    // tiến trình, nên giá trị đó phải bị từ chối trước khi tới hệ điều hành.
    assert.equal(isProcessAlive('may:0'), false)
    assert.equal(isProcessAlive('may:-1'), false)
    assert.equal(isProcessAlive('may:khong-phai-so'), false)
    assert.equal(isProcessAlive('khong-co-dau-hai-cham'), false)
    assert.equal(isProcessAlive(''), false)
    assert.equal(isProcessAlive(null), false)
    assert.equal(isProcessAlive(undefined), false)

    // Tên máy khác: trên máy khác ta không soi được bảng tiến trình, và mốc thời
    // gian đã cũ là bằng chứng duy nhất còn lại. Chờ mãi một công việc không ai
    // chạy mới là kiểu hỏng mà bộ thu hồi sinh ra để chấm dứt.
    assert.equal(isProcessAlive('may-khac:1', os.hostname()), false)

    // PID gần như chắc chắn không tồn tại.
    assert.equal(isProcessAlive(`${os.hostname()}:999999`, os.hostname()), false)
  })
})

// ─── 8.2 Nhịp và cổng bật/tắt ────────────────────────────────────────────────

describe('8.2 bộ đếm nhịp và cổng bật/tắt', () => {
  const reaperSource = () => readFileSync('server/services/media-processing-reaper.ts', 'utf8')
  const pluginSource = () => readFileSync('server/plugins/media-processing-reaper.ts', 'utf8')

  it('nhịp 15 phút, timer không giữ tiến trình sống', () => {
    assert.equal(TICK_INTERVAL_MS, 15 * 1000)
    const source = reaperSource()
    assert.match(source, /timer\.unref\?\.\(\)/)
    assert.match(source, /warmup\.unref\?\.\(\)/)
    assert.match(source, /clearInterval\(timer\)/)
  })

  it('lỗi trong một nhịp bị nuốt thành một dòng log', () => {
    // Một unhandled rejection trong worker biến một lượt dọn trượt thành một lần
    // sập tiến trình.
    const source = reaperSource()
    assert.match(source, /media\.reaper_failed/)
    assert.match(source, /\.catch\(/)
  })

  it('cổng bật/tắt giống từng dòng với hai bộ đếm nhịp đã có', () => {
    // So **mã**, không so văn xuôi: bộ lọc dưới đây bắt theo từ khoá, và một dòng
    // chú thích tình cờ chứa chữ "return" sẽ làm phép so đỏ vì một lý do không
    // liên quan gì tới cổng bật/tắt. Điều cần khẳng định là ba plugin **gate
    // giống nhau**, và đó là một khẳng định về mã.
    const gateOf = (source: string) => stripComments(source)
      .split('\n')
      .filter(line => /override|enabled|return|includes/.test(line))
      .map(line => line.trim())
      .filter(line => line !== '')
      .join('\n')

    const reaper = pluginSource().replace(/MEDIA_REAPER_SCHEDULER/g, 'SCHEDULER_VAR')
    const retention = readFileSync('server/plugins/retention-scheduler.ts', 'utf8')
      .replace(/RETENTION_SCHEDULER/g, 'SCHEDULER_VAR')
    const analytics = readFileSync('server/plugins/analytics-scheduler.ts', 'utf8')
      .replace(/ANALYTICS_SCHEDULER/g, 'SCHEDULER_VAR')

    assert.ok(gateOf(reaper).includes('SCHEDULER_VAR'), 'bộ lọc phải thật sự bắt được cổng, không rỗng')
    assert.equal(gateOf(reaper), gateOf(retention), 'ba job định kỳ phải bật/tắt giống nhau')
    assert.equal(gateOf(reaper), gateOf(analytics))
  })

  it('tắt ở ngoài production trừ khi được bật tường minh', () => {
    const source = pluginSource()
    assert.match(source, /MEDIA_REAPER_SCHEDULER/)
    assert.match(source, /NODE_ENV === 'production'/)
    assert.match(source, /\['0', 'false', 'off', 'no'\]/)
    assert.match(source, /startMediaProcessingReaper\(\)/)
  })

  it('khởi động hai lần không tạo hai timer', () => {
    const source = reaperSource()
    assert.match(source, /if \(timer\) return/)
    // Gọi thật để chắc chắn hàm không ném ra ngoài — một plugin ném lúc boot làm
    // cả tiến trình không lên được.
    startMediaProcessingReaper()
    startMediaProcessingReaper()
    stopMediaProcessingReaper()
    stopMediaProcessingReaper()
  })
})

// ─── 8.3 Cùng một khoá danh nghĩa ────────────────────────────────────────────

describe('8.3 bộ thu hồi lấy đúng khoá của đường ống', () => {
  it('dùng chung tên khoá với lượt bắt đầu đường ống', async () => {
    const fake = fakeMediaPool({ items: [pendingItem({ processingStatus: 'processing' })] })
    await reapStuckJobs({ db: dbOver(fake), pool: fake.pool as never, config })

    assert.ok(
      fake.locks.includes(TRANSCODE_LOCK_NAME),
      `bộ thu hồi phải lấy khoá ${TRANSCODE_LOCK_NAME}, thấy ${JSON.stringify(fake.locks)}`,
    )
    assert.ok(
      fake.locks.includes(`release:${TRANSCODE_LOCK_NAME}`),
      'khoá phải được nhả trong `finally`',
    )
    assert.equal(fake.held, 0, 'kết nối giữ khoá phải được trả lại')
  })

  it('nhịp chồng lên nhịp trước thì KHÔNG làm gì', async () => {
    const fake = fakeMediaPool({
      items: [pendingItem({ processingStatus: 'processing', claimedBy: 'may:1' })],
      lockBusy: true,
    })
    const logs = captureLogs()
    try {
      const outcome = await reapStuckJobs({
        db: dbOver(fake), pool: fake.pool as never, config,
      })
      assert.equal(outcome, null, 'không lấy được khoá thì trả về `null`, không phải một kết quả rỗng')
      assert.ok(
        !fake.queries.some(call => call.sql.trim().startsWith('update `media_items`')),
        'không được chạm một hàng nào khi không giữ khoá',
      )
      assert.ok(logs.events().includes('media.reaper_lock_contention'))
    } finally {
      logs.restore()
    }
  })
})

// ─── Hàm thuần ───────────────────────────────────────────────────────────────

describe('hàm thuần của đường ống', () => {
  it('chọn bản theo chiều cao nguồn, không bao giờ trả về rỗng', () => {
    assert.deepEqual(selectRenditions(1080).map(r => r.name), ['360p', '720p', '1080p'])
    assert.deepEqual(selectRenditions(720).map(r => r.name), ['360p', '720p'])
    assert.deepEqual(selectRenditions(360).map(r => r.name), ['360p'])

    // Không bao giờ nâng cấp độ phân giải: một nguồn 480p chuyển thành 1080p chỉ
    // tốn thời gian và đĩa để cho ra một tệp mờ hơn cả bản gốc.
    assert.deepEqual(selectRenditions(480).map(r => r.name), ['360p'])

    // Và **không bao giờ rỗng**: một nguồn 240p không khớp bản nào ở trên, và trả
    // về rỗng nghĩa là mục đó không bao giờ có bản nào sẵn sàng — tức là không
    // bao giờ xem được, mà không có gì báo lỗi.
    const tiny = selectRenditions(240)
    assert.equal(tiny.length, 1)
    assert.equal(tiny[0]!.name, '240p')
    assert.equal(tiny[0]!.height, 240)

    // Chiều cao lẻ phải làm tròn về số chẵn: bộ giải mã từ chối kích thước lẻ.
    assert.equal(selectRenditions(241)[0]!.height, 240)
    // Không đọc được chiều cao thì dùng cả ba bản — một tệp thiếu metadata vẫn
    // chuyển mã được.
    assert.equal(selectRenditions(null).length, RENDITIONS.length)
    assert.equal(selectRenditions(0).length, RENDITIONS.length)
    assert.equal(selectRenditions(Number.NaN).length, RENDITIONS.length)
  })

  it('bề rộng suy từ tỉ lệ nguồn và luôn là số chẵn', () => {
    assert.equal(scaledWidth(1920, 1080, 720), 1280)
    assert.equal(scaledWidth(1920, 1080, 360), 640)
    assert.equal(scaledWidth(480, 720, 360), 240)
    // 1000 × 333 ở chiều cao 300 → 900.9 → 901 → 900 (chẵn).
    assert.equal(scaledWidth(1000, 333, 300), 900)
    assert.equal(scaledWidth(0, 0, 360), null)
    assert.equal(scaledWidth(Number.NaN, 100, 360), null)
  })

  it('đọc kết quả ffprobe mà không ném khi thiếu trường', () => {
    const parsed = parseProbeJson(JSON.stringify({
      format: { duration: '12.5' },
      streams: [
        { codec_type: 'audio' },
        { codec_type: 'video', width: 1920, height: 1080 },
      ],
    }))
    assert.equal(parsed.durationSeconds, 13)
    assert.equal(parsed.width, 1920)
    assert.equal(parsed.height, 1080)
    assert.equal(parseProbeJson('không phải json').durationSeconds, null)
    assert.equal(parseProbeJson('{}').width, null)
    // Stream video phải được chọn theo `codec_type`, không theo thứ tự: một tệp
    // có luồng audio đứng trước là chuyện thường.
    assert.equal(parseProbeJson(JSON.stringify({ streams: [{ codec_type: 'audio' }] })).width, null)
  })

  it('danh tính là token riêng từng lượt dù cùng máy và PID', () => {
    const claim = processingClaim('may-a', 123)
    assert.notEqual(claim, processingClaim('may-a', 123))
    assert.ok(claim.length <= 64)
    assert.equal(isProcessAlive(claim, 'may-a'), false, 'PID 123 gần như chắc chắn không tồn tại')
  })
})

// ─── Runner giả không được ghi ra ngoài thư mục tạm ──────────────────────────

/**
 * Một runner giả ghi nhầm chỗ thì **không có gì đỏ**.
 *
 * Đó đúng là chuyện đã xảy ra: `args.indexOf('-hls_segment_filename') + 1` trả về
 * `args[0]` khi cờ không có mặt, nên lượt gọi `extractThumbnail` đi vào nhánh HLS
 * và ghi `index.m3u8` + `seg_000.ts` vào **thư mục làm việc của tiến trình**. Hai
 * tệp rác nằm lại trong thư mục gốc của kho sau mỗi lượt `npm test`, và triệu
 * chứng duy nhất — `publishFile` ném ENOENT vì `scratch/` không tồn tại — bị khối
 * `catch` bao quanh nuốt theo thiết kế. Bản sửa một mình không đủ: nó đúng cho tới
 * lần thêm nhánh runner tiếp theo. Khẳng định dưới đây là thứ giữ nó đúng.
 */
describe('runner giả không ghi ra ngoài thư mục tạm', () => {
  it('một lượt chạy đầy đủ không để lại tệp nào trong thư mục làm việc', async () => {
    const slug = 'phim-khong-rac'
    const before = new Set(readdirSync(process.cwd()))
    const workdirB = await workdirWith(slug)
    const fake = fakeMediaPool({ items: [pendingItem({ slug })] })
    try {
      await runPipeline(fake, { runner: scriptedRunner(), config: testConfig(workdirB) })
    } finally {
      await fs.rm(workdirB, { recursive: true, force: true })
    }

    // So **hai danh sách**, không so một tên cụ thể: `index.m3u8` / `seg_000.ts`
    // là hai cái tên của lần hỏng này, còn nhánh ghi nhầm tiếp theo sẽ có tên
    // khác. Một khẳng định chỉ nêu hai tên đó sẽ xanh trong khi thư mục gốc vẫn
    // đang bị bồi rác.
    const added = readdirSync(process.cwd()).filter(name => !before.has(name))
    assert.deepEqual(
      added,
      [],
      `runner giả đã ghi ra ngoài thư mục tạm: ${added.join(', ')}`,
    )
  })

  it('lượt gọi không mang cờ HLS đi vào nhánh ảnh đại diện, không phải nhánh HLS', async () => {
    // Hình dạng argv y hệt `extractThumbnail`: `-hide_banner` đứng đầu và **không
    // có** `-hls_segment_filename`. Chốt bằng chỉ số âm là đủ ở đây vì tệp ra là
    // tệp duy nhất nhánh này chạm tới.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cdkt-runner-thumb-'))
    const output = path.join(dir, 'thumb.jpg')
    const before = new Set(readdirSync(process.cwd()))
    try {
      const outcome = await scriptedRunner()(
        'nice',
        ['-n', '19', 'ffmpeg', '-hide_banner', '-nostdin', '-y', '-ss', '1', '-i', 'x.mp4',
          '-frames:v', '1', '-vf', 'scale=-2:720', '-q:v', '3', output],
        { signal: new AbortController().signal },
      )

      assert.equal(outcome.code, 0)
      // Ảnh đại diện phải nằm **đúng chỗ được yêu cầu** — đây là thứ phân biệt
      // "đã ghi vào thư mục tạm" với "đã ghi vào một thư mục nào đó".
      assert.ok((await fs.stat(output)).size > 0, 'ảnh đại diện phải được ghi vào đường dẫn được yêu cầu')
      assert.deepEqual(readdirSync(process.cwd()).filter(name => !before.has(name)), [])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

// ─── Đối chiếu nguồn: đường ống không ghi nhật ký kiểm toán ──────────────────

describe('đường ống và bộ thu hồi không ghi nhật ký kiểm toán', () => {
  it('cả hai tệp đều không chạm `activity_logs`, nên không có lượt ghi nào để bọc', () => {
    // Hành động đáng ghi kiểm toán là **lượt tải lên**, và cặp hàng + nhật ký đó
    // nằm trong transaction của `completeUpload` (`chunked-upload.ts`). Một lượt
    // chuyển mã là sự kiện của máy, không phải hành động của cán bộ.
    //
    // Bỏ chú thích trước khi khẳng định: chính đoạn văn giải thích *vì sao* tệp
    // không chạm `activityLogs` có chứa chuỗi đó, nên không lọc nó ra thì lời giải
    // thích làm đỏ cái test nó đang giải thích — và bài học rút ra sẽ là xoá lời
    // giải thích, không phải giữ guard.
    for (const file of ['video-processing.ts', 'media-processing-reaper.ts']) {
      const source = stripComments(readFileSync(path.join('server/services', file), 'utf8'))
      assert.doesNotMatch(source, /activityLogs/, `${file} không được ghi nhật ký kiểm toán`)
    }
  })

  it('hai tệp này được khai trong `SERVICE_EXEMPTIONS` kèm lý do, không phải đi qua im lặng', () => {
    // Cổng quét trong `tests/reader-audit-atomicity.test.ts` khớp chuỗi trên **văn
    // bản mã nguồn** và **không bỏ chú thích**, nên phần đầu tệp — vốn nhắc tới
    // `activityLogs` để giải thích vì sao nó không ghi — vẫn khớp. Nghĩa là hai tệp
    // này **cần** một mục miễn trừ, và mục đó phải nói ra hình dạng thật: không có
    // cặp hàng + audit nào để bọc.
    //
    // Đây là chỗ dễ viết sai nhất: một mục miễn trừ mô tả một hình dạng không tồn
    // tại thì đọc ra y hệt một mục đúng, và nó sống lâu hơn ký ức của người viết.
    const audit = readFileSync('tests/reader-audit-atomicity.test.ts', 'utf8')
    for (const file of ['video-processing.ts', 'media-processing-reaper.ts']) {
      const entry = new RegExp(`'${file.replace('.', '\\.')}':\\s*'([^']+)'`).exec(audit)
      assert.ok(entry, `${file} phải có một mục trong SERVICE_EXEMPTIONS kèm lý do`)
      assert.match(
        entry[1]!,
        /no row\+audit pair/,
        `lý do miễn trừ của ${file} phải nói ra hình dạng thật: không có cặp hàng + audit nào`,
      )
    }
  })
})
