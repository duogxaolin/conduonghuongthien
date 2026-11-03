/**
 * `app/` nạp `shared/` CHỈ qua alias `~~/shared/…` — không bao giờ bằng đường tương
 * đối (wave2-hardening D-SHARED; lỗi build ngẫu nhiên trên nhánh tích hợp Wave 1).
 *
 * Nuxt để `<root>/shared/` là external trong bản build SSR (vite-builder
 * `ssrEnvironment` → `rolldownOptions.external`), để Nitro gói nó một lần. Rolldown
 * in import của một external theo chính chuỗi nguồn: nguồn là alias (`~~/shared/x`)
 * thì in ra đường tuyệt đối, Nitro giải được; nguồn là đường TƯƠNG ĐỐI
 * (`../../shared/x`) thì có lúc in ra đường tương đối tính từ thư mục build
 * (`"../../../../../shared/link-policy.ts"` từ `node_modules/.cache/nuxt/.nuxt/dist/
 * server/_nuxt/`) — Nitro báo `Could not resolve` và `npm run build` đỏ. Với
 * `app/utils/nav-config.ts` nó đỏ 1/5 lượt (tuỳ cách chia chunk); với bản re-export
 * tương đối trong `app/utils/*` (wave2 5.1) nó đỏ mọi lượt.
 *
 * Một alias duy nhất (`~~/shared/…`, không `#shared`/`@@/shared`) vì đó là alias
 * `scripts/ts-resolver.mjs` giải cho test Node trần — các test nạp thẳng
 * `app/utils/nav-config.ts`, `hero-content.ts`.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { moduleReferences } from './_module-references.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const APP_DIR = path.join(ROOT, 'app')
const SHARED_DIR = path.join(ROOT, 'shared')
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|vue)$/

const inside = (target: string, dir: string) => {
  const rel = path.relative(dir, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** Vì sao `specifier` (trong tệp `fromFile` dưới app/) là cách sai để tới shared/ — hoặc null. */
function violation(fromFile: string, specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    return inside(path.resolve(path.dirname(fromFile), specifier), SHARED_DIR)
      ? 'đường tương đối tới shared/ — dùng ~~/shared/…'
      : null
  }
  if (/^(?:#shared|@@\/shared)(?:\/|$)/.test(specifier)) return 'alias khác — dùng ~~/shared/… (alias ts-resolver giải được)'
  return null
}

function offendersIn(file: string, source: string): string[] {
  const rel = path.relative(ROOT, file).split(path.sep).join('/')
  const found: string[] = []
  for (const ref of moduleReferences(file, source)) {
    if (ref.specifier === null) {
      found.push(`${rel}:${ref.line} ${ref.form} với đối số không phải chuỗi cố định — không kiểm được`)
      continue
    }
    const why = violation(file, ref.specifier)
    if (why) found.push(`${rel}:${ref.line} ${ref.form} '${ref.specifier}' — ${why}`)
  }
  return found
}

function walk(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walk(full))
    else if (SOURCE_FILE.test(entry.name)) files.push(full)
  }
  return files
}

const appFiles = walk(APP_DIR)

describe('app/ nạp shared/ chỉ qua ~~/shared/…', () => {
  test('quét đủ cây app/, kể cả khối <script> của .vue', () => {
    const names = appFiles.map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
    assert.ok(names.length > 200, `chỉ thấy ${names.length} tệp`)
    assert.ok(names.includes('app/utils/nav-config.ts'))
    // Một .vue có import shared/ thật: bộ đọc phải thấy nó, nếu không guard mù với 174 tệp .vue.
    const roles = path.join(APP_DIR, 'pages/admin/users/roles.vue')
    const specifiers = moduleReferences(roles, readFileSync(roles, 'utf8')).map((r) => r.specifier)
    assert.ok(specifiers.includes('~~/shared/permissions'), `không đọc được import trong ${roles}`)
  })

  test('không tệp nào dưới app/ nạp shared/ bằng đường tương đối hay alias khác', () => {
    assert.deepEqual(appFiles.flatMap((file) => offendersIn(file, readFileSync(file, 'utf8'))), [])
  })
})

describe('bộ dò app/ → shared/', () => {
  const FAKE = path.join(ROOT, 'app/utils/demo/x.ts')
  const bad: Record<string, string> = {
    'import tương đối': `import { safeLinkOrNull } from '../../../shared/link-policy'`,
    'import type tương đối': `import type { BlockData } from '../../../shared/blocks/types'`,
    're-export tương đối (bản đã làm build đỏ mọi lượt)': `export { blockText } from '../../../shared/blocks/types'`,
    'export * tương đối': `export * from '../../../shared/submission-status'`,
    'import() tương đối': `const m = await import('../../../shared/link-policy')`,
    '#shared': `import { safeLinkOrNull } from '#shared/link-policy'`,
    '@@/shared': `import { safeLinkOrNull } from '@@/shared/link-policy'`,
    'import() không phải chuỗi cố định': 'const m = await import(target)',
  }
  for (const [name, source] of Object.entries(bad)) {
    test(`bắt: ${name}`, () => assert.equal(offendersIn(FAKE, source).length, 1, source))
  }

  test('bắt trong <script setup> của .vue, đúng số dòng', () => {
    const vue = '<template><a /></template>\n<script setup lang="ts">\nimport { ref } from \'vue\'\nimport { safeLinkOrNull } from \'../../shared/link-policy\'\n</script>\n'
    const found = offendersIn(path.join(ROOT, 'app/components/Demo.vue'), vue)
    assert.equal(found.length, 1)
    assert.match(found[0]!, /^app\/components\/Demo\.vue:4 /)
  })

  const good: Record<string, string> = {
    '~~/shared': `import { safeLinkOrNull } from '~~/shared/link-policy'`,
    'tương đối trong app/': `import { a } from '../errorMessage'`,
    'alias ~/': `import { a } from '~/utils/errorMessage'`,
    'thư mục tên bắt đầu bằng shared': `import { a } from '../../../shared-ui/x'`,
    'chú thích và chuỗi nhắc shared/': `// from '../../../shared/link-policy'\nconst s = "../../../shared/link-policy"`,
    'gói npm': `import { ref } from 'vue'`,
  }
  for (const [name, source] of Object.entries(good)) {
    test(`không báo nhầm: ${name}`, () => assert.deepEqual(offendersIn(FAKE, source), [], source))
  }
})

describe('ts-resolver giải ~~/ như Nuxt (gốc repo)', () => {
  // `npm test` chạy với `--import ./scripts/ts-resolver.mjs`, nên import dưới đây
  // đi đúng đường mà test của nav-config / hero-content đi.
  test('~~/shared/… nạp được', async () => {
    const mod = await import('~~/shared/link-policy')
    assert.equal(typeof mod.safeLinkOrNull, 'function')
  })

  test('~~/… không có thật vẫn lỗi (không lùi ngầm về đâu cả)', async () => {
    await assert.rejects(import('~~/shared/khong-ton-tai-module'), /Cannot find|ERR_MODULE_NOT_FOUND/)
  })

  test('module app/ dùng ~~/shared nạp được dưới test Node trần', async () => {
    const nav = await import('../app/utils/nav-config.ts')
    const hero = await import('../app/utils/blocks/hero-content.ts')
    assert.equal(typeof nav.parseNavConfig, 'function')
    assert.equal(typeof hero.resolveHeroContent, 'function')
  })
})
