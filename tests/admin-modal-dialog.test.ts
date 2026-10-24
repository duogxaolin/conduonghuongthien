/**
 * Hộp thoại modal của trang quản trị (spec `admin-dialogs`, design D-MODAL).
 *
 * Lỗi gốc: 17 lớp phủ `fixed inset-0` ở 10 tệp admin chỉ là một `<div>` mờ — không
 * `role="dialog"`, không `aria-modal`, không tên; Tab đi thẳng ra trang phía sau,
 * Escape không làm gì, đóng hộp thì focus rơi về `<body>`. Mỗi tệp tự viết lại khung
 * nên mỗi bản thiếu một thứ khác nhau. Nay có MỘT khung `AdminModal.vue` (dựng trên
 * `focus-return.ts` như `ConfirmModal.vue`) và ba lớp kiểm:
 *
 *   1. GUARD — quét CÂY TEMPLATE (không grep theo dòng: nền mờ bên trong một
 *      `role="dialog"` như `MediaLibraryModal` là đúng, grep dòng sẽ báo oan) của mọi
 *      `.vue` dưới `pages/admin`, `components/admin` và `layouts/admin.vue`. Mỗi phần
 *      tử `fixed inset-0` phải: là hộp thoại modal (`role="dialog"` + `aria-modal`),
 *      nằm trong / bọc trực tiếp một hộp thoại như thế, nằm trong `AdminModal` /
 *      `ConfirmModal`, hoặc có tên trong `EXEMPT_OVERLAYS` kèm lý do.
 *   2. RENDER — biên dịch CHÍNH `AdminModal.vue` (script + template) và render SSR với
 *      props thật: vai trò, `aria-modal`, `aria-labelledby` trỏ đúng tiêu đề, trạng
 *      thái bận khoá nút đóng.
 *   3. QUYẾT ĐỊNH — Escape / Tab / bấm nền đi qua hàm thuần ở `app/utils/admin-modal.ts`
 *      (component chỉ gọi nó). Hành vi bàn phím thật trong trình duyệt:
 *      `tests/e2e/admin-dialogs.spec.ts`.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { renderToString } from 'vue/server-renderer'

const APP = new URL('../app/', import.meta.url)
const read = (relative: string) => readFileSync(new URL(relative, APP), 'utf8')

// ─── 1. Guard ───────────────────────────────────────────────────────────────

// Kiểu nút của @vue/compiler-core (NodeTypes): chỉ phần guard cần.
const ELEMENT = 1
const ATTRIBUTE = 6
const DIRECTIVE = 7

interface TemplateProp {
  type: number
  name: string
  value?: { content: string }
  arg?: { content?: string }
  exp?: { content?: string }
  modifiers?: Array<string | { content: string }>
}
interface TemplateNode {
  type: number
  tag?: string
  props?: TemplateProp[]
  children?: TemplateNode[]
  loc: { start: { line: number } }
}

const staticAttr = (node: TemplateNode, name: string) =>
  node.props?.find(p => p.type === ATTRIBUTE && p.name === name)?.value?.content

const directiveExp = (node: TemplateNode, name: string, arg?: string) =>
  node.props?.find(p => p.type === DIRECTIVE && p.name === name && (arg === undefined || p.arg?.content === arg))?.exp?.content

/**
 * Lớp phủ = `fixed` + phủ kín cả hai chiều: `inset-0`, hoặc ghép từng cạnh
 * (`inset-x-0`/`left-0 right-0`/`left-0 w-full|w-screen` × `inset-y-0`/`top-0 bottom-0`/
 * `top-0 h-full|h-screen|h-dvh`). Chỉ bắt `fixed inset-0` thì `fixed top-0 left-0 w-full
 * h-full` — cùng một lớp phủ — lọt qua.
 */
function coversViewport(classes: string): boolean {
  const t = new Set(classes.split(/\s+/))
  if (!t.has('fixed')) return false
  const x = t.has('inset-0') || t.has('inset-x-0') || (t.has('left-0') && (t.has('right-0') || t.has('w-full') || t.has('w-screen')))
  const y = t.has('inset-0') || t.has('inset-y-0') || (t.has('top-0') && (t.has('bottom-0') || t.has('h-full') || t.has('h-screen') || t.has('h-dvh')))
  return x && y
}

/** Lớp phủ ở `class` tĩnh, hoặc trong một chuỗi chữ của `:class`. */
function isOverlay(node: TemplateNode): boolean {
  const fixed = staticAttr(node, 'class')
  if (fixed && coversViewport(fixed)) return true
  const bound = directiveExp(node, 'bind', 'class')
  if (!bound) return false
  for (const literal of bound.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)) {
    if (coversViewport(literal[1] ?? literal[2] ?? literal[3] ?? '')) return true
  }
  return false
}

const DIALOG_ROLES = ['dialog', 'alertdialog']
const isDialogRole = (node: TemplateNode) => DIALOG_ROLES.includes(staticAttr(node, 'role') ?? '')
const isModalDialog = (node: TemplateNode) => isDialogRole(node) && staticAttr(node, 'aria-modal') === 'true'

/** Khung dùng chung đã mang ngữ nghĩa + hành vi hộp thoại. */
const DIALOG_SHELLS = new Set(['AdminModal', 'admin-modal', 'ConfirmModal', 'AdminConfirmModal', 'admin-confirm-modal'])
const isDialogShell = (node: TemplateNode) => DIALOG_SHELLS.has(node.tag ?? '')

const elementChildren = (node: TemplateNode) => (node.children ?? []).filter(child => child.type === ELEMENT)

type Verdict = 'dialog' | 'dialog-backdrop' | 'wraps-dialog' | 'bare'
interface OverlayFinding { line: number; vIf: string | null; verdict: Verdict }

/**
 * Mọi lớp phủ trong template của một SFC, kèm lý do nó (không) là modal.
 *
 * Lớp phủ nằm TRONG một hộp thoại chỉ hợp lệ khi nó là nền mờ trống, con trực tiếp của
 * hộp (MediaLibraryModal cũ, ScanThumbnailsModal). Một lớp phủ có nội dung nằm trong
 * thân hộp thoại / thân `AdminModal` là một hộp thoại lồng không có ngữ nghĩa → `bare`.
 */
function classifyOverlays(source: string, filename = 'inline.vue'): OverlayFinding[] {
  const { descriptor } = parse(source, { filename })
  const root = descriptor.template?.ast as TemplateNode | undefined
  if (!root) return []
  const found: OverlayFinding[] = []
  const visit = (node: TemplateNode, ancestors: TemplateNode[]) => {
    if (node.type === ELEMENT && isOverlay(node)) {
      const parent = ancestors.at(-1)
      const empty = elementChildren(node).length === 0 && !(node.children ?? []).some(child => child.type !== 3 /* COMMENT */)
      let verdict: Verdict = 'bare'
      if (isModalDialog(node)) verdict = 'dialog'
      else if (parent && isModalDialog(parent) && empty) verdict = 'dialog-backdrop'
      else if (elementChildren(node).some(isModalDialog)) verdict = 'wraps-dialog'
      found.push({ line: node.loc.start.line, vIf: directiveExp(node, 'if') ?? null, verdict })
    }
    const next = node.type === ELEMENT ? [...ancestors, node] : ancestors
    for (const child of node.children ?? []) visit(child, next)
  }
  visit(root, [])
  return found
}

/** `role="dialog"` không có tên truy cập (`aria-label`/`aria-labelledby`, tĩnh hoặc bind không thể ra `undefined`). */
function unnamedDialogs(source: string, filename = 'inline.vue'): number[] {
  const { descriptor } = parse(source, { filename })
  const root = descriptor.template?.ast as TemplateNode | undefined
  if (!root) return []
  const lines: number[] = []
  const named = (node: TemplateNode) => {
    if (staticAttr(node, 'aria-label')?.trim() || staticAttr(node, 'aria-labelledby')?.trim()) return true
    const bound = directiveExp(node, 'bind', 'aria-labelledby') ?? directiveExp(node, 'bind', 'aria-label')
    return !!bound && !/\bundefined\b|\bnull\b/.test(bound)
  }
  const visit = (node: TemplateNode) => {
    if (node.type === ELEMENT && isDialogRole(node) && !named(node)) lines.push(node.loc.start.line)
    for (const child of node.children ?? []) visit(child)
  }
  visit(root)
  return lines
}

/**
 * `@keyup` trên một điều khiển BÊN TRONG hộp thoại. Hộp mở bằng Enter trên nút (kích
 * hoạt ở `keydown`) rồi đưa focus vào ô đầu tiên — phím được THẢ ở ô đó, nên `@keyup.enter`
 * chạy mà người dùng chưa gõ gì (ngăn kéo "Phiên bản" tự lưu một bản sao lưu, hộp MFA báo
 * "chưa nhập mật khẩu"). Trong hộp thoại dùng `@keydown`.
 */
function keyupInsideDialogs(source: string, filename = 'inline.vue'): number[] {
  const { descriptor } = parse(source, { filename })
  const root = descriptor.template?.ast as TemplateNode | undefined
  if (!root) return []
  const lines: number[] = []
  const visit = (node: TemplateNode, insideDialog: boolean) => {
    const here = insideDialog || (node.type === ELEMENT && (isDialogRole(node) || isDialogShell(node)))
    if (node.type === ELEMENT && here && node.props?.some(p => p.type === DIRECTIVE && p.name === 'on' && p.arg?.content === 'keyup')) {
      lines.push(node.loc.start.line)
    }
    for (const child of node.children ?? []) visit(child, here)
  }
  visit(root, false)
  return lines
}

/**
 * Mọi `@keydown.enter` bên trong hộp thoại, và handler của nó có lọc bằng
 * `isDeliberateEnter` không (trực tiếp trong biểu thức, hoặc trong thân hàm cùng tệp
 * mà biểu thức gọi). Thiếu lọc: giữ Enter (phím lặp) hay chốt chữ của bộ gõ tiếng Việt
 * (Safari: `keyCode 229`) đều gửi biểu mẫu.
 */
function enterHandlersInsideDialogs(source: string, filename = 'inline.vue'): Array<{ line: number; handler: string; deliberate: boolean }> {
  const { descriptor } = parse(source, { filename })
  const root = descriptor.template?.ast as TemplateNode | undefined
  if (!root) return []
  const script = descriptor.scriptSetup?.content ?? descriptor.script?.content ?? ''
  const bodyOf = (name: string) => {
    const start = script.search(new RegExp(`(?:function\\s+${name}\\s*\\(|const\\s+${name}\\s*=)`))
    if (start < 0) return ''
    const rest = script.slice(start + 1)
    const end = rest.search(/\n(?:async\s+)?function\s|\nconst\s|\nlet\s|\nwatch\(|\nonMounted\(|\ndefineExpose/)
    return script.slice(start, end < 0 ? undefined : start + 1 + end)
  }
  const found: Array<{ line: number; handler: string; deliberate: boolean }> = []
  const visit = (node: TemplateNode, insideDialog: boolean) => {
    const here = insideDialog || (node.type === ELEMENT && (isDialogRole(node) || isDialogShell(node)))
    if (node.type === ELEMENT && here) {
      for (const prop of node.props ?? []) {
        if (prop.type !== DIRECTIVE || prop.name !== 'on' || prop.arg?.content !== 'keydown') continue
        const modifiers = (prop.modifiers ?? []).map(m => (typeof m === 'string' ? m : m.content))
        if (!modifiers.includes('enter')) continue
        const handler = prop.exp?.content ?? ''
        const name = handler.match(/^\s*([A-Za-z_$][\w$]*)/)?.[1] ?? ''
        const deliberate = handler.includes('isDeliberateEnter(') || (!!name && bodyOf(name).includes('isDeliberateEnter('))
        found.push({ line: node.loc.start.line, handler, deliberate })
      }
    }
    for (const child of node.children ?? []) visit(child, here)
  }
  visit(root, false)
  return found
}

/** `aria-labelledby` của hộp thoại trỏ tới id KHÔNG có trong template (tên rỗng). */
function labelledbyTargetsMissing(source: string, filename = 'inline.vue'): string[] {
  const { descriptor } = parse(source, { filename })
  const root = descriptor.template?.ast as TemplateNode | undefined
  if (!root) return []
  const staticIds = new Set<string>()
  const boundIds = new Set<string>()
  const dialogs: TemplateNode[] = []
  const visit = (node: TemplateNode) => {
    if (node.type === ELEMENT) {
      const id = staticAttr(node, 'id')
      if (id) staticIds.add(id)
      const bound = directiveExp(node, 'bind', 'id')
      if (bound) boundIds.add(bound.trim())
      if (isDialogRole(node)) dialogs.push(node)
    }
    for (const child of node.children ?? []) visit(child)
  }
  visit(root)
  const missing: string[] = []
  for (const dialog of dialogs) {
    const fixed = staticAttr(dialog, 'aria-labelledby')
    if (fixed) for (const id of fixed.split(/\s+/).filter(Boolean)) if (!staticIds.has(id)) missing.push(id)
    const bound = directiveExp(dialog, 'bind', 'aria-labelledby')?.trim()
    if (!bound) continue
    const literals = [...bound.matchAll(/'([^']+)'|"([^"]+)"/g)].map(m => m[1] ?? m[2] ?? '')
    if (literals.length) {
      for (const id of literals) if (!staticIds.has(id)) missing.push(id)
    } else if (!boundIds.has(bound)) {
      missing.push(bound)
    }
  }
  return missing
}

/**
 * Lớp phủ cố ý KHÔNG phải hộp thoại modal. Khoá bằng biểu thức `v-if` (không theo số
 * dòng — dòng xê dịch theo mọi lần sửa). Thêm mục mới phải trả lời được: "lớp phủ này
 * chặn trang mà không phải hộp thoại vì sao?".
 */
const EXEMPT_OVERLAYS: Array<{ file: string; vIf: string; reason: string }> = [
  {
    file: 'components/admin/builder/PropertyPanel.vue',
    vIf: 'expanded',
    reason: 'nền của chế độ "mở rộng" của chính cột thuộc tính trong trình dựng trang: cùng một panel phóng to tại chỗ (nút bật/tắt `aria-pressed`), không phải hộp thoại mới mở ra',
  },
  {
    file: 'layouts/admin.vue',
    vIf: 'isMobileMenuOpen',
    reason: 'nền của sidebar điều hướng trên màn hẹp — ngăn kéo điều hướng của layout, không phải hộp thoại; bấm nền chỉ đóng menu',
  },
]

function adminVueFiles(): string[] {
  const found: string[] = ['layouts/admin.vue']
  const walk = (relative: string) => {
    for (const entry of readdirSync(new URL(relative, APP), { withFileTypes: true })) {
      const child = `${relative}/${entry.name}`
      if (entry.isDirectory()) walk(child)
      else if (entry.name.endsWith('.vue')) found.push(child)
    }
  }
  walk('pages/admin')
  walk('components/admin')
  return found.sort()
}

test('classifier: nhận ra lớp phủ và các dạng làm nó thành hộp thoại modal', () => {
  const verdicts = (template: string) => classifyOverlays(`<template>${template}</template>`).map(f => f.verdict)

  // Lớp phủ trần — đúng thứ guard phải bắt (17 chỗ trên a7be585).
  assert.deepEqual(verdicts('<div v-if="open" class="fixed inset-0 bg-black/40" @click.self="open = false"><div class="bg-white">x</div></div>'), ['bare'])
  // role="dialog" mà thiếu aria-modal vẫn chưa phải modal.
  assert.deepEqual(verdicts('<div class="fixed inset-0" role="dialog"></div>'), ['bare'])
  assert.deepEqual(verdicts('<div class="fixed inset-0" role="dialog" aria-modal="true"></div>'), ['dialog'])
  // Nền mờ TRỐNG, con trực tiếp của hộp thoại (ScanThumbnailsModal).
  assert.deepEqual(verdicts('<div class="fixed inset-0" role="dialog" aria-modal="true"><div class="fixed inset-0 bg-black/60" @click="close"></div></div>'), ['dialog', 'dialog-backdrop'])
  // Lớp phủ CÓ nội dung nằm trong thân hộp thoại = hộp thoại lồng không ngữ nghĩa.
  assert.deepEqual(verdicts('<div class="fixed inset-0" role="dialog" aria-modal="true"><div><div class="fixed inset-0"><button>x</button></div></div></div>'), ['dialog', 'bare'])
  // Nền bọc trực tiếp khung mang vai trò (ChatbotSmallTalkPanel).
  assert.deepEqual(verdicts('<div class="fixed inset-0 bg-black/40"><div role="dialog" aria-modal="true">x</div></div>'), ['wraps-dialog'])
  // Hộp thoại ở tầng sâu hơn KHÔNG được tính là "bọc trực tiếp".
  assert.deepEqual(verdicts('<div class="fixed inset-0"><div><div role="dialog" aria-modal="true"></div></div></div>'), ['bare'])
  // Lớp phủ tự viết lồng trong thân AdminModal cũng phải là hộp thoại.
  assert.deepEqual(verdicts('<AdminModal :open="x" title="t"><div class="fixed inset-0"><p>y</p></div></AdminModal>'), ['bare'])
  // `:class` cũng bị quét; `absolute inset-0` và `fixed inset-x-4` không phải lớp phủ.
  assert.deepEqual(verdicts(`<div :class="big ? 'fixed inset-0 z-50' : 'h-full'"></div>`), ['bare'])
  assert.deepEqual(verdicts('<div class="absolute inset-0"></div><div class="fixed inset-x-4 top-16"></div>'), [])
  // Lớp phủ ghép từng cạnh vẫn là lớp phủ; sidebar `fixed top-0 bottom-0 left-0` thì không.
  assert.deepEqual(verdicts('<div class="fixed top-0 left-0 w-full h-full bg-black/50"></div>'), ['bare'])
  assert.deepEqual(verdicts('<div class="fixed inset-x-0 inset-y-0"></div><div class="fixed left-0 right-0 top-0 bottom-0"></div>'), ['bare', 'bare'])
  assert.deepEqual(verdicts('<aside class="fixed top-0 bottom-0 left-0 w-64"></aside><div class="fixed top-0 left-0 w-full h-16"></div>'), [])
})

test('classifier: hộp thoại phải có tên; @keyup trong hộp thoại bị bắt', () => {
  const unnamed = (template: string) => unnamedDialogs(`<template>${template}</template>`).length
  assert.equal(unnamed('<div role="dialog" aria-modal="true"></div>'), 1)
  assert.equal(unnamed('<div role="dialog" aria-labelledby="t"></div><div role="dialog" aria-label="Thư viện"></div>'), 0)
  assert.equal(unnamed(`<div role="dialog" :aria-labelledby="titleId"></div>`), 0)
  // Tên bind có thể ra `undefined` không phải tên chắc chắn (ConfirmModal không tiêu đề).
  assert.equal(unnamed(`<div role="dialog" :aria-labelledby="hasTitle ? 'x' : undefined"></div>`), 1)

  const keyups = (template: string) => keyupInsideDialogs(`<template>${template}</template>`).length
  assert.equal(keyups('<input @keyup.enter="search" />'), 0, 'ô tìm kiếm của trang (ngoài hộp thoại) không bị cấm')
  assert.equal(keyups('<AdminModal :open="o" title="t"><input @keyup.enter="save" /></AdminModal>'), 1)
  assert.equal(keyups('<div role="dialog" aria-label="x"><div><input @keyup.enter="submit" /></div></div>'), 1)
  assert.equal(keyups('<AdminModal :open="o" title="t"><input @keydown.enter.prevent="save" /></AdminModal>'), 0)
})

test('mọi role="dialog" trong admin có tên truy cập', () => {
  const offenders: string[] = []
  for (const file of adminVueFiles()) {
    for (const line of unnamedDialogs(read(file), file)) offenders.push(`${file}:${line}`)
  }
  assert.deepEqual(offenders, [], 'Hộp thoại không tên: trình đọc màn hình chỉ đọc "hộp thoại". Dùng <AdminModal title=…> hoặc aria-labelledby trỏ tiêu đề.')
})

test('không có @keyup nào bên trong hộp thoại admin (phím mở hộp được thả vào ô đầu tiên)', () => {
  const offenders: string[] = []
  for (const file of adminVueFiles()) {
    for (const line of keyupInsideDialogs(read(file), file)) offenders.push(`${file}:${line}`)
  }
  assert.deepEqual(offenders, [], 'Dùng @keydown.enter (kèm bỏ qua lúc đang gõ dấu — isComposing) thay cho @keyup trong hộp thoại.')
})

test('mọi lớp phủ admin là hộp thoại modal, nằm trong AdminModal/ConfirmModal, hoặc được miễn có lý do', () => {
  const offenders: string[] = []
  for (const file of adminVueFiles()) {
    for (const finding of classifyOverlays(read(file), file)) {
      if (finding.verdict !== 'bare') continue
      if (EXEMPT_OVERLAYS.some(e => e.file === file && e.vIf === finding.vIf)) continue
      offenders.push(`${file}:${finding.line}${finding.vIf ? ` (v-if="${finding.vIf}")` : ''}`)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'Lớp phủ chặn trang mà không phải hộp thoại: bàn phím đi ra sau, trình đọc màn hình không biết có hộp thoại. '
    + 'Dùng <AdminModal> (app/components/admin/AdminModal.vue), hoặc thêm vào EXEMPT_OVERLAYS kèm lý do.',
  )
})

test('danh sách miễn không mục nào cũ: mỗi mục còn khớp đúng một lớp phủ trần', () => {
  for (const exemption of EXEMPT_OVERLAYS) {
    assert.ok(exemption.reason.length > 40, `${exemption.file}: lý do miễn phải nói được vì sao không phải hộp thoại`)
    const matches = classifyOverlays(read(exemption.file), exemption.file)
      .filter(f => f.vIf === exemption.vIf && f.verdict === 'bare')
    assert.equal(matches.length, 1, `${exemption.file} v-if="${exemption.vIf}" không còn khớp — gỡ khỏi EXEMPT_OVERLAYS`)
  }
})

/**
 * Hộp thoại dựng bằng AdminModal. 17 lớp phủ của D-MODAL: 15 hộp thoại + 2 ngăn kéo của
 * trình dựng trang (bảng khối, phiên bản) — hai ngăn kéo có nền mờ chặn cả trang và bấm
 * nền để đóng, tức là modal, nên KHÔNG được miễn mà dùng `size="drawer"`. Cộng 6 hộp có
 * sẵn `role="dialog"` nhưng không tên, không bẫy Tab/`inert`/trả focus (ngôn ngữ ×2,
 * nhắc dịch lại bài, xem nhanh bản dịch, dịch toàn bộ, thư viện ảnh).
 * Ghim số lượng: quay về `<div>` tự viết (kể cả có `role="dialog"`) là mất bẫy Tab,
 * Escape, `inert` và trả focus mà guard ở trên không thấy được.
 */
const MIGRATED_TO_ADMIN_MODAL: Record<string, number> = {
  'pages/admin/content/content-types.vue': 1,
  'pages/admin/content/categories/index.vue': 1,
  'pages/admin/content/pages/index.vue': 1,
  'pages/admin/content/pages/[id].vue': 3,
  'pages/admin/users/index.vue': 2,
  'pages/admin/media-portal/categories.vue': 1,
  'components/admin/SubmissionDetailModal.vue': 1,
  'components/admin/ContentTypePicker.vue': 1,
  'components/admin/ai/AiServicesTab.vue': 1,
  'components/admin/ai/AiProvidersTab.vue': 5,
  'pages/admin/languages/index.vue': 2,
  'pages/admin/content/articles/[id].vue': 1,
  'components/admin/articles/ArticleQuickViewModal.vue': 1,
  'components/admin/articles/ArticleGlobalTranslateModal.vue': 1,
  'components/admin/MediaLibraryModal.vue': 1,
}

test('23 hộp thoại admin dựng bằng AdminModal (17 của D-MODAL + 6 hộp không tên)', () => {
  assert.equal(Object.values(MIGRATED_TO_ADMIN_MODAL).reduce((a, b) => a + b, 0), 23)
  for (const [file, expected] of Object.entries(MIGRATED_TO_ADMIN_MODAL)) {
    const source = read(file)
    const { descriptor } = parse(source, { filename: file })
    let count = 0
    const visit = (node: TemplateNode) => {
      if (node.type === ELEMENT && node.tag === 'AdminModal') count += 1
      for (const child of node.children ?? []) visit(child)
    }
    visit(descriptor.template!.ast as TemplateNode)
    assert.equal(count, expected, `${file}: cần ${expected} <AdminModal>, thấy ${count}`)
    assert.match(
      descriptor.scriptSetup?.content ?? '',
      /import AdminModal from '~\/components\/admin\/AdminModal\.vue'/,
      `${file} phải import AdminModal tường minh`,
    )
  }
})

test('AdminModal nằm trên layout admin và DƯỚI ConfirmModal (hộp xác nhận mở đè lên được)', () => {
  const zOf = (file: string) => {
    const match = read(file).match(/fixed inset-0[^"]*\bz-\[(\d+)\]/)
    assert.ok(match, `${file}: không tìm thấy z-index của lớp phủ`)
    return Number(match[1])
  }
  const modal = zOf('components/admin/AdminModal.vue')
  assert.ok(modal < zOf('components/admin/ConfirmModal.vue'), 'ConfirmModal phải đè lên AdminModal')
  // Sidebar admin `z-50`, header `z-30`.
  assert.ok(modal > 50, 'AdminModal phải đè lên sidebar/header của layout admin')
})

// ─── 2. Render: chính AdminModal.vue, props thật ────────────────────────────

/**
 * Biên dịch script + template của SFC (`inlineTemplate`), gỡ kiểu TS, thay `import`
 * bằng module do test cấp. Khác `_render-sfc-template.ts` (setup giả): ở đây props,
 * slot và `useId()` là thật.
 */
async function loadAdminModal(): Promise<Vue.Component> {
  const file = new URL('components/admin/AdminModal.vue', APP)
  const { descriptor } = parse(readFileSync(file, 'utf8'), { filename: file.pathname })
  const compiled = compileScript(descriptor, { id: 'admin-modal-test', inlineTemplate: true })
  const modules: Record<string, unknown> = {
    vue: Vue,
    '~/utils/focus-return': await import('../app/utils/focus-return.ts'),
    '~/utils/admin-modal': await import('../app/utils/admin-modal.ts'),
  }
  const code = stripTypeScriptTypes(compiled.content)
    .replace(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?/g, (_m, names: string, from: string) => {
      if (!(from in modules)) throw new Error(`AdminModal.vue import ngoài dự kiến: ${from}`)
      return `const {${names.replace(/\s+as\s+/g, ': ')}} = __modules[${JSON.stringify(from)}];`
    })
    .replace(/export default/, 'return')
  return new Function('__modules', code)(modules) as Vue.Component
}

interface Rendered { body: string; teleported: string }

async function renderModals(...modals: Array<{ props: Record<string, unknown>; footer?: boolean }>): Promise<Rendered> {
  const AdminModal = await loadAdminModal()
  const app = Vue.createSSRApp({
    render: () => modals.map(({ props, footer }) => Vue.h(AdminModal, props, {
      default: () => Vue.h('p', { 'data-slot': 'body' }, 'Nội dung biểu mẫu'),
      ...(footer ? { footer: () => Vue.h('button', { type: 'button', 'data-slot': 'footer' }, 'Lưu') } : {}),
    })),
  })
  app.config.warnHandler = () => {}
  const ctx: { teleports?: Record<string, string> } = {}
  const body = await renderToString(app, ctx)
  return { body, teleported: ctx.teleports?.body ?? '' }
}

const dialogTag = (html: string) => html.match(/<div[^>]*role="dialog"[^>]*>/)?.[0] ?? ''
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]
const closeButton = (html: string) => html.match(/<button[^>]*aria-label="Đóng"[^>]*>/)?.[0] ?? ''
/** Thuộc tính `disabled` — không phải biến thể `disabled:` của Tailwind trong `class`. */
const DISABLED_ATTR = /\sdisabled(?:=""|(?=[\s>]))/

test('AdminModal đóng: không render gì', async () => {
  const { teleported, body } = await renderModals({ props: { open: false, title: 'Thêm người dùng' } })
  assert.doesNotMatch(teleported + body, /role="dialog"/)
  assert.doesNotMatch(teleported + body, /Nội dung biểu mẫu/)
})

test('AdminModal mở: role="dialog", aria-modal, tên lấy từ tiêu đề, slot nội dung + chân', async () => {
  const { teleported } = await renderModals({ props: { open: true, title: 'Thêm người dùng' }, footer: true })
  const dialog = dialogTag(teleported)
  assert.ok(dialog, 'hộp thoại phải render (Teleport tới body)')
  assert.equal(attr(dialog, 'aria-modal'), 'true')
  assert.equal(attr(dialog, 'aria-busy'), undefined)
  const labelledby = attr(dialog, 'aria-labelledby')
  assert.ok(labelledby, 'phải có aria-labelledby')
  const heading = teleported.match(new RegExp(`<h2[^>]*id="${labelledby}"[^>]*>([\\s\\S]*?)</h2>`))
  assert.ok(heading, 'aria-labelledby phải trỏ tới tiêu đề hộp thoại')
  assert.match(heading[1]!, /Thêm người dùng/)
  assert.match(teleported, /data-slot="body"[^>]*>Nội dung biểu mẫu/)
  assert.match(teleported, /data-slot="footer"/)
  const close = closeButton(teleported)
  assert.ok(close, 'nút đóng có tên truy cập "Đóng"')
  assert.doesNotMatch(close, DISABLED_ATTR)
  // Không có slot chân thì không có dải chân trống.
  const bare = await renderModals({ props: { open: true, title: 'x' } })
  assert.doesNotMatch(bare.teleported, /<footer/)
})

test('AdminModal bận: aria-busy và nút đóng bị khoá (không đóng giữa lúc lưu)', async () => {
  const { teleported } = await renderModals({ props: { open: true, title: 'Đang lưu', busy: true } })
  assert.equal(attr(dialogTag(teleported), 'aria-busy'), 'true')
  assert.match(closeButton(teleported), DISABLED_ATTR)
})

test('hai AdminModal trên cùng trang có id tiêu đề khác nhau', async () => {
  const { teleported } = await renderModals(
    { props: { open: true, title: 'Tạo tài khoản' } },
    { props: { open: true, title: 'Sửa tài khoản' } },
  )
  const ids = [...teleported.matchAll(/aria-labelledby="([^"]+)"/g)].map(m => m[1])
  assert.equal(ids.length, 2)
  assert.notEqual(ids[0], ids[1])
})

test('kích thước: mặc định md, sm hẹp hơn, drawer là ngăn kéo phải toàn chiều cao', async () => {
  const panel = (html: string) => html.match(/<div[^>]*data-admin-modal-panel[^>]*>/)?.[0] ?? ''
  const md = (await renderModals({ props: { open: true, title: 'x' } })).teleported
  assert.match(panel(md), /max-w-lg/)
  assert.doesNotMatch(dialogTag(md), /justify-end/)
  assert.match(panel((await renderModals({ props: { open: true, title: 'x', size: 'sm' } })).teleported), /max-w-md/)
  const drawer = (await renderModals({ props: { open: true, title: 'x', size: 'drawer' } })).teleported
  assert.match(dialogTag(drawer), /justify-end/)
  assert.match(panel(drawer), /h-full/)
})

// ─── 3. Quyết định bàn phím / bấm nền ───────────────────────────────────────

test('Escape đóng khi không bận; bị chặn khi đang lưu', async () => {
  const { adminModalKeyAction } = await import('../app/utils/admin-modal.ts')
  const base = { key: 'Escape', busy: false, defaultPrevented: false, covered: false, inside: true, focusLost: false }
  assert.equal(adminModalKeyAction(base), 'close')
  assert.equal(adminModalKeyAction({ ...base, busy: true }), 'none')
  // Nút "Lưu" bị disabled lúc lưu → trình duyệt đẩy focus về <body>. Lưu hỏng xong,
  // Escape vẫn phải đóng được hộp.
  assert.equal(adminModalKeyAction({ ...base, inside: false, focusLost: true }), 'close')
  // ConfirmModal đang mở đè lên (hộp này bị `inert`): Escape chỉ đóng hộp xác nhận.
  assert.equal(adminModalKeyAction({ ...base, covered: true }), 'none')
  // Phím xảy ra ở một lớp khác (toast, thư viện ảnh mở đè) không phải của hộp này.
  assert.equal(adminModalKeyAction({ ...base, inside: false }), 'none')
  // Một điều khiển bên trong đã tự xử lý Escape.
  assert.equal(adminModalKeyAction({ ...base, defaultPrevented: true }), 'none')
  assert.equal(adminModalKeyAction({ ...base, key: 'Enter' }), 'none')
})

test('Tab bị bẫy trong hộp, kể cả khi focus đã rơi về <body>; không đụng lớp khác', async () => {
  const { adminModalKeyAction } = await import('../app/utils/admin-modal.ts')
  const base = { key: 'Tab', busy: false, defaultPrevented: false, covered: false, inside: true, focusLost: false }
  assert.equal(adminModalKeyAction(base), 'trap')
  assert.equal(adminModalKeyAction({ ...base, busy: true }), 'trap', 'đang lưu vẫn không được Tab ra sau hộp')
  assert.equal(adminModalKeyAction({ ...base, inside: false, focusLost: true }), 'trap')
  assert.equal(adminModalKeyAction({ ...base, inside: false }), 'none')
  assert.equal(adminModalKeyAction({ ...base, covered: true }), 'none')
})

test('bấm nền đóng hộp chỉ khi cả nhấn lẫn thả đều ở nền, và không đang lưu', async () => {
  const { adminModalBackdropCloses } = await import('../app/utils/admin-modal.ts')
  assert.equal(adminModalBackdropCloses({ busy: false, pressStartedOnBackdrop: true, clickOnBackdrop: true }), true)
  assert.equal(adminModalBackdropCloses({ busy: true, pressStartedOnBackdrop: true, clickOnBackdrop: true }), false)
  // Bôi đen chữ trong ô nhập rồi thả chuột ra ngoài khung: trình duyệt bắn click lên
  // nền (tổ tiên chung) — không được đóng mất biểu mẫu đang gõ.
  assert.equal(adminModalBackdropCloses({ busy: false, pressStartedOnBackdrop: false, clickOnBackdrop: true }), false)
  assert.equal(adminModalBackdropCloses({ busy: false, pressStartedOnBackdrop: true, clickOnBackdrop: false }), false)
})

test('focus mở đầu: phần tử được chỉ định (data-autofocus/autofocus) thắng ô đầu tiên của thân', async () => {
  const { pickInitialFocus } = await import('../app/utils/admin-modal.ts')
  const root = 'root'
  assert.equal(pickInitialFocus({ designated: 'search', body: 'first-field', footer: 'save', close: 'x', root }), 'search')
  assert.equal(pickInitialFocus({ designated: null, body: 'first-field', footer: 'save', close: 'x', root }), 'first-field')
  // Đang tải (thân chưa có điều khiển): hàng nút, rồi nút đóng, rồi chính hộp.
  assert.equal(pickInitialFocus({ designated: null, body: null, footer: 'save', close: 'x', root }), 'save')
  assert.equal(pickInitialFocus({ designated: null, body: null, footer: null, close: 'x', root }), 'x')
  assert.equal(pickInitialFocus({ designated: null, body: null, footer: null, close: null, root }), 'root')
})

test('trả focus khi nút mở đã bị gỡ: tìm lại theo khoá ổn định, không thì về <main> — không bao giờ để ở <body>', async () => {
  const { openerKeyOf, focusFallbackTarget, ADMIN_MODAL_OPENER_ATTR } = await import('../app/utils/admin-modal.ts')
  const marked = (value: string | null, id = '') => ({
    id,
    closest: (selector: string) => (selector === `[${ADMIN_MODAL_OPENER_ATTR}]` && value !== null ? { getAttribute: () => value } : null),
  })
  // Khoá đánh dấu thắng id (id có thể trùng giữa bản desktop/mobile của cùng một hàng).
  assert.deepEqual(openerKeyOf(marked('submission-12', 'btn-1')), { attr: ADMIN_MODAL_OPENER_ATTR, value: 'submission-12' })
  assert.deepEqual(openerKeyOf(marked(null, 'add-user')), { attr: 'id', value: 'add-user' })
  assert.equal(openerKeyOf(marked(null)), null)
  assert.equal(openerKeyOf(null), null)

  const lookups: string[] = []
  const find = (key: { value: string }) => { lookups.push(key.value); return key.value === 'submission-12' ? 'row-button' : null }
  const main = () => 'main'
  // Danh sách đã vẽ lại: nút cùng khoá được tìm thấy.
  assert.deepEqual(focusFallbackTarget({ attr: ADMIN_MODAL_OPENER_ATTR, value: 'submission-12' }, { find, main }), { target: 'row-button', refound: true })
  // Hàng chưa/không còn trong danh sách → đỗ ở vùng nội dung chính (nơi gọi chờ nút về).
  assert.deepEqual(focusFallbackTarget({ attr: ADMIN_MODAL_OPENER_ATTR, value: 'submission-99' }, { find, main }), { target: 'main', refound: false })
  assert.deepEqual(focusFallbackTarget(null, { find, main }), { target: 'main', refound: false })
  assert.deepEqual(lookups, ['submission-12', 'submission-99'])
})

test('phím đang GIỮ lúc hộp mở: lặp (autorepeat) và lần thả bị nuốt tới khi có một lần nhấn mới', async () => {
  const { createHeldKeyGuard } = await import('../app/utils/admin-modal.ts')
  const guard = createHeldKeyGuard()
  // Chưa mở hộp: không đụng gì.
  assert.equal(guard.keydown({ repeat: true }), false)
  assert.equal(guard.keyup(), false)

  // Enter giữ trên nút mở: hộp mở ở keydown đầu, các keydown lặp sau đó rơi vào ô
  // vừa nhận focus — mỗi lần là một lần "lưu bản sao lưu".
  guard.arm()
  assert.equal(guard.keydown({ repeat: true }), true)
  assert.equal(guard.keydown({ repeat: true }), true)
  assert.equal(guard.keyup(), true, 'lần thả của phím đã mở hộp cũng bị nuốt')
  // Sau khi thả, phím người dùng gõ trong hộp đi qua bình thường.
  assert.equal(guard.keydown({ repeat: false }), false)
  assert.equal(guard.keyup(), false)

  // Một lần nhấn MỚI trong hộp (không lặp) chấm dứt việc nuốt ngay.
  guard.arm()
  assert.equal(guard.keydown({ repeat: false }), false)
  assert.equal(guard.keydown({ repeat: true }), false, 'giữ phím CỦA NGƯỜI DÙNG trong hộp (vd. xoá chữ) không bị nuốt')
  assert.equal(guard.keyup(), false)

  guard.arm(); guard.disarm()
  assert.equal(guard.keydown({ repeat: true }), false)
})

test('Enter có chủ đích: không lặp, không đang gõ dấu', async () => {
  const { isDeliberateEnter } = await import('../app/utils/admin-modal.ts')
  assert.equal(isDeliberateEnter({ key: 'Enter', repeat: false, isComposing: false, keyCode: 13 }), true)
  assert.equal(isDeliberateEnter({ key: 'Enter', repeat: true, isComposing: false, keyCode: 13 }), false)
  assert.equal(isDeliberateEnter({ key: 'Enter', repeat: false, isComposing: true, keyCode: 13 }), false, 'IME tiếng Việt chốt chữ bằng Enter')
  // Safari chốt chữ của bộ gõ bằng keydown `isComposing: false` nhưng `keyCode: 229`.
  assert.equal(isDeliberateEnter({ key: 'Enter', repeat: false, isComposing: false, keyCode: 229 }), false, 'Safari + IME: keyCode 229')
  assert.equal(isDeliberateEnter({ key: 'a', repeat: false, isComposing: false, keyCode: 65 }), false)
})

test('restore() chỉ báo thành công khi focus THỰC SỰ tới nút mở (nút bị disabled/mất tabindex thì không)', async () => {
  const { createFocusReturn } = await import('../app/utils/focus-return.ts')
  let active: unknown = 'body'
  const focusable = { isConnected: true, focus() { active = focusable } }
  const disabledOpener = { isConnected: true, focus() { /* nút disabled: trình duyệt bỏ qua */ } }

  const ok = createFocusReturn(() => false, () => active)
  ok.remember(focusable)
  assert.equal(ok.restore(), true)
  assert.equal(active, focusable)

  active = 'body'
  const lost = createFocusReturn(() => false, () => active)
  lost.remember(disabledOpener)
  assert.equal(lost.restore(), false, 'focus còn ở <body> — nơi gọi phải chạy đường dự phòng')
})

test('nơi "đỗ" focus dự phòng: <main> mang tabindex tạm có dấu, rời focus là gỡ, và không bao giờ được nhớ làm nút mở', async () => {
  const { parkFocusOn, isFocusPark, rememberableOpener, FOCUS_PARK_ATTR } = await import('../app/utils/admin-modal.ts')
  const attrs = new Map<string, string>()
  let onBlur: (() => void) | null = null
  const main = {
    hasAttribute: (n: string) => attrs.has(n),
    setAttribute: (n: string, v: string) => { attrs.set(n, v) },
    removeAttribute: (n: string) => { attrs.delete(n) },
    addEventListener: (_type: 'blur', fn: () => void) => { onBlur = fn },
  }
  assert.equal(parkFocusOn(main), main)
  assert.equal(attrs.get('tabindex'), '-1')
  assert.ok(attrs.has(FOCUS_PARK_ATTR))
  assert.equal(isFocusPark(main), true)
  // Hộp B mở trong lúc focus đang đỗ ở <main>: <main> KHÔNG được nhớ làm nút mở (thuộc
  // tính tạm sẽ bị gỡ lúc focus rời đi → trả focus về nó là rơi xuống <body>).
  const body = { hasAttribute: () => false }
  assert.equal(rememberableOpener(main, body), null)
  assert.equal(rememberableOpener(body, body), null)
  const button = { hasAttribute: () => false }
  assert.equal(rememberableOpener(button, body), button)
  // Rời focus: gỡ đúng hai thuộc tính đã gắn.
  onBlur!()
  assert.equal(attrs.size, 0)
  // <main> vốn có tabindex của trang: không gắn dấu, không gỡ.
  attrs.set('tabindex', '0')
  onBlur = null
  assert.equal(parkFocusOn(main), main)
  assert.equal(isFocusPark(main), false)
  assert.equal(onBlur, null)
  assert.equal(parkFocusOn(null), null)
})

test('focus rơi khỏi hộp đang mở (điều khiển bị gỡ/disabled) → kéo lại; hộp bị phủ thì để lớp trên lo', async () => {
  const { focusEscaped, shouldMoveToReturnedOpener } = await import('../app/utils/admin-modal.ts')
  const body = {}
  assert.equal(focusEscaped({ active: body, body, covered: false }), true)
  assert.equal(focusEscaped({ active: null, body, covered: false }), true)
  assert.equal(focusEscaped({ active: body, body, covered: true }), false, 'ConfirmModal đang mở đè lên: không giật focus của nó')
  assert.equal(focusEscaped({ active: {}, body, covered: false }), false)

  // Đã đỗ focus ở <main> chờ danh sách tải lại: nút cùng khoá xuất hiện thì chuyển về
  // nó — chỉ khi người dùng chưa tự đi chỗ khác.
  const parked = {}
  assert.equal(shouldMoveToReturnedOpener({ active: parked, parked, body }), true)
  assert.equal(shouldMoveToReturnedOpener({ active: body, parked, body }), true)
  assert.equal(shouldMoveToReturnedOpener({ active: {}, parked, body }), false)
})

test('mọi Enter bên trong hộp thoại admin: @keydown.enter + isDeliberateEnter (không lặp, không IME)', () => {
  const offenders: string[] = []
  for (const file of adminVueFiles()) {
    for (const finding of enterHandlersInsideDialogs(read(file), file)) {
      if (!finding.deliberate) offenders.push(`${file}:${finding.line} (${finding.handler})`)
    }
  }
  assert.deepEqual(offenders, [], 'Handler Enter trong hộp thoại phải lọc bằng isDeliberateEnter (ConfirmModal prompt từng dùng @keydown.enter.prevent="accept").')
})

test('classifier: handler Enter trong hộp thoại phải gọi isDeliberateEnter', () => {
  const sfc = (template: string, script: string) => `<script setup lang="ts">\n${script}\n</script>\n<template>${template}</template>`
  const check = (template: string, script: string) => enterHandlersInsideDialogs(sfc(template, script)).map(f => f.deliberate)
  assert.deepEqual(check('<AdminModal :open="o" title="t"><input @keydown.enter.prevent="accept" /></AdminModal>', 'function accept() {}'), [false])
  assert.deepEqual(check('<div role="dialog" aria-label="x"><input @keydown.enter="onEnter" /></div>', 'const onEnter = (e: KeyboardEvent) => {\n  if (!isDeliberateEnter(e)) return\n}'), [true])
  assert.deepEqual(check('<div role="dialog" aria-label="x"><input @keydown.enter="submitOnEnter($event, go)" /></div>', 'function submitOnEnter(e: KeyboardEvent, s: () => void) {\n  if (!isDeliberateEnter(e)) return\n  s()\n}\nfunction go() {}'), [true])
  assert.deepEqual(check('<input @keydown.enter="search" />', 'function search() {}'), [], 'ô ngoài hộp thoại không bị xét')
})

test('aria-labelledby của hộp thoại trỏ tới id CÓ trong template', () => {
  const missing = (template: string) => labelledbyTargetsMissing(`<template>${template}</template>`)
  assert.deepEqual(missing('<div role="dialog" aria-labelledby="t"><h2 id="t">x</h2></div>'), [])
  assert.deepEqual(missing('<div role="dialog" aria-labelledby="t"><h2 id="tt">x</h2></div>'), ['t'])
  assert.deepEqual(missing(`<div role="dialog" :aria-labelledby="hasTitle ? 'a' : 'b'"><h2 id="a"></h2><p id="b"></p></div>`), [])
  assert.deepEqual(missing(`<div role="dialog" :aria-labelledby="hasTitle ? 'a' : 'b'"><h2 id="a"></h2></div>`), ['b'])
  assert.deepEqual(missing('<div role="dialog" :aria-labelledby="titleId"><h2 :id="titleId"></h2></div>'), [])
  assert.deepEqual(missing('<div role="dialog" :aria-labelledby="titleId"><h2 :id="otherId"></h2></div>'), ['titleId'])

  const offenders: string[] = []
  for (const file of adminVueFiles()) {
    for (const id of labelledbyTargetsMissing(read(file), file)) offenders.push(`${file} → ${id}`)
  }
  assert.deepEqual(offenders, [])
})

test('hộp thoại nuốt phím giữ từ trước khi mở; ô Enter trong hộp dùng isDeliberateEnter', () => {
  for (const file of ['components/admin/AdminModal.vue', 'components/admin/ConfirmModal.vue']) {
    const source = read(file)
    assert.match(source, /createHeldKeyGuard\(\)/, `${file} phải nuốt autorepeat của phím đã mở hộp`)
    assert.match(source, /addEventListener\('keydown', [^,]+, true\)/, `${file}: nuốt ở pha capture, trước handler của điều khiển`)
    assert.match(source, /addEventListener\('keyup', [^,]+, true\)/)
  }
  for (const file of ['pages/admin/content/pages/[id].vue', 'components/admin/MediaLibraryModal.vue', 'pages/admin/profile.vue']) {
    assert.match(read(file), /isDeliberateEnter\(/, `${file}: Enter lặp/đang gõ dấu không được gửi`)
  }
})

/**
 * Trang đóng hộp rồi tải lại danh sách (skeleton thay bảng → nút "Sửa" của hàng bị gỡ và
 * vẽ lại): nút mở mang khoá ổn định để AdminModal tìm lại đúng nút đó.
 */
const OPENER_MARKERS: Record<string, string[]> = {
  'pages/admin/users/index.vue': ['`user-${u.id}`'],
  'pages/admin/content/content-types.vue': ['`content-type-${ct.id}`'],
  'pages/admin/content/categories/index.vue': ['`category-${root.id}`', '`category-${child.id}`', '`category-add-child-${root.id}`'],
  'pages/admin/media-portal/categories.vue': ['`media-category-${cat.id}`'],
  'pages/admin/submissions/index.vue': ['`submission-${s.id}`'],
  'components/admin/languages/LanguagesListTab.vue': ['`translate-${lang.code}`'],
}

test('nút mở trên danh sách tải lại sau khi đóng hộp mang khoá data-admin-modal-opener', () => {
  for (const [file, keys] of Object.entries(OPENER_MARKERS)) {
    const source = read(file)
    for (const key of keys) {
      assert.ok(source.includes(`:data-admin-modal-opener="${key}"`), `${file} thiếu khoá ${key}`)
    }
  }
})

test('xếp lớp: hộp mở sau nằm trên hộp mở trước, và luôn dưới ConfirmModal', async () => {
  const { createModalLayers, adminModalLayerZ } = await import('../app/utils/admin-modal.ts')
  const layers = createModalLayers()
  const a = layers.open()
  const b = layers.open()
  assert.ok(adminModalLayerZ(b) > adminModalLayerZ(a))
  layers.close() // một hộp đóng
  const c = layers.open()
  assert.ok(adminModalLayerZ(c) > adminModalLayerZ(b), 'hộp mở sau cùng phải nằm trên mọi hộp còn mở')
  layers.close(); layers.close()
  assert.equal(layers.open(), 1, 'hết hộp mở thì đếm lại từ đầu')
  assert.ok(adminModalLayerZ(0) >= 9000)
  assert.ok(adminModalLayerZ(1_000_000) < 9999, 'không bao giờ chạm ConfirmModal (z-[9999])')
})

test('AdminModal nối dây: phím qua adminModalKeyAction, nền qua adminModalBackdropCloses, focus qua focus-return', () => {
  const source = read('components/admin/AdminModal.vue')
  const script = source.slice(0, source.indexOf('</script>'))
  for (const helper of ['adminModalKeyAction(', 'adminModalBackdropCloses(', 'inertOutside(', 'trapTabTarget(', 'visibleTabbables', 'focusReturn.restore(', 'focusReturn.remember(', 'pickInitialFocus(', 'openerKeyOf(', 'focusFallbackTarget(', 'adminModalLayers.open(', 'adminModalLayers.close(', 'adminModalLayerZ(', 'rememberableOpener(', 'focusEscaped(', 'shouldMoveToReturnedOpener(', 'parkFocusOn(']) {
    assert.ok(script.includes(helper), `AdminModal.vue phải dùng ${helper}`)
  }
  // Giữ focus trong hộp khi điều khiển đang focus bị gỡ/disabled (theo dõi DOM của hộp),
  // và chờ nút mở về sau khi danh sách tải lại (theo dõi <body> có thời hạn).
  assert.match(script, /keepFocusObserver\.observe\(root, \{ childList: true, subtree: true, attributes: true/)
  assert.match(script, /observer\.observe\(document\.body,/)
  assert.match(script, /setTimeout\(stop, RETURNED_OPENER_WAIT_MS\)/)

  const confirm = read('components/admin/ConfirmModal.vue')
  for (const helper of ['rememberableOpener(', 'parkFocusOn(', 'isDeliberateEnter(']) {
    assert.ok(confirm.includes(helper), `ConfirmModal.vue phải dùng ${helper}`)
  }
  // Escape của hộp xác nhận đánh dấu đã xử lý (panel thuộc tính không thu nhỏ theo).
  assert.match(confirm, /if \(e\.key !== 'Escape'\) return\n[\s\S]*?e\.preventDefault\(\)\n\s*cancel\(\)/)
  // Hộp tiến trình dịch AI: biểu tượng quay khi đang dịch (như trước khi chuyển sang
  // AdminModal), dừng khi người dùng chọn giảm chuyển động.
  assert.match(read('pages/admin/languages/index.vue'), /:icon="!progressStats\.finished && !progressStats\.stopped \? 'fa-solid fa-wand-magic-sparkles animate-spin motion-reduce:animate-none' : 'fa-solid fa-wand-magic-sparkles'"/)
  // Panel thuộc tính mở rộng (nghe Escape ở window) bỏ qua Escape mà một hộp thoại đã
  // xử lý — đóng thư viện ảnh mở từ panel không thu nhỏ luôn panel.
  assert.match(read('components/admin/builder/PropertyPanel.vue'), /e\.key === 'Escape' && expanded\.value && !e\.defaultPrevented/)
  // Tailwind utility, không <style> (CLAUDE.md: code mới không <style scoped>).
  assert.doesNotMatch(source, /<style/)
  // Không chuyển `visibility` lúc mở: focus() vào cây đang `hidden` bị bỏ qua
  // (bài học DefaultMobileDrawer / ChatWidget).
  assert.doesNotMatch(source, /invisible|visibility/)
})
