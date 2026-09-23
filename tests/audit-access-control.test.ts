import assert from 'node:assert/strict'
import { after, test, mock } from 'node:test'
import { createServer } from 'node:http'
import * as h3 from 'h3'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import { PERMISSION_RESOURCES, PERMISSION_ACTIONS, rolePermissionMatrix } from '../shared/permissions.ts'
import { roles, permissions, articles } from '../server/db/schema.ts'

Object.assign(globalThis, {
  defineEventHandler: h3.defineEventHandler, readBody: h3.readBody,
  getRouterParam: h3.getRouterParam, getQuery: h3.getQuery, createError: h3.createError,
})

let selectedArticle = { id: 42, type: 'document', title: 'Restricted draft' }
const writes: Array<{ table: unknown, values: any }> = []
const scopes: Array<{ sql: string, params: unknown[] }> = []
const dialect = new MySqlDialect()
let transactions = 0
const db = {
  select(selection?: any) {
    let table: unknown
    const chain: any = {
      from(value: unknown) { table = value; return chain },
      leftJoin() { return chain }, innerJoin() { return chain },
      where(scope: any) { if (scope) scopes.push(dialect.sqlToQuery(scope)); return chain },
      orderBy() { return chain }, groupBy() { return chain }, limit() { return chain }, offset() { return chain },
      then(resolve: any) {
        const rows = table === roles ? [{ id: 42, name: 'Editor', isSystem: false }]
          : selection?.total ? [{ total: 0 }]
          : selection?.orphanCount ? [{ orphanCount: 0 }]
          : table === articles && selection?.content ? [selectedArticle] : []
        return Promise.resolve(rows).then(resolve)
      },
    }
    return chain
  },
  insert(table: unknown) { return { values: async (values: any) => { writes.push({ table, values }); return [{ insertId: 42 }] } } },
  update(table: unknown) { return { set: (values: any) => ({ where: async () => { writes.push({ table, values }) } }) } },
  delete(table: unknown) { return { where: async () => { writes.push({ table, values: 'delete' }) } } },
  async transaction(fn: any) { transactions++; return fn(db) },
}
mock.module(new URL('../server/utils/db.ts', import.meta.url), { namedExports: { getDb: () => db } })

const mediaWrites: any[] = []
class MediaValidationError extends Error {}
mock.module(new URL('../server/services/media-portal.ts', import.meta.url), { namedExports: {
  MediaValidationError,
  updateMediaItem: async (input: any) => {
    if (input.title === '') throw new MediaValidationError('Missing title')
    mediaWrites.push(input)
    return { ok: true, slug: 'video', status: 'draft' }
  },
} })

const { articleReadScope, articleResource } = await import('../server/services/articles.ts')
const createRole = (await import('../server/api/admin/roles/index.post.ts')).default
const updateRole = (await import('../server/api/admin/roles/[id].put.ts')).default
const listArticles = (await import('../server/api/admin/articles/index.get.ts')).default
const detailArticle = (await import('../server/api/admin/articles/[id].get.ts')).default
const authors = (await import('../server/api/admin/articles/authors.get.ts')).default
const updateMedia = (await import('../server/api/admin/media-portal/[id].put.ts')).default
const mediaConfig = (await import('../server/api/admin/media-portal/config.get.ts')).default

let actor: any
const router = h3.createRouter()
router.post('/roles', createRole).put('/roles/:id', updateRole)
router.get('/articles', listArticles).get('/articles/authors', authors).get('/articles/:id', detailArticle)
router.put('/media/:id', updateMedia)
router.get('/media-config', mediaConfig)
const app = h3.createApp({ onError: () => {} })
app.use(h3.defineEventHandler(event => { event.context.adminUser = actor }))
app.use(router)
const server = createServer(h3.toNodeListener(app))
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
after(() => new Promise<void>(resolve => server.close(() => resolve())))
const base = `http://127.0.0.1:${(server.address() as any).port}`
function reader(resource: string) {
  return { id: 7, permissions: [{ resource, canRead: true, canCreate: false, canUpdate: false, canDelete: false }] }
}
function request(path: string, body?: unknown, method = 'PUT') {
  return fetch(base + path, body === undefined ? {} : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

test('role matrix roundtrip retains every canonical resource and all seven flags in persistence', async () => {
  actor = { id: 7, isSuperAdmin: true }
  const rows = PERMISSION_RESOURCES.map(({ key: resource }) => ({ resource,
    ...Object.fromEntries(PERMISSION_ACTIONS.map(({ flag }, index) => [flag, index % 2 === 0])),
  }))
  const payload = Object.entries(rolePermissionMatrix(rows)).map(([resource, flags]) => ({ resource, ...flags }))
  writes.length = 0
  const response = await request('/roles/42', { permissions: payload })
  assert.equal(response.status, 200)
  assert.deepEqual(writes.find(write => write.table === permissions && Array.isArray(write.values))?.values,
    payload.map(row => ({ ...row, roleId: 42 })))
  assert.equal(payload.length, 20)
  assert.equal(payload.find(row => row.resource === 'livestream')?.canTest, true)
  writes.length = 0
  assert.equal((await request('/roles', { name: 'New role', permissions: payload }, 'POST')).status, 200)
  assert.deepEqual(writes.find(write => write.table === permissions)?.values,
    payload.map(row => ({ ...row, roleId: 42 })))
})

test('both role endpoints reject malformed grants before any write or transaction', async () => {
  actor = { ...reader('roles'), permissions: [{ ...reader('roles').permissions[0], canCreate: true, canUpdate: true }] }
  for (const [path, method] of [['/roles', 'POST'], ['/roles/42', 'PUT']]) {
    for (const grants of [null, [{ resource: 'users', canRead: 'true' }], [{ resource: 'users', canRead: 1 }], [{ resource: 'news' }, { resource: 'news' }]]) {
      writes.length = 0
      const before = transactions
      assert.equal((await request(path!, { name: 'Changed', permissions: grants }, method!)).status, 400)
      assert.deepEqual(writes, [])
      assert.equal(transactions, before)
    }
  }
})

test('article detail and explicit filters enforce the article resource instead of news', async () => {
  actor = reader('news')
  selectedArticle = { id: 42, type: 'document', title: 'Restricted draft' }
  assert.equal((await request('/articles/42')).status, 403)
  assert.equal((await request('/articles?type=document')).status, 403)
  actor = reader('documents')
  assert.equal((await request('/articles/42')).status, 200)
  assert.equal((await request('/articles?type=document')).status, 200)
  assert.equal((await request('/articles?type=news')).status, 403)
})

test('unfiltered articles, totals and author aggregates share the allowed-type SQL boundary', async () => {
  actor = reader('documents')
  scopes.length = 0
  assert.equal((await request('/articles')).status, 200)
  assert.equal((await request('/articles/authors')).status, 200)
  assert.equal(scopes.length, 4)
  for (const query of scopes) {
    assert.match(query.sql, /`articles`\.`type` in \(\?\)/)
    assert.deepEqual(query.params, ['document'])
  }
  actor = reader('media')
  assert.equal((await request('/articles')).status, 403)
  assert.equal((await request('/articles/authors')).status, 403)
})

test('dynamic types inherit news on both read and write mappings, including prototype keys', () => {
  for (const type of ['community', 'constructor', '__proto__']) {
    assert.equal(articleResource(type), 'news')
    assert.throws(() => articleReadScope(reader('documents'), type), { statusCode: 403 })
    assert.doesNotThrow(() => articleReadScope(reader('news'), type))
  }
  const scope = dialect.sqlToQuery(articleReadScope(reader('news')))
  assert.match(scope.sql, /not in/)
  assert.match(scope.sql, /is null/)
})

test('media update trusts only route and session identity, and translates validation to 400', async () => {
  actor = { id: 7, isSuperAdmin: true }
  mediaWrites.length = 0
  assert.equal((await request('/media/42', { id: 999, actorId: 888, title: 'Safe', storagePath: '/etc/passwd' })).status, 200)
  assert.equal(mediaWrites[0].id, 42)
  assert.equal(mediaWrites[0].actorId, 7)
  assert.equal(mediaWrites[0].title, 'Safe')
  assert.equal(Object.hasOwn(mediaWrites[0], 'storagePath'), false)
  assert.equal((await request('/media/42', { title: '' })).status, 400)
  assert.equal((await request('/media/42.5', { title: 'Safe' })).status, 400)
  assert.equal(mediaWrites.length, 1)
})

test('media capabilities follow server upload config, expose no paths and require media read or create', async () => {
  const original = process.env.MEDIA_UPLOAD_ENABLED
  try {
    actor = reader('news')
    assert.equal((await request('/media-config')).status, 403)
    actor = { id: 7, permissions: [{ ...reader('media_portal').permissions[0], canRead: false, canCreate: true }] }
    for (const enabled of [false, true]) {
      process.env.MEDIA_UPLOAD_ENABLED = String(enabled)
      const response = await request('/media-config')
      assert.equal(response.status, 200)
      const result = await response.json()
      assert.equal(result.uploadEnabled, enabled)
      assert.deepEqual(Object.keys(result).sort(), ['categories', 'maxUploadSize', 'ok', 'uploadEnabled'])
    }
  } finally {
    if (original === undefined) delete process.env.MEDIA_UPLOAD_ENABLED
    else process.env.MEDIA_UPLOAD_ENABLED = original
  }
})
