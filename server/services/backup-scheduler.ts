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
 * phương, 0–23). Một khe được phục vụ khi một lượt theo lịch THÀNH CÔNG bắt đầu từ
 * khe đó trở đi. Chưa có: chạy trong giờ của khe; lượt hỏng (kể cả lượt bị cắt
 * ngang) được thử lại sau 60 phút, tối đa 3 lượt rồi bỏ khe (log
 * `backup.slot_abandoned` một lần); khe lỡ vì máy chủ tắt được bù một lần — chỉ khi
 * scheduler đã đang phục vụ các khe trước đó, nên bật công tắc giữa tuần thì đợi
 * khe kế tiếp. Bản cũ chạy bất cứ khi nào lượt trước cũ hơn 36 giờ (cả ngày không
 * có trong lịch), đọc giờ `0` thành 3, và coi lượt HỎNG là đã chạy xong trong ngày.
 *
 * Kết quả của khe nằm ở MỘT bản ghi bền: khoá settings `backup_scheduler_state`
 * (`BackupSchedulerState`), không suy từ bảng `backups`. Xoay vòng xoá hàng
 * `backups` của mọi trigger — vài bản sao lưu tay trong tuần đủ xoá hàng SQL của
 * lượt Chủ nhật, và một khe mất bằng chứng trông như hỏng: sao lưu toàn bộ giữa
 * tuần, lặp tới khi báo "bỏ khe" sai. Bản ghi được viết khi một lượt BẮT ĐẦU
 * (trong khoá chạy, trước mọi việc — `RunBackupOptions.onStarted`), khi nó kết
 * thúc, và khi khe bị bỏ. Khoá này không nằm trong `ALLOWED_SETTING_KEYS`: API
 * cài đặt không ghi được nó.
 *
 * Khi tới lượt: `runBackup('all', 'scheduled')`. Lỗi trong tick nuốt thành
 * `backup.scheduler_failed` — không sập worker.
 */
import { getDb } from '../utils/db'
import { settings } from '../db/schema'
import { runBackup, sweepPartialBackups } from './backup'
import { logInfo, logWarn } from '../utils/logger'

const TICK_MS = 15 * 60 * 1000
const WARMUP_MS = 120 * 1000
/** Dọn `.partial` lúc khởi động — sau khi CSDL đã sẵn sàng, trước tick khởi động. */
const PARTIAL_SWEEP_DELAY_MS = 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

export const DEFAULT_BACKUP_HOUR = 3
/** Khe "đang tới giờ" trong 60 phút đầu — đủ cho tick 15 phút và lượt khởi động sau 120 s. */
export const SLOT_WINDOW_MS = HOUR_MS
/** Thử lại một khe hỏng không sớm hơn 60 phút sau khi lượt hỏng BẮT ĐẦU. */
export const RETRY_AFTER_MS = HOUR_MS
/** Số lượt (kể cả lượt đầu) dành cho một khe trước khi bỏ khe. */
export const MAX_SLOT_ATTEMPTS = 3
/**
 * Bù khe lỡ chỉ khi scheduler có một lượt trong 8 ngày trước khe — tức đang phục vụ
 * lịch (8 > 7 ngày của lịch hằng tuần). Không có: công tắc vừa được bật (hoặc bật
 * lại sau thời gian dài) → đợi khe kế tiếp.
 */
export const CATCH_UP_LOOKBACK_MS = 8 * DAY_MS
/** Khoá settings giữ trạng thái của scheduler. Không ai ngoài scheduler ghi nó. */
export const BACKUP_SCHEDULER_STATE_KEY = 'backup_scheduler_state'

export type BackupPolicy = { enabled: boolean; hour: number; days: number[] }
/**
 * Trạng thái bền của scheduler (một hàng `settings`, JSON). Mọi mốc là ISO (UTC).
 *  - `slot`/`attempts`: khe mà bộ đếm thuộc về, và số lượt đã BẮT ĐẦU cho khe đó
 *    (bị từ chối vì khoá bận không phải một lượt).
 *  - `lastAttemptAt`: lúc bắt đầu lượt gần nhất (khe nào cũng được) — để biết
 *    scheduler có đang phục vụ lịch không (bù khe lỡ) và để chờ 60 phút giữa hai lượt.
 *  - `outcome`: `running` = đã bắt đầu, chưa ghi kết quả (đang chạy, hoặc bị giết
 *    giữa chừng — lúc quyết định thì tính như một lượt hỏng).
 *  - `lastDoneAt`: lúc bắt đầu lượt thành công gần nhất.
 */
export type BackupSchedulerState = {
  slot: string
  attempts: number
  lastAttemptAt: string
  outcome: 'running' | 'done' | 'failed' | 'abandoned'
  lastDoneAt: string | null
}
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

const OUTCOMES = new Set<BackupSchedulerState['outcome']>(['running', 'done', 'failed', 'abandoned'])
const isIsoTime = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value))

/** Bản ghi trạng thái đọc từ settings; hỏng/thiếu bất kỳ trường nào → `null` (coi như chưa có lịch sử). */
export function parseSchedulerState(raw: unknown): BackupSchedulerState | null {
  if (typeof raw !== 'string' || !raw) return null
  let value: unknown
  try { value = JSON.parse(raw) } catch { return null }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (!isIsoTime(record.slot) || !isIsoTime(record.lastAttemptAt)) return null
  if (!Number.isSafeInteger(record.attempts) || (record.attempts as number) < 0) return null
  if (!OUTCOMES.has(record.outcome as BackupSchedulerState['outcome'])) return null
  if (record.lastDoneAt !== null && !isIsoTime(record.lastDoneAt)) return null
  return {
    slot: record.slot,
    attempts: record.attempts as number,
    lastAttemptAt: record.lastAttemptAt,
    outcome: record.outcome as BackupSchedulerState['outcome'],
    lastDoneAt: record.lastDoneAt as string | null,
  }
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
export function isBackupDue(policy: BackupPolicy, now: Date, state: BackupSchedulerState | null): DueDecision {
  if (!policy.enabled) return { run: false, reason: 'disabled', slot: null }
  const slot = lastSlot(now, policy.days, policy.hour)
  if (state?.lastDoneAt && Date.parse(state.lastDoneAt) >= slot.getTime()) return { run: false, reason: 'slot_done', slot }

  const current = state && Date.parse(state.slot) === slot.getTime() && state.attempts > 0 ? state : null
  if (current) {
    if (current.outcome === 'done') return { run: false, reason: 'slot_done', slot }
    if (current.outcome === 'abandoned' || current.attempts >= MAX_SLOT_ATTEMPTS) return { run: false, reason: 'slot_abandoned', slot }
    // `failed`, hoặc `running` còn sót (lượt bị cắt ngang): một lượt hỏng.
    if (now.getTime() - Date.parse(current.lastAttemptAt) < RETRY_AFTER_MS) return { run: false, reason: 'retry_wait', slot }
    return { run: true, reason: 'retry', slot }
  }

  if (now.getTime() - slot.getTime() < SLOT_WINDOW_MS) return { run: true, reason: 'slot', slot }
  const lastAttempt = state ? Date.parse(state.lastAttemptAt) : Number.NaN
  const servingBefore = lastAttempt < slot.getTime() && lastAttempt >= slot.getTime() - CATCH_UP_LOOKBACK_MS
  if (servingBefore) return { run: true, reason: 'catch_up', slot }
  return { run: false, reason: 'outside_slot', slot }
}

/** Chính sách + trạng thái trong MỘT lượt đọc settings. Không đọc được → coi như tắt. */
async function loadSchedulerInputs(): Promise<{ policy: BackupPolicy; state: BackupSchedulerState | null }> {
  try {
    const rows = await getDb().select().from(settings)
    const map = new Map(rows.map(r => [r.key, r.value]))
    return {
      policy: {
        enabled: map.get('backup_auto_enabled') === 'true' || map.get('backup_auto_enabled') === '1',
        hour: parseBackupHour(map.get('backup_auto_hour')),
        days: parseBackupDays(map.get('backup_auto_days')),
      },
      state: parseSchedulerState(map.get(BACKUP_SCHEDULER_STATE_KEY)),
    }
  } catch {
    return { policy: { enabled: false, hour: DEFAULT_BACKUP_HOUR, days: [] }, state: null }
  }
}

async function saveSchedulerState(state: BackupSchedulerState): Promise<void> {
  const value = JSON.stringify(state)
  await getDb().insert(settings)
    .values({ key: BACKUP_SCHEDULER_STATE_KEY, value, type: 'json', group: 'internal' })
    .onDuplicateKeyUpdate({ set: { value } })
}

function logStateUnwritten(err: unknown, outcome: BackupSchedulerState['outcome']) {
  logWarn({ event: 'backup.scheduler_state_unwritten', outcome, error: err instanceof Error ? err.message : String(err) })
}

let timer: NodeJS.Timeout | null = null
let warmup: NodeJS.Timeout | null = null
let partialSweep: NodeJS.Timeout | null = null
let ticking = false

/** Một tick (xuất ra để kiểm thử). Không bao giờ ném. */
export async function backupSchedulerTick(now: Date = new Date()): Promise<void> {
  // Một lượt sao lưu dài hơn khoảng tick: tick kế tiếp không được mở lượt thứ hai.
  if (ticking) return
  ticking = true
  try {
    const { policy, state } = await loadSchedulerInputs()
    if (!policy.enabled) return
    const decision = isBackupDue(policy, now, state)
    if (decision.reason === 'slot_abandoned' && state && state.outcome !== 'abandoned') {
      // Lượt thứ ba bị cắt ngang (không kịp ghi kết quả): bỏ khe ở đây, log một lần.
      await saveSchedulerState({ ...state, outcome: 'abandoned' })
      logWarn({ event: 'backup.slot_abandoned', slot: state.slot, failures: state.attempts })
    }
    if (!decision.run || !decision.slot) return
    logInfo({ event: 'backup.scheduler_due', reason: decision.reason, slot: decision.slot.toISOString(), hour: policy.hour })

    const slot = decision.slot.toISOString()
    const started: { state: BackupSchedulerState | null } = { state: null }
    try {
      await runBackup('all', 'scheduled', null, {
        onStarted: async () => {
          started.state = {
            slot,
            attempts: (state && state.slot === slot ? state.attempts : 0) + 1,
            lastAttemptAt: now.toISOString(),
            outcome: 'running',
            lastDoneAt: state?.lastDoneAt ?? null,
          }
          await saveSchedulerState(started.state)
        },
      })
    } catch (err) {
      const attempt = started.state
      if (attempt) {
        const abandoned = attempt.attempts >= MAX_SLOT_ATTEMPTS
        await saveSchedulerState({ ...attempt, outcome: abandoned ? 'abandoned' : 'failed' })
          .catch((stateErr: unknown) => logStateUnwritten(stateErr, abandoned ? 'abandoned' : 'failed'))
        if (abandoned) logWarn({ event: 'backup.slot_abandoned', slot, failures: attempt.attempts })
      }
      throw err
    }
    const attempt = started.state
    if (attempt) {
      await saveSchedulerState({ ...attempt, outcome: 'done', lastDoneAt: attempt.lastAttemptAt })
        .catch((stateErr: unknown) => logStateUnwritten(stateErr, 'done'))
    }
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
 * Một lượt dọn `cdkt-*.partial` sau khi khởi động (`sweepPartialBackups`, dưới khoá
 * chạy) — không phụ thuộc công tắc scheduler: lượt sao lưu tay bị giết giữa chừng
 * cũng để lại tệp `.partial`.
 */
export function scheduleStartupPartialSweep(): void {
  if (partialSweep) return
  partialSweep = setTimeout(() => {
    partialSweep = null
    sweepPartialBackups().catch((err: unknown) => {
      logWarn({ event: 'backup.partial_sweep_failed', error: err instanceof Error ? err.message : String(err) })
    })
  }, PARTIAL_SWEEP_DELAY_MS)
  partialSweep.unref()
}

/**
 * Dừng tick định kỳ, tick khởi động 120 s và lượt dọn `.partial` lúc khởi động.
 * Hook `close` của Nitro gọi hàm này lúc container dừng; bản cũ chỉ xoá
 * `setInterval`, nên dừng trong 2 phút đầu sau khi khởi động vẫn để tick khởi động
 * mở một lượt sao lưu giữa lúc drain.
 */
export function stopBackupScheduler(): void {
  if (timer) { clearInterval(timer); timer = null }
  if (warmup) { clearTimeout(warmup); warmup = null }
  if (partialSweep) { clearTimeout(partialSweep); partialSweep = null }
}
