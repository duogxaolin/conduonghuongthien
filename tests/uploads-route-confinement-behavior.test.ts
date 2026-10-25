import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, type ReadStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import test, { after } from 'node:test'

/**
 * `GET /uploads/**` (`server/routes/uploads/[...path].ts`) phục vụ tệp từ
 * `<cwd>/public/uploads` lúc chạy. Hai bất biến an ninh:
 *
 *   1. không đường dẫn nào trong request với tới được một tệp NGOÀI thư mục đó
 *      (`.env` nằm ngay trên `public/`);
 *   2. tệp ngoài danh sách loại an toàn — trước hết là `.svg`, một tài liệu chạy được
 *      trên chính origin của cổng — bị tải xuống chứ không bao giờ được vẽ.
 *
 * Trước đây cả hai chỉ được giữ bằng khẳng định văn bản trong
 * `tests/cms-core-auth-media.test.ts` (mã phải còn `replace(/\.\./g, '')`,
 * `startsWith(uploadsRoot + path.sep)`, bảng MIME không có `svg`). Ở đây handler thật
 * chạy trên một cây tệp tạm có tệp bí mật nằm ngay ngoài gốc
 * (docs/decisions/test-strategy.md).
 */

const root = realpathSync(mkdtempSync(join(tmpdir(), 'cdkt-uploads-route-')))
const uploads = join(root, 'public', 'uploads')
mkdirSync(join(uploads, '2026', '10'), { recursive: true })
writeFileSync(join(uploads, '2026', '10', 'photo.png'), 'png-bytes')
writeFileSync(join(uploads, 'legacy.svg'), '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(document.domain)"/>')
writeFileSync(join(uploads, 'page.html'), '<script>alert(1)</script>')
writeFileSync(join(root, '.env'), 'JWT_SECRET=not-a-real-secret')
writeFileSync(join(root, 'public', 'secret.txt'), 'outside the uploads root')

const previousCwd = process.cwd()
process.chdir(root)
after(() => {
  process.chdir(previousCwd)
  rmSync(root, { recursive: true, force: true })
})

type Event = { context: { params: { path?: string } }, headers: Record<string, string> }
const streamed: string[] = []
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.createError = (input: { statusCode: number, statusMessage?: string }) => Object.assign(new Error(input.statusMessage ?? String(input.statusCode)), input)
globals.setResponseHeaders = (event: Event, headers: Record<string, string>) => { Object.assign(event.headers, headers) }
globals.sendStream = async (_event: Event, stream: ReadStream) => {
  streamed.push(String(stream.path))
  let body = ''
  for await (const chunk of stream) body += String(chunk)
  return body
}
const route = (await import('../server/routes/uploads/[...path].ts')).default as unknown as (event: Event) => Promise<string>

const request = (path: string | undefined) => {
  const event: Event = { context: { params: { path } }, headers: {} }
  return { event, response: route(event) }
}
async function statusOf(path: string | undefined): Promise<number | null> {
  try {
    await request(path).response
    return null
  } catch (error) {
    return (error as { statusCode?: number }).statusCode ?? -1
  }
}

test('a file under public/uploads is streamed with its type, its length and nosniff', async () => {
  streamed.length = 0
  const { event, response } = request('2026/10/photo.png')
  assert.equal(await response, 'png-bytes')
  assert.deepEqual(streamed, [join(uploads, '2026', '10', 'photo.png')])
  assert.equal(event.headers['Content-Type'], 'image/png')
  assert.equal(event.headers['Content-Length'], String('png-bytes'.length))
  assert.equal(event.headers['X-Content-Type-Options'], 'nosniff')
  assert.equal(event.headers['Content-Disposition'], undefined, 'a safe image renders inline')
})

test('no request path reaches a file outside public/uploads', async () => {
  const hostile = [
    '../../.env',
    '../secret.txt',
    '2026/../../secret.txt',
    '2026/10/../../../../.env',
    '....//....//.env',
    '..././..././.env',
    './../.././.env',
    '/etc/hostname',
    join(root, '.env'),
    `${root}${sep}public${sep}secret.txt`,
    '//' + join(root, '.env'),
    '..%2f..%2f.env',
    '%2e%2e/%2e%2e/.env',
    '..\\..\\.env',
  ]
  for (const path of hostile) {
    streamed.length = 0
    const status = await statusOf(path)
    assert.ok(status === 403 || status === 404, `${JSON.stringify(path)} answered ${status}`)
    assert.deepEqual(streamed, [], `${JSON.stringify(path)} streamed a file`)
  }
})

test('the uploads directory itself, a sub-directory and a missing path are 404, not a listing', async () => {
  for (const path of ['', '.', '2026', '2026/10/', 'missing.png', undefined]) {
    streamed.length = 0
    assert.equal(await statusOf(path), 404, JSON.stringify(path))
    assert.deepEqual(streamed, [])
  }
})

test('an SVG or any type outside the safe list is downloaded, never rendered', async () => {
  for (const name of ['legacy.svg', 'page.html']) {
    const { event, response } = request(name)
    await response
    assert.equal(event.headers['Content-Type'], 'application/octet-stream', `${name} is served with a renderable type`)
    assert.equal(event.headers['Content-Disposition'], 'attachment', `${name} is not forced to download`)
    assert.equal(event.headers['X-Content-Type-Options'], 'nosniff', `${name} can be sniffed into HTML/SVG`)
  }
})
