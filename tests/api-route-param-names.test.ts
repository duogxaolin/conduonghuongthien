import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createRouter } from 'radix3'

/**
 * Hai tệp route ở cùng một vị trí đường dẫn PHẢI đặt cùng tên tham số.
 *
 * Bộ định tuyến (radix3, dưới Nitro) giữ MỘT tên tham số cho mỗi vị trí, của tệp đăng ký trước,
 * bất kể phương thức. `comments/[articleSlug].get.ts` + `comments/[id].delete.ts` làm
 * `getRouterParam(event, 'id')` là `undefined` trên bản build → `Number(undefined)` = NaN →
 * mọi lượt người đọc xoá bình luận của mình trả 400 "Bình luận không hợp lệ" (2026-11-03). Test
 * handler gọi trực tiếp không bắt được: nó tự đưa `id` vào, không qua bộ định tuyến.
 */

const API_ROOT = join(import.meta.dirname, '..', 'server', 'api')
const METHOD_SUFFIX = /\.(get|post|put|patch|delete|head|options)$/
const PARAM = /^\[(?:\.\.\.)?(\w+)\]$/

function listRouteFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory()
      ? listRouteFiles(join(dir, entry.name))
      : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : [])
}

interface RouteFile {
  file: string
  /** Vị trí không tên tham số: `public/comments/*`. */
  position: string
  /** Mẫu radix3 với tên tham số của chính tệp. */
  pattern: string
  names: string[]
}

function describe(file: string): RouteFile {
  const rel = relative(API_ROOT, file).replace(/\\/g, '/').replace(/\.ts$/, '')
  const parts = rel.split('/')
  parts[parts.length - 1] = parts[parts.length - 1]!.replace(METHOD_SUFFIX, '')
  if (parts[parts.length - 1] === 'index') parts.pop()
  const names: string[] = []
  const position = parts.map((p) => {
    const m = PARAM.exec(p)
    if (!m) return p
    names.push(m[1]!)
    return '*'
  }).join('/')
  const pattern = '/api/' + parts.map((p) => {
    const m = PARAM.exec(p)
    return m ? (p.startsWith('[...') ? `**:${m[1]}` : `:${m[1]}`) : p
  }).join('/')
  return { file: relative(join(API_ROOT, '..', '..'), file).replace(/\\/g, '/'), position, pattern, names }
}

const routes = listRouteFiles(API_ROOT).map(describe)

function conflicts(list: RouteFile[]): string[] {
  const byPosition = new Map<string, RouteFile[]>()
  for (const r of list) byPosition.set(r.position, [...(byPosition.get(r.position) ?? []), r])
  const out: string[] = []
  for (const [position, group] of byPosition) {
    const distinct = new Set(group.map(r => r.names.join('/')))
    if (distinct.size > 1) {
      out.push(`${position}: ${group.map(r => `${r.file} → [${r.names.join(', ')}]`).join(' | ')}`)
    }
  }
  return out
}

test('no two API route files at the same path position name their parameter differently', () => {
  assert.ok(routes.length > 100, 'the scan found the API route files')
  assert.deepEqual(conflicts(routes), [])
})

test('the scan catches the comment-delete defect it was written for (proof)', () => {
  const broken = [
    ...routes.filter(r => !r.file.includes('public/comments/[articleSlug].delete')),
    describe(join(API_ROOT, 'public', 'comments', '[id].delete.ts')),
  ]
  const found = conflicts(broken)
  assert.equal(found.length, 1)
  assert.match(found[0]!, /public\/comments\/\*/)
})

test('why: the router keeps the first-registered parameter name for a position', () => {
  const router = createRouter<{ method: string }>()
  router.insert('/api/public/comments/:articleSlug', { method: 'get' })
  router.insert('/api/public/comments/:id', { method: 'delete' })
  assert.deepEqual(router.lookup('/api/public/comments/28')?.params, { articleSlug: '28' })
})

test('every getRouterParam literal in a route file is one of that file\'s own parameter names', () => {
  const wrong: string[] = []
  for (const r of routes) {
    const source = readFileSync(join(API_ROOT, '..', '..', r.file), 'utf8')
    for (const m of source.matchAll(/getRouterParam\(\s*event\s*,\s*['"](\w+)['"]/g)) {
      if (!r.names.includes(m[1]!)) wrong.push(`${r.file}: getRouterParam(event, '${m[1]}') but the file declares [${r.names.join(', ')}]`)
    }
  }
  assert.deepEqual(wrong, [])
})
