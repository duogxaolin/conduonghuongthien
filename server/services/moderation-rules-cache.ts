/**
 * Cache luật kiểm duyệt đang bật (TTL 60s) để khớp dưới 1ms. Tách nguyên văn từ
 * moderation-worker.ts; module cũ re-export để import không đổi.
 */
import { eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { aiModerationRules, type AiModerationRule } from '../db/schema'
import { clearCompiledModerationRegexCache, resetSlowModerationRules } from './moderation-regex'

// ── In-memory Rule Cache (TTL 60s for sub-millisecond matching) ────────────
let cachedRules: AiModerationRule[] | null = null
let cacheExpiresAt = 0

export async function getActiveModerationRules(): Promise<AiModerationRule[]> {
  const now = Date.now()
  if (cachedRules && now < cacheExpiresAt) {
    return cachedRules
  }

  const db = getDb()
  const rows = await db
    .select()
    .from(aiModerationRules)
    .where(eq(aiModerationRules.isEnabled, true))

  cachedRules = rows
  cacheExpiresAt = now + 60_000
  return rows
}

export function invalidateModerationRulesCache(): void {
  cachedRules = null
  cacheExpiresAt = 0
  // Regex đã biên dịch (và lượt ghi log "mẫu bị bỏ qua") đi cùng vòng đời luật:
  // sửa/xoá luật thì lượt nạp sau biên dịch — và cảnh báo — lại từ đầu.
  clearCompiledModerationRegexCache()
  // Luật bị tắt tạm vì chậm (cửa sổ quá 200 ms hay dùng hết ngân sách 1 s/60 s —
  // `moderation-regex-runtime.ts`) TỰ bật lại sau 10 phút; một thao tác tường minh của
  // cán bộ (tạo/sửa/xoá luật, khởi động lại worker — mọi nơi gọi hàm này) bật lại MỌI
  // luật ngay và xoá sổ ngân sách. Vẫn chậm thì lượt chậm kế tiếp tắt nó lần nữa. Hết
  // hạn TTL 60 s của cache luật KHÔNG đi qua đây, nên không đặt lại gì.
  resetSlowModerationRules()
}

/** Số luật đang nằm trong cache (0 nếu chưa nạp / đã invalidate). */
export function getCachedRulesCount(): number {
  return cachedRules ? cachedRules.length : 0
}
