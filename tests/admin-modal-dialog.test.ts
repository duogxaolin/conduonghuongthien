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

const hasFixedInset0 = (classes: string) => {
  const tokens = classes.split(/\s+/)
  return tokens.includes('fixed') && tokens.includes('inset-0')
}

/** `fixed inset-0` ở `class` tĩnh, hoặc trong một chuỗi chữ của `:class`. */
function isOverlay(node: TemplateNode): boolean {
  const fixed = staticAttr(node, 'class')
  if (fixed && hasFixedInset0(fixed)) return true
  const bound = directiveExp(node, 'bind', 'class')
  if (!bound) return false
  for (const literal of bound.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)) {
    if (hasFixedInset0(literal[1] ?? literal[2] ?? literal[3] ?? '')) return true
  }
  return false
}

const isModalDialog = (node: TemplateNode) =>
  ['dialog', 'alertdialog'].includes(staticAttr(node, 'role') ?? '') && staticAttr(node, 'aria-modal') === 'true'

/** Khung dùng chung đã mang ngữ nghĩa + hành vi hộp thoại. */
const DIALOG_SHELLS = new Set(['AdminModal', 'admin-modal', 'ConfirmModal', 'AdminConfirmModal', 'admin-confirm-modal'])

type Verdict = 'dialog' | 'inside-dialog' | 'wraps-dialog' | 'inside-shell' | 'bare'
interface OverlayFinding { line: number; vIf: string | null; verdict: Verdict }

/** Mọi lớp phủ `fixed inset-0` trong template của một SFC, kèm lý do nó (không) là modal. */
function classifyOverlays(source: string, filename = 'inline.vue'): OverlayFinding[] {
  const { descriptor } = parse(source, { filename })
  const root = descriptor.template?.ast as TemplateNode | undefined
  if (!root) return []
  const found: OverlayFinding[] = []
  const visit = (node: TemplateNode, ancestors: TemplateNode[]) => {
    if (node.type === ELEMENT && isOverlay(node)) {
      const children = (node.children ?? []).filter(child => child.type === ELEMENT)
      let verdict: Verdict = 'bare'
      if (isModalDialog(node)) verdict = 'dialog'
      else if (ancestors.some(isModalDialog)) verdict = 'inside-dialog'
      else if (children.some(isModalDialog)) verdict = 'wraps-dialog'
      else if (ancestors.some(a => DIALOG_SHELLS.has(a.tag ?? ''))) verdict = 'inside-shell'
      found.push({ line: node.loc.start.line, vIf: directiveExp(node, 'if') ?? null, verdict })
    }
    const next = node.type === ELEMENT ? [...ancestors, node] : ancestors
    for (const child of node.children ?? []) visit(child, next)
  }
  visit(root, [])
  return found
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
  // Nền mờ bên trong hộp thoại (MediaLibraryModal, ScanThumbnailsModal).
  assert.deepEqual(verdicts('<div class="fixed inset-0" role="dialog" aria-modal="true"><div class="fixed inset-0 bg-black/60"></div></div>'), ['dialog', 'inside-dialog'])
  // Nền bọc trực tiếp khung mang vai trò (ChatbotSmallTalkPanel).
  assert.deepEqual(verdicts('<div class="fixed inset-0 bg-black/40"><div role="dialog" aria-modal="true">x</div></div>'), ['wraps-dialog'])
  // Hộp thoại ở tầng sâu hơn KHÔNG được tính là "bọc trực tiếp".
  assert.deepEqual(verdicts('<div class="fixed inset-0"><div><div role="dialog" aria-modal="true"></div></div></div>'), ['bare'])
  assert.deepEqual(verdicts('<AdminModal :open="x" title="t"><div class="fixed inset-0"></div></AdminModal>'), ['inside-shell'])
  // `:class` cũng bị quét; `absolute inset-0` và `fixed inset-x-4` không phải lớp phủ.
  assert.deepEqual(verdicts(`<div :class="big ? 'fixed inset-0 z-50' : 'h-full'"></div>`), ['bare'])
  assert.deepEqual(verdicts('<div class="absolute inset-0"></div><div class="fixed inset-x-4 top-16"></div>'), [])
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
 * 17 lớp phủ của D-MODAL nay dựng bằng AdminModal: 15 hộp thoại + 2 ngăn kéo của trình
 * dựng trang (bảng khối, phiên bản) — hai ngăn kéo có nền mờ chặn cả trang và bấm nền để
 * đóng, tức là modal, nên KHÔNG được miễn mà dùng `size="drawer"`.
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
}

test('17 lớp phủ của D-MODAL dựng bằng AdminModal', () => {
  assert.equal(Object.values(MIGRATED_TO_ADMIN_MODAL).reduce((a, b) => a + b, 0), 17)
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

test('AdminModal nối dây: phím qua adminModalKeyAction, nền qua adminModalBackdropCloses, focus qua focus-return', () => {
  const source = read('components/admin/AdminModal.vue')
  const script = source.slice(0, source.indexOf('</script>'))
  for (const helper of ['adminModalKeyAction(', 'adminModalBackdropCloses(', 'inertOutside(', 'trapTabTarget(', 'visibleTabbables', 'focusReturn.restore(', 'focusReturn.remember(']) {
    assert.ok(script.includes(helper), `AdminModal.vue phải dùng ${helper}`)
  }
  // Tailwind utility, không <style> (CLAUDE.md: code mới không <style scoped>).
  assert.doesNotMatch(source, /<style/)
  // Không chuyển `visibility` lúc mở: focus() vào cây đang `hidden` bị bỏ qua
  // (bài học DefaultMobileDrawer / ChatWidget).
  assert.doesNotMatch(source, /invisible|visibility/)
})
