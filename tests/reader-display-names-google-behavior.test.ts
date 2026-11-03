import assert from 'node:assert/strict'
import test, { beforeEach, mock } from 'node:test'

/**
 * Tên Google là một từ dành riêng (spec reader-display-names-google, D-NAMES).
 *
 * Luật tên dành riêng ("Admin", "Ban quản trị", "C11", "Bộ Công an"…) chỉ áp cho
 * tên NGƯỜI ĐỌC TỰ ĐẶT. Tên lấy từ Google đi thẳng vào `display_name` và hiện trên
 * bình luận công khai — ai đặt tên Google là "Ban Quản Trị" thì đăng bình luận dưới
 * đúng cái tên đó, cạnh câu trả lời chính thức của cổng. Nay: vẫn đăng nhập được
 * (từ chối sẽ khoá một người thật), tên Google vẫn lưu nguyên văn, nhưng hiển thị
 * là "Bạn đọc" cho tới khi người đọc tự chọn tên.
 *
 * Chạy THẬT `server/api/auth/google/callback.get.ts` (state ký thật, id_token giải
 * và kiểm thật), `effectiveDisplayName`, `serializePublicComment`, và lượt điền cờ
 * một lần lúc khởi động.
 */

process.env.JWT_SECRET = 'reader-display-names-google-secret-0123456789'

type ReaderRow = { id: number, googleSub: string, displayName: string | null, displayNameReserved: boolean, customDisplayName: string | null, isBanned: boolean, tokenVersion: number }
let readers: ReaderRow[] = []
let nextId = 41
let currentSub = ''
const cookies: string[] = []

const schema = await import('../server/db/schema')
const { readerAccounts } = schema

mock.module('../server/utils/db', {
  namedExports: {
    getPool: () => ({}),
    getDb: () => ({
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: async () => (table === readerAccounts ? readers.filter(row => row.googleSub === currentSub) : []),
          }),
        }),
      }),
      update: () => ({
        set: (values: Partial<ReaderRow>) => ({
          where: async () => {
            const row = readers.find(r => r.googleSub === currentSub)
            if (row) Object.assign(row, values)
            return [{ affectedRows: row ? 1 : 0 }, []]
          },
        }),
      }),
      insert: () => ({
        values: async (values: Partial<ReaderRow>) => {
          const id = nextId++
          readers.push({ id, customDisplayName: null, isBanned: false, tokenVersion: 0, displayNameReserved: false, displayName: null, googleSub: '', ...values } as ReaderRow)
          return [{ insertId: id }, []]
        },
      }),
    }),
  },
})
mock.module('../server/services/google-oauth-settings', {
  namedExports: { getUsableOAuthConfig: async () => ({ ok: true, clientId: 'portal-client-id', clientSecret: 'portal-client-secret' }) },
})
mock.module('../server/utils/google-oauth/config', {
  namedExports: {
    GOOGLE_TOKEN_ENDPOINT: 'https://oauth2.googleapis.com/token',
    resolveRedirectUri: () => 'https://portal.example.vn/api/auth/google/callback',
    // Imported by public-link-base (through the comments service); unused here.
    configuredBaseUrl: () => 'https://portal.example.vn',
    requestBase: () => 'https://portal.example.vn',
  },
})
mock.module('../server/services/ip-bans', { namedExports: { loadIpBanValues: async () => [] } })
mock.module('../server/utils/ip-ban', { namedExports: { isIpBanned: () => false } })
mock.module('../server/utils/client-ip', { namedExports: { getClientIp: () => '203.0.113.7' } })
mock.module('../server/utils/reader-auth', { namedExports: { setReaderCookie: (_event: unknown, ticket: string) => { cookies.push(ticket) } } })

const { issueState, stateSigningKey } = await import('../server/utils/google-oauth/state')
const { OAUTH_STATE_COOKIE } = await import('../server/utils/google-oauth/flow')

let idTokenClaims: Record<string, unknown> = {}
type Event = { query: Record<string, string>, cookies: Record<string, string>, headers: Record<string, string> }
const redirects: string[] = []
Object.assign(globalThis, {
  defineEventHandler: (handler: unknown) => handler,
  getQuery: (event: Event) => event.query,
  getCookie: (event: Event, name: string) => event.cookies[name],
  deleteCookie: () => {},
  getRequestHeader: (event: Event, name: string) => event.headers[name],
  sendRedirect: (_event: Event, location: string) => { redirects.push(location); return location },
  $fetch: async () => ({
    id_token: ['header', Buffer.from(JSON.stringify(idTokenClaims)).toString('base64url'), 'signature'].join('.'),
  }),
})

const callback = (await import('../server/api/auth/google/callback.get')).default as unknown as (event: Event) => Promise<string>
const { effectiveDisplayName, RESERVED_PROVIDER_NAME_FALLBACK } = await import('../server/utils/display-name')
const { serializePublicComment } = await import('../server/services/comments')
const { backfillReservedReaderNames } = await import('../server/db/reader-name-backfill')

async function signIn(sub: string, name: string): Promise<string> {
  currentSub = sub
  idTokenClaims = {
    iss: 'https://accounts.google.com',
    aud: 'portal-client-id',
    exp: Math.floor(Date.now() / 1000) + 600,
    sub,
    email: `${sub}@gmail.com`,
    name,
  }
  const state = issueState('/news/bai-viet', stateSigningKey())
  return callback({ query: { state, code: 'authorization-code' }, cookies: { [OAUTH_STATE_COOKIE]: state }, headers: { 'user-agent': 'test' } })
}

const shownName = (row: ReaderRow) => effectiveDisplayName(row)
const commentBy = (row: ReaderRow) => serializePublicComment({
  id: 1, articleId: 1, readerId: row.id, adminUserId: null, parentId: null, body: 'Xin hỏi', createdAt: null,
  readerName: row.displayName, readerCustomName: row.customDisplayName, readerNameReserved: row.displayNameReserved,
} as never, null)

beforeEach(() => {
  readers = []
  cookies.length = 0
  redirects.length = 0
})

test('spec: a reader whose Google name is "Admin" signs in, and their comments show "Bạn đọc"', async () => {
  const location = await signIn('google-sub-admin', 'Admin')
  assert.equal(location, '/news/bai-viet', 'sign-in did not complete')
  assert.equal(cookies.length, 1, 'no reader session was issued')

  const [row] = readers
  assert.equal(row!.displayName, 'Admin', 'the provider name is stored as Google sent it')
  assert.equal(row!.displayNameReserved, true)
  assert.equal(shownName(row!), 'Bạn đọc')
  assert.equal(RESERVED_PROVIDER_NAME_FALLBACK, 'Bạn đọc')
  assert.equal(commentBy(row!).authorName, 'Bạn đọc')
})

test('the same folding as reader-chosen names: diacritics, case, full-width, separators', async () => {
  for (const name of ['Ban Quản Trị', 'ＡＤＭＩＮ', 'Bộ Công an', 'C-11', 'Hỗ trợ Ban quản trị']) {
    readers = []
    await signIn(`sub-${name}`, name)
    assert.equal(readers[0]!.displayNameReserved, true, `${name} was not recognised as reserved`)
    assert.equal(commentBy(readers[0]!).authorName, 'Bạn đọc')
  }
})

test('an ordinary Google name is shown as it is', async () => {
  for (const name of ['Nguyễn Công An', 'Adminh Trần', 'Lê Thị Hoa']) {
    readers = []
    await signIn(`sub-${name}`, name)
    assert.equal(readers[0]!.displayNameReserved, false, `${name} was wrongly treated as reserved`)
    assert.equal(commentBy(readers[0]!).authorName, name)
  }
})

test('the flag follows the Google name on every sign-in, both ways', async () => {
  await signIn('returning', 'Admin')
  assert.equal(commentBy(readers[0]!).authorName, 'Bạn đọc')
  await signIn('returning', 'Phạm Văn Bình')
  assert.equal(readers.length, 1)
  assert.equal(readers[0]!.displayNameReserved, false)
  assert.equal(commentBy(readers[0]!).authorName, 'Phạm Văn Bình')
  await signIn('returning', 'Moderator')
  assert.equal(commentBy(readers[0]!).authorName, 'Bạn đọc')
})

test('a name the reader chose wins over the neutral name', async () => {
  await signIn('chooser', 'Admin')
  readers[0]!.customDisplayName = 'Bác Ba'
  assert.equal(shownName(readers[0]!), 'Bác Ba')
  assert.equal(commentBy(readers[0]!).authorName, 'Bác Ba')
})

test('existing readers are flagged once when the column is added (one-time conversion)', async () => {
  const rows = new Map<number, { display_name: string | null, display_name_reserved: number }>([
    [1, { display_name: 'Admin', display_name_reserved: 0 }],
    [2, { display_name: 'Nguyễn Văn A', display_name_reserved: 0 }],
    [3, { display_name: 'Ban quản trị viên', display_name_reserved: 0 }],
    [4, { display_name: null, display_name_reserved: 0 }],
  ])
  const statements: string[] = []
  const connection = {
    execute: async (statement: string, params: unknown[] = []) => {
      statements.push(statement)
      if (statement.startsWith('SELECT')) {
        return [[...rows].filter(([, row]) => row.display_name !== null).map(([id, row]) => ({ id, display_name: row.display_name })), []]
      }
      for (const id of params as number[]) rows.get(id)!.display_name_reserved = 1
      return [{ affectedRows: (params as number[]).length }, []]
    },
  }
  // "Ban quản trị viên" folds to "ban quan tri vien" — it starts with the reserved
  // "ban quan tri" and ends with the reserved "quan tri vien", as separate words.
  assert.equal(await backfillReservedReaderNames(connection as never), 2)
  assert.deepEqual([...rows].filter(([, row]) => row.display_name_reserved === 1).map(([id]) => id), [1, 3])
  assert.equal(rows.get(1)!.display_name, 'Admin', 'the Google name itself is never rewritten')
  assert.equal(statements.filter(sql => sql.startsWith('UPDATE')).length, 1, 'one batched UPDATE, parameterised ids')
})

test('the boot sequence adds the column and runs the backfill only when the column was just added', async () => {
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(new URL('../server/db/migrations-additive.ts', import.meta.url), 'utf8')
  assert.match(source, /const readerNameFlagExisted = await hasColumn\(db, database, 'reader_accounts', 'display_name_reserved'\)/)
  assert.match(source, /ensureColumn\(db, database, 'reader_accounts', 'display_name_reserved', 'TINYINT\(1\) NOT NULL DEFAULT 0/)
  assert.match(source, /if \(!readerNameFlagExisted\) await backfillReservedReaderNames\(db\)/)
})
