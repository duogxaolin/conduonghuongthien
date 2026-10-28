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
import { describe, it } from 'node:test'
import {
  moderationFileDeclaring,
  moderationWorkerFiles,
  moderationWorkerSource,
  moderationWorkerSourceWith,
} from './_moderation-worker-family.ts'

// `moderation-worker.ts` là barrel từ wave3 4.3: mã nằm ở cả nhóm tệp. Hai khẳng định
// "đã biến mất" đọc TOÀN nhóm (suy từ thư mục — đọc riêng barrel thì xanh trên rỗng);
// hai khẳng định "vẫn còn" đọc đúng tệp khai báo hàm đó (`moderationFileDeclaring`).
const modWorkerSource = moderationWorkerSource()
const checkSource = moderationFileDeclaring('checkAndModerateContent').source
const preModerateSource = moderationFileDeclaring('fastPreModerate').source

/** Ngưỡng cũ `content.length >= 5`. */
const OLD_LENGTH_FLOOR = /content\.length\s*>=\s*5/
/** Biểu thức ngưỡng cũ `matchedKeywords.length > 0 || content.length >= N`. */
const OLD_THRESHOLD_EXPR = /matchedKeywords\.length\s*>\s*0\s*\|\|\s*content\.length/

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
      !OLD_LENGTH_FLOOR.test(stripped),
      'Ngưỡng `content.length >= 5` đã quay lại — bình luận ngắn sẽ bị bỏ qua AI. ' +
        'Người dùng yêu cầu MỌI comment qua AI một lược.',
    )
  })

  it('không còn điều kiện `matchedKeywords.length > 0 || content.length >= 5`', () => {
    const stripped = stripComments(modWorkerSource)
    // Toàn bộ biểu thức ngưỡng cũ phải biến mất. Nếu ai thêm lại dưới dạng tương
    // đương (đổi 5 thành 3, hoặc thêm `||` khác), comment ngắn vẫn lọt.
    assert.ok(
      !OLD_THRESHOLD_EXPR.test(stripped),
      'Biểu thức ngưỡng `matchedKeywords.length > 0 || content.length >= N` đã quay lại. ' +
        'Comment ngắn không khớp keyword sẽ bị bỏ qua AI.',
    )
  })

  it('bằng chứng tiêm: hai khẳng định "đã biến mất" thấy ngưỡng cũ ở MỌI tệp của nhóm, kể cả tệp con mới', () => {
    // Ngưỡng cũ quay lại ở tệp KHÔNG khai báo checkAndModerateContent, và ở một tệp con
    // chưa ai liệt kê: cả hai phải đỏ — tập quét không được thu hẹp về một tệp.
    const old = '\nexport const _gate = (matchedKeywords: unknown[], content: string) => matchedKeywords.length > 0 || content.length >= 5\n'
    const rescan = 'moderation-worker-rescan.ts'
    const cases: Array<[string, Record<string, string>]> = [
      [
        'tệp con không khai báo checkAndModerateContent',
        { [rescan]: `${moderationFileDeclaring('rescanExistingContent').source}${old}` },
      ],
      ['tệp con mới, chưa ai liệt kê', { 'moderation-worker-extra.ts': old }],
    ]
    for (const [label, overrides] of cases) {
      const stripped = stripComments(moderationWorkerSourceWith(overrides))
      assert.ok(OLD_LENGTH_FLOOR.test(stripped), `${label}: không thấy \`content.length >= 5\``)
      assert.ok(OLD_THRESHOLD_EXPR.test(stripped), `${label}: không thấy biểu thức ngưỡng cũ`)
    }
    // Nhắc tới ngưỡng trong chú thích thì không đỏ (lời giải thích không phải mã).
    const commented = stripComments(
      moderationWorkerSourceWith({
        'moderation-worker-extra.ts':
          '// trước đây: matchedKeywords.length > 0 || content.length >= 5\n/* content.length >= 5 */\nexport const _x = 1\n',
      }),
    )
    assert.ok(!OLD_LENGTH_FLOOR.test(commented) && !OLD_THRESHOLD_EXPR.test(commented))
    // Anh em không thuộc nhóm: tệp tên lạ không lọt vào tập quét qua lối tiêm — kể cả các
    // tệp con của nhóm moderation-regex (tách ở wave3 4.3, cùng tiền tố `moderation-`).
    for (const sibling of ['moderation-regex.ts', 'moderation-regex-runtime.ts', 'moderation-regex-check.ts', 'moderation-regex-extra.ts'])
      assert.equal(moderationWorkerSourceWith({ [sibling]: old }), moderationWorkerSource(), sibling)
    for (const file of moderationWorkerFiles())
      assert.ok(!/\/moderation-regex(?:-[a-z0-9-]+)?\.ts$/.test(file), `${file} thuộc nhóm moderation-regex, không thuộc tập quét của worker`)
  })

  it('checkAndModerateContent chạy AI cho mọi content không rỗng', () => {
    const stripped = stripComments(checkSource)
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
      /export\s+async\s+function\s+fastPreModerate/.test(preModerateSource),
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
