/**
 * Số đo thời gian thực + sức khoẻ của worker kiểm duyệt (trạng thái cấp module). Tách
 * nguyên văn từ moderation-worker.ts; `workerStats` được export để các nơi ghi số
 * (fastPreModerate, checkAndModerateContent) cùng cập nhật một đối tượng.
 */
import { getHeapStatistics } from 'node:v8'
import { getCachedRulesCount, invalidateModerationRulesCache } from './moderation-rules-cache'

// ── Worker Realtime Metrics & Health Tracker ──────────────────────────────
interface WorkerStatsState {
  startedAt: string
  totalScanned: number
  blockedInstant: number
  blockedAi: number
  allowedCount: number
  errorCount: number
  lastScannedAt: string | null
  lastError: string | null
  lastErrorAt: string | null
  lastAiLatencyMs: number
}

export const workerStats: WorkerStatsState = {
  startedAt: new Date().toISOString(),
  totalScanned: 0,
  blockedInstant: 0,
  blockedAi: 0,
  allowedCount: 0,
  errorCount: 0,
  lastScannedAt: null,
  lastError: null,
  lastErrorAt: null,
  lastAiLatencyMs: 0,
}

export function getWorkerStats() {
  const uptimeSeconds = Math.round((Date.now() - new Date(workerStats.startedAt).getTime()) / 1000)
  const mem = process.memoryUsage()
  // `heapTotal` là mức V8 tự kéo theo nhu cầu, không phải trần cứng — admin nhìn
  // "46/64 MB" mà tưởng worker bị kìm 100 MB, trong khi `--max-old-space-size`
  // thực sự cho tới 2048 MB. `heap_size_limit` từ v8 là con số cap thật, và %
  // heapUsed/cap nói rõ worker còn bao nhiêu room.
  const stats = getHeapStatistics()
  const heapLimitMb = Math.round((stats.heap_size_limit ?? 0) / 1024 / 1024)
  const heapUsedPercent = heapLimitMb > 0
    ? Math.round((mem.heapUsed / (stats.heap_size_limit ?? 1)) * 1000) / 10
    : 0
  return {
    ...workerStats,
    uptimeSeconds,
    status: workerStats.errorCount > 10 ? ('degraded' as const) : ('active' as const),
    cachedRulesCount: getCachedRulesCount(),
    memoryUsageMb: {
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      rss: Math.round(mem.rss / 1024 / 1024),
      heapLimit: heapLimitMb,
      heapUsedPercent,
    },
  }
}

export function resetWorkerStats() {
  workerStats.errorCount = 0
  workerStats.lastError = null
  workerStats.lastErrorAt = null
  invalidateModerationRulesCache()
}
