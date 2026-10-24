/**
 * Default seed lần đầu cho mỗi CSDL, xoá rồi thì xoá luôn — MySQL thật (wave2 D7).
 *
 * Container chạy `init.ts` → `seed.ts` ở MỖI lần khởi động (Dockerfile CMD). Bản cũ
 * thêm lại mọi default còn thiếu theo khoá tự nhiên mỗi lần đó: cán bộ xoá một luật
 * kiểm duyệt, một mạng xã hội, một danh mục — deploy kế tiếp nó quay lại. Thể loại và
 * danh mục bài viết còn được chèn từ chính tệp DDL (`schema-tables/core.ts`,
 * `content.ts`) trong `init.ts`.
 *
 * Nay mỗi nhóm default (`moderation_rules`, `social_links`, `media_categories`,
 * `content_types`, `categories`) có bộ default theo phiên bản, mỗi bộ đánh dấu một
 * lần trong `settings` (`seed.<nhóm>.v<N>.done`):
 *   - CSDL mới: mọi default được chèn MỘT lần, mọi bộ được đánh dấu;
 *   - default bị xoá: khởi động lại không chèn lại;
 *   - CSDL đã có dữ liệu nhưng chưa có dấu (bản trước bản vá): bảng có hàng → chỉ
 *     ghi dấu v1, không chèn gì;
 *   - bộ v2 thêm sau: tới CSDL đang chạy đúng một lần; default v1 đã xoá vẫn xoá.
 *
 * Khởi động y như container: `init.ts` rồi `seed.ts`, mỗi cái một tiến trình riêng.
 *
 *   SEED_MARKERS_INTEGRATION=1 SEED_MARKERS_PORT=33069 SEED_MARKERS_PASSWORD=... \
 *     node --experimental-strip-types --experimental-test-module-mocks \
 *     --import ./scripts/ts-resolver.mjs --test tests/seed-markers-integration.test.ts
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import test, { after } from 'node:test'
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise'

const enabled = process.env.SEED_MARKERS_INTEGRATION === '1'
const host = process.env.SEED_MARKERS_HOST || '127.0.0.1'
const port = Number(process.env.SEED_MARKERS_PORT || 3306)
const user = process.env.SEED_MARKERS_USER || 'root'
const password = process.env.SEED_MARKERS_PASSWORD || ''
const DB_NAME = `cdkt_seedmark_${Date.now()}_${process.pid}`
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const originalEnv = { ...process.env }
const BOOT_SECRETS = {
  JWT_SECRET: randomBytes(32).toString('hex'),
  CHATBOT_ENCRYPTION_SECRET: randomBytes(32).toString('base64'),
  ANALYTICS_HMAC_SECRET: randomBytes(32).toString('hex'),
}

/** Bảng của mỗi nhóm + cột khoá tự nhiên mà seed nhận ra một default. */
const GROUP_TABLES = {
  moderation_rules: { table: 'ai_moderation_rules', key: 'pattern' },
  social_links: { table: 'social_links', key: 'platform' },
  media_categories: { table: 'media_categories', key: 'slug' },
  content_types: { table: 'content_types', key: 'slug' },
  categories: { table: 'categories', key: 'slug' },
} as const
type GroupName = keyof typeof GROUP_TABLES

/** Một default của mỗi nhóm mà cán bộ "xoá" trong các ca dưới. */
const DELETED_DEFAULTS: Record<GroupName, string> = {
  moderation_rules: 'lừa đảo',
  social_links: 'YouTube',
  media_categories: 'video-tuyen-truyen',
  content_types: 'faq',
  categories: 'tin-dia-phuong',
}

function assertDisposableDatabase(name: string) {
  assert.match(name, /^cdkt_seedmark_\d+_\d+$/)
  assert.notEqual(name, 'cdkt_admin')
  if (originalEnv.DB_NAME) assert.notEqual(name, originalEnv.DB_NAME)
}

async function withConnection<T>(work: (conn: Connection) => Promise<T>): Promise<T> {
  assertDisposableDatabase(DB_NAME)
  const conn = await mysql.createConnection({ host, port, user, password, database: DB_NAME, dateStrings: true })
  try {
    return await work(conn)
  } finally {
    await conn.end()
  }
}

function runBootStep(script: 'server/db/init.ts' | 'server/db/seed.ts', extraEnv: Record<string, string> = {}) {
  assertDisposableDatabase(DB_NAME)
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--import', './scripts/ts-resolver.mjs', script],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 240_000,
      killSignal: 'SIGKILL',
      env: { ...originalEnv, DB_HOST: host, DB_PORT: String(port), DB_USER: user, DB_PASSWORD: password, DB_NAME, ...BOOT_SECRETS, ...extraEnv },
    },
  )
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
  assert.notEqual(result.signal, 'SIGKILL', `${script} timed out\n${output}`)
  assert.equal(result.status, 0, `${script} failed (exit ${result.status})\n${output}`)
}

/** Một lần khởi động container: `init.ts` rồi `seed.ts`. Mật khẩu admin sinh mỗi lượt, không in ra. */
async function boot() {
  runBootStep('server/db/init.ts')
  const { passwordRejectionMessage } = await import('../server/utils/password-policy.ts')
  let adminPassword = ''
  for (let attempt = 0; attempt < 5 && !adminPassword; attempt += 1) {
    const candidate = `Qx7#${randomBytes(12).toString('base64url')}`
    if (!passwordRejectionMessage(candidate, { username: 'admin' })) adminPassword = candidate
  }
  assert.ok(adminPassword)
  runBootStep('server/db/seed.ts', { ADMIN_PASSWORD: adminPassword, ADMIN_EMAIL: 'seedmark@example.test' })
}

/** `{ nhóm: [khoá tự nhiên…] }` — có lặp nếu một default bị chèn hai lần. */
async function groupKeys(): Promise<Record<GroupName, string[]>> {
  return withConnection(async (conn) => {
    const out = {} as Record<GroupName, string[]>
    for (const [group, { table, key }] of Object.entries(GROUP_TABLES) as Array<[GroupName, { table: string, key: string }]>) {
      const [rows] = await conn.query<RowDataPacket[]>(`SELECT \`${key}\` AS k FROM \`${table}\` ORDER BY \`${key}\`, id`)
      out[group] = rows.map(row => String(row.k))
    }
    return out
  })
}

async function markers(): Promise<Record<string, string>> {
  return withConnection(async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>("SELECT `key`, `value`, `group` FROM `settings` WHERE `key` LIKE 'seed.%' ORDER BY `key`")
    for (const row of rows) assert.equal(row.group, 'internal', `${row.key}: markers live in the internal settings group`)
    return Object.fromEntries(rows.map(row => [String(row.key), String(row.value)]))
  })
}

async function deleteDefaults(conn: Connection) {
  for (const [group, value] of Object.entries(DELETED_DEFAULTS) as Array<[GroupName, string]>) {
    const { table, key } = GROUP_TABLES[group]
    const [result] = await conn.query(`DELETE FROM \`${table}\` WHERE \`${key}\` = ?`, [value])
    assert.equal((result as { affectedRows: number }).affectedRows, 1, `${table}: the default ${value} was not there to delete`)
  }
}

after(async () => {
  if (!enabled) return
  try {
    const { closeDb } = await import('../server/utils/db.ts')
    await closeDb()
  } catch { /* the pool was never opened */ }
  const conn = await mysql.createConnection({ host, port, user, password })
  try {
    assertDisposableDatabase(DB_NAME)
    await conn.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``)
  } finally {
    await conn.end()
  }
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]
  Object.assign(process.env, originalEnv)
})

test('fresh database: every group\'s defaults are inserted once and every default set is marked', { skip: !enabled, timeout: 600_000 }, async () => {
  await boot()
  const { SEED_GROUPS, seedMarkerKey } = await import('../server/db/seed-groups.ts')
  const keys = await groupKeys()
  for (const group of SEED_GROUPS) {
    const expected = group.sets.flatMap(set => set.keys).sort()
    assert.deepEqual([...keys[group.name]].sort(), expected, `${group.name}: exactly the defaults, each once`)
  }
  const marked = await markers()
  const expectedMarkers = SEED_GROUPS.flatMap(group => group.sets.map(set => seedMarkerKey(group.name, set.version))).sort()
  assert.deepEqual(Object.keys(marked).sort(), expectedMarkers)
  // The stored format is pinned literally, independent of `seedMarkerKey`: a changed
  // format would leave every existing database unmarked and re-seed each group once.
  assert.deepEqual(Object.keys(marked).sort(), [
    'seed.categories.v1.done', 'seed.content_types.v1.done', 'seed.media_categories.v1.done',
    'seed.moderation_rules.v1.done', 'seed.social_links.v1.done',
  ])
  for (const value of Object.values(marked)) assert.ok(!Number.isNaN(Date.parse(value)), `marker value ${value} is an ISO time`)

  // Khởi động lần hai trên CSDL vừa seed: không thêm, không đổi gì.
  await boot()
  assert.deepEqual(await groupKeys(), keys)
  assert.deepEqual(await markers(), marked, 'markers are written once, never rewritten')
})

test('a default staff deleted stays deleted across a restart', { skip: !enabled, timeout: 600_000 }, async () => {
  const before = await groupKeys()
  await withConnection(deleteDefaults)
  await boot()
  const afterRestart = await groupKeys()
  for (const [group, value] of Object.entries(DELETED_DEFAULTS) as Array<[GroupName, string]>) {
    assert.ok(!afterRestart[group].includes(value), `${group}: the deleted default "${value}" came back on restart`)
    assert.deepEqual(afterRestart[group], before[group].filter(k => k !== value), `${group}: nothing else changed`)
  }
})

test('an existing database from before the markers (tables have rows, no markers): marked on first boot, nothing re-inserted', { skip: !enabled, timeout: 600_000 }, async () => {
  const before = await groupKeys()
  await withConnection(conn => conn.query("DELETE FROM `settings` WHERE `key` LIKE 'seed.%'"))
  await boot()
  assert.deepEqual(await groupKeys(), before, 'the bootstrap writes markers only')
  const { SEED_GROUPS, seedMarkerKey } = await import('../server/db/seed-groups.ts')
  assert.deepEqual(Object.keys(await markers()).sort(), SEED_GROUPS.flatMap(group => group.sets.map(set => seedMarkerKey(group.name, set.version))).sort())
})

test('a v2 default set reaches an existing database once; deleted v1 defaults stay deleted', { skip: !enabled, timeout: 120_000 }, async () => {
  Object.assign(process.env, { DB_HOST: host, DB_PORT: String(port), DB_USER: user, DB_PASSWORD: password, DB_NAME })
  const { getDb } = await import('../server/utils/db.ts')
  const { MODERATION_RULES_SEED, SOCIAL_LINKS_SEED, SEED_GROUPS, applySeedGroups, defineSeedGroup, seedMarkerKey } = await import('../server/db/seed-groups.ts')
  const db = getDb()
  const before = await groupKeys()

  const newRule = { category: 'spam_fraud', ruleType: 'keyword', pattern: 'mua bán tài khoản ngân hàng', action: 'auto_hide', severity: 'high' }
  // Cán bộ đã tự tạo đúng một default của v2 trước khi bản phát hành ra: không nhân đôi.
  const staffCreated = { platform: 'Threads', label: 'Threads C11 (cán bộ tạo)', url: 'https://threads.net/@c11', icon: 'fa-brands fa-threads', iconType: 'fontawesome', color: '#000000' }
  await withConnection(conn => conn.query(
    'INSERT INTO `social_links` (`platform`, `label`, `url`, `icon`, `icon_type`, `color`) VALUES (?, ?, ?, ?, ?, ?)',
    [staffCreated.platform, staffCreated.label, staffCreated.url, staffCreated.icon, staffCreated.iconType, staffCreated.color],
  ))
  const groups = SEED_GROUPS.map((group) => {
    if (group.name === 'moderation_rules') return defineSeedGroup({ ...MODERATION_RULES_SEED, sets: [...MODERATION_RULES_SEED.sets, { version: 2, rows: [newRule] }] })
    if (group.name === 'social_links') {
      return defineSeedGroup({ ...SOCIAL_LINKS_SEED, sets: [...SOCIAL_LINKS_SEED.sets, { version: 2, rows: [{ ...staffCreated, label: 'Threads C11' }, { platform: 'LinkedIn', label: 'LinkedIn C11', url: 'https://linkedin.com/company/c11', icon: 'fa-brands fa-linkedin', iconType: 'fontawesome', color: '#0a66c2' }] }] })
    }
    return group
  })

  const first = await applySeedGroups(db, groups)
  assert.deepEqual(
    first.filter(o => o.result !== 'skipped').map(o => [o.group, o.version, o.result, o.inserted]).sort(),
    [['moderation_rules', 2, 'seeded', 1], ['social_links', 2, 'seeded', 1]],
    'only the two new sets run; every v1 set is already marked',
  )
  const afterV2 = await groupKeys()
  assert.deepEqual([...afterV2.moderation_rules].sort(), [...before.moderation_rules, newRule.pattern].sort(), 'v1 rules as they were, plus the one v2 rule')
  assert.ok(!afterV2.moderation_rules.includes(DELETED_DEFAULTS.moderation_rules), 'the deleted v1 rule stays deleted')
  assert.deepEqual(afterV2.social_links.filter(p => p === 'Threads'), ['Threads'], 'a v2 default staff already created is not duplicated')
  assert.ok(afterV2.social_links.includes('LinkedIn'))
  assert.ok(!afterV2.social_links.includes(DELETED_DEFAULTS.social_links))
  const marked = await markers()
  assert.ok(marked[seedMarkerKey('moderation_rules', 2)] && marked[seedMarkerKey('social_links', 2)])

  // Lần hai (khởi động kế tiếp với cùng bộ v2): không chèn gì nữa.
  const second = await applySeedGroups(db, groups)
  assert.ok(second.every(o => o.result === 'skipped'), JSON.stringify(second))
  assert.deepEqual(await groupKeys(), afterV2)
})
