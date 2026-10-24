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
import test from 'node:test'
import { parse } from '@vue/compiler-sfc'
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

  let retried = 0
  const failed = await render({ moderationError: 'Không thể tải số liệu kiểm duyệt an ninh.', loadModeration: () => { retried += 1 } })
  assert.match(failed, /role="alert"/)
  assert.match(failed, /Không thể tải số liệu kiểm duyệt an ninh\./)
  assert.match(failed, /Thử lại/)
  assert.equal(retried, 0)
  assert.match(source, /@click="loadModeration\(\)"/)
  // Đang lỗi thì không hiện số cũ như thể chúng còn đúng.
  assert.doesNotMatch(failed, /data-moderation-count/)
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
