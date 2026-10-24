import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import test, { mock } from 'node:test'
import { fileURLToPath } from 'node:url'
import { analyzeReaderNameReads, readerNameViolations } from './_reader-name-guard'

/**
 * MỌI chỗ người đọc thấy tên của một người đọc khác đi qua `effectiveDisplayName`
 * (spec reader-display-names-google, D-NAMES) — kiểm chứng độc lập 2A tìm ra một
 * chỗ lọt (CRITICAL): chuông thông báo của người đọc (`notifications.ts`) đọc thẳng
 * `custom_display_name`/`display_name`, nên một người mang tên Google "Ban Quản Trị"
 * trả lời bình luận thì người nhận thấy "Ban quản trị đã trả lời" — không phân biệt
 * được với câu trả lời thật của cổng.
 *
 * Phần hành vi chạy THẬT `listNotifications` (CSDL giả trả đúng hình dạng hàng mà
 * MySQL trả — cờ `display_name_reserved` qua `sql` thô là số 0/1, không phải boolean),
 * `listChatHistory` (bản chụp tên livestream ghi trước 2A), `effectiveDisplayName`.
 * Phần guard đọc mã nguồn `server/**`: đọc tên Google mà không đọc cờ là lỗi, trừ
 * các màn hình chỉ dành cho cán bộ có tên trong danh sách kèm lý do.
 */

let notificationRows: Array<Record<string, unknown>> = []
let chatRows: Array<Record<string, unknown>> = []

function chain(resolveRows: (projection: Record<string, unknown> | undefined) => unknown[], projection?: Record<string, unknown>) {
  const node: Record<string, unknown> = {}
  for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy', 'limit', 'offset']) node[method] = () => node
  node.then = (resolve: (rows: unknown[]) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve(resolveRows(projection)).then(resolve, reject)
  return node
}

mock.module('../server/utils/db', {
  namedExports: {
    getPool: () => ({}),
    getDb: () => ({
      select: (projection?: Record<string, unknown>) => chain(p => (p && 'total' in p ? [{ total: notificationRows.length }] : notificationRows), projection),
    }),
  },
})

const { listNotifications } = await import('../server/services/notifications')
const { listChatHistory } = await import('../server/services/livestream-chat')
const { effectiveDisplayName, RESERVED_PROVIDER_NAME_FALLBACK } = await import('../server/utils/display-name')

/** A notification row exactly as the select in `listNotifications` returns it from MySQL. */
function notificationRow(author: { custom: string | null, google: string | null, reserved: number | null }, extra: Record<string, unknown> = {}) {
  return {
    id: 1, isRead: 0, createdAt: new Date('2026-10-24T00:00:00Z'),
    body: 'Cảm ơn bạn, mình cũng gặp vấn đề này', adminUserId: null, commentReaderId: 42, parentId: 7,
    articleTitle: 'Bài viết', articleSlug: 'bai-viet', articleStatus: 'published', commentsEnabled: true,
    mediaItemTitle: null, mediaItemSlug: null, mediaItemShortId: null, mediaItemStatus: null, mediaCommentsEnabled: null,
    olderCount: 0, rootId: 7,
    authorName: author.custom, authorGoogleName: author.google, authorNameReserved: author.reserved,
    ...extra,
  }
}

// ─── CRITICAL: the reader notification bell ───────────────────────────────────

test("a flagged author's reply appears in the recipient's notifications as \"Bạn đọc\" (MySQL returns the flag as 1)", async () => {
  notificationRows = [notificationRow({ custom: null, google: 'Ban Quản Trị', reserved: 1 })]
  const page = await listNotifications({ readerId: 9, page: 1, perPage: 20 })
  assert.equal(page.items[0]!.authorName, 'Bạn đọc')
  assert.equal(page.items[0]!.isAdminReply, false)
})

test('notifications: an ordinary Google name is shown, a chosen name wins, a real admin reply stays the portal label', async () => {
  notificationRows = [
    notificationRow({ custom: null, google: 'Nguyễn Văn A', reserved: 0 }),
    notificationRow({ custom: 'Bác Ba', google: 'Admin', reserved: 1 }, { id: 2 }),
    notificationRow({ custom: null, google: null, reserved: null }, { id: 3, adminUserId: 1, commentReaderId: null }),
  ]
  const { items } = await listNotifications({ readerId: 9, page: 1, perPage: 20 })
  assert.deepEqual(items.map(item => item.authorName), ['Nguyễn Văn A', 'Bác Ba', 'Ban quản trị'])
})

test('effectiveDisplayName takes the flag as MySQL returns it (0/1) as well as a boolean', () => {
  for (const flag of [1, true]) assert.equal(effectiveDisplayName({ displayName: 'Admin', customDisplayName: null, displayNameReserved: flag }), 'Bạn đọc')
  for (const flag of [0, false, null, undefined]) assert.equal(effectiveDisplayName({ displayName: 'Admin', customDisplayName: null, displayNameReserved: flag }), 'Admin')
  assert.equal(RESERVED_PROVIDER_NAME_FALLBACK, 'Bạn đọc')
})

// ─── W3: livestream chat history snapshots written before 2A ──────────────────

test('livestream history: a reserved name snapshotted before the fix reads as "Bạn đọc"; other snapshots are kept as written', async () => {
  chatRows = [
    { id: 3, displayName: 'Admin', content: 'chào', createdAt: new Date('2026-10-24T00:00:03Z') },
    { id: 2, displayName: 'Ban Quản Trị', content: 'xin chào', createdAt: new Date('2026-10-24T00:00:02Z') },
    { id: 1, displayName: 'Nguyễn Văn A', content: 'hello', createdAt: new Date('2026-10-24T00:00:01Z') },
  ]
  let call = 0
  const db = {
    select: () => chain(() => (call++ === 0 ? [{ id: 5, title: 'Buổi phát' }] : chatRows)),
  }
  const history = await listChatHistory({}, { db: db as never })
  assert.deepEqual(history.messages.map(message => message.displayName), ['Nguyễn Văn A', 'Bạn đọc', 'Bạn đọc'])
})

// ─── S5: source guard ─────────────────────────────────────────────────────────

/**
 * Hàm đọc tên Google thô CÓ CHỦ ĐÍCH — chỉ cán bộ thấy, hoặc chuyển nguyên cột cho
 * nơi gọi tự giải. Liệt kê theo `tệp#hàm`: một hàm mới đọc tên mà không qua resolver
 * (kể cả trong chính các tệp này) làm test đỏ; một mục không còn đúng cũng đỏ.
 */
const STAFF_ONLY_RAW_NAME_READS: Record<string, string> = {
  'services/readers.ts#listReaders': 'danh sách người đọc ở /admin/readers — cán bộ nhận diện tài khoản bằng tên Google thật',
  'services/readers.ts#getReaderDetail': 'chi tiết người đọc ở /admin/readers/[id] — như trên',
  'services/readers.ts#banReader': 'tên trong dòng audit/log của lượt chặn',
  'services/readers.ts#unbanReader': 'tên trong dòng audit/log của lượt bỏ chặn',
  'services/readers.ts#deleteReader': 'tên trong dòng audit/log của lượt xoá tài khoản',
  'services/readers.ts#purgeReaderComments': 'tên trong dòng audit/log của lượt xoá bình luận',
  'api/admin/comments/ai-moderate.post.ts#default': 'tên tác giả gửi cho prompt kiểm duyệt AI — không hiển thị cho người đọc',
  'utils/reader-auth.ts#resolveReader': 'bộ nạp danh tính: trả cả hai cột tên + cờ cho nơi gọi (`reader/me`, bình luận, chat livestream) — chúng giải qua effectiveDisplayName',
}

function serverFiles(): Array<{ rel: string, source: string }> {
  const root = fileURLToPath(new URL('../server', import.meta.url))
  const out: Array<{ rel: string, source: string }> = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (full.endsWith('.ts')) out.push({ rel: relative(root, full).replaceAll('\\', '/'), source: readFileSync(full, 'utf8') })
    }
  }
  walk(root)
  // The schema, DDL, migrations and the one-time backfill define or convert the
  // column; they display nothing.
  return out.filter(file => !file.rel.startsWith('db/'))
}

test('S5: every function under server/ that reads a reader name reads the flag AND passes it to effectiveDisplayName (staff-only exceptions named)', () => {
  const violations = serverFiles().flatMap(({ rel, source }) => readerNameViolations(rel, source)).sort()
  const unexpected = violations.filter(entry => !STAFF_ONLY_RAW_NAME_READS[entry])
  assert.deepEqual(unexpected, [], 'these functions read a reader name without resolving it through effectiveDisplayName + display_name_reserved')
  const stale = Object.keys(STAFF_ONLY_RAW_NAME_READS).filter(entry => !violations.includes(entry))
  assert.deepEqual(stale, [], 'these allowlist entries no longer read a raw name — drop them so the list keeps meaning something')
})

/**
 * Tám biến thể của lượt kiểm chứng lại 2A (bản guard trước bỏ lọt 5): projection
 * trong một hằng, SQL thô không backtick, chuỗi `pool.query`, chọn nguyên hàng,
 * chọn cờ mà không dùng, `sql\`${cột}\`` lồng. Nguyên văn, chỉ là dữ liệu cho bộ
 * phân tích — không bao giờ được nạp.
 */
const VERIFIER_VARIANTS: Record<string, string> = {
  'A.ts': `import { eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { readerAccounts } from '../db/schema'
export async function leakA(id: number) {
  const [row] = await getDb().select({ name: readerAccounts.displayName }).from(readerAccounts).where(eq(readerAccounts.id, id))
  return row?.name
}`,
  'B.ts': `import { eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { readerAccounts } from '../db/schema'
const columns = { name: readerAccounts.displayName, custom: readerAccounts.customDisplayName }
export async function leakB(id: number) {
  const [row] = await getDb().select(columns).from(readerAccounts).where(eq(readerAccounts.id, id))
  return row?.custom || row?.name
}`,
  'C.ts': `import { sql } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { articleComments } from '../db/schema'
export async function leakC() {
  return getDb().select({ author: sql<string>\`ra.display_name\` }).from(articleComments)
}`,
  'D.ts': `import { getPool } from '../utils/db'
export async function leakD(id: number) {
  const [rows] = await getPool()!.query('SELECT display_name FROM reader_accounts WHERE id = ?', [id])
  return rows
}`,
  'E.ts': `import { eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { readerAccounts } from '../db/schema'
export async function leakE(id: number) {
  const [row] = await getDb().select().from(readerAccounts).where(eq(readerAccounts.id, id))
  return { name: row?.customDisplayName || row?.displayName }
}`,
  'G.ts': `import { sql } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { articleComments } from '../db/schema'
export async function leakG() {
  return getDb().select({ names: sql<string>\`GROUP_CONCAT(\\\`ra\\\`.\\\`display_name\\\`)\` }).from(articleComments)
}`,
  'H.ts': `import { eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { readerAccounts } from '../db/schema'
import { effectiveDisplayName } from '../utils/display-name'
export async function okH(id: number) {
  const [row] = await getDb().select({ displayName: readerAccounts.displayName, customDisplayName: readerAccounts.customDisplayName, displayNameReserved: readerAccounts.displayNameReserved }).from(readerAccounts).where(eq(readerAccounts.id, id))
  return row ? effectiveDisplayName(row) : null
}
export async function leakH(id: number) {
  const [row] = await getDb().select({ n: readerAccounts.displayName, c: readerAccounts.customDisplayName, f: readerAccounts.displayNameReserved }).from(readerAccounts).where(eq(readerAccounts.id, id))
  return row?.c || row?.n
}`,
  'I.ts': `import { eq, sql } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { readerAccounts } from '../db/schema'
export async function leakI(id: number) {
  const [row] = await getDb().select({ name: sql<string>\`COALESCE(\${readerAccounts.customDisplayName}, \${readerAccounts.displayName})\` }).from(readerAccounts).where(eq(readerAccounts.id, id))
  return row?.name
}`,
}

test('S5: all eight verifier variants are caught; the safe function among them passes', () => {
  const violations = Object.entries(VERIFIER_VARIANTS).flatMap(([name, source]) => readerNameViolations(name, source)).sort()
  assert.deepEqual(violations, ['A.ts#leakA', 'B.ts#leakB', 'C.ts#leakC', 'D.ts#leakD', 'E.ts#leakE', 'G.ts#leakG', 'H.ts#leakH', 'I.ts#leakI'])
})

test('S5: the analyzer counts comments as nothing and a flagged call in a helper as one hop', () => {
  const source = `import { effectiveDisplayName } from '../utils/display-name'
// the column \`display_name\` is refreshed from Google (comment, not a read)
function serialize(row: { name: string, custom: string, flag: number }) {
  return effectiveDisplayName({ displayName: row.name, customDisplayName: row.custom, displayNameReserved: row.flag })
}
export async function list(db: any) {
  const rows = await db.select({ name: readerAccounts.displayName, custom: readerAccounts.customDisplayName, flag: readerAccounts.displayNameReserved }).from(readerAccounts)
  return rows.map((row: any) => serialize(row))
}
export function noFlagKey(row: any) {
  return effectiveDisplayName({ displayName: readerAccounts.displayName, customDisplayName: null, displayNameReserved: undefined })
}
export function literalWithoutFlag() {
  return effectiveDisplayName({ displayName: readerAccounts.displayName, customDisplayName: null } as never)
}`
  const verdicts = Object.fromEntries(analyzeReaderNameReads('x.ts', source).map(verdict => [verdict.name, verdict.ok]))
  assert.equal(verdicts.serialize, true, 'a function that reads no column is never a violation')
  assert.equal(verdicts.list, true, 'one hop to a same-file resolver')
  assert.equal(verdicts.noFlagKey, false, 'the flag key is there but the flag column is never read')
  assert.equal(verdicts.literalWithoutFlag, false, 'an object literal without displayNameReserved is not a resolution')
})

test('S5: livestream name snapshots are resolved on the way out', () => {
  for (const { rel, source } of serverFiles()) {
    if (!/livestreamMessages\.displayName\b/.test(source)) continue
    assert.match(source, /publicNameSnapshot\(/, `${rel} reads livestream name snapshots without publicNameSnapshot`)
  }
})
