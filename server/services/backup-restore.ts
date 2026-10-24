/**
 * Khôi phục backup — CSDL (`.sql.gz`) hoặc file (`.tar.gz`).
 *
 * Chỉ SuperAdmin được gọi tới đây (endpoint chặn bằng `requireSuperAdmin`).
 * Thứ tự là hợp đồng, đừng đảo:
 *
 *  1. Kiểm file TRƯỚC khi ghi, ghi nhận hay chạy bất cứ gì (`backup-restore-guards.ts`):
 *     đuôi, chữ ký gzip, trần nén, trần giải nén (giải nén theo luồng có trần),
 *     danh sách mục tar (không `..`, không đường dẫn tuyệt đối, không liên kết).
 *  2. Khoá `cdkt:backup:restore` — không hai lượt khôi phục chồng nhau.
 *  3. CSDL: sao lưu an toàn `pre-restore` (không xoay vòng → không xoá được file
 *     đang khôi phục). Sao lưu an toàn hỏng → KHÔNG khôi phục.
 *  4. Chạy SQL / giải nén. CSDL — trên MỌI lối sau khi dump đã chạy (kể cả dump chết
 *     giữa chừng, bước cấu trúc hỏng): đưa cấu trúc về bản hiện tại
 *     (`convergeSchemaAfterRestore`) RỒI mã hoá bí mật nguyên văn bản dump mang về
 *     (`sealRestoredCredentials`), trước gắn lại/audit — `backup-restore-recovery.ts`.
 *  5. Audit thành công trong một transaction (kèm khôi phục các hàng `backups`
 *     mô tả file còn trên đĩa — dump vừa chạy đã `DROP TABLE backups`); thất bại
 *     ghi `backup_restore_failed` trong transaction riêng. Mỗi lượt có log bảo mật.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { getDb, getPool } from '../utils/db'
import { backups, activityLogs } from '../db/schema'
import { withNamedLock } from '../utils/named-lock'
import { logError, logInfo, logWarn, SECURITY_EVENTS } from '../utils/logger'
import { BackupLockBusyError, LOCK_RESTORE, backupsDir, holdRestoreTarget, runBackup, timestampStamp, type RunStatus } from './backup'
import { restoreSql } from './backup-sql'
import { insertBackupRow } from './backup-registry'
import { keepSchedulerStateAcrossRestore, readSchedulerStateForRestore } from './backup-scheduler'
import {
  assertOneDatabase,
  convergeBackupsRegistry,
  convergeSchemaAfterRestore,
  existingUserIds,
  reattachBackupRows,
  restoreLiveStateAfterFailedRestore,
  sealRestoredCredentials,
  type BackupRow,
} from './backup-restore-recovery'
import {
  BackupRestoreError,
  DEFAULT_RESTORE_LIMITS,
  backupKindOf,
  expectedArchiveTop,
  gunzipFileBounded,
  inspectArchive,
  validateUploadedBackup,
  type RestoreLimits,
} from './backup-restore-guards'

const execFileAsync = promisify(execFile)

// Tên khoá `LOCK_RESTORE` sống ở `backup.ts`: xoay vòng ở đó hỏi `IS_USED_LOCK`
// trên đúng khoá này để không xoá file đang được khôi phục.
const LOCK_TIMEOUT = 0

/** Người khôi phục — `username` đi vào audit để vẫn nêu được tên dù bảng `users` vừa bị thay. */
export interface RestoreActor { id: number | null; username?: string | null }

export interface RestoreOutcome {
  /** Cảnh báo cho SuperAdmin (dump cũ lệch giờ), `null` nếu không có. */
  warning: string | null
  legacyDateShift: boolean
  /** Tên file sao lưu an toàn tạo trước khi khôi phục CSDL. */
  preRestoreBackup: string | null
}

export const LEGACY_DUMP_WARNING = 'File này là bản sao lưu cũ của hệ thống (trước bản vá ngày giờ): các giá trị ngày giờ trong đó bị lệch, có thể sớm hơn thực tế 7 giờ. Đã khôi phục nguyên trạng — hãy kiểm tra lại các ngày giờ quan trọng.'

let currentRestoreStatus: RunStatus = { running: false, phase: '', message: '', startedAt: null, progress: undefined }

export function getRestoreStatus(): RunStatus { return { ...currentRestoreStatus } }

function setStatus(running: boolean, phase: string, message: string, progress?: number): void {
  currentRestoreStatus = { running, phase, message, startedAt: Date.now(), progress }
}

/** Báo running ngay khi endpoint nhận request — trước khi đọc multipart body. */
export function setRestoreStatusReceiving(): void {
  const pid = process.pid
  const now = Date.now()
  logInfo({ event: 'backup.restore_receiving', pid, at: now })
  currentRestoreStatus = { running: true, phase: 'upload', message: 'Đang nhận file upload...', startedAt: now, progress: 0 }
}

/** Đánh dấu failed khi endpoint trả lỗi sớm (sai định dạng, thiếu file). */
export function setRestoreStatusFailed(message: string): void {
  setStatus(false, 'failed', message)
}

const messageOf = (err: unknown) => err instanceof Error ? err.message : String(err)
const reasonOf = (err: unknown) => err instanceof BackupRestoreError ? err.reason : 'error'

function logRefused(actor: RestoreActor, filename: string, err: unknown, source: 'stored' | 'upload'): void {
  logWarn({
    event: SECURITY_EVENTS.backupRestoreRefused,
    userId: actor.id, username: actor.username ?? null, filename, source,
    reason: reasonOf(err), message: messageOf(err),
  })
}

/** Sao lưu an toàn trước khi chạy SQL. Hỏng hoặc bận → huỷ khôi phục với lý do rõ. */
async function takeSafetyBackup(adminUserId: number | null): Promise<string> {
  try {
    // `allowDuringRestore`: lượt này đang giữ khoá khôi phục — mọi lượt sao lưu khác bị từ chối.
    const result = await runBackup('sql', 'pre-restore', adminUserId, { rotate: false, allowDuringRestore: true })
    const file = result.files.find(entry => entry.type === 'sql')
    if (!file) throw new Error('lượt sao lưu không tạo được file SQL')
    return file.name
  } catch (err: unknown) {
    if (err instanceof BackupLockBusyError) {
      throw new BackupRestoreError('Một lượt backup đang chạy — chờ xong rồi khôi phục (cần sao lưu an toàn trước khi khôi phục).', 409, 'backup_running')
    }
    throw new BackupRestoreError(`Không tạo được bản sao lưu an toàn trước khi khôi phục — đã huỷ khôi phục: ${messageOf(err)}`, 500, 'safety_backup_failed')
  }
}

/** Ghi `backup_restore_failed` trong transaction riêng; lỗi ghi audit không che lỗi gốc. */
async function recordRestoreFailure(actor: RestoreActor, filename: string, err: unknown, preRestoreBackup: string | null): Promise<void> {
  try {
    const db = getDb()
    await db.transaction(async (tx) => {
      const known = await existingUserIds(tx, [actor.id])
      await tx.insert(activityLogs).values({
        userId: actor.id !== null && known.has(actor.id) ? actor.id : null,
        action: 'backup_restore_failed', resource: 'settings', resourceId: null,
        meta: { filename, actorId: actor.id, actorUsername: actor.username ?? null, reason: reasonOf(err), error: messageOf(err), preRestoreBackup },
      })
    })
  } catch (auditErr: unknown) {
    logError({ event: 'backup.restore_failure_audit_failed', filename, userId: actor.id, error: messageOf(auditErr) })
  }
}

/**
 * Khôi phục một file trong thư mục backups. Ném `BackupRestoreError` (mang mã
 * HTTP) cho mọi lỗi người gọi phân loại được.
 *
 * File được đăng ký "đang khôi phục" (`holdRestoreTarget`) TRƯỚC khi kiểm tồn
 * tại và lấy khoá, nhả ở `finally` (kể cả lỗi và 409) — để lượt xoay vòng của một
 * backup khác kết thúc giữa chừng không xoá nó (xem `rotateOldBackups`).
 */
export async function runRestore(filename: string, actor: RestoreActor): Promise<RestoreOutcome> {
  const dir = backupsDir()
  const release = holdRestoreTarget(path.relative(dir, path.resolve(dir, filename)))
  try {
    return await restoreHeldTarget(filename, actor)
  } finally {
    release()
  }
}

async function restoreHeldTarget(filename: string, actor: RestoreActor): Promise<RestoreOutcome> {
  const db = getDb()
  const pool = getPool()
  if (!pool) throw new Error('Cơ sở dữ liệu chưa sẵn sàng.')

  const dir = backupsDir()
  const filePath = path.resolve(dir, filename)
  const kind = backupKindOf(filename)
  try {
    if (!filePath.startsWith(dir + path.sep)) throw new BackupRestoreError('Đường dẫn file không hợp lệ.', 400, 'invalid_path')
    if (!kind) throw new BackupRestoreError(`Định dạng file không hỗ trợ: ${filename}`, 400, 'bad_extension')
    try { await fs.stat(filePath) } catch { throw new BackupRestoreError(`File backup "${filename}" không tồn tại.`, 404, 'not_found') }
  } catch (err: unknown) {
    setStatus(false, 'failed', messageOf(err))
    logRefused(actor, filename, err, 'stored')
    throw err
  }

  const outcome = await withNamedLock(pool, LOCK_RESTORE, LOCK_TIMEOUT, async () => {
    setStatus(true, 'start', `Đang khôi phục ${filename}`)
    logWarn({ event: SECURITY_EVENTS.backupRestoreStarted, userId: actor.id, username: actor.username ?? null, filename })
    let preRestoreBackup: string | null = null
    // Danh sách backup của hệ thống đang chạy, đọc trước khi dump chạy — gắn lại trên
    // MỌI lối ra sau khi dump đã chạy (thành công: trong transaction audit; thất bại:
    // `restoreLiveStateAfterFailedRestore`).
    let rowsBefore: BackupRow[] = []
    // Trạng thái scheduler sao lưu của hệ thống đang chạy (`undefined` = khôi phục tệp,
    // hoặc không đọc được → không đụng tới) — ghi lại sau khi khôi phục, như `rowsBefore`.
    let schedulerStateBefore: string | null | undefined
    // Từ lúc dump bắt đầu chạy tới lúc transaction audit (kèm gắn lại hàng) commit,
    // `backups` có thể đang là bản trong dump: lối thất bại phải gắn lại hàng.
    let registryRewound = false
    try {
      let legacyDateShift = false
      if (kind === 'sql') {
        assertOneDatabase()
        // Sổ sao lưu phải đúng hình dạng TRƯỚC khi đăng ký bản an toàn: một lượt khôi phục
        // hỏng trước đó có thể đã để nó ở hình dạng cũ (vd. khi làm theo lời khuyên
        // "khôi phục bản an toàn"). Hỏng thì vẫn đi tiếp — `insertBackupRow` tự thích ứng.
        await convergeBackupsRegistry(filename, actor)
        setStatus(true, 'safety', 'Đang tạo bản sao lưu an toàn trước khi khôi phục')
        preRestoreBackup = await takeSafetyBackup(actor.id)
        // Đọc SAU sao lưu an toàn để có cả hàng của bản `pre-restore`.
        rowsBefore = await db.select().from(backups)
        schedulerStateBefore = await readSchedulerStateForRestore(db)
        setStatus(true, 'sql', 'Đang phục hồi CSDL')
        registryRewound = true
        // Mọi lối sau khi dump đã chạy giữ MỘT thứ tự: dump → cấu trúc → mã hoá bí mật
        // (`sealRestoredCredentials`) → gắn lại/audit. Cấu trúc đi trước mọi thứ đụng tới
        // bảng vừa khôi phục, `settings` cũng vậy; bước cấu trúc hỏng thì vẫn mã hoá.
        try {
          ;({ legacyDateShift } = await restoreSql(filePath))
        } catch (err: unknown) {
          // Dump chết giữa chừng: một phần bảng có thể đã mang hình dạng cũ. Vẫn đưa cấu
          // trúc về bản hiện tại (được tới đâu hay tới đó) để audit thất bại, danh sách
          // và lượt sao lưu kế không hỏng theo — lỗi GỐC mới là thứ được báo. Bảng
          // `settings` có thể đã bị thay: mã hoá bí mật nguyên văn ngay sau bước đó.
          await convergeSchemaAfterRestore(filename, actor).catch(() => {})
          await sealRestoredCredentials(pool, filename, actor)
          throw err
        }
        // Trước MỌI thứ đụng tới bảng vừa khôi phục (gắn lại `backups`, audit, scheduler).
        setStatus(true, 'schema', 'Đang cập nhật cấu trúc CSDL')
        let schemaConverged = true
        try {
          await convergeSchemaAfterRestore(filename, actor)
        } catch {
          schemaConverged = false
        }
        // Bí mật nguyên văn mà bản dump trước 2A mang về: mã hoá ngay, dù bước cấu trúc
        // vừa hỏng, và trước audit bên dưới (nó có thể ném) — không đợi lần khởi động sau.
        await sealRestoredCredentials(pool, filename, actor)
        if (!schemaConverged) {
          // Không bảo "khởi động lại": lỗi đến từ chính dữ liệu vừa nạp thì mỗi lần
          // khởi động (`init.ts && …`) chạy đúng bước này và container dừng lặp lại.
          // Đường lui là bản an toàn — nêu đúng tên (nó đã được gắn lại vào danh sách).
          throw new BackupRestoreError(
            `Dữ liệu của bản sao lưu đã được nạp nhưng chưa đưa được cấu trúc CSDL về phiên bản hiện tại (chi tiết trong log máy chủ). Đừng khởi động lại ứng dụng để sửa — lần khởi động chạy đúng bước này và có thể dừng lặp lại. Khôi phục bản an toàn ${preRestoreBackup} để trở về trạng thái ngay trước lượt này; nếu không khôi phục được trong ứng dụng, dùng scripts/restore-db.sh trên máy chủ với chính tệp đó (DEPLOY.md, mục Khôi phục thật).`,
            500,
            'schema_convergence_failed',
          )
        }
      } else {
        setStatus(true, 'extract', 'Đang giải nén file', 0)
        await restoreFiles(filePath)
      }

      setStatus(true, 'audit', 'Đang ghi audit log')
      await db.transaction(async (tx) => {
        const reattached = await reattachBackupRows(tx, rowsBefore)
        if (schedulerStateBefore !== undefined) await keepSchedulerStateAcrossRestore(tx, schedulerStateBefore)
        const known = await existingUserIds(tx, [actor.id])
        await tx.insert(activityLogs).values({
          userId: actor.id !== null && known.has(actor.id) ? actor.id : null,
          action: 'backup_restore', resource: 'settings', resourceId: null,
          meta: {
            filename, actorId: actor.id, actorUsername: actor.username ?? null, preRestoreBackup,
            ...(reattached.length ? { reattachedBackups: reattached } : {}),
            ...(legacyDateShift ? { legacyDateShift: true } : {}),
          },
        })
      })
      registryRewound = false

      const warning = legacyDateShift ? LEGACY_DUMP_WARNING : null
      setStatus(false, 'done', warning ? `Khôi phục xong. ${warning}` : 'Khôi phục xong', 100)
      logWarn({ event: SECURITY_EVENTS.backupRestoreSucceeded, userId: actor.id, username: actor.username ?? null, filename, preRestoreBackup, legacyDateShift })
      return { warning, legacyDateShift, preRestoreBackup }
    } catch (err: unknown) {
      setStatus(false, 'failed', `Khôi phục lỗi: ${messageOf(err)}`)
      // Còn trong khoá khôi phục: đặt lại danh sách backup TRƯỚC khi nhả khoá, để không
      // lượt dọn nào thấy một danh sách thiếu bản `pre-restore` và các bản mới hơn.
      if (registryRewound) await restoreLiveStateAfterFailedRestore(rowsBefore, schedulerStateBefore, filename, actor)
      logWarn({ event: SECURITY_EVENTS.backupRestoreFailed, userId: actor.id, username: actor.username ?? null, filename, reason: reasonOf(err), error: messageOf(err), preRestoreBackup })
      await recordRestoreFailure(actor, filename, err, preRestoreBackup)
      throw err
    }
  })

  if (!outcome.acquired) {
    const err = new BackupRestoreError('Một lượt khôi phục khác đang chạy. Thử lại sau.', 409, 'restore_running')
    setStatus(false, 'failed', err.message)
    logRefused(actor, filename, err, 'stored')
    throw err
  }
  return outcome.value
}


/**
 * Giải nén archive về đúng gốc. Danh sách mục được kiểm TRƯỚC (`inspectArchive`):
 * một mục không an toàn → không giải nén mục nào.
 */
async function restoreFiles(filePath: string): Promise<void> {
  // Mỗi file backup chỉ chứa 1 cây: `uploads/` (nén từ public/) hoặc `media/`
  // (từ /var/lib/cdkt/). Xác định cây qua tên file rồi extract về gốc đúng.
  const treeName = expectedArchiveTop(path.basename(filePath))
  const target = treeName === 'media' ? '/var/lib/cdkt' : path.resolve(process.cwd(), 'public')

  const { entries } = await inspectArchive(filePath, treeName)

  await fs.mkdir(target, { recursive: true }).catch(() => {})
  setStatus(true, 'extract', `Đang giải nén ${entries} mục...`, 0)
  await execFileAsync('tar', ['-xzf', filePath, '-C', target, treeName])
  setStatus(true, 'extract', `Đã giải nén ${entries} mục`, 100)
}

/** Không ghi đè một backup đã có cùng tên: thêm hậu tố thời điểm tải lên. */
async function uniqueBackupName(dir: string, safeName: string): Promise<string> {
  try { await fs.stat(path.join(dir, safeName)) } catch { return safeName }
  const ext = safeName.endsWith('.sql.gz') ? '.sql.gz' : '.tar.gz'
  return `${safeName.slice(0, -ext.length)}-upload-${timestampStamp()}${ext}`
}

/**
 * Kiểm, lưu rồi khôi phục một file tải lên.
 *
 * Mọi kiểm tra chạy trước khi file được ghi nhận vào `backups` hay được thực
 * thi: tên/chữ ký/trần nén trên bộ đệm (chưa chạm đĩa), rồi trần giải nén (và
 * danh sách mục tar) trên một file tạm. Lỗi → xoá file tạm, không có hàng nào,
 * trạng thái khôi phục là `failed` kèm lý do.
 */
export async function restoreUploaded(filename: string, fileBuffer: Uint8Array, actor: RestoreActor, limits: RestoreLimits = DEFAULT_RESTORE_LIMITS): Promise<RestoreOutcome> {
  // Giữ tên file "đang khôi phục" từ lúc biết tên tới hết `runRestore` — xem
  // `holdRestoreTarget` (xoay vòng của một backup khác không được xoá nó).
  const holds: Array<() => void> = []
  try {
    return await storeAndRestoreUpload(filename, fileBuffer, actor, limits, name => holds.push(holdRestoreTarget(name)))
  } finally {
    for (const release of holds) release()
  }
}

async function storeAndRestoreUpload(
  filename: string,
  fileBuffer: Uint8Array,
  actor: RestoreActor,
  limits: RestoreLimits,
  onTargetNamed: (name: string) => void,
): Promise<RestoreOutcome> {
  const dir = backupsDir()
  let tempPath: string | null = null
  let finalName = ''
  try {
    const { safeName, kind } = validateUploadedBackup(filename, fileBuffer, limits)
    await fs.mkdir(dir, { recursive: true })
    finalName = await uniqueBackupName(dir, safeName)
    onTargetNamed(finalName)
    const target = path.resolve(dir, finalName)
    if (!target.startsWith(dir + path.sep)) throw new BackupRestoreError('Tên file không hợp lệ.', 400, 'invalid_path')

    setStatus(true, 'save', `Đang ghi file ${finalName} (${Math.round(fileBuffer.length / 1024 / 1024)}MB)...`)
    tempPath = path.join(dir, `.upload-${randomUUID()}.partial`)
    await fs.writeFile(tempPath, fileBuffer)

    setStatus(true, 'save', `Đang kiểm tra file ${finalName}...`)
    if (kind === 'sql') {
      await gunzipFileBounded(tempPath, limits.maxSqlBytes, false)
    } else {
      await gunzipFileBounded(tempPath, limits.maxArchiveBytes, false)
      await inspectArchive(tempPath, expectedArchiveTop(finalName), limits)
    }
    await fs.rename(tempPath, target)
    tempPath = null

    try {
      // `insertBackupRow`: một lượt khôi phục hỏng trước đó có thể để sổ ở hình dạng cũ.
      await insertBackupRow(getDb(), {
        filename: finalName, type: kind, bytes: fileBuffer.length, stamp: timestampStamp(), trigger: 'manual', status: 'done',
        createdBy: actor.id,
      })
    } catch (insertErr: unknown) {
      await fs.unlink(target).catch(() => {})
      throw insertErr
    }
  } catch (err: unknown) {
    if (tempPath) await fs.unlink(tempPath).catch(() => {})
    setStatus(false, 'failed', messageOf(err))
    logRefused(actor, finalName || filename, err, 'upload')
    throw err
  }
  return await runRestore(finalName, actor)
}
