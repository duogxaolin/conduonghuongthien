/**
 * Lớp Tailwind viết trong `shared/` phải được Tailwind quét và sinh CSS.
 *
 * `shared/submission-status.ts` giữ lớp huy hiệu trạng thái đơn
 * (`bg-[#e6f0fb] text-[#1c4f86] border-[#b9d5f0]`…) mà trang quản trị chỉ gắn qua
 * `:class="SUBMISSION_STATUS_META[s].badgeClass"`. Tailwind chỉ sinh lớp nó THẤY
 * trong các tệp `content`; khi tệp này còn ở `app/utils/` thì glob `./app/**` thấy
 * nó. Chuyển sang `shared/` mà `content` không có `./shared/**` thì 7 trong 15 lớp
 * (những lớp không xuất hiện ở đâu khác) bị purge — huy hiệu mất màu, không lỗi,
 * không test nào khác đỏ.
 *
 * Kiểm theo hành vi: lấy mọi chuỗi trong `shared/` trông như lớp Tailwind giá trị
 * tuỳ ý (`tiền-tố-[giá-trị]`), chạy chính Tailwind với đúng mảng `content` của
 * `tailwind.config.js`, rồi đòi CSS có từng lớp. Lớp giá trị tuỳ ý không phụ thuộc
 * `theme`, nên chỉ cần `content` (đọc bằng AST: tệp cấu hình là CommonJS trong một
 * gói `"type": "module"`, `loadConfig` của Tailwind không nạp được ngoài Nuxt).
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { before, describe, test } from 'node:test'
import ts from 'typescript'
import { SUBMISSION_STATUS_META } from '../shared/submission-status.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
// Cùng bản postcss / micromatch mà Tailwind dùng (lấy qua chính gói tailwindcss).
const requireHere = createRequire(import.meta.url)
const tailwindcss = requireHere('tailwindcss')
const requireFromTailwind = createRequire(requireHere.resolve('tailwindcss'))
const postcss = requireFromTailwind('postcss')
const micromatch = requireFromTailwind('micromatch') as { isMatch: (file: string, globs: string[]) => boolean }

/** Mảng `content` của `module.exports = { … }` trong tailwind.config.js. */
function contentGlobs(): string[] {
  const file = path.join(ROOT, 'tailwind.config.js')
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  for (const st of sf.statements) {
    if (!ts.isExpressionStatement(st) || !ts.isBinaryExpression(st.expression)) continue
    const { left, right } = st.expression
    if (left.getText(sf) !== 'module.exports' || !ts.isObjectLiteralExpression(right)) continue
    for (const prop of right.properties) {
      if (!ts.isPropertyAssignment(prop) || prop.name.getText(sf) !== 'content') continue
      assert.ok(ts.isArrayLiteralExpression(prop.initializer), '`content` không còn là mảng — cập nhật test này')
      return prop.initializer.elements.map((el) => {
        assert.ok(ts.isStringLiteral(el), `phần tử content không phải chuỗi: ${el.getText(sf)}`)
        return el.text
      })
    }
  }
  assert.fail('không tìm thấy `module.exports = { content: [...] }` trong tailwind.config.js')
}

/** `bg-[#e6f0fb]`, `md:text-[0.82rem]`, `!border-[#b9d5f0]`… */
const ARBITRARY_CLASS = /^(?:[a-z0-9-]+:)*!?-?[a-z][a-z0-9-]*-\[[^\s[\]]+\]$/

/** Lớp giá trị tuỳ ý trong chuỗi (không phải chú thích) của mọi tệp dưới shared/ → các tệp chứa nó. */
function sharedArbitraryClasses(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>()
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!/\.[cm]?[jt]s$/.test(entry.name)) continue
      const relPath = path.relative(ROOT, full).split(path.sep).join('/')
      const sf = ts.createSourceFile(full, readFileSync(full, 'utf8'), ts.ScriptTarget.Latest, true)
      const visit = (node: ts.Node): void => {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
          for (const token of node.text.split(/\s+/)) {
            if (!ARBITRARY_CLASS.test(token)) continue
            if (!found.has(token)) found.set(token, new Set())
            found.get(token)!.add(relPath)
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(sf)
    }
  }
  walk(path.join(ROOT, 'shared'))
  return found
}

const globs = contentGlobs()
const classes = sharedArbitraryClasses()
const badgeClasses = Object.values(SUBMISSION_STATUS_META).flatMap((meta) => meta.badgeClass.split(/\s+/))

describe('lớp Tailwind trong shared/ được quét và sinh CSS', () => {
  test('quét được lớp giá trị tuỳ ý trong shared/, gồm đủ 15 lớp huy hiệu trạng thái đơn', () => {
    assert.equal(badgeClasses.length, 15)
    for (const cls of badgeClasses) {
      assert.ok(ARBITRARY_CLASS.test(cls), `${cls} không còn là lớp giá trị tuỳ ý — cập nhật test`)
      assert.ok(classes.get(cls)?.has('shared/submission-status.ts'), `không thấy ${cls} trong shared/submission-status.ts`)
    }
  })

  test('mọi tệp shared/ mang lớp Tailwind nằm trong một glob `content` của tailwind.config.js', () => {
    const patterns = globs.map((glob) => glob.replace(/^\.\//, ''))
    const files = new Set([...classes.values()].flatMap((set) => [...set]))
    const uncovered = [...files].filter((file) => !micromatch.isMatch(file, patterns)).sort()
    assert.deepEqual(uncovered, [], `thêm './shared/**/*.{ts,js}' vào content (đang có: ${globs.join(', ')})`)
  })

  describe('Tailwind với đúng `content` của repo', () => {
    const selectors = new Set<string>()
    before(async () => {
      const config = { content: globs.map((glob) => path.join(ROOT, glob)) }
      const result = await postcss([tailwindcss(config)]).process('@tailwind utilities;', { from: undefined })
      postcss.parse(result.css).walkRules((rule: { selectors: string[] }) => {
        for (const selector of rule.selectors) selectors.add(selector.replace(/\\(.)/g, '$1'))
      })
    })

    test('sinh CSS cho mọi lớp giá trị tuỳ ý trong shared/', () => {
      assert.ok(selectors.size > 100, `CSS sinh ra gần như rỗng (${selectors.size} selector)`)
      const missing = [...classes.keys()]
        .filter((cls) => ![...selectors].some((s) => s === `.${cls}` || s.startsWith(`.${cls}:`)))
        .sort()
      assert.deepEqual(missing, [], 'các lớp này bị purge — content của tailwind.config.js không quét tệp chứa chúng')
    })
  })
})
