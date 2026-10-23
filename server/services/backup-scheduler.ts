/**
 * Scheduler backup tự động — cùng pattern `retention-scheduler.ts` +
 * `analytics-scheduler.ts`: tick 15 phút, quyết định do hàm thuần `isBackupDue`.
 *
 * Plugin khởi động scheduler ở production trừ khi `BACKUP_SCHEDULER` tắt
 * (`server/utils/backup-scheduler-switch.ts`); có bản sao lưu hay không là do
 * công tắc admin `backup_auto_enabled` (mặc định tắt) — bật scheduler không bao
 * giờ tự sinh một bản sao lưu không ai yêu cầu.
 *
 * Lịch (wave1 D10): "khe" là ngày-trong-tuần đã chọn lúc `hour` giờ (giờ địa
 * phương, 0–23). Một khe được phục vụ khi có một lượt `scheduled` THÀNH CÔNG bắt
 * đầu từ khe đó trở đi. Chưa có: chạy trong giờ của khe; lượt hỏng được thử lại
 * sau 60 phút, tối đa 3 lượt rồi bỏ khe (log `backup.slot_abandoned` một lần);
 * khe lỡ vì máy chủ tắt được bù một lần — chỉ khi scheduler đã đang phục vụ các
 * khe trước đó, nên bật công tắc giữa tuần thì đợi khe kế tiếp. Bản cũ chạy bất
 * cứ khi nào lượt trước cũ hơn 36 giờ (cả ngày không có trong lịch), đọc giờ `0`
 * thành 3, và coi lượt HỎNG là đã chạy xong trong ngày.
 *
 * Khi tới lượt: `runBackup('all', 'scheduled')`. Lỗi trong tick nuốt thành
 * `backup.scheduler_failed` — không sập worker.
 */
import { and, eq, gte } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { backups, settings } from '../db/schema'
import { runBackup } from './backup'
import { logInfo, logWarn } from '../utils/logger'

const TICK_MS = 15 * 60 * 1000
const WARMUP_MS = 120 * 1000
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

export const DEFAULT_BACKUP_HOUR = 3
/** Khe "đang tới giờ" trong 60 phút đầu — đủ cho tick 15 phút và lượt khởi động sau 120 s. */
export const SLOT_WINDOW_MS = HOUR_MS
/** Thử lại một khe hỏng không sớm hơn 60 phút sau lượt hỏng. */
export const RETRY_AFTER_MS = HOUR_MS
/** Số lượt (kể cả lượt đầu) dành cho một khe trước khi bỏ khe. */
export const MAX_SLOT_ATTEMPTS = 3
/**
 * Bù khe lỡ chỉ khi có một lượt `scheduled` trong 8 ngày trước khe — tức scheduler
 * đang phục vụ lịch (8 > 7 ngày của lịch hằng tuần). Không có: công tắc vừa được
 * bật (hoặc bật lại sau thời gian dài) → đợi khe kế tiếp.
 */
export const CATCH_UP_LOOKBACK_MS = 8 * DAY_MS
/** Lịch sử cần đọc: khe gần nhất lùi tối đa 7 ngày + 8 ngày nhìn lại + 1 ngày dư. */
const HISTORY_MS = 7 * DAY_MS + CATCH_UP_LOOKBACK_MS + DAY_MS

export type BackupPolicy = { enabled: boolean; hour: number; days: number[] }
/** Một lượt sao lưu theo lịch = mọi hàng cùng `stamp` (SQL + các archive). */
export type ScheduledRun = { startedAt: Date; status: 'done' | 'failed' }
export type DueReason =
  | 'disabled' | 'slot_done' | 'slot_abandoned' | 'retry_wait' | 'retry' | 'slot' | 'catch_up' | 'outside_slot'
export type DueDecision = { run: boolean; reason: DueReason; slot: Date | null }

/** Giờ chạy: số nguyên 0–23 (0 = nửa đêm, hợp lệ); mọi giá trị khác → 3. */
export function parseBackupHour(raw: unknown): number {
  const text = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : ''
  if (!/^\d{1,2}$/.test(text)) return DEFAULT_BACKUP_HOUR
  const hour = Number(text)
  return hour <= 23 ? hour : DEFAULT_BACKUP_HOUR
}

/** Ngày chạy: mảng JSON các số nguyên 0 (CN)–6, bỏ trùng; rỗng/không đọc được = mỗi ngày. */
export function parseBackupDays(raw: unknown): number[] {
  if (typeof raw !== 'string' || !raw) return []
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return [] }
  if (!Array.isArray(parsed)) return []
  const days = parsed.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6)
  return [...new Set(days)].sort((a, b) => a - b)
}

/** Khe gần nhất ≤ `now`: ngày đã chọn (giờ địa phương) lúc `hour`:00. */
export function lastSlot(now: Date, days: readonly number[], hour: number): Date {
  for (let back = 0; back <= 7; back += 1) {
    const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, hour, 0, 0, 0)
    if (candidate.getTime() > now.getTime()) continue
    if (days.length === 0 || days.includes(candidate.getDay())) return candidate
  }
  // Không tới được với ngày 0–6: tám ngày liên tiếp luôn chứa mọi thứ trong tuần.
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, hour, 0, 0, 0)
}

/** Hàm thuần — mọi quyết định chạy/không chạy nằm ở đây (tests/backup-scheduler-due.test.ts). */
export function isBackupDue(policy: BackupPolicy, now: Date, runs: readonly ScheduledRun[]): DueDecision {
  if (!policy.enabled) return { run: false, reason: 'disabled', slot: null }
  const slot = lastSlot(now, policy.days, policy.hour)
  const sinceSlot = runs.filter(run => run.startedAt.getTime() >= slot.getTime())
  if (sinceSlot.some(run => run.status === 'done')) return { run: false, reason: 'slot_done', slot }

  const failures = sinceSlot.filter(run => run.status === 'failed')
  if (failures.length >= MAX_SLOT_ATTEMPTS) return { run: false, reason: 'slot_abandoned', slot }
  if (failures.length > 0) {
    const lastFailure = Math.max(...failures.map(run => run.startedAt.getTime()))
    if (now.getTime() - lastFailure < RETRY_AFTER_MS) return { run: false, reason: 'retry_wait', slot }
    return { run: true, reason: 'retry', slot }
  }

  if (now.getTime() - slot.getTime() < SLOT_WINDOW_MS) return { run: true, reason: 'slot', slot }
  const servingBefore = runs.some(run =>
    run.startedAt.getTime() < slot.getTime() && run.startedAt.getTime() >= slot.getTime() - CATCH_UP_LOOKBACK_MS)
  if (servingBefore) return { run: true, reason: 'catch_up', slot }
  return { run: false, reason: 'outside_slot', slot }
}

/** `YYYYMMDDTHHMMSSZ` (UTC, cùng định dạng `timestampStamp` của backup.ts) → Date; sai định dạng → null. */
export function parseBackupStamp(stamp: string): Date | null {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(stamp)
  if (!match) return null
  const [, y, mo, d, h, mi, s] = match.map(Number) as [number, number, number, number, number, number, number]
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s))
  return Number.isNaN(date.getTime()) ? null : date
}

function stampOf(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
}

/**
 * Gom hàng `backups` theo `stamp` thành từng lượt "all" (lượt theo lịch luôn là
 * "all"). THÀNH CÔNG chỉ khi có dump SQL `done` VÀ ít nhất một archive `done`
 * (`type='media'`, cả uploads lẫn media) và không tệp nào hỏng. Mọi trường hợp khác
 * là lượt HỎNG: một tệp hỏng (SQL `done` trước rồi archive mới hỏng), hoặc lượt bị
 * cắt ngang (container dừng giữa chừng — dump đã có hàng, archive thì không, cũng
 * không có hàng `failed`). Mốc bắt đầu đọc từ `stamp` (UTC, chuỗi do JS sinh) chứ
 * không từ `created_at` — không phụ thuộc múi giờ của phiên MySQL.
 */
export function groupScheduledRuns(
  rows: ReadonlyArray<{ stamp: string; type: string | null; status: string | null }>,
): ScheduledRun[] {
  const byStamp = new Map<string, { startedAt: Date; sqlDone: boolean; archiveDone: boolean; failed: boolean }>()
  for (const row of rows) {
    const startedAt = parseBackupStamp(row.stamp)
    if (!startedAt) continue
    const run = byStamp.get(row.stamp) ?? { startedAt, sqlDone: false, archiveDone: false, failed: false }
    if (row.status === 'failed') run.failed = true
    if (row.status === 'done' && row.type === 'sql') run.sqlDone = true
    if (row.status === 'done' && row.type === 'media') run.archiveDone = true
    byStamp.set(row.stamp, run)
  }
  return [...byStamp.values()]
    .map(run => ({
      startedAt: run.startedAt,
      status: !run.failed && run.sqlDone && run.archiveDone ? 'done' as const : 'failed' as const,
    }))
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
}

async function loadPolicy(): Promise<BackupPolicy> {
  try {
    const rows = await getDb().select().from(settings)
    const map = new Map(rows.map(r => [r.key, r.value]))
    return {
      enabled: map.get('backup_auto_enabled') === 'true' || map.get('backup_auto_enabled') === '1',
      hour: parseBackupHour(map.get('backup_auto_hour')),
      days: parseBackupDays(map.get('backup_auto_days')),
    }
  } catch {
    return { enabled: false, hour: DEFAULT_BACKUP_HOUR, days: [] }
  }
}

/** Ném khi không đọc được lịch sử — tick bỏ lượt thay vì chạy theo một lịch sử không biết. */
async function loadScheduledRuns(now: Date): Promise<ScheduledRun[]> {
  const rows = await getDb()
    .select({ stamp: backups.stamp, type: backups.type, status: backups.status })
    .from(backups)
    .where(and(eq(backups.trigger, 'scheduled'), gte(backups.stamp, stampOf(new Date(now.getTime() - HISTORY_MS)))))
  return groupScheduledRuns(rows)
}

let timer: NodeJS.Timeout | null = null
let warmup: NodeJS.Timeout | null = null
/** Khe đã log `backup.slot_abandoned` — một dòng cho mỗi khe, không phải mỗi tick. */
let abandonedSlotLogged: number | null = null
let ticking = false

/** Một tick (xuất ra để kiểm thử). Không bao giờ ném. */
export async function backupSchedulerTick(now: Date = new Date()): Promise<void> {
  // Một lượt sao lưu dài hơn khoảng tick: tick kế tiếp không được mở lượt thứ hai.
  if (ticking) return
  ticking = true
  try {
    const policy = await loadPolicy()
    if (!policy.enabled) return
    const decision = isBackupDue(policy, now, await loadScheduledRuns(now))
    if (decision.reason === 'slot_abandoned' && decision.slot && abandonedSlotLogged !== decision.slot.getTime()) {
      abandonedSlotLogged = decision.slot.getTime()
      logWarn({ event: 'backup.slot_abandoned', slot: decision.slot.toISOString(), failures: MAX_SLOT_ATTEMPTS })
    }
    if (!decision.run) return
    logInfo({ event: 'backup.scheduler_due', reason: decision.reason, slot: decision.slot?.toISOString(), hour: policy.hour })
    await runBackup('all', 'scheduled', null)
  } catch (err) {
    logWarn({ event: 'backup.scheduler_failed', error: err instanceof Error ? err.message : String(err) })
  } finally {
    ticking = false
  }
}

export function startBackupScheduler(): void {
  if (timer) return
  timer = setInterval(() => { backupSchedulerTick().catch(() => {}) }, TICK_MS)
  timer.unref()
  warmup = setTimeout(() => {
    warmup = null
    backupSchedulerTick().catch(() => {})
  }, WARMUP_MS)
  warmup.unref()
  logInfo({ event: 'backup.scheduler_started', tickMs: TICK_MS, warmupMs: WARMUP_MS })
}

/**
 * Dừng cả tick định kỳ LẪN tick khởi động 120 s. Hook `close` của Nitro gọi hàm
 * này lúc container dừng; bản cũ chỉ xoá `setInterval`, nên dừng trong 2 phút đầu
 * sau khi khởi động vẫn để tick khởi động mở một lượt sao lưu giữa lúc drain.
 */
export function stopBackupScheduler(): void {
  if (timer) { clearInterval(timer); timer = null }
  if (warmup) { clearTimeout(warmup); warmup = null }
}
