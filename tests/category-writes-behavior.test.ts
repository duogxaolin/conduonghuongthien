/**
 * `POST /api/admin/categories` and `PUT /api/admin/categories/:id`, run for real through
 * `server/services/category-writes.ts`, on an in-memory SQLite `categories` table: every WHERE
 * the service builds is compiled with drizzle's MySQL dialect and run there (the harness of
 * tests/article-id-oracle-behavior.test.ts), so `parent_id IS NULL` versus `parent_id = NULL`
 * is decided by a real SQL engine, not by a stand-in.
 *
 * The bug: two categories with the same name in the same place were both accepted — the
 * second got the slug `-2` and the two "Tin nổi bật" could not be told apart. Now the name must
 * be free among its siblings (same parent; for a root, the roots of the same type), compared
 * without case, accents, `đ` or extra spaces; the refusal is a 409 with a Vietnamese sentence,
 * and nothing is written. Same names in different places stay allowed.
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, it, mock } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { getTableColumns, type SQL } from 'drizzle-orm'
import { MySqlDialect } from 'drizzle-orm/mysql-core'

const { categories } = await import('../server/db/schema')

const sqlite = new DatabaseSync(':memory:')
sqlite.exec(`CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, parent_id INTEGER,
  type TEXT NOT NULL, description TEXT, display_order INTEGER NOT NULL DEFAULT 0, created_at TEXT
)`)
const dialect = new MySqlDialect()
const COLUMNS = getTableColumns(categories)
const columnName = (key: string) => (COLUMNS as Record<string, { name: string }>)[key]!.name
const toRow = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(COLUMNS).map(([key, column]) => [key, row[column.name] ?? null]))

const sent: string[] = []
/** Called right before each INSERT, with the attempt number — a test can let "another request" commit there. */
let beforeInsert: ((attempt: number) => void) | null = null
let inserts = 0

function run(where: SQL | undefined) {
  if (!where) return { sql: '1 = 1', params: [] as unknown[] }
  const query = dialect.sqlToQuery(where)
  sent.push(query.sql)
  return { sql: query.sql, params: query.params }
}
function select(projection?: Record<string, { name: string }>) {
  let where: SQL | undefined
  let limit: number | undefined
  const rows = () => {
    const q = run(where)
    const found = sqlite.prepare(`SELECT * FROM categories WHERE ${q.sql}${limit ? ` LIMIT ${limit}` : ''}`).all(...q.params as never[]) as Record<string, unknown>[]
    return found.map(raw => {
      const row = toRow(raw)
      return projection ? Object.fromEntries(Object.keys(projection).map(key => [key, row[key]])) : row
    })
  }
  const builder = {
    from: () => builder,
    where: (w: SQL | undefined) => { where = w; return builder },
    limit: (n: number) => { limit = n; return builder },
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => { try { return Promise.resolve(rows()).then(resolve, reject) } catch (e) { return reject(e) } },
  }
  return builder
}
function sqliteError(err: unknown): never {
  if (String((err as Error).message).includes('UNIQUE')) throw Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY', errno: 1062 })
  throw err
}
const tx = {
  select,
  insert: () => ({
    values: async (values: Record<string, unknown>) => {
      inserts += 1
      beforeInsert?.(inserts)
      const keys = Object.keys(values)
      try {
        const info = sqlite.prepare(`INSERT INTO categories (${keys.map(columnName).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map(k => values[k] ?? null) as never[])
        return [{ insertId: Number(info.lastInsertRowid), affectedRows: 1 }]
      } catch (err) { sqliteError(err) }
    },
  }),
  update: () => ({
    set: (fields: Record<string, unknown>) => ({
      where: async (where: SQL) => {
        const q = run(where)
        const keys = Object.keys(fields)
        sent.push(`update ${keys.join(',')}`)
        try {
          sqlite.prepare(`UPDATE categories SET ${keys.map(k => `${columnName(k)} = ?`).join(', ')} WHERE ${q.sql}`).run(...keys.map(k => fields[k] ?? null) as never[], ...q.params as never[])
        } catch (err) { sqliteError(err) }
      },
    }),
  }),
}
let transactions = 0
// The pool itself offers only `transaction`: a check (or the write) moved out of the transaction
// throws here instead of passing on the same table.
const db = {
  transaction: async <T>(work: (t: typeof tx) => Promise<T>): Promise<T> => {
    transactions += 1
    sqlite.exec('BEGIN')
    try {
      const out = await work(tx)
      sqlite.exec('COMMIT')
      return out
    } catch (err) {
      sqlite.exec('ROLLBACK')
      throw err
    }
  },
}
mock.module('../server/utils/db', { namedExports: { getDb: () => db } })

const translated: unknown[][] = []
mock.module('../server/services/i18n-auto-translate', {
  namedExports: {
    autoTranslateCategory: async (...args: unknown[]) => { translated.push(['create', ...args.slice(1)]) },
    autoTranslateCategoryUpdate: async (...args: unknown[]) => { translated.push(['update', ...args.slice(1)]) },
  },
})

type Event = { body: unknown, params: Record<string, string>, context: { adminUser: unknown } }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.readBody = async (event: Event) => event.body
globals.getRouterParam = (event: Event, key: string) => event.params[key]
globals.createError = (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input)

const postCategory = (await import('../server/api/admin/categories/index.post')).default as unknown as (event: Event) => Promise<{ ok: true, id: number, slug: string }>
const putCategory = (await import('../server/api/admin/categories/[id].put')).default as unknown as (event: Event) => Promise<{ ok: true, slug?: string }>
const { categoryNameKey } = await import('../server/services/category-writes')

const editor = { id: 7, isSuperAdmin: false, permissions: [{ resource: 'categories', canCreate: true, canRead: true, canUpdate: true, canDelete: false }] }
const create = (body: Record<string, unknown>) => postCategory({ body, params: {}, context: { adminUser: editor } })
const update = (id: number, body: Record<string, unknown>) => putCategory({ body, params: { id: String(id) }, context: { adminUser: editor } })
async function refusal(work: () => Promise<unknown>): Promise<{ statusCode?: number, statusMessage?: string } | null> {
  try { await work(); return null } catch (err) { return err as { statusCode?: number, statusMessage?: string } }
}
const all = () => (sqlite.prepare('SELECT id, name, slug, parent_id AS parentId, type FROM categories ORDER BY id').all() as Record<string, unknown>[]).map(r => ({ ...r }))
const seed = (id: number, name: string, slug: string, parentId: number | null, type = 'news') =>
  sqlite.prepare('INSERT INTO categories (id, name, slug, parent_id, type) VALUES (?, ?, ?, ?, ?)').run(id, name, slug, parentId, type)

beforeEach(() => {
  sqlite.exec('DELETE FROM categories')
  sent.length = 0
  translated.length = 0
  beforeInsert = null
  inserts = 0
  transactions = 0
  seed(1, 'Tin nổi bật', 'tin-noi-bat', null)
  seed(2, 'Thông báo', 'thong-bao', null)
  seed(3, 'Tin trong ngày', 'tin-trong-ngay', 1)
  seed(4, 'Đào tạo nghề', 'dao-tao-nghe', 1)
  seed(5, 'Văn bản', 'van-ban', null, 'document')
})

describe('category names are unique among siblings (create)', () => {
  for (const [name, why] of [
    ['Tin trong ngày', 'the same'],
    ['TIN TRONG NGÀY', 'another case'],
    ['tin trong ngay', 'no accents'],
    ['  Tin   trong  ngày ', 'extra spaces'],
    ['dao tao nghe', '"đ" typed as "d"'],
    ['ĐÀO TẠO NGHỀ', 'capital Đ'],
  ] as const) {
    it(`a child named like a sibling (${why}) is refused 409 with the sentence, and nothing is written`, async () => {
      const before = all()
      const err = await refusal(() => create({ name, type: 'news', parentId: 1 }))
      assert.equal(err?.statusCode, 409)
      assert.match(String(err?.statusMessage), /^Đã có danh mục cùng tên trong mục này: “(Tin trong ngày|Đào tạo nghề)”\.$/)
      assert.deepEqual(all(), before)
      assert.deepEqual(translated, [])
    })
  }

  it('a root named like a root of the same type is refused (the roots of a type are siblings)', async () => {
    const err = await refusal(() => create({ name: 'tin NOI bat', type: 'news' }))
    assert.equal(err?.statusCode, 409)
    assert.equal(err?.statusMessage, 'Đã có danh mục cùng tên trong mục này: “Tin nổi bật”.')
  })

  it('the same name elsewhere is allowed: under another parent, as a root, as a root of another type', async () => {
    const underOther = await create({ name: 'Tin trong ngày', type: 'news', parentId: 2 })
    assert.equal(underOther.slug, 'tin-trong-ngay-2')
    const asRoot = await create({ name: 'Tin trong ngày', type: 'news' })
    assert.equal(asRoot.slug, 'tin-trong-ngay-3')
    const otherType = await create({ name: 'Tin nổi bật', type: 'document' })
    assert.equal(otherType.slug, 'tin-noi-bat-2')
    // A child named like a root of its own type is not its sibling either.
    const childLikeRoot = await create({ name: 'Văn bản', type: 'news', parentId: 2 })
    assert.equal(childLikeRoot.slug, 'van-ban-2')
    assert.deepEqual(all().slice(5).map(r => [r.name, r.parentId, r.type]), [
      ['Tin trong ngày', 2, 'news'], ['Tin trong ngày', null, 'news'], ['Tin nổi bật', null, 'document'], ['Văn bản', 2, 'news'],
    ])
    assert.equal(translated.length, 4, 'each create still starts its translation, after the commit')
  })

  it('punctuation still counts: "Tin & nổi bật" is not "Tin nổi bật"', async () => {
    const created = await create({ name: 'Tin & nổi bật', type: 'news' })
    assert.equal(created.slug, 'tin-noi-bat-2')
  })

  it('the checks and the insert run in one transaction, the existing rules first (empty name, bad parent: their own sentences)', async () => {
    await create({ name: 'Mới', type: 'news', parentId: 1 })
    assert.equal(transactions, 1)
    assert.equal((await refusal(() => create({ name: '', type: 'news' })))?.statusMessage, 'Tên danh mục không được để trống.')
    assert.equal((await refusal(() => create({ name: 'X', type: '' })))?.statusMessage, 'Loại danh mục không được để trống.')
    assert.equal((await refusal(() => create({ name: 'X', type: 'news', parentId: 99 })))?.statusMessage, 'Danh mục cha không tồn tại.')
    assert.equal((await refusal(() => create({ name: 'X', type: 'news', parentId: 3 })))?.statusMessage, 'Chỉ cho phép 1 cấp cha-con. Không thể chọn danh mục con làm cha.')
  })

  it('a root\'s siblings are found with `parent_id is null` (never `= null`, which matches nothing)', async () => {
    await refusal(() => create({ name: 'Tin nổi bật', type: 'news' }))
    assert.ok(sent.some(q => /`categories`\.`parent_id` is null and `categories`\.`type` = \?/.test(q)), sent.join('\n'))
  })

  /** "Another request" commits a row between this one's checks (reads only, so far) and its insert. */
  const competitorCommits = (id: number, name: string, slug: string, parentId: number) => {
    sqlite.exec('COMMIT')
    seed(id, name, slug, parentId)
    sqlite.exec('BEGIN')
  }

  it('a create that loses the race on the slug is run again, and then sees the winner: 409, not a 500', async () => {
    beforeInsert = (attempt) => { if (attempt === 1) competitorCommits(50, 'Lịch công tác', 'lich-cong-tac', 2) }
    const err = await refusal(() => create({ name: 'Lịch công tác', type: 'news', parentId: 2 }))
    assert.equal(err?.statusCode, 409)
    assert.equal(err?.statusMessage, 'Đã có danh mục cùng tên trong mục này: “Lịch công tác”.')
    assert.equal(transactions, 2)
    assert.equal(all().filter(r => r.name === 'Lịch công tác').length, 1)
  })

  it('a slug taken meanwhile under another parent: the retry takes the next free slug and succeeds', async () => {
    beforeInsert = (attempt) => { if (attempt === 1) competitorCommits(51, 'Lịch công tác', 'lich-cong-tac', 1) }
    const created = await create({ name: 'Lịch công tác', type: 'news', parentId: 2 })
    assert.equal(created.slug, 'lich-cong-tac-2')
    assert.equal(transactions, 2)
  })

  it('a unique-key error that keeps coming back is not retried for ever (three attempts, then it surfaces)', async () => {
    beforeInsert = () => { throw Object.assign(new Error('Duplicate entry'), { errno: 1062 }) }
    const err = await refusal(() => create({ name: 'Bất kỳ', type: 'news' }))
    assert.equal((err as { errno?: number } | null)?.errno, 1062)
    assert.equal(transactions, 3)
  })
})

describe('category names are unique among siblings (update)', () => {
  it('renaming to a sibling\'s name (any case/accents) is refused 409; nothing changes', async () => {
    const before = all()
    const err = await refusal(() => update(4, { name: 'tin TRONG ngay' }))
    assert.equal(err?.statusCode, 409)
    assert.equal(err?.statusMessage, 'Đã có danh mục cùng tên trong mục này: “Tin trong ngày”.')
    assert.deepEqual(all(), before)
    assert.deepEqual(translated, [])
  })

  it('changing only the case or accents of its own name passes (the row itself is not a sibling)', async () => {
    const res = await update(3, { name: 'TIN TRONG NGÀY' })
    assert.deepEqual(res, { ok: true, slug: 'tin-trong-ngay' })
    assert.equal(all().find(r => r.id === 3)?.name, 'TIN TRONG NGÀY')
    assert.deepEqual(translated, [['update', 'tin-trong-ngay', 'TIN TRONG NGÀY', null]])
  })

  it('moving under a parent that already has a child of that name is refused, even with no rename', async () => {
    seed(6, 'Tin trong ngày', 'tin-trong-ngay-2', 2)
    const err = await refusal(() => update(6, { parentId: 1 }))
    assert.equal(err?.statusCode, 409)
    assert.equal(all().find(r => r.id === 6)?.parentId, 2)
  })

  it('making a child a root of a type that has a root of that name is refused; a free place is fine', async () => {
    seed(7, 'Thông báo', 'thong-bao-2', 1)
    assert.equal((await refusal(() => update(7, { parentId: null })))?.statusCode, 409)
    assert.deepEqual(await update(7, { parentId: null, type: 'document' }), { ok: true, slug: 'thong-bao-2' })
    assert.deepEqual(all().find(r => r.id === 7), { id: 7, name: 'Thông báo', slug: 'thong-bao-2', parentId: null, type: 'document' })
  })

  it('changing a root\'s type to one that has a root of that name is refused', async () => {
    const err = await refusal(() => update(5, { type: 'news', name: 'Tin nổi bật' }))
    assert.equal(err?.statusCode, 409)
    assert.equal((await refusal(() => update(5, { type: 'news' })))?.statusCode, undefined, '"Văn bản" is free among the news roots')
  })

  it('the existing rules and sentences are unchanged: 404, empty name, own parent, child as parent, parent of a parent', async () => {
    assert.equal((await refusal(() => update(99, { name: 'X' })))?.statusCode, 404)
    assert.equal((await refusal(() => update(3, { name: '  ' })))?.statusMessage, 'Tên danh mục không được để trống.')
    assert.equal((await refusal(() => update(1, { parentId: 1 })))?.statusMessage, 'Không thể đặt danh mục làm cha của chính nó.')
    assert.equal((await refusal(() => update(2, { parentId: 3 })))?.statusMessage, 'Chỉ cho phép 1 cấp cha-con.')
    assert.equal((await refusal(() => update(1, { parentId: 2 })))?.statusMessage, 'Không thể đặt danh mục cha cho danh mục đã có con.')
    assert.deepEqual(await update(2, {}), { ok: true })
  })
})

/**
 * Verifier F1 (CRITICAL): the page (`pages/admin/content/categories/index.vue`, `handleSave`)
 * sends EVERY field on every save — name, slug (the row's own, unless typed), type,
 * description, parentId, displayOrder. A check run whenever name/type/parent were SENT refused
 * every save of a duplicate pair stored before the check (409 on MySQL; the base answered 200).
 * These edits are sent exactly as the page sends them.
 */
describe('edits as the categories page sends them (the full body of handleSave)', () => {
  type Row = { id: number, name: string, slug: string, parentId: number | null, type: string, description: string | null, displayOrder: number }
  const rowOf = (id: number) => {
    const r = sqlite.prepare('SELECT id, name, slug, parent_id AS parentId, type, description, display_order AS displayOrder FROM categories WHERE id = ?').get(id) as Row
    return { ...r }
  }
  /** What the edit modal sends for a row (its fields as loaded), with what the officer changed. */
  const pageSave = (id: number, change: Partial<Omit<Row, 'id'>> = {}) => {
    const r = rowOf(id)
    return update(id, {
      name: r.name, slug: r.slug, type: r.type, description: r.description || null, parentId: r.parentId || null, displayOrder: r.displayOrder, ...change,
    })
  }

  for (const [kind, id, dup] of [['root', 9, () => seed(9, 'tin nổi bật', 'tin-noi-bat-cu', null)], ['child', 8, () => seed(8, 'tin trong ngày', 'tin-trong-ngay-cu', 1)]] as const) {
    it(`a ${kind} duplicate stored before the check: description, order and slug still save (200)`, async () => {
      dup() // written before this check existed — a duplicate of #1 / #3
      assert.deepEqual(await pageSave(id, { description: 'Mô tả mới' }), { ok: true, slug: rowOf(id).slug })
      assert.equal(rowOf(id).description, 'Mô tả mới')
      assert.deepEqual(await pageSave(id, { displayOrder: 7 }), { ok: true, slug: rowOf(id).slug })
      assert.equal(rowOf(id).displayOrder, 7)
      const moved = await pageSave(id, { slug: `${kind}-moi` })
      assert.deepEqual(moved, { ok: true, slug: `${kind}-moi` })
      assert.equal(rowOf(id).slug, `${kind}-moi`)
      // Its own case/accents may change too: the key is the same, nothing new is duplicated.
      assert.deepEqual(await pageSave(id, { name: rowOf(id).name.toUpperCase() }), { ok: true, slug: `${kind}-moi` })
    })
  }

  it('renaming to a sibling\'s name is refused (409), the row unchanged', async () => {
    const before = rowOf(4)
    const err = await refusal(() => pageSave(4, { name: 'TIN TRONG NGAY' }))
    assert.equal(err?.statusCode, 409)
    assert.equal(err?.statusMessage, 'Đã có danh mục cùng tên trong mục này: “Tin trong ngày”.')
    assert.deepEqual(rowOf(4), before)
  })

  it('moving a root to another type where a root has that name is refused (409) — the type alone, name unchanged', async () => {
    seed(11, 'văn bản', 'van-ban-tin', null, 'news') // not a duplicate: "Văn bản" (#5) is a root of `document`
    assert.deepEqual(await pageSave(11, { description: 'ok' }), { ok: true, slug: 'van-ban-tin' })
    const err = await refusal(() => pageSave(11, { type: 'document' }))
    assert.equal(err?.statusCode, 409)
    assert.equal(err?.statusMessage, 'Đã có danh mục cùng tên trong mục này: “Văn bản”.')
    assert.equal(rowOf(11).type, 'news')
    assert.deepEqual(await pageSave(11, { type: 'faq' }), { ok: true, slug: 'van-ban-tin' }, 'a type with no such root is fine')
  })

  it('moving a child under a parent that has a child of that name is refused (409); a child\'s type alone does not move it', async () => {
    seed(6, 'Tin trong ngày', 'tin-trong-ngay-2', 2)
    const err = await refusal(() => pageSave(6, { parentId: 1 }))
    assert.equal(err?.statusCode, 409)
    assert.equal(rowOf(6).parentId, 2)
    // A child's place is its parent: a duplicate child pair stays editable when only its type changes.
    seed(8, 'tin trong ngày', 'tin-trong-ngay-cu', 1)
    assert.deepEqual(await pageSave(8, { type: 'document' }), { ok: true, slug: 'tin-trong-ngay-cu' })
  })

  it('making a duplicate child a root where its type has that name is refused', async () => {
    seed(7, 'Thông báo', 'thong-bao-2', 1)
    assert.equal((await refusal(() => pageSave(7, { parentId: null })))?.statusCode, 409)
  })
})

describe('the request body: what used to be a 500 or stored as text is a 400', () => {
  const longName = 'a'.repeat(256)
  it('a name that is not a string: PUT `name: null` used to be stored as "null"', async () => {
    assert.equal((await refusal(() => update(3, { name: null })))?.statusMessage, 'Tên danh mục phải là chuỗi ký tự.')
    assert.equal((await refusal(() => update(3, { name: 42 })))?.statusMessage, 'Tên danh mục phải là chuỗi ký tự.')
    assert.equal((await refusal(() => create({ name: { x: 1 }, type: 'news' })))?.statusMessage, 'Tên danh mục phải là chuỗi ký tự.')
    assert.equal((await refusal(() => create({ name: null, type: 'news' })))?.statusMessage, 'Tên danh mục không được để trống.')
    assert.equal(all().find(r => r.id === 3)?.name, 'Tin trong ngày')
  })

  it('a name over 255 characters (VARCHAR(255)), an explicit slug over 255, a type over 32: 400, not 500', async () => {
    assert.equal((await refusal(() => create({ name: longName, type: 'news' })))?.statusMessage, 'Tên danh mục tối đa 255 ký tự.')
    assert.equal((await refusal(() => update(3, { name: longName })))?.statusMessage, 'Tên danh mục tối đa 255 ký tự.')
    assert.equal((await refusal(() => create({ name: 'X', type: 'news', slug: 'b'.repeat(300) })))?.statusMessage, 'Đường dẫn (slug) tối đa 255 ký tự.')
    assert.equal((await refusal(() => update(3, { slug: 'b'.repeat(300) })))?.statusMessage, 'Đường dẫn (slug) tối đa 255 ký tự.')
    assert.equal((await refusal(() => create({ name: 'X', type: 't'.repeat(33) })))?.statusMessage, 'Loại danh mục không hợp lệ.')
    // 255 Vietnamese characters are 255, not their UTF-16 or byte length.
    assert.equal((await create({ name: 'đ'.repeat(255), type: 'news' })).slug, 'd'.repeat(255))
    assert.equal(all().length, 6)
  })

  it('a parent that is not an id (`\'abc\'`, -1, 1.5): 400; digits as text are an id; empty means no parent', async () => {
    for (const parentId of ['abc', -1, 1.5, '1x', true]) {
      assert.equal((await refusal(() => create({ name: 'X', type: 'news', parentId })))?.statusMessage, 'Danh mục cha không hợp lệ.', String(parentId))
      assert.equal((await refusal(() => update(2, { parentId })))?.statusMessage, 'Danh mục cha không hợp lệ.', String(parentId))
    }
    assert.equal(all().find(r => r.id === 2)?.parentId, null)
    const child = await create({ name: 'Con bằng chữ số', type: 'news', parentId: '2' })
    assert.equal(all().find(r => r.id === child.id)?.parentId, 2)
    const root = await create({ name: 'Gốc', type: 'news', parentId: '' })
    assert.equal(all().find(r => r.id === root.id)?.parentId, null)
  })

  it('an order that is not a number: 400; digits as text are taken', async () => {
    assert.equal((await refusal(() => create({ name: 'X', type: 'news', displayOrder: 'abc' })))?.statusMessage, 'Thứ tự hiển thị phải là một số.')
    assert.equal((await refusal(() => update(2, { displayOrder: 'abc' })))?.statusMessage, 'Thứ tự hiển thị phải là một số.')
    assert.equal((await refusal(() => update(2, { displayOrder: 1e12 })))?.statusMessage, 'Thứ tự hiển thị phải là một số.')
    await update(2, { displayOrder: '3' })
    assert.equal((sqlite.prepare('SELECT display_order AS o FROM categories WHERE id = 2').get() as { o: number }).o, 3)
  })
})

describe('categoryNameKey', () => {
  it('ignores case, Vietnamese accents, đ/Đ and spacing; keeps punctuation and digits', () => {
    assert.equal(categoryNameKey('  Đào   TẠO nghề '), 'dao tao nghe')
    assert.equal(categoryNameKey('Tin nổi bật'), categoryNameKey('TIN NOI BAT'))
    assert.equal(categoryNameKey('Ảnh hoạt động'), 'anh hoat dong')
    assert.notEqual(categoryNameKey('Tin & Sự kiện'), categoryNameKey('Tin Sự kiện'))
    assert.notEqual(categoryNameKey('Quý 1'), categoryNameKey('Quý 2'))
  })

  it('ignores invisible characters and the look-alike Eth (Ð, ð) — both slipped past the check', async () => {
    // Built from code points: the source holds no invisible character.
    const zwsp = String.fromCodePoint(0x200b), bom = String.fromCodePoint(0xfeff), shy = String.fromCodePoint(0xad), wj = String.fromCodePoint(0x2060)
    assert.equal(categoryNameKey(`Tin${zwsp} trong${bom} ngày${shy}${wj}`), 'tin trong ngay')
    assert.equal(categoryNameKey('ÐÀO TẠO NGHỀ'), 'dao tao nghe')
    assert.equal(categoryNameKey('ðào tạo nghề'), 'dao tao nghe')
    const viaZw = await refusal(() => create({ name: `Tin trong${zwsp} ngày`, type: 'news', parentId: 1 }))
    assert.equal(viaZw?.statusCode, 409)
    const viaEth = await refusal(() => create({ name: 'ÐÀO TẠO NGHỀ', type: 'news', parentId: 1 }))
    assert.equal(viaEth?.statusCode, 409)
  })
})
