/**
 * Scheduler backup tự động — cùng pattern `retention-scheduler.ts` +
 * `analytics-scheduler.ts`.
 *
 * Tick 15 phút, quyết định do hàm thuần `isBackupDue`. Lấy lastRunAt từ bảng
 * `backups` (bản `scheduled` `done` mới nhất). Mặc định **tắt** — backup tự
 * động phải bật cố ý qua `BACKUP_SCHEDULER=1` hoặc công tắc trong settings.
 *
 * Khi due: `runBackup({ type: 'all', trigger: 'scheduled' })`. Lỗi trong tick
 * nuốt thành `backup.scheduler_failed` — không sập worker.
 */
import { desc, eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { backups, settings } from '../db/schema'
import { runBackup } from './backup'
import { logInfo, logWarn } from '../utils/logger'

const TICK_MS = 15 * 60 * 1000
const WARMUP_MS = 120 * 1000

type DueDecision = { run: boolean; reason: string }

/** Hàm thuần — kiểm đủ mọi thứ trước khi quyết định chạy. */
export function isBackupDue(
  policy: { enabled: boolean; hour: number; days: number[] },
  now: Date,
  lastRunAt: Date | null,
): DueDecision {
  if (!policy.enabled) return { run: false, reason: 'disabled' }
  // Stale 36h — bù cho đêm bị bỏ (cùng lý do retention scheduler).
  if (lastRunAt && (now.getTime() - lastRunAt.getTime() > 36 * 60 * 60 * 1000)) {
    return { run: true, reason: 'stale' }
  }
  // Chưa chạy lần nào → chạy ngay (lượt đầu thường là backlog).
  if (!lastRunAt) return { run: true, reason: 'first' }
  // Khác ngày với lượt trước + đúng giờ.
  const todayStr = now.toLocaleDateString('en-CA') // YYYY-MM-DD local
  const lastStr = lastRunAt.toLocaleDateString('en-CA')
  if (todayStr === lastStr) return { run: false, reason: 'same_day' }
  // Kiểm giờ (địa phương).
  if (now.getHours() < policy.hour) return { run: false, reason: 'before_hour' }
  // Kiểm ngày trong tuần (nếu cụ thể).
  if (policy.days.length > 0 && !policy.days.includes(now.getDay())) {
    return { run: false, reason: 'not_scheduled_day' }
  }
  return { run: true, reason: 'scheduled' }
}

async function loadPolicy(): Promise<{ enabled: boolean; hour: number; days: number[] }> {
  try {
    const db = getDb()
    const rows = await db.select().from(settings)
    const map = new Map(rows.map(r => [r.key, r.value]))
    const daysRaw = map.get('backup_auto_days')
    let days: number[] = []
    if (daysRaw) {
      try { days = JSON.parse(daysRaw) } catch { days = [] }
    }
    return {
      enabled: map.get('backup_auto_enabled') === 'true' || map.get('backup_auto_enabled') === '1',
      hour: Number(map.get('backup_auto_hour')) || 3,
      days,
    }
  } catch {
    return { enabled: false, hour: 3, days: [] }
  }
}

async function lastBackupRunAt(): Promise<Date | null> {
  try {
    const db = getDb()
    const [row] = await db.select().from(backups)
      .where(eq(backups.trigger, 'scheduled'))
      .orderBy(desc(backups.id)).limit(1)
    return row?.createdAt ? new Date(row.createdAt) : null
  } catch {
    return null
  }
}

let timer: NodeJS.Timeout | null = null

async function tick() {
  try {
    const policy = await loadPolicy()
    const now = new Date()
    const lastRunAt = await lastBackupRunAt()
    const decision = isBackupDue(policy, now, lastRunAt)
    if (!decision.run) return
    logInfo({ event: 'backup.scheduler_due', reason: decision.reason, hour: policy.hour })
    await runBackup('all', 'scheduled', null)
  } catch (err) {
    logWarn({ event: 'backup.scheduler_failed', error: err instanceof Error ? err.message : String(err) })
  }
}

export function startBackupScheduler(): void {
  if (timer) return
  timer = setInterval(() => { tick().catch(() => {}) }, TICK_MS)
  timer.unref()
  setTimeout(() => { tick().catch(() => {}) }, WARMUP_MS).unref()
  logInfo({ event: 'backup.scheduler_started', tickMs: TICK_MS, warmupMs: WARMUP_MS })
}

export function stopBackupScheduler(): void {
  if (timer) { clearInterval(timer); timer = null }
}
