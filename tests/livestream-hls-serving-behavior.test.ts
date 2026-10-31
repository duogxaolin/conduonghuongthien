import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * Self-hosted HLS of a live broadcast — `GET /api/public/livestream/:id/stream`
 * and `GET /api/public/livestream/:id/assets/**` (both in front of
 * `server/services/livestream-hls.ts`).
 *
 * Public and unauthenticated, and the second route takes a file path from the
 * request. The invariants:
 *   - only the ACTIVE session, of source `upload`, with the id in the URL, serves
 *     anything; every other id is a 404;
 *   - a requested path never leaves the session's stream directory: not with
 *     `..`, not into a sibling stream, not through a symlink (file or directory)
 *     planted inside it;
 *   - only HLS types are served (`.txt` next to the segments is not), always with
 *     `no-store` and `nosniff`; an empty file is "not ready", not an empty 200;
 *   - a playlist is rewritten so every reference goes back through this route;
 *     one that references an absolute path, a URL, or a file outside its stream
 *     is refused rather than relayed;
 *   - byte ranges are honoured (206 + `Content-Range`) and a range outside the
 *     file is 416;
 *   - `validateHlsSource` (run before a broadcast goes live) accepts a complete
 *     source and refuses one with a missing segment or a path for a stream key.
 *
 * Real files on disk under a temporary `LIVESTREAM_HLS_ROOT` — with a secret
 * file and a sibling stream next to it — served by the real handlers in a real h3
 * app. `getActiveLivestream`'s query runs on SQLite (`_sqlite-mysql-db.ts`).
 * Linux only, like the code under test (it opens through `/proc/self/fd`).
 */

const linuxOnly = process.platform === 'linux' ? false : 'livestream HLS serving opens files through /proc/self/fd (Linux only)'

const root = realpathSync(mkdtempSync(join(tmpdir(), 'cdkt-hls-')))
const live = join(root, 'live')
const stream = join(live, 'cam1')
mkdirSync(join(stream, 'v720'), { recursive: true })
mkdirSync(join(live, 'cam2'), { recursive: true })
mkdirSync(join(root, 'outside'), { recursive: true })
process.env.LIVESTREAM_HLS_ROOT = live

const SECRET = 'JWT_SECRET=outside-the-hls-root'
const SEG0 = Buffer.from('segment-zero-bytes-0123456789')
const MEDIA_PLAYLIST = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n#EXTINF:4.0,\nseg0.ts\n#EXTINF:4.0,\nv720/seg1.ts\n'
writeFileSync(join(stream, 'index.m3u8'), MEDIA_PLAYLIST)
writeFileSync(join(stream, 'seg0.ts'), SEG0)
writeFileSync(join(stream, 'v720', 'seg1.ts'), 'segment-one')
writeFileSync(join(stream, 'notes.txt'), 'encoder notes')
writeFileSync(join(stream, 'empty.ts'), '')
writeFileSync(join(stream, 'abs.m3u8'), '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4.0,\n/etc/passwd.ts\n')
writeFileSync(join(stream, 'url.m3u8'), '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4.0,\nhttps://evil.example/x.ts\n')
writeFileSync(join(stream, 'sibling.m3u8'), '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4.0,\n../cam2/seg.ts\n')
writeFileSync(join(stream, 'key.m3u8'), '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-KEY:METHOD=AES-128,URI=../cam2/k.key\n#EXTINF:4.0,\nseg0.ts\n')
writeFileSync(join(live, 'cam2', 'seg.ts'), 'other-stream-segment')
writeFileSync(join(root, 'secret.ts'), SECRET)
writeFileSync(join(root, 'outside', 'x.ts'), SECRET)
symlinkSync(join(root, 'secret.ts'), join(stream, 'leak.ts'))
symlinkSync(join(root, 'outside'), join(stream, 'outdir'))
// A stream with a missing segment, for validateHlsSource.
mkdirSync(join(live, 'broken'), { recursive: true })
writeFileSync(join(live, 'broken', 'index.m3u8'), '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4.0,\ngone.ts\n')

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { livestreamSessions } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([livestreamSessions])

mock.module('../server/utils/logger', {
  namedExports: {
    log: () => {},
    logInfo: () => {},
    logWarn: () => {},
    logError: () => {},
    SECURITY_EVENTS: new Proxy({}, { get: (_target, key) => `event.${String(key)}` }),
  },
})
mock.module('../server/utils/db', { namedExports: { getDb: () => harness.db, getPool: () => null } })

const { installH3Globals, startHandlerServer } = await import('./_h3-handler-server')
installH3Globals()
const streamHandler = (await import('../server/api/public/livestream/[id]/stream.get')).default
const assetHandler = (await import('../server/api/public/livestream/[id]/assets/[...path].get')).default
const { validateHlsSource, HlsSourceError } = await import('../server/services/livestream-hls')

const server = await startHandlerServer([
  { method: 'get', path: '/api/public/livestream/:id/stream', handler: streamHandler },
  // Nitro's route for `assets/[...path].get.ts`.
  { method: 'get', path: '/api/public/livestream/:id/assets/**:path', handler: assetHandler },
])
after(async () => {
  await server.close()
  rmSync(root, { recursive: true, force: true })
})

const ACTIVE_ID = 7

/**
 * A raw GET: the path is sent exactly as written. `fetch`, and `http.request`
 * given a URL string, both resolve `.`/`..` segments before sending — a test of
 * the server's confinement through them would never send the attack.
 */
function rawGet(path: string, headers: Record<string, string> = {}): Promise<{ status: number, headers: Record<string, string | string[] | undefined>, body: Buffer }> {
  const { hostname, port } = new URL(server.origin)
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: hostname, port, path, method: 'GET', headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(chunk as Buffer))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }))
    })
    req.on('error', reject)
    // A Content-Length larger than the body sent would otherwise wait forever.
    req.setTimeout(5_000, () => req.destroy(new Error(`no complete response for ${path} within 5 s`)))
    req.end()
  })
}
const asset = (path: string, headers?: Record<string, string>) => rawGet(`/api/public/livestream/${ACTIVE_ID}/assets/${path}`, headers)

beforeEach(async () => {
  harness.reset()
  await harness.db.insert(livestreamSessions).values([
    { id: 3, title: 'Buổi cũ', source: 'upload', storagePath: 'cam2', isActive: false },
    { id: ACTIVE_ID, title: 'Phiên tòa lưu động', source: 'upload', storagePath: 'cam1', isActive: true },
  ])
})

test('the active upload session\'s playlist is served rewritten: every reference comes back through this route', { skip: linuxOnly }, async () => {
  const response = await rawGet(`/api/public/livestream/${ACTIVE_ID}/stream`)
  assert.equal(response.status, 200)
  assert.equal(response.headers['content-type'], 'application/vnd.apple.mpegurl')
  assert.equal(response.headers['cache-control'], 'no-store')
  assert.equal(response.headers['x-content-type-options'], 'nosniff')
  const lines = response.body.toString('utf8').split('\n')
  assert.ok(lines.includes(`/api/public/livestream/${ACTIVE_ID}/assets/seg0.ts`))
  assert.ok(lines.includes(`/api/public/livestream/${ACTIVE_ID}/assets/v720/seg1.ts`))
  assert.ok(!lines.includes('seg0.ts'), 'no reference is relayed as written')
})

test('only the active session, of source upload, with the id in the URL serves anything', { skip: linuxOnly }, async () => {
  assert.equal((await rawGet('/api/public/livestream/3/stream')).status, 404)
  assert.equal((await rawGet('/api/public/livestream/3/assets/seg.ts')).status, 404)
  // An ended session's URL does not serve the stream that is live now.
  assert.equal((await rawGet('/api/public/livestream/3/assets/seg0.ts')).status, 404)
  assert.equal((await rawGet('/api/public/livestream/8/assets/seg0.ts')).status, 404)
  assert.equal((await rawGet('/api/public/livestream/07/assets/seg0.ts')).status, 404)
  assert.equal((await rawGet('/api/public/livestream/abc/stream')).status, 404)

  harness.sqlite.prepare('UPDATE livestream_sessions SET source = \'youtube\' WHERE id = ?').run(ACTIVE_ID)
  assert.equal((await rawGet(`/api/public/livestream/${ACTIVE_ID}/stream`)).status, 404)
  assert.equal((await asset('seg0.ts')).status, 404)

  harness.sqlite.prepare('UPDATE livestream_sessions SET source = \'upload\', is_active = 0 WHERE id = ?').run(ACTIVE_ID)
  assert.equal((await rawGet(`/api/public/livestream/${ACTIVE_ID}/stream`)).status, 404)
})

test('a segment is served byte for byte, as video/mp2t, no-store and nosniff', { skip: linuxOnly }, async () => {
  const response = await asset('seg0.ts')
  assert.equal(response.status, 200)
  assert.deepEqual(response.body, SEG0)
  assert.equal(response.headers['content-type'], 'video/mp2t')
  assert.equal(response.headers['cache-control'], 'no-store')
  assert.equal(response.headers['x-content-type-options'], 'nosniff')
  assert.equal(response.headers['accept-ranges'], 'bytes')
  assert.equal(response.headers['content-length'], String(SEG0.length))
  assert.equal((await asset('v720/seg1.ts')).body.toString(), 'segment-one')
})

test('a requested path never leaves the stream directory: .., a sibling stream, a symlinked file or directory', { skip: linuxOnly }, async () => {
  // `v720/../seg0.ts` names a real segment once resolved: its 404 shows the path
  // reached the server unresolved (a client that resolved it would get a 200).
  for (const path of ['../secret.ts', '../../secret.ts', '../cam2/seg.ts', 'v720/../../cam2/seg.ts', 'v720/../seg0.ts', 'leak.ts', 'outdir/x.ts', './seg0.ts', '.hidden.ts']) {
    const response = await asset(path)
    assert.equal(response.status, 404, path)
    assert.ok(!response.body.toString().includes('outside-the-hls-root'), `${path} leaked the secret`)
    assert.ok(!response.body.toString().includes('other-stream-segment'), `${path} reached another stream`)
  }
})

test('only HLS types are served, and an empty file is not ready yet', { skip: linuxOnly }, async () => {
  assert.equal((await asset('notes.txt')).status, 404)
  assert.equal((await asset('empty.ts')).status, 404)
  assert.equal((await asset('missing.ts')).status, 404)
})

test('a playlist that points at an absolute path, a URL or another stream is refused, not relayed', { skip: linuxOnly }, async () => {
  for (const playlist of ['abs.m3u8', 'url.m3u8', 'sibling.m3u8', 'key.m3u8']) {
    const response = await asset(playlist)
    assert.equal(response.status, 404, playlist)
    assert.ok(!response.body.toString().includes('evil.example'), playlist)
  }
})

test('byte ranges: 206 with Content-Range, a suffix range, and 416 outside the file', { skip: linuxOnly }, async () => {
  const middle = await asset('seg0.ts', { range: 'bytes=2-5' })
  assert.equal(middle.status, 206)
  assert.equal(middle.headers['content-range'], `bytes 2-5/${SEG0.length}`)
  assert.deepEqual(middle.body, SEG0.subarray(2, 6))

  const tail = await asset('seg0.ts', { range: 'bytes=-4' })
  assert.equal(tail.status, 206)
  assert.deepEqual(tail.body, SEG0.subarray(SEG0.length - 4))

  const open = await asset('seg0.ts', { range: 'bytes=10-' })
  assert.equal(open.status, 206)
  assert.deepEqual(open.body, SEG0.subarray(10))

  // An end past the file is clipped to the last byte, in the header too.
  const overlong = await asset('seg0.ts', { range: 'bytes=20-9999' })
  assert.equal(overlong.status, 206)
  assert.equal(overlong.headers['content-range'], `bytes 20-${SEG0.length - 1}/${SEG0.length}`)
  assert.equal(overlong.headers['content-length'], String(SEG0.length - 20))
  assert.deepEqual(overlong.body, SEG0.subarray(20))

  for (const range of [`bytes=${SEG0.length}-`, 'bytes=6-2', 'bytes=-', 'items=0-1']) {
    assert.equal((await asset('seg0.ts', { range })).status, 416, range)
  }
})

test('validateHlsSource accepts a complete source and refuses a broken one or a path for a key', { skip: linuxOnly }, async () => {
  assert.equal(await validateHlsSource('cam1'), 'cam1/index.m3u8')
  assert.equal(await validateHlsSource(' cam1/index.m3u8 '), 'cam1/index.m3u8')
  for (const source of ['broken', '../live/cam1', '/var/lib/cdkt/media/live/cam1', 'cam1/seg0.ts', 'cam1/sibling.m3u8', 'missing', '', 42]) {
    await assert.rejects(validateHlsSource(source), HlsSourceError, String(source))
  }
})
