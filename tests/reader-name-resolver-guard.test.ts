import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import test, { mock } from 'node:test'
import { fileURLToPath } from 'node:url'

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
 * Màn hình chỉ cán bộ thấy, đọc tên Google thô CÓ CHỦ ĐÍCH. Số khối `select` được
 * ghi kèm: thêm một lượt đọc tên thô mới vào chính tệp này cũng làm test đỏ.
 */
const STAFF_ONLY_RAW_NAME_READS: Record<string, { blocks: number, reason: string }> = {
  'services/readers.ts': {
    blocks: 6,
    reason: 'danh sách/chi tiết người đọc ở /admin/readers (cán bộ nhận diện tài khoản bằng tên Google thật) và tên trong dòng audit/log của chặn, bỏ chặn, xoá, xoá bình luận',
  },
  'api/admin/comments/ai-moderate.post.ts': {
    blocks: 1,
    reason: 'tên tác giả gửi cho prompt kiểm duyệt AI — không hiển thị cho người đọc',
  },
}

/** Every `.select({ … })` block in a source text, matched by brace depth. */
function selectBlocks(source: string): string[] {
  const blocks: string[] = []
  let from = 0
  for (;;) {
    const start = source.indexOf('.select({', from)
    if (start === -1) return blocks
    let depth = 0
    let end = start + '.select('.length
    for (; end < source.length; end++) {
      const char = source[end]
      if (char === '{') depth++
      else if (char === '}') { depth--; if (depth === 0) break }
    }
    blocks.push(source.slice(start, end + 1))
    from = end + 1
  }
}

// Raw SQL lives in template literals, where the identifier quotes are escaped:
// the source text reads \`display_name\`.
const READS_GOOGLE_NAME = /readerAccounts\.displayName\b(?!Reserved)|`display_name\\?`/
const READS_FLAG = /readerAccounts\.displayNameReserved|`display_name_reserved\\?`/

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

test('S5: every select that reads a Google name also reads display_name_reserved, outside named staff-only views', () => {
  const offenders: string[] = []
  const staffCounts: Record<string, number> = {}
  for (const { rel, source } of serverFiles()) {
    for (const block of selectBlocks(source)) {
      if (!READS_GOOGLE_NAME.test(block)) continue
      if (READS_FLAG.test(block)) continue
      if (STAFF_ONLY_RAW_NAME_READS[rel]) { staffCounts[rel] = (staffCounts[rel] ?? 0) + 1; continue }
      offenders.push(`${rel}: ${block.replace(/\s+/g, ' ').slice(0, 120)}…`)
    }
  }
  assert.deepEqual(offenders, [], 'a reader-facing select reads the Google name without the reserved flag')
  for (const [rel, { blocks }] of Object.entries(STAFF_ONLY_RAW_NAME_READS)) {
    assert.equal(staffCounts[rel] ?? 0, blocks, `${rel}: the staff-only raw name reads changed — review and update the allowlist`)
  }
})

test('S5: a file that reads the reserved flag resolves the name through effectiveDisplayName', () => {
  const offenders = serverFiles()
    .filter(({ rel, source }) => READS_FLAG.test(source) && rel !== 'utils/reader-auth.ts')
    .filter(({ source }) => !/effectiveDisplayName\(/.test(source))
    .map(({ rel }) => rel)
  // `utils/reader-auth.ts` is the identity loader: it hands the columns and the flag
  // to its callers (`reader/me`, comments, livestream chat), which resolve the name.
  assert.deepEqual(offenders, [], 'these files select the flag but never resolve the name with it')
})

test('S5: livestream name snapshots are resolved on the way out', () => {
  for (const { rel, source } of serverFiles()) {
    if (!/livestreamMessages\.displayName\b/.test(source)) continue
    assert.match(source, /publicNameSnapshot\(/, `${rel} reads livestream name snapshots without publicNameSnapshot`)
  }
})
