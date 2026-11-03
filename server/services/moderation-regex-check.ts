/**
 * Kiểm một mẫu luật lúc LƯU và biên dịch nó lúc chạy — tệp con của nhóm
 * `moderation-regex` (wave3-long-term 4.3, D-SPLIT; dời nguyên văn từ
 * `moderation-regex.ts`, nơi gọi vẫn import barrel đó).
 *
 * Hai nơi khớp luật từng biên dịch KHÁC nhau: `checkAndModerateContent` gọi
 * `pattern.toLowerCase()` trước `new RegExp(...)`, nên `\S \W \D \B` bị đổi thành
 * `\s \w \d \b` — nghĩa ngược hẳn (`^\D+$` thành "toàn chữ số"). Không phân biệt
 * hoa/thường thì đã có cờ `i`; mẫu KHÔNG bao giờ bị hạ chữ. Cả hai đường khớp và hai
 * endpoint tạo/sửa luật đi qua ĐÚNG các hàm dưới đây.
 *
 * Tệp này là chủ DUY NHẤT của cache biên dịch (`compiled`, không `export`): chỉ
 * `compileModerationRegex` ghi, chỉ `clearCompiledModerationRegexCache` xoá
 * (`tests/service-split-boundaries.test.ts`, luật 4). Phép phân tích cấu trúc (lớp 1) ở
 * `moderation-regex-analysis.ts`.
 */
import { logWarn } from '../utils/logger'
import { MODERATION_PATTERN_MAX_LENGTH, MODERATION_REGEX_FLAGS } from './moderation-regex-limits'
import { analyzePattern } from './moderation-regex-analysis'

/** Mọi `ruleType` khác `keyword` đều được khớp như regex — cùng điều kiện ở mọi nơi. */
export function isRegexRuleType(ruleType: string | null | undefined): boolean {
  return ruleType !== 'keyword'
}

export type ModerationPatternCheck = { ok: true } | { ok: false; reason: string }

/**
 * Kiểm một mẫu trước khi lưu (và trước khi biên dịch lúc chạy). Trả lý do tiếng
 * Việt hiển thị thẳng cho cán bộ.
 */
export function checkModerationPattern(pattern: string, ruleType: string | null | undefined): ModerationPatternCheck {
  const value = String(pattern ?? '').trim()
  if (!value) return { ok: false, reason: 'Mẫu nhận diện không được để trống.' }
  if (value.length > MODERATION_PATTERN_MAX_LENGTH) {
    return { ok: false, reason: `Mẫu nhận diện quá dài (tối đa ${MODERATION_PATTERN_MAX_LENGTH} ký tự).` }
  }
  if (!isRegexRuleType(ruleType)) return { ok: true }

  try {
    new RegExp(value, MODERATION_REGEX_FLAGS)
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: `Mẫu regex không hợp lệ: ${detail}` }
  }

  const shape = analyzePattern(value)
  if (shape) return { ok: false, reason: `Mẫu regex có nguy cơ treo máy chủ (${shape.reason}). ${shape.hint}` }
  return { ok: true }
}

// ── Biên dịch có bộ nhớ đệm ────────────────────────────────────────────────
// Khoá theo chuỗi mẫu. Xoá cùng lúc với cache luật (`invalidateModerationRulesCache`),
// nên một mẫu hỏng/nguy hiểm chỉ ghi log MỘT lần cho mỗi lượt nạp luật, không phải
// mỗi tin nhắn.
const compiled = new Map<string, RegExp | null>()
const COMPILED_CACHE_MAX = 1000

/**
 * Biên dịch một mẫu regex của luật, hoặc `null` khi mẫu không hợp lệ / quá dài /
 * có hình dạng nguy hiểm. Luật đã nằm trong CSDL từ trước khi có phép kiểm lúc lưu
 * cũng đi qua đây, nên mẫu nguy hiểm cũ bị BỎ QUA lúc chạy (ở cả hai đường khớp)
 * chứ không chạy trên tin nhắn công khai.
 */
export function compileModerationRegex(pattern: string): RegExp | null {
  const key = String(pattern ?? '')
  if (compiled.has(key)) return compiled.get(key) ?? null

  const check = checkModerationPattern(key, 'pattern')
  let regex: RegExp | null = null
  if (check.ok) {
    regex = new RegExp(key.trim(), MODERATION_REGEX_FLAGS)
  } else {
    logWarn({ event: 'ai_moderation.rule_pattern_skipped', pattern: key.slice(0, MODERATION_PATTERN_MAX_LENGTH), reason: check.reason })
  }
  if (compiled.size >= COMPILED_CACHE_MAX) compiled.clear()
  compiled.set(key, regex)
  return regex
}

export function clearCompiledModerationRegexCache(): void {
  compiled.clear()
}
