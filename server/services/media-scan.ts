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
 * khi `action` return).
 */
import { promises as fs, type Dirent, type Stats } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { getDb, getPool, type Pool } from '../utils/db'
import { media, activityLogs } from '../db/schema'
import { affectedRowsOrZero } from '../utils/affected-rows'
import {
  detectImageMime,
  isSharpDecodable,
  type DetectedImageMime,
} from '../utils/image-mime'
import { logInfo, logWarn } from '../utils/logger'

const LOCK_NAME = 'cdkt:media:scan'

/** Trần số file mỗi lượt quét — chống treo nếu thư mục khổng lồ. */
const MAX_FILES_PER_SCAN = 5000
/** Bỏ qua file lớn hơn ngưỡng này — không phải ảnh hợp lệ, khả năng cao là video/backup. */
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024
/** Đọc tối đa 12 byte đầu cho magic-byte. */
const SNIFF_BYTES = 12

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
  skipped: number
  errors: string[]
  phase: 'scanning' | 'done' | 'failed' | 'cancelled'
  message: string
  startedAt: number
  finishedAt: number | null
  truncated: boolean
}

let currentScanJob: ScanJobStatus | null = null

export function getScanJobStatus(): ScanJobStatus | null {
  return currentScanJob ? { ...currentScanJob, errors: [...currentScanJob.errors] } : null
}

export function cancelScanJob(): void {
  if (currentScanJob?.running) {
    currentScanJob.cancelling = true
  }
}

/**
 * Khởi tạo job scan nền. Trả `{ jobId }` ngay — worker chạy tiếp trong nền.
 * Nếu đã có job đang chạy → throw.
 */
export async function startScanJob(adminUserId: number | null): Promise<{ jobId: string }> {
  if (currentScanJob?.running) {
    throw new Error('Một lượt quét khác đang chạy. Thử lại sau.')
  }

  const uploadsRoot = path.resolve(process.cwd(), 'public', 'uploads')
  // Walk trước để đếm total (đồng bộ — walk chỉ stat, nhanh).
  const candidates = await walkUploadDir(uploadsRoot)

  const jobId = `scan_${Date.now()}`
  currentScanJob = {
    jobId,
    running: true,
    cancelling: false,
    total: candidates.length,
    done: 0,
    imported: 0,
    skipped: 0,
    errors: [],
    phase: 'scanning',
    message: `Đang quét ${candidates.length} file`,
    startedAt: Date.now(),
    finishedAt: null,
    truncated: false,
  }

  void runScanWorker(candidates, uploadsRoot, adminUserId)
  return { jobId }
}

async function runScanWorker(
  candidates: string[],
  uploadsRoot: string,
  adminUserId: number | null,
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
    const [rows] = await conn.query('SELECT GET_LOCK(?, 0) AS acquired', [LOCK_NAME])
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
    // Thu thập storage_path đã có hàng — type-check O(1).
    const knownRows = await db.select({ storagePath: media.storagePath }).from(media)
    const known = new Set<string>()
    for (const row of knownRows) {
      if (row.storagePath) known.add(path.resolve(row.storagePath))
    }

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
        if (known.has(path.resolve(fileAbs))) {
          processed += 1
          if (currentScanJob) currentScanJob.done += 1
          continue
        }
        try {
          const ok = await importOne(db, fileAbs, uploadsRoot, adminUserId)
          if (currentScanJob) {
            if (ok) currentScanJob.imported += 1
            else currentScanJob.skipped += 1
            currentScanJob.done += 1
          }
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
          },
        })
      } catch { /* audit hỏng không sập batch */ }

      await new Promise((r) => setTimeout(r, BATCH_SLEEP_MS))
    }

    // Audit tổng.
    if (currentScanJob && (currentScanJob.imported > 0 || currentScanJob.skipped > 0)) {
      try {
        await db.insert(activityLogs).values({
          userId: adminUserId,
          action: 'scan_uploads',
          resource: 'media',
          resourceId: null,
          meta: {
            imported: currentScanJob.imported,
            skipped: currentScanJob.skipped,
            truncated: currentScanJob.truncated,
          },
        })
      } catch { /* audit hỏng không sập lượt quét */ }
    }

    if (!currentScanJob?.cancelling) {
      finishJob('done', `Quét xong: ${currentScanJob?.imported ?? 0} nhập, ${currentScanJob?.skipped ?? 0} bỏ qua`)
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

async function importOne(
  db: ReturnType<typeof getDb>,
  absolutePath: string,
  uploadsRoot: string,
  adminUserId: number | null,
): Promise<boolean> {
  let stat: Stats
  try { stat = await fs.lstat(absolutePath) } catch { return false }
  if (!stat.isFile() || stat.size > MAX_FILE_SIZE_BYTES || stat.size === 0) return false

  const handle = await fs.open(absolutePath, 'r').catch(() => null)
  if (!handle) return false
  try {
    const buf = Buffer.alloc(SNIFF_BYTES)
    const { bytesRead } = await handle.read(buf, 0, SNIFF_BYTES, 0)
    const detected = detectImageMime(buf.subarray(0, bytesRead))
    if (!detected) return false

    let width: number | null = null
    let height: number | null = null
    if (isSharpDecodable(detected)) {
      try {
        const meta = await sharp(absolutePath).metadata()
        width = meta.width || null
        height = meta.height || null
      } catch { /* sharp fail — vẫn nhập, không dimensions */ }
    }

    const filename = path.basename(absolutePath)
    const rel = path.relative(uploadsRoot, absolutePath).replace(/\\/g, '/')
    const url = `/uploads/${rel}`

    await db.transaction(async (tx) => {
      const [insertRes] = await tx.insert(media).values({
        filename,
        originalName: filename,
        mimeType: detected,
        sizeBytes: stat.size,
        provider: 'local',
        url,
        storagePath: absolutePath,
        width,
        height,
        uploadedBy: adminUserId,
      })
      const createdId = affectedRowsOrZero(insertRes) > 0
        ? (insertRes as { insertId?: number }).insertId ?? null
        : null
      await tx.insert(activityLogs).values({
        userId: adminUserId,
        action: 'create',
        resource: 'media',
        resourceId: createdId,
        meta: { originalName: filename, url, provider: 'local', scanned: true },
      })
    })
    return true
  } finally {
    await handle.close()
  }
}
