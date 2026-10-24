/**
 * Kiểm duyệt an ninh có MỘT nơi quản lý: `/admin/ai/moderation` (spec
 * `admin-moderation-ui`, design D10).
 *
 * Lỗi gốc: tab "Kiểm duyệt An ninh" của AI Panel (`AiModerationTab.vue`) là bản chép
 * thứ hai của trang kiểm duyệt — tự thêm/bật/tắt/xoá quy tắc và tự duyệt/xoá/cấm IP
 * hàng đối soát, với thông báo, phân trang và sửa lỗi riêng. Hai bản trôi khỏi nhau:
 * huy hiệu "chờ đối soát" ở tab đếm trên trang 20 dòng đầu (`items.filter`) nên không
 * bao giờ vượt 20. Nay tab chỉ còn số liệu (đếm thật từ máy chủ) + liên kết sang trang.
 *
 * Kịch bản của spec: mở tab → thấy số hàng chờ + số quy tắc đang bật + liên kết tới
 * trang kiểm duyệt, KHÔNG có nút duyệt/từ chối/sửa quy tắc.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { renderSfcTemplate } from './_render-sfc-template.ts'

const FILE = new URL('../app/components/admin/ai/AiModerationTab.vue', import.meta.url)
const source = readFileSync(FILE, 'utf8')
const script = parse(source, { filename: FILE.pathname }).descriptor.scriptSetup?.content ?? ''

const render = (state: Record<string, unknown>) =>
  renderSfcTemplate(FILE.pathname, {
    moderationLoading: false,
    moderationError: '',
    summary: null,
    loadModeration: () => {},
    ...state,
  })

test('số hàng chờ là TỔNG của máy chủ, không phải số dòng trên một trang', async () => {
  const { summarizeModeration } = await import('../app/utils/moderation-summary.ts')
  const summary = summarizeModeration(
    { total: 57, items: [{ id: 1 }] },
    { rules: [{ isEnabled: true }, { isEnabled: false }, { isEnabled: true }] },
  )
  assert.deepEqual(summary, { pendingCount: 57, activeRuleCount: 2, totalRuleCount: 3 })
  assert.deepEqual(summarizeModeration({ total: 0 }, { rules: [] }), { pendingCount: 0, activeRuleCount: 0, totalRuleCount: 0 })
})

test('phản hồi sai dạng là LỖI (nhánh lỗi + thử lại), không phải "0 hàng chờ"', async () => {
  const { summarizeModeration } = await import('../app/utils/moderation-summary.ts')
  assert.throws(() => summarizeModeration({}, { rules: [] }))
  assert.throws(() => summarizeModeration({ total: '5' }, { rules: [] }))
  assert.throws(() => summarizeModeration({ total: -1 }, { rules: [] }))
  assert.throws(() => summarizeModeration({ total: 3 }, {}))
})

test('kịch bản spec: tab hiện hai con số + liên kết, không có điều khiển duyệt/từ chối/sửa quy tắc', async () => {
  const html = await render({ summary: { pendingCount: 57, activeRuleCount: 12, totalRuleCount: 15 } })
  assert.match(html, />\s*57\s*</, 'phải hiện số hàng đang chờ đối soát')
  assert.match(html, />\s*12\s*</, 'phải hiện số quy tắc đang bật')
  assert.match(html, /to="\/admin\/ai\/moderation"/, 'phải có liên kết tới trang kiểm duyệt')
  // Không còn điều khiển nào thay đổi dữ liệu.
  assert.doesNotMatch(html, /<(input|select|textarea)\b/)
  assert.doesNotMatch(html, /<button\b/, 'trạng thái đã tải không có nút nào — mọi thao tác ở trang kiểm duyệt')
  for (const label of ['Duyệt', 'Từ chối', 'Xóa', 'Cấm IP', 'Thêm quy tắc', 'Bật', 'Tắt']) {
    assert.ok(!html.includes(label), `tab tóm tắt không được có thao tác "${label}"`)
  }
})

test('tải / lỗi đi theo hợp đồng chung: role="status" + sr-only, lỗi role="alert" + Thử lại gọi loadModeration', async () => {
  const loading = await render({ moderationLoading: true })
  assert.match(loading, /role="status"/)
  assert.match(loading, /aria-busy="true"/)
  assert.match(loading, /sr-only/)
  assert.match(loading, /motion-reduce:animate-none/)

  const failed = await render({ moderationError: 'Không thể tải số liệu kiểm duyệt an ninh.' })
  assert.match(failed, /role="alert"/)
  assert.match(failed, /Không thể tải số liệu kiểm duyệt an ninh\./)
  assert.match(failed, /Thử lại/)
  // Đang lỗi thì không hiện số cũ như thể chúng còn đúng.
  assert.doesNotMatch(failed, /data-moderation-count/)
})

/**
 * Chạy CHÍNH `<script setup>` của tab (biên dịch thật, `$fetch` giả) và bấm CHÍNH nút
 * "Thử lại" của template đã biên dịch (gọi `onClick` của vnode) — không phải đếm một hàm
 * giả không ai gọi. Chứng minh: lỗi → nhánh lỗi; bấm thử lại → gọi lại đúng hai endpoint,
 * xoá lỗi, hiện số mới.
 */
async function mountModerationTab(fetchImpl: (url: string, opts?: Record<string, unknown>) => Promise<unknown>) {
  const { descriptor } = parse(source, { filename: FILE.pathname })
  const compiled = compileScript(descriptor, { id: 'moderation-summary-test' })
  const modules: Record<string, unknown> = {
    vue: Vue,
    '~/utils/errorMessage': await import('../app/utils/errorMessage.ts'),
    '~/utils/moderation-summary': await import('../app/utils/moderation-summary.ts'),
  }
  const code = stripTypeScriptTypes(compiled.content)
    .replace(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?/g, (_m, names: string, from: string) => {
      if (!(from in modules)) throw new Error(`AiModerationTab.vue import ngoài dự kiến: ${from}`)
      return `const {${names.replace(/\s+as\s+/g, ': ')}} = __modules[${JSON.stringify(from)}];`
    })
    .replace(/export default/, 'return')
  // Auto-import của Nuxt (`ref`, `onMounted`) và `$fetch` toàn cục, cấp qua tham số.
  const component = new Function('__modules', 'ref', 'onMounted', '$fetch', code)(modules, Vue.ref, () => {}, fetchImpl) as {
    setup: (props: object, ctx: object) => Record<string, unknown>
  }
  const bindings = component.setup({}, { expose: () => {}, emit: () => {}, attrs: {}, slots: {} })

  const template = compileTemplate({
    source: descriptor.template!.content,
    filename: FILE.pathname,
    id: 'moderation-summary-test',
    compilerOptions: { expressionPlugins: ['typescript'] },
  })
  const renderCode = stripTypeScriptTypes(template.code)
    .replace(/import \{([^}]*)\} from "vue"/, (_m, names: string) => `const {${names.replace(/ as /g, ': ')}} = Vue`)
    .replace('export function render', 'function render')
  const renderFn = new Function('Vue', `${renderCode}\nreturn render`)(Vue) as (ctx: unknown, cache: unknown[]) => Vue.VNode
  const ctx = Vue.proxyRefs(bindings)
  const tree = () => {
    // `resolveComponent('NuxtLink')` ngoài app chỉ cảnh báo — tắt cho test gọn.
    const warn = console.warn
    console.warn = () => {}
    try { return renderFn(ctx, []) } finally { console.warn = warn }
  }
  return { bindings: ctx as Record<string, unknown> & { loadModeration: () => Promise<void> }, tree }
}

function findVNodes(node: unknown, match: (vnode: Vue.VNode) => boolean, out: Vue.VNode[] = []): Vue.VNode[] {
  if (Array.isArray(node)) { for (const child of node) findVNodes(child, match, out); return out }
  if (!node || typeof node !== 'object') return out
  const vnode = node as Vue.VNode
  if (match(vnode)) out.push(vnode)
  findVNodes(vnode.children, match, out)
  return out
}
const textOf = (vnode: Vue.VNode): string =>
  typeof vnode.children === 'string' ? vnode.children : Array.isArray(vnode.children) ? vnode.children.map(c => (c && typeof c === 'object' ? textOf(c as Vue.VNode) : String(c ?? ''))).join('') : ''

test('bấm "Thử lại" thật sự tải lại: lỗi được xoá, hai endpoint được gọi lại, số mới hiện ra', async () => {
  const calls: Array<{ url: string; params?: unknown }> = []
  let mode: 'fail' | 'pass' = 'fail'
  const { bindings, tree } = await mountModerationTab(async (url, opts) => {
    calls.push({ url, params: opts?.params })
    if (mode === 'fail') throw Object.assign(new Error('500'), { data: { statusMessage: 'Máy chủ kiểm duyệt không phản hồi.' } })
    if (url === '/api/admin/ai/moderation/queue') return { ok: true, total: 7, items: [] }
    return { ok: true, rules: [{ isEnabled: true }, { isEnabled: false }, { isEnabled: true }] }
  })

  await bindings.loadModeration()
  assert.equal(bindings.moderationError, 'Máy chủ kiểm duyệt không phản hồi.')
  assert.equal(bindings.summary, null)
  assert.equal(calls.length, 2)

  const retry = findVNodes(tree(), v => v.type === 'button' && textOf(v).includes('Thử lại'))
  assert.equal(retry.length, 1, 'nhánh lỗi phải có đúng một nút Thử lại')
  mode = 'pass'
  await (retry[0]!.props!.onClick as () => Promise<void>)()

  assert.equal(calls.length, 4, 'thử lại phải gọi lại cả hai endpoint')
  assert.deepEqual(calls[2], { url: '/api/admin/ai/moderation/queue', params: { status: 'pending', perPage: 1 } })
  assert.equal(calls[3]!.url, '/api/admin/ai/moderation/rules')
  assert.equal(bindings.moderationError, '')
  assert.deepEqual(bindings.summary, { pendingCount: 7, activeRuleCount: 2, totalRuleCount: 3 })
  const after = tree()
  assert.equal(findVNodes(after, v => v.type === 'button' && textOf(v).includes('Thử lại')).length, 0)
  const counts = findVNodes(after, v => typeof v.props?.['data-moderation-count'] === 'string')
  assert.deepEqual(counts.map(v => [v.props!['data-moderation-count'], textOf(v).trim()]), [['pending', '7'], ['active-rules', '2']])
})

test('trang kiểm duyệt: huy hiệu "chờ đối soát" là tổng của máy chủ, không đếm trên một trang 20 dòng', async () => {
  const { pendingBadgeCount } = await import('../app/utils/moderation-summary.ts')
  // Tổng ĐÃ TẢI cho bộ lọc "pending": dùng nó (mới nhất sau mỗi lượt tải hàng đợi).
  assert.equal(pendingBadgeCount({ queueTotal: 57, queueTotalFilter: 'pending', workerPending: 40 }), 57)
  // Tổng đã tải là của bộ lọc khác: tổng "pending" của worker-status.
  assert.equal(pendingBadgeCount({ queueTotal: 3, queueTotalFilter: 'approved', workerPending: 57 }), 57)
  // Vừa bấm sang "pending" nhưng hàng đợi chưa tải xong (`queueTotal` còn là tổng của
  // "approved"): KHÔNG hiện số của bộ lọc trước — dùng worker-status.
  assert.equal(pendingBadgeCount({ queueTotal: 3, queueTotalFilter: 'approved', workerPending: 57 }), 57)
  // worker-status hỏng (hoặc chưa tải) và tổng đã tải không phải "pending": không biết
  // → `null` (ẩn huy hiệu), KHÔNG phải "0 hàng chờ".
  assert.equal(pendingBadgeCount({ queueTotal: 90, queueTotalFilter: 'all', workerPending: null }), null)
  assert.equal(pendingBadgeCount({ queueTotal: 0, queueTotalFilter: null, workerPending: null }), null)

  const page = readFileSync(new URL('../app/pages/admin/ai/moderation.vue', import.meta.url), 'utf8')
  assert.doesNotMatch(page, /queue\.value\.filter\(q => q\.status === 'pending'\)/, 'đếm trên trang 20 dòng là lỗi trần 20')
  assert.match(page, /pendingBadgeCount\(\{ queueTotal: queueTotal\.value, queueTotalFilter: queueTotalFilter\.value, workerPending: workerPendingCount\.value \}\)/)
  // `queueTotalFilter` chỉ đổi khi phản hồi của chính bộ lọc đó về (trong loadQueue).
  const loadQueueFn = page.slice(page.indexOf('async function loadQueue'), page.indexOf('async function loadRules'))
  assert.match(loadQueueFn, /queueTotalFilter\.value = filter/)
  // worker-status hỏng thì xoá số "pending" cũ — huy hiệu ẩn thay vì hiện số lỗi thời.
  const workerFn = page.slice(page.indexOf('async function loadWorkerStatus'), page.indexOf('function applyRescanStatus'))
  assert.match(workerFn, /workerPendingCount\.value = res\.worker\.pendingQueueCount/)
  assert.match(workerFn, /catch \{[\s\S]*workerPendingCount\.value = null/)
  // Huy hiệu `null` = ẩn (không phải "0").
  assert.match(page, /v-if="t\.badge !== null && t\.badge > 0"/)
  // Xử lý một hàng đợi xong thì số "pending" của worker cũng được làm mới.
  const resolveFn = page.slice(page.indexOf('async function resolveItem'), page.indexOf('// ─── TAB 4'))
  assert.match(resolveFn, /loadWorkerStatus\(\)/)
})

test('chỉ ĐỌC hai endpoint sẵn có; không còn đường ghi nào trong tab', () => {
  assert.match(script, /'\/api\/admin\/ai\/moderation\/queue'/)
  assert.match(script, /status: 'pending'/)
  assert.match(script, /perPage: 1\b/, 'chỉ cần tổng — xin 1 dòng, đọc `total`')
  assert.match(script, /'\/api\/admin\/ai\/moderation\/rules'/)
  assert.match(script, /summarizeModeration\(/)
  assert.doesNotMatch(script, /method:\s*'(POST|PUT|PATCH|DELETE)'/)
  assert.doesNotMatch(script, /\/resolve/)
  assert.doesNotMatch(script, /moderation\/rules\/\$\{/)
  assert.doesNotMatch(script, /useConfirm|useToast/)
  // Cha (`ai/index.vue`) vẫn gọi lại khi chuyển sang tab.
  assert.match(script, /defineExpose[\s\S]*loadModeration/)
})
