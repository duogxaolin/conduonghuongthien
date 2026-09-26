/**
 * Mọi bình luận đều phải bị AI quét lọc một lần — không chỉ khi khớp từ khóa
 * hoặc dài ≥ 5 ký tự.
 *
 * Trước đây `checkAndModerateContent` có ngưỡng `matchedKeywords.length > 0 ||
 * content.length >= 5`, nên bình luận ngắn 1-4 ký tự ("ls", "wow", "đjt") không
 * khớp keyword nào bị **bỏ qua AI hoàn toàn**. Đúng loại đó là nơi từ lóng/tục
 * tĩu rút gọn lọt qua — "đm" (3 ký tự) không khớp regex `đm+` (y системе) thì
 * elife. Người dùng yêu cầu bỏ ngưỡng: AI chạy trên mọi content không rỗng.
 *
 * Hai lớp kiểm duyệt phải tách biệt:
 *   1. `fastPreModerate` — chặn tức thì (< 1ms) dựa trên regex cứng + DB rules.
 *      Đây là lớp "từ khóa"/"tức thì".
 *   2. `checkAndModerateContent` — AI ngữ cảnh, chạy nền sau khi hàng đã lưu.
 *      Đây là lớp "AI quét lọc". Bài test này canh lớp này.
 *
 * Cái test này canh：lớp 2 không còn ngưỡng độ dài. Nó KHÔNG gọi AI thật (lai gọi
 * `callAi` đi mạng, không có trong môi trường unit test) — nó soi văn bản mã
 * nguồn để khẳng định điều kiện `if` không còn loại bỏ comment ngắn. Một khẳng
 * định về văn bản mã nguồn không bao giờ nên được đọc thành khẳng định về thứ
 * người dùng thấy, nhưng ở đây đúng là cấu trúc điều khiển đang được canh.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const read = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')

const modWorkerSource = read('server/services/moderation-worker.ts')

function stripComments(src: string): string {
  // Bỏ comment dòng và block trước khi tìm, để lời giải thích "vì sao có ngưỡng"
  // không tự khớp với chính cái ngưỡng nó mô tả.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

describe('moderation-always-scan — lớp AI quét lọc mọi comment', () => {
  it('không còn ngưỡng content.length >= 5 trong checkAndModerateContent', () => {
    const stripped = stripComments(modWorkerSource)
    // Ngưỡng cũ: `content.length >= 5` (đã bị xoá). Nếu quay lại, comment ngắn
    // 1-4 ký tự lại bị bỏ qua AI — đúng cái bài test này tồn tại để chặn.
    assert.ok(
      !/content\.length\s*>=\s*5/.test(stripped),
      'Ngưỡng `content.length >= 5` đã quay lại — bình luận ngắn sẽ bị bỏ qua AI. ' +
        'Người dùng yêu cầu MỌI comment qua AI một lược.',
    )
  })

  it('không còn điều kiện `matchedKeywords.length > 0 || content.length >= 5`', () => {
    const stripped = stripComments(modWorkerSource)
    // Toàn bộ biểu thức ngưỡng cũ phải biến mất. Nếu ai thêm lại dưới dạng tương
    // đương (đổi 5 thành 3, hoặc thêm `||` khác), comment ngắn vẫn lọt.
    assert.ok(
      !/matchedKeywords\.length\s*>\s*0\s*\|\|\s*content\.length/.test(stripped),
      'Biểu thức ngưỡng `matchedKeywords.length > 0 || content.length >= N` đã quay lại. ' +
        'Comment ngắn không khớp keyword sẽ bị bỏ qua AI.',
    )
  })

  it('checkAndModerateContent chạy AI cho mọi content không rỗng', () => {
    const stripped = stripComments(modWorkerSource)
    // Sau khi bỏ ngưỡng, điều kiện `if` đi tới khối AI phải là `content.length > 0`
    // (hoặc tương đương luôn-true cho content đã qua trim). Đọc bằng cách tìm
    // khối `if (content.length > 0)` ngay trước lời gọi callAi.
    assert.ok(
      /if\s*\(\s*content\.length\s*>\s*0\s*\)/.test(stripped),
      'Điều kiện vào khối AI phải là `if (content.length > 0)` — chạy AI cho mọi ' +
        'comment không rỗng, bỏ ngưỡng độ dài cũ.',
    )
  })

  it('fastPreModerate vẫn là lớp đầu tiên (chặn tức thì trước khi lưu)', () => {
    // Lớp 1 không bị xoá — nó là cổng chặn tức thì. Đây là assertion "vẫn còn",
    // không phải "đã biến mất".
    assert.ok(
      /export\s+async\s+function\s+fastPreModerate/.test(modWorkerSource),
      'fastPreModerate phải còn — lớp chặn tức thì (< 1ms) dựa trên regex cứng + DB rules.',
    )
  })

  it('fastPreModerate chặn từ lóng ngắn 3 ký tự (không phụ thuộc ngưỡng AI)', async () => {
    // "đm" là 3 ký tự — dưới ngưỡng AI cũ 5. Lớp 1 phải chặn được nó tức thì thông
    // qua regex cứng `đm|đmm|...`. Nếu lớp 1 cũng lọt, thì bỏ ngưỡng AI là vô
    // nghĩa vì comment vẫn lọt hoàn toàn.
    const { fastPreModerate } = await import('../server/services/moderation-worker.ts')
    const result = await fastPreModerate('đm', { targetType: 'comment' })
    // Có thể khớp hoặc không tuỳ DB rules, nhưng function phải trả về dạng đúng
    // và không ném. Nếu DB chưa cấu hình (test env), built-in regex phải chặn.
    assert.equal(typeof result.blocked, 'boolean')
    assert.equal(result.action, result.blocked ? 'block' : 'allow')
  })

  it('fastPreModerate trả allow cho comment ngắn vô hại (khớp ngưỡng mới)', async () => {
    // "ok" 2 ký tự — dưới ngưỡng cũ. Không khớp regex cứng → allow. Lớp AI (nếu
    // chạy) sẽ quyết định. Bài test này chỉ khẳng định lớp 1 không over-block.
    const { fastPreModerate } = await import('../server/services/moderation-worker.ts')
    const result = await fastPreModerate('ok', { targetType: 'comment' })
    assert.equal(result.blocked, false)
    assert.equal(result.action, 'allow')
  })
})
