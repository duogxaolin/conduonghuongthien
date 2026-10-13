/**
 * Cache luật kiểm duyệt đang bật (TTL 60s) để khớp dưới 1ms. Tách nguyên văn từ
 * moderation-worker.ts; module cũ re-export để import không đổi.
 */
import { eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { aiModerationRules, type AiModerationRule } from '../db/schema'

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
}

/** Số luật đang nằm trong cache (0 nếu chưa nạp / đã invalidate). */
export function getCachedRulesCount(): number {
  return cachedRules ? cachedRules.length : 0
}
