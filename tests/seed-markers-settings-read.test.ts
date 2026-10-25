/**
 * Dấu seed (`seed.<nhóm>.v<N>.done`, wave2 D7) nằm trong bảng `settings` nhưng KHÔNG
 * bao giờ đi qua API cài đặt: không lượt đọc nào trả chúng (allowlist khoá), không
 * lượt ghi nào nhận chúng (`ALLOWED_SETTING_KEYS`). Cán bộ không xoá nhầm được qua
 * trang cài đặt — xoá dấu là thao tác vận hành có chủ đích (`production/README.md`).
 *
 * Chạy các handler THẬT trên một bảng `settings` trong bộ nhớ có sẵn hàng dấu; cộng
 * vài bất biến thuần của `seed-groups.ts` (định dạng khoá, bộ default hợp lệ).
 */
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

const MARKERS = ['seed.moderation_rules.v1.done', 'seed.social_links.v1.done', 'seed.categories.v1.done']
const store = new Map<string, string | null>([
  ['site_name', 'Con Đường Hướng Thiện'],
  ['hotline', '0912345678'],
  ['backup_keep_count', '14'],
  ...MARKERS.map(key => [key, '2026-10-24T00:00:00.000Z'] as [string, string]),
])
const written: string[] = []
const tx = {
  insert: () => ({
    values: (value: Record<string, unknown>) => {
      if ('action' in value) return Promise.resolve()
      written.push(String(value.key))
      return { onDuplicateKeyUpdate: async () => { store.set(String(value.key), String(value.value)) } }
    },
  }),
}
mock.module('../server/utils/db', {
  namedExports: {
    // `where` is accepted and ignored: the handlers must not rely on the query alone.
    getDb: () => ({
      select: () => ({
        from: () => {
          const rows = async () => [...store].map(([key, value]) => ({ key, value, type: 'string', group: key.startsWith('seed.') ? 'internal' : 'general' }))
          return Object.assign(rows(), { where: () => rows() })
        },
      }),
      transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    }),
  },
})
mock.module('../server/utils/permissions', {
  namedExports: { requireResourcePermission: () => {}, requireSuperAdmin: () => {} },
})
type Event = { body?: unknown, context: Record<string, unknown> }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.readBody = async (event: Event) => event.body
globals.createError = (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input)

type SettingsResponse = { ok: boolean, settings: Record<string, string | null> }
const adminGet = (await import('../server/api/admin/settings/index.get')).default as unknown as (event: Event) => Promise<SettingsResponse>
const adminPut = (await import('../server/api/admin/settings/index.put')).default as unknown as (event: Event) => Promise<unknown>
const backupGet = (await import('../server/api/admin/settings/backup.get')).default as unknown as (event: Event) => Promise<SettingsResponse>
const publicGet = (await import('../server/api/public/settings.get')).default as unknown as (event: Event) => Promise<SettingsResponse>
const { SEED_GROUPS, defineSeedGroup, isSeedMarkerKey, seedMarkerKey, MODERATION_RULES_SEED } = await import('../server/db/seed-groups.ts')

const SUPERADMIN = { id: 1, isSuperAdmin: true }
const as = (adminUser: unknown, body?: unknown): Event => ({ body, context: { adminUser } })

test('no settings read returns a seed marker', async () => {
  for (const [name, read] of [['admin', adminGet], ['backup', backupGet], ['public', publicGet]] as const) {
    const response = await read(as(SUPERADMIN))
    const keys = Object.keys(response.settings)
    assert.ok(keys.length > 0, `${name}: the read returned nothing — the fixture is wrong`)
    assert.deepEqual(keys.filter(isSeedMarkerKey), [], `${name} settings read leaked a seed marker`)
  }
})

test('the settings write refuses a seed marker key', async () => {
  for (const key of [MARKERS[0]!, 'seed.anything.v9.done']) {
    await assert.rejects(
      () => adminPut(as(SUPERADMIN, { settings: { [key]: '' } })),
      (err: unknown) => (err as { statusCode?: number }).statusCode === 400,
    )
  }
  assert.deepEqual(written.filter(isSeedMarkerKey), [])
  assert.equal(store.get(MARKERS[0]!), '2026-10-24T00:00:00.000Z', 'the marker is untouched')
})

test('marker keys: one per group and version, all under the seed. prefix', () => {
  assert.equal(seedMarkerKey('moderation_rules', 1), 'seed.moderation_rules.v1.done')
  assert.deepEqual(SEED_GROUPS.map(group => group.name).sort(), ['categories', 'content_types', 'media_categories', 'moderation_rules', 'social_links'])
  for (const group of SEED_GROUPS) {
    assert.ok(group.sets.some(set => set.version === 1), `${group.name} has no v1`)
    for (const set of group.sets) assert.ok(isSeedMarkerKey(seedMarkerKey(group.name, set.version)))
    const keys = group.sets.flatMap(set => set.keys)
    assert.equal(new Set(keys).size, keys.length, `${group.name}: a default key appears twice`)
    assert.ok(keys.length > 0)
  }
  assert.equal(isSeedMarkerKey('site_name'), false)
})

test('a later default set may only add new keys, and every group needs v1', () => {
  const v1 = MODERATION_RULES_SEED.sets[0]!
  assert.throws(() => defineSeedGroup({ ...MODERATION_RULES_SEED, sets: [v1, { version: 2, rows: [v1.rows[0]!] }] }), /appears twice/)
  assert.throws(() => defineSeedGroup({ ...MODERATION_RULES_SEED, sets: [{ version: 2, rows: v1.rows }] }), /v1 is missing/)
  assert.throws(() => defineSeedGroup({ ...MODERATION_RULES_SEED, sets: [v1, { version: 1, rows: [] }] }), /distinct/)
})
