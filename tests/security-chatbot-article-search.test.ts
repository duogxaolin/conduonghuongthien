import assert from 'node:assert/strict'
import test from 'node:test'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import type { SQL } from 'drizzle-orm'
import { articleSearchKeywords, buildArticleSearch } from '../server/utils/chatbot/article-search'
import { escapeLikeWildcards } from '../server/utils/sql-like'
import { intervalDays } from '../server/utils/sql-literals'

/**
 * `search_c11_articles` nhận chuỗi tìm kiếm từ **model**, mà khách vãng lai dẫn
 * dắt được model bằng nội dung câu hỏi. Bản cũ ghép chuỗi đó vào
 * `sql.raw("... LIKE '%${cleanQ}%' ...")` sau khi chỉ loại `"` và `\` — dấu `'`
 * lọt qua, nên `x' OR SLEEP(5) -- ` thoát khỏi chuỗi LIKE và chạy như SQL
 * (blind injection, không cần đăng nhập). Các test dưới đây biên dịch truy vấn
 * sang SQL MySQL thật và kiểm một điều: giá trị người dùng chỉ ở trong tham số.
 */

const dialect = new MySqlDialect()
const compile = (expression: SQL) => dialect.sqlToQuery(expression)

function compiledSearch(query: string, type: string | null = null) {
  const plan = buildArticleSearch(query, type)
  return { where: compile(plan.where), order: plan.orderBy.map(compile) }
}

const PAYLOADS = [
  `x' OR SLEEP(5) -- `,
  `x') OR (SELECT SLEEP(5)) OR ('`,
  `' UNION SELECT password_hash FROM users -- `,
  `tái hòa nhập'; DROP TABLE articles; -- `,
  `\\' OR 1=1 -- `,
  `x" OR "1"="1`,
  `%' AND (SELECT 1 FROM users WHERE username='admin' AND SUBSTRING(password_hash,1,1)='$') AND '%'='`,
]

// Từ SQL nguy hiểm không bao giờ được xuất hiện trong chuỗi lệnh, kể cả khi người
// dùng gõ chúng — vì chuỗi lệnh chỉ chứa phần do chính mã nguồn viết.
const FORBIDDEN_IN_SQL = /SLEEP|UNION|DROP\s+TABLE|password_hash|SUBSTRING|OR 1=1/i

test('a payload typed by the visitor never reaches the SQL text', () => {
  for (const payload of PAYLOADS) {
    const { where, order } = compiledSearch(payload)
    for (const part of [where, ...order]) {
      assert.doesNotMatch(part.sql, FORBIDDEN_IN_SQL, `payload leaked into SQL: ${payload}\n${part.sql}`)
    }
  }
})

test('the ORDER BY carries no string literal at all, so there is nothing to break out of', () => {
  // Bản cũ có `LIKE '%…%'` ngay trong chuỗi lệnh. Giờ mọi chuỗi là `?`.
  for (const payload of [...PAYLOADS, 'tái hòa nhập', 'vay vốn ở đâu']) {
    const { order } = compiledSearch(payload)
    for (const part of order) {
      assert.ok(!part.sql.includes("'"), `a quote in the ORDER BY: ${part.sql}`)
      assert.ok(!part.sql.includes('"') || /`[^`]*`/.test(part.sql), part.sql)
    }
  }
})

test('keywords travel as bound parameters', () => {
  const { where, order } = compiledSearch('vay vốn tái hòa nhập')
  assert.ok(where.params.includes('%vay%'), 'the WHERE must bind the keyword')
  const rank = order[0]!
  assert.ok(rank.params.includes('%vay%') && rank.params.includes('%vốn%'), 'the relevance score must bind keywords too')
  assert.ok(rank.params.includes('%vay vốn tái hòa nhập%'), 'the whole phrase is bound for the exact-title bonus')
  // One placeholder per bound value: no value is spliced into the text.
  assert.equal((rank.sql.match(/\?/g) ?? []).length, rank.params.length)
})

test('a payload survives only as an escaped LIKE operand in params', () => {
  // The keyword extractor reduces it to letters and digits, so the quote and the
  // comment marker are gone before they could reach even a bound parameter...
  const keywords = articleSearchKeywords(PAYLOADS[0]!)
  assert.deepEqual(keywords, ['or', 'sleep'])
  for (const keyword of keywords) assert.match(keyword, /^[\p{L}\p{N}]+$/u, 'a keyword is letters and digits only')
  // ...and the whole-phrase parameter, which does keep the raw text, is data.
  const { order } = compiledSearch(PAYLOADS[0]!)
  const phrase = order[0]!.params.find(value => typeof value === 'string' && value.includes('SLEEP'.toLowerCase() + '(5)'))
  assert.ok(phrase, 'the raw phrase is only ever a bound value')
})

test('LIKE wildcards typed by the visitor stop being wildcards', () => {
  assert.equal(escapeLikeWildcards('100%_x\\y'), '100\\%\\_x\\\\y')
  const { where } = compiledSearch('%%%')
  // No keyword survives, so this takes the whole-query branch.
  assert.ok(where.params.includes('%\\%\\%\\%%'), `wildcards must be escaped: ${JSON.stringify(where.params)}`)
})

test('type filter and published-only guard are still applied', () => {
  const { where } = compiledSearch('gương hoàn lương', 'role_model')
  assert.match(where.sql, /`status` = \?/)
  assert.match(where.sql, /`type` = \?/)
  assert.ok(where.params.includes('published') && where.params.includes('role_model'))
  const without = compiledSearch('gương hoàn lương', null)
  assert.doesNotMatch(without.where.sql, /`type` = \?/)
})

test('ranking still prefers title matches and falls back to newest first', () => {
  const { order } = compiledSearch('xóa án tích')
  assert.equal(order.length, 2)
  assert.match(order[0]!.sql, /LOWER\(`articles`\.`title`\) LIKE \?/)
  assert.match(order[0]!.sql, /THEN 10 ELSE 0/)
  assert.match(order[0]!.sql, /THEN 3 ELSE 0/)
  assert.match(order[0]!.sql, /THEN 30 ELSE 0/)
  assert.match(order[0]!.sql, / DESC$/)
  assert.match(order[1]!.sql, /`published_at` desc/i)

  const empty = compiledSearch('')
  assert.equal(empty.order.length, 1, 'no query means newest first and nothing else')
})

test('chat-policy builds the article query through buildArticleSearch only', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('../server/utils/chatbot/chat-policy.ts', import.meta.url), 'utf8')
  assert.match(source, /buildArticleSearch\(rawQ, type\)/)
  assert.doesNotMatch(source, /sql\.raw/, 'no raw SQL may be assembled in the chatbot policy')
})

// ─── intervalDays ────────────────────────────────────────────────────────────

test('intervalDays accepts whole day counts and nothing else', () => {
  assert.equal(compile(intervalDays(0)).sql, '0')
  assert.equal(compile(intervalDays(90)).sql, '90')
  assert.equal(compile(intervalDays('30')).sql, '30', 'a numeric string is a number, not SQL')
  for (const bad of ['1 DAY) OR (SELECT SLEEP(5)', '1; DROP TABLE x', -1, 1.5, NaN, Infinity, 99_999, null, undefined, {}, [], '', '  ', true]) {
    assert.throws(() => intervalDays(bad), RangeError, `accepted ${String(bad)}`)
  }
})

// ─── Video and photo tools: same rule, same helper ───────────────────────────

test('video and photo tools bind the query as an escaped LIKE operand', async () => {
  const { photoSearchCondition, videoSearchCondition } = await import('../server/utils/chatbot/media-search')
  for (const [name, build] of [['video', videoSearchCondition], ['photo', photoSearchCondition]] as const) {
    const wild = compile(build('100%_x'))
    assert.ok(wild.params.includes('%100\\%\\_x%'), `${name}: % and _ must be escaped, got ${JSON.stringify(wild.params)}`)
    for (const payload of PAYLOADS) {
      const { sql } = compile(build(payload))
      assert.doesNotMatch(sql, FORBIDDEN_IN_SQL, `${name}: payload leaked into SQL: ${payload}`)
      assert.ok(!sql.includes("'") || /image\/%/.test(sql), `${name}: stray literal in ${sql}`)
    }
  }
})

test('a pathological query is cut to 200 characters before it is bound', async () => {
  const { videoSearchCondition } = await import('../server/utils/chatbot/media-search')
  const { params } = compile(videoSearchCondition('a'.repeat(5000)))
  const bound = params.filter((value): value is string => typeof value === 'string' && value.includes('a'))
  assert.ok(bound.length > 0 && bound.every(value => value.length <= 204), 'pattern length: %…% around at most 200 characters')
})

test('every LIKE in chat-policy goes through the shared helper', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('../server/utils/chatbot/chat-policy.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /like\([^)]*`%\$\{/, 'a LIKE pattern is assembled by hand again')
  assert.match(source, /videoSearchCondition\(/)
  assert.match(source, /photoSearchCondition\(/)
})
