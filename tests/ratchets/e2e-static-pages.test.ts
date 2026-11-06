import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { SMOKE_EXEMPT, SMOKE_PAGES } from '../e2e/public-static-pages.ts'

/**
 * Ratchet độ phủ giao diện: mọi TRANG CÔNG KHAI TĨNH dưới `app/pages/` (không `/admin`, không
 * `[param]`) phải được mở bởi `tests/e2e/public-pages-smoke.spec.ts` (`SMOKE_PAGES`) hoặc nằm
 * trong `SMOKE_EXEMPT` kèm lý do. Thêm một trang mới mà không chọn → đỏ ở đây (chạy trong
 * `npm test`, không cần trình duyệt).
 *
 * Cấu trúc, không phải hành vi: test này chứng minh danh sách và spec KHỚP cây `app/pages`;
 * việc trang thật sự trả 200 + một `<h1>` + không lỗi console do chính spec Playwright chứng minh.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PAGES_DIR = path.join(ROOT, 'app/pages')

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

/** Route Nuxt của một tệp `app/pages/**.vue`, hoặc `null` nếu động / thuộc admin. */
export function staticPublicRoute(file: string): string | null {
  const relative = path.relative(PAGES_DIR, file).split(path.sep).join('/')
  if (!relative.endsWith('.vue')) return null
  if (relative.includes('[') || relative.includes(']')) return null
  // Nuxt: nhóm route `(nhom)/` không vào URL; hậu tố `.client`/`.server` chỉ là chế độ dựng, không vào URL.
  const segments = relative.slice(0, -'.vue'.length).split('/')
    .filter(segment => !/^\(.*\)$/.test(segment))
    .map(segment => segment.replace(/\.(client|server)$/, ''))
  if (segments[0] === 'admin') return null
  if (segments[segments.length - 1] === 'index') segments.pop()
  return `/${segments.join('/')}`
}

const discovered = walk(PAGES_DIR)
  .map(staticPublicRoute)
  .filter((route): route is string => route !== null)
  .sort()

test('tập quét không rỗng và nhận ra đúng các trang tĩnh đã biết (guard không thu hẹp âm thầm)', () => {
  assert.ok(discovered.length >= 10, `chỉ quét được ${discovered.length} trang tĩnh`)
  for (const known of ['/', '/about', '/news', '/news/local-news']) assert.ok(discovered.includes(known), known)
  assert.equal(staticPublicRoute(path.join(PAGES_DIR, 'admin/index.vue')), null)
  assert.equal(staticPublicRoute(path.join(PAGES_DIR, 'news/[category]/[slug].vue')), null)
  assert.equal(staticPublicRoute(path.join(PAGES_DIR, 'role-models/index.vue')), '/role-models')
  assert.equal(staticPublicRoute(path.join(PAGES_DIR, '(nhom)/gioi-thieu.vue')), '/gioi-thieu', 'route group is not part of the URL')
  assert.equal(staticPublicRoute(path.join(PAGES_DIR, 'trang.client.vue')), '/trang', '.client is not part of the URL')
})

test('mọi trang công khai tĩnh được smoke mở hoặc nằm trong danh sách miễn', () => {
  const covered = new Set<string>([...SMOKE_PAGES, ...Object.keys(SMOKE_EXEMPT)])
  const missing = discovered.filter(route => !covered.has(route))
  assert.deepEqual(
    missing,
    [],
    `trang chưa có trong tests/e2e/public-static-pages.ts (SMOKE_PAGES hoặc SMOKE_EXEMPT kèm lý do): ${missing.join(', ')}`,
  )
})

test('danh sách không mục nào lỗi thời, không trùng, không vừa mở vừa miễn', () => {
  const real = new Set(discovered)
  const stale = [...SMOKE_PAGES, ...Object.keys(SMOKE_EXEMPT)].filter(route => !real.has(route))
  assert.deepEqual(stale, [], `mục trỏ tới trang không còn (hoặc không phải trang tĩnh công khai): ${stale.join(', ')}`)
  assert.equal(new Set(SMOKE_PAGES).size, SMOKE_PAGES.length, 'SMOKE_PAGES có route trùng')
  const both = Object.keys(SMOKE_EXEMPT).filter(route => (SMOKE_PAGES as readonly string[]).includes(route))
  assert.deepEqual(both, [], 'route vừa mở vừa miễn')
})

test('mỗi mục miễn có lý do thật (không rỗng, không placeholder)', () => {
  for (const [route, reason] of Object.entries(SMOKE_EXEMPT)) {
    assert.ok(reason.trim().length >= 25, `${route}: lý do quá ngắn`)
    assert.doesNotMatch(reason, /^\s*(todo|tbd|n\/a|later|sau)\b/i, `${route}: lý do là placeholder`)
  }
})

test('spec smoke tồn tại, nạp ĐÚNG danh sách này và mở từng route trong vòng lặp', () => {
  const specPath = path.join(ROOT, 'tests/e2e/public-pages-smoke.spec.ts')
  assert.ok(existsSync(specPath), 'thiếu tests/e2e/public-pages-smoke.spec.ts')
  const spec = readFileSync(specPath, 'utf8')
  assert.match(spec, /import\s*\{[^}]*\bSMOKE_PAGES\b[^}]*\}\s*from\s*'\.\/public-static-pages'/)
  assert.match(spec, /for\s*\(\s*const\s+\w+\s+of\s+SMOKE_PAGES\s*\)/, 'spec không lặp qua SMOKE_PAGES')
  assert.match(spec, /page\.goto\(/)
  assert.match(spec, /pageerror/, 'spec không bắt lỗi trang (pageerror)')
  assert.match(spec, /type\(\)\s*!==\s*'error'/, 'spec không bắt console.error')
  assert.doesNotMatch(spec, /test\.(skip|fixme)|\.skip\(/, 'spec không được bỏ qua test')
})
