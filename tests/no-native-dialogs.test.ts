import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Không hộp thoại mặc định của trình duyệt (`window.confirm/alert/prompt`) và không swal trong
 * `app/`: hỏi lại trước thao tác không hoàn tác đi qua `useConfirm()` + `ConfirmModal` (bẫy focus,
 * Escape = Hủy, thao tác nguy hiểm mở ở nút "Hủy"). Trang công khai từng dùng `window.confirm` để
 * xoá bình luận (2026-11-03) — kiểm kê toàn site lúc đó: đây là chỗ DUY NHẤT.
 */
const APP = join(import.meta.dirname, '..', 'app')

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.(vue|ts)$/.test(e.name) ? [join(dir, e.name)] : [])
}

const stripComments = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')

const NATIVE = /\bwindow\s*\.\s*(confirm|alert|prompt)\s*\(|(?<![.\w])alert\s*\(|\bglobalThis\s*\.\s*(confirm|alert|prompt)\s*\(|swal|sweetalert/i

function offenders(list: Array<{ file: string, source: string }>) {
  return list.filter(f => NATIVE.test(stripComments(f.source))).map(f => f.file)
}

const sources = files(APP).map(f => ({ file: relative(join(APP, '..'), f).replace(/\\/g, '/'), source: readFileSync(f, 'utf8') }))

test('no window.confirm / alert / prompt and no swal anywhere under app/', () => {
  assert.ok(sources.length > 200, 'the scan found the app sources')
  assert.deepEqual(offenders(sources), [])
})

test('the scan catches each native dialog it forbids (proof)', () => {
  for (const code of [
    'if (!window.confirm("x")) return',
    'window.alert("x")',
    'const a = window.prompt("x")',
    'alert("x")',
    'Swal.fire({})',
    "import Swal from 'sweetalert2'",
  ]) {
    assert.deepEqual(offenders([{ file: 'x.ts', source: code }]), ['x.ts'], code)
  }
  // a comment, or the site's own composable, is not a native dialog
  assert.deepEqual(offenders([{ file: 'x.ts', source: '// window.confirm is not used\nconst ok = await confirm({ message: "x" })' }]), [])
})

test('the public comment thread mounts the confirm modal that its delete flow opens', () => {
  const component = readFileSync(join(APP, 'components', 'ArticleComments.vue'), 'utf8')
  const writes = readFileSync(join(APP, 'composables', 'useCommentWrites.ts'), 'utf8')
  assert.match(writes, /confirm\(\{[\s\S]*danger: true/)
  assert.match(component, /<AdminConfirmModal\s*\/>/)
})
