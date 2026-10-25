/**
 * Quét thư mục `public/uploads/` — tạo hàng `media` cho tệp ảnh mồ côi.
 *
 * Ca sử dụng: ai đó copy tệp ảnh thẳng vào `public/uploads/` (SCP, rsync, restore
 * backup, migrate từ hệ thống cũ — kể cả `migrated/media/...`) thì tệp tồn tại
 * trên đĩa nhưng không có hàng `media` → không hiện trên cổng, không chọn được
 * từ Media Library Modal, không xoá được qua admin. Nút này cứu lại chúng.
 *
 * ── Worker nền + chia đợt (không chạy trong 1 HTTP request) ─────────────────
 * Quét 5000 file × (đọc magic byte + sharp metadata + INSERT) = 10-30 phút →
 * HTTP timeout. Nên `startScanJob` chỉ khởi tạo job + trả `{ jobId }` ngay;
 * worker chạy nền, từng batch 50 file, sleep 200ms giữa batch.
 *
 * Chỉ nhận **ảnh** (magic byte JPEG/PNG/GIF/WebP/ICO) — PDF/video không nhận.
 *
 * **Khoá MySQL `cdkt:media:scan`** (timeout 0) — acquire trực tiếp bằng `GET_LOCK`
 * (không dùng `withNamedLock` wrapper vì lock phải giữ suốt worker, wrapper release
 * khi `action` return). Giữ được khoá rồi mới hỏi khoá khôi phục: đang khôi phục → job
 * `failed` trước khi đọc/ghi gì (`pre-job-backup.ts`).
 *
 * Nhập từng tệp ở `media-scan-import.ts` (wave2 D-SCAN): ghi `scanned_source_path`,
 * không nhập lại tệp đã biết (kể cả bản nhập nằm trên R2), không tải đè khoá R2 của
 * hàng khác (`conflicts`), xoá object vừa tải khi ghi hàng hỏng.
 */
import { promises as fs, type Dirent } from 'node:fs'
import path from 'node:path'
import type { RowDataPacket } from 'mysql2/promise'
import { getDb, getPool } from '../utils/db'
import { media, activityLogs } from '../db/schema'
import { logInfo, logWarn } from '../utils/logger'
import type { R2Config } from '../utils/media-r2'
import { loadR2Config } from './media'
import { buildLegacyR2Index, claimLegacyR2Row, importScannedFile, knownScanSources, scanSourcePath } from './media-scan-import'
import { refuseIfRestoreInProgress } from './backup'
import { MEDIA_JOB_LOCK, abortJobIfRestoreInProgress } from './pre-job-backup'

/**
 * Khoá tên MySQL của lượt quét — giữ suốt worker. Lượt đổi domain R2 cũng giữ nó
 * (`media-repoint.ts`). Tên ở `MEDIA_JOB_LOCK` (`pre-job-backup.ts`) — lượt khôi phục đọc
 * cùng danh sách.
 */
export const MEDIA_SCAN_LOCK_NAME = MEDIA_JOB_LOCK.scan
const LOCK_NAME = MEDIA_SCAN_LOCK_NAME

/** Trần số file mỗi lượt quét — chống treo nếu thư mục khổng lồ. */
const MAX_FILES_PER_SCAN = 5000
/** Số tên tệp xung đột giữ lại trong trạng thái (đủ cho màn hình; tổng nằm ở `conflicts`). */
const MAX_CONFLICT_FILES_REPORTED = 50

const BATCH_SIZE = 50
const BATCH_SLEEP_MS = 200

// ── Job state (cấp module) ────────────────────────────────────────────────────

export interface ScanJobStatus {
  jobId: string
  running: boolean
  cancelling: boolean
  /** Tổng số file tìm thấy (đếm lúc start). */
  total: number
  /** Số file đã xử lý (imported + skipped). */
  done: number
  imported: number
  /** Gồm cả `conflicts`. */
  skipped: number
  /** Tệp không nhập vì khoá R2 đích đã thuộc một ảnh khác (không tải đè). */
  conflicts: number
  /** Đường dẫn nguồn (tương đối) của tối đa 50 tệp xung đột đầu tiên. */
  conflictFiles: string[]
  /**
   * Tệp đã được lượt quét CŨ nhập lên R2 (hàng chưa có `scanned_source_path`, cùng tên +
   * kích thước) — không nhập lại, hàng đó được ghi nguồn. Không tính vào `skipped`.
   */
  legacyMatched: number
  errors: string[]
  phase: 'scanning' | 'done' | 'failed' | 'cancelled'
  message: string
  startedAt: number
  finishedAt: number | null
  truncated: boolean
}

let currentScanJob: ScanJobStatus | null = null

export function getScanJobStatus(): ScanJobStatus | null {
  return currentScanJob ? { ...currentScanJob, errors: [...currentScanJob.errors], conflictFiles: [...currentScanJob.conflictFiles] } : null
}

export function cancelScanJob(): void {
  if (currentScanJob?.running) {
    currentScanJob.cancelling = true
  }
}

export function forceResetScanJob(): { ok: boolean; message: string } {
  if (!currentScanJob) return { ok: false, message: 'Không có job quét nào.' }
  if (!currentScanJob.running) return { ok: false, message: 'Job quét đã dừng rồi.' }
  const prevPhase = currentScanJob.phase
  const elapsed = Math.round((Date.now() - currentScanJob.startedAt) / 1000)
  currentScanJob.running = false
  currentScanJob.cancelling = false
  currentScanJob.phase = 'cancelled'
  currentScanJob.message = `Đã buộc dừng (treo ở ${prevPhase} ${elapsed}s) — có thể chạy lại ngay.`
  currentScanJob.finishedAt = Date.now()
  logWarn({ event: 'media.scan_force_reset', prevPhase, elapsed })
  return { ok: true, message: currentScanJob.message }
}

/**
 * Khởi tạo job scan nền. Trả `{ jobId }` ngay — worker chạy tiếp trong nền.
 * Nếu đã có job đang chạy → throw.
 *
 * `autoRepointToR2`: upload R2 ngay khi nhập hàng `media` (provider='r2'), giữ
 * file local làm fallback. Mặc định false (giữ hành vi cũ: chỉ nhập local).
 */
export async function startScanJob(
  adminUserId: number | null,
  opts?: { autoRepointToR2?: boolean },
): Promise<{ jobId: string }> {
  if (currentScanJob?.running) {
    throw new Error('Một lượt quét khác đang chạy. Thử lại sau.')
  }

  const uploadsRoot = path.resolve(process.cwd(), 'public', 'uploads')
  // Walk trước để đếm total (đồng bộ — walk chỉ stat, nhanh).
  const candidates = await walkUploadDir(uploadsRoot)

  // Load R2 config trước nếu autoRepoint — fail nhanh nếu cấu hình thiếu.
  let r2Config: R2Config | null = null
  if (opts?.autoRepointToR2) {
    r2Config = await loadR2Config()
    if (!r2Config.accountId || !r2Config.accessKeyId || !r2Config.secretAccessKey || !r2Config.bucket) {
      throw new Error('Cấu hình Cloudflare R2 chưa đầy đủ để tự đẩy lên R2.')
    }
  }

  const jobId = `scan_${Date.now()}`
  currentScanJob = {
    jobId,
    running: true,
    cancelling: false,
    total: candidates.length,
    done: 0,
    imported: 0,
    skipped: 0,
    conflicts: 0,
    conflictFiles: [],
    legacyMatched: 0,
    errors: [],
    phase: 'scanning',
    message: `Đang quét ${candidates.length} file`,
    startedAt: Date.now(),
    finishedAt: null,
    truncated: false,
  }

  void runScanWorker(candidates, uploadsRoot, adminUserId, r2Config)
  return { jobId }
}

async function runScanWorker(
  candidates: string[],
  uploadsRoot: string,
  adminUserId: number | null,
  r2Config: R2Config | null = null,
): Promise<void> {
  const db = getDb()
  const pool = getPool()

  const finishJob = (phase: ScanJobStatus['phase'], message: string) => {
    if (!currentScanJob) return
    currentScanJob.running = false
    currentScanJob.phase = phase
    currentScanJob.message = message
    currentScanJob.finishedAt = Date.now()
    logInfo({
      event: 'media.scan_job_done',
      phase,
      imported: currentScanJob.imported,
      skipped: currentScanJob.skipped,
      conflicts: currentScanJob.conflicts,
      legacyMatched: currentScanJob.legacyMatched,
      errors: currentScanJob.errors.length,
    })
  }

  // Acquire named lock trực tiếp (giữ suốt worker).
  if (!pool) {
    finishJob('failed', 'Cơ sở dữ liệu chưa sẵn sàng.')
    return
  }
  const conn = await pool.getConnection()
  try {
    const [rows] = await conn.query<RowDataPacket[]>('SELECT GET_LOCK(?, 0) AS acquired', [LOCK_NAME])
    if (Number(rows[0]?.acquired) !== 1) {
      finishJob('failed', 'Một lượt quét khác đang chạy.')
      return
    }
  } catch (err) {
    conn.release()
    finishJob('failed', err instanceof Error ? err.message : String(err))
    return
  }

  try {
    // Đã giữ khoá quét → hỏi khoá khôi phục (thứ tự đối xứng với lượt khôi phục, xem
    // `pre-job-backup.ts`): đang khôi phục (hoặc không hỏi được) → dừng TRƯỚC khi đọc/ghi
    // hàng `media` nào; `catch` bên dưới kết thúc job `failed` với câu của job, `finally`
    // nhả khoá.
    try {
      await refuseIfRestoreInProgress({ job: 'scan' })
    } catch (err: unknown) {
      abortJobIfRestoreInProgress(err, 'scan', 'quét thư mục ảnh')
      throw err
    }

    // Tệp đã có hàng: `scanned_source_path` của mọi hàng + `storage_path` của hàng
    // local — tra O(1) theo đường dẫn tương đối với gốc uploads.
    const knownRows = await db
      .select({
        id: media.id,
        filename: media.filename,
        sizeBytes: media.sizeBytes,
        provider: media.provider,
        storagePath: media.storagePath,
        scannedSourcePath: media.scannedSourcePath,
      })
      .from(media)
    const known = knownScanSources(knownRows, uploadsRoot)
    // Hàng R2 do lượt quét CŨ nhập: chưa có nguồn, nhận diện bằng tên + kích thước (W3).
    const legacy = buildLegacyR2Index(knownRows)

    let processed = 0
    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      if (currentScanJob?.cancelling) {
        finishJob('cancelled', `Đã hủy ở ${currentScanJob.done}/${currentScanJob.total}`)
        break
      }
      if (processed >= MAX_FILES_PER_SCAN) {
        if (currentScanJob) currentScanJob.truncated = true
        logWarn({ event: 'media.scan_truncated', reason: 'max_files', limit: MAX_FILES_PER_SCAN })
        break
      }

      const batch = candidates.slice(i, i + BATCH_SIZE)
      for (const fileAbs of batch) {
        if (currentScanJob?.cancelling) break
        if (processed >= MAX_FILES_PER_SCAN) {
          if (currentScanJob) currentScanJob.truncated = true
          break
        }
        const source = scanSourcePath(uploadsRoot, fileAbs)
        if (source && known.has(source)) {
          processed += 1
          if (currentScanJob) currentScanJob.done += 1
          continue
        }
        try {
          if (source && await claimLegacyR2Row(db, legacy, fileAbs, source) !== null) {
            known.add(source)
            if (currentScanJob) {
              currentScanJob.legacyMatched += 1
              currentScanJob.done += 1
            }
            processed += 1
            continue
          }
          const outcome = await importScannedFile(db, fileAbs, uploadsRoot, adminUserId, { r2Config })
          if (currentScanJob) {
            if (outcome.kind === 'imported') currentScanJob.imported += 1
            else currentScanJob.skipped += 1
            if (outcome.kind === 'conflict') {
              currentScanJob.conflicts += 1
              if (source && currentScanJob.conflictFiles.length < MAX_CONFLICT_FILES_REPORTED) currentScanJob.conflictFiles.push(source)
            }
            currentScanJob.done += 1
          }
          if (outcome.kind === 'imported' && source) known.add(source)
        } catch {
          if (currentScanJob) {
            currentScanJob.skipped += 1
            currentScanJob.done += 1
            currentScanJob.errors.push(path.basename(fileAbs))
          }
        }
        processed += 1
      }

      // Audit mỗi batch.
      try {
        await db.insert(activityLogs).values({
          userId: adminUserId,
          action: 'scan_uploads_batch',
          resource: 'media',
          resourceId: null,
          meta: {
            batch: Math.floor(i / BATCH_SIZE) + 1,
            done: currentScanJob?.done ?? 0,
            total: currentScanJob?.total ?? 0,
            imported: currentScanJob?.imported ?? 0,
            skipped: currentScanJob?.skipped ?? 0,
            conflicts: currentScanJob?.conflicts ?? 0,
            legacyMatched: currentScanJob?.legacyMatched ?? 0,
          },
        })
      } catch { /* audit hỏng không sập batch */ }

      await new Promise((r) => setTimeout(r, BATCH_SLEEP_MS))
    }

    // Audit tổng.
    if (currentScanJob && (currentScanJob.imported > 0 || currentScanJob.skipped > 0 || currentScanJob.legacyMatched > 0)) {
      try {
        await db.insert(activityLogs).values({
          userId: adminUserId,
          action: 'scan_uploads',
          resource: 'media',
          resourceId: null,
          meta: {
            imported: currentScanJob.imported,
            skipped: currentScanJob.skipped,
            conflicts: currentScanJob.conflicts,
            legacyMatched: currentScanJob.legacyMatched,
            truncated: currentScanJob.truncated,
          },
        })
      } catch { /* audit hỏng không sập lượt quét */ }
    }

    if (!currentScanJob?.cancelling) {
      const conflicts = currentScanJob?.conflicts ?? 0
      const legacyMatched = currentScanJob?.legacyMatched ?? 0
      finishJob('done', `Quét xong: ${currentScanJob?.imported ?? 0} nhập, ${currentScanJob?.skipped ?? 0} bỏ qua${conflicts ? ` (${conflicts} trùng tên với ảnh đã có trên R2 — không ghi đè)` : ''}${legacyMatched ? `, ${legacyMatched} đã có từ lượt quét trước` : ''}`)
    }
  } catch (err) {
    logWarn({ event: 'media.scan_job_failed', error: err instanceof Error ? err.message : String(err) })
    finishJob('failed', err instanceof Error ? err.message : String(err))
  } finally {
    // Release named lock.
    try { await conn.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]) } catch { /* noop */ }
    conn.release()
  }
}

async function walkUploadDir(uploadsRoot: string): Promise<string[]> {
  const files: string[] = []
  async function walk(dir: string) {
    if (files.length >= MAX_FILES_PER_SCAN) return
    let entries: Dirent[]
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      if (entry.isSymbolicLink?.()) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile()) {
        files.push(full)
        if (files.length >= MAX_FILES_PER_SCAN) return
      }
    }
  }
  await walk(uploadsRoot)
  return files
}
