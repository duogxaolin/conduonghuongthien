/**
 * Một lượt sao lưu (`runBackup`) — một phần của `backup.ts` (tệp đó giờ là barrel, xem
 * đầu tệp): giữ khoá chạy, dump CSDL / nén cây thư mục dưới tên `.partial`, đăng ký
 * từng tệp cùng audit trong một transaction, rồi Drive (`backup-offsite.ts`) và xoay
 * vòng (`backup-rotation.ts`). Trạng thái chạy cho endpoint poll (`getBackupStatus`)
 * chỉ tệp này ghi.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { eq } from 'drizzle-orm'

import { getDb, getPool } from '../utils/db'
import { backups, activityLogs, settings } from '../db/schema'
import { withNamedLock } from '../utils/named-lock'
import { logInfo, logWarn } from '../utils/logger'
import { settingsSecretForUse } from '../utils/settings-secrets'
import { dumpSql } from './backup-sql'
import { markOffsiteStatus, offsiteStatusAtRegistration, uploadRunOffsite } from './backup-offsite'
import { insertBackupRow } from './backup-registry'
import { PARTIAL_SUFFIX, backupsDir, timestampStamp, type BackupTrigger } from './backup-names'
import { BackupLockBusyError, BackupRestoreStateUnknownError, LOCK_RUN, LOCK_TIMEOUT, refuseIfRestoreInProgress } from './backup-locks'
import { deleteStaleFiles } from './backup-sweep'
import { rotateOldBackups } from './backup-rotation'

const execFileAsync = promisify(execFile)

export type BackupType = 'sql' | 'files' | 'all'

/**
 * Một cây thư mục đóng vào một archive riêng: `<parent>/<tree>` →
 * `cdkt-<tree>-<stamp>-<trigger>.tar.gz`. Tên cây quyết định họ của archive
 * (`backupFamilyOf`, `expectedArchiveTop`) nên chỉ có hai giá trị.
 */
export interface ArchiveSource {
  tree: 'uploads' | 'media'
  parent: string
}

/**
 * Hai cây của một lượt "files", theo thứ tự nén. BusyBox tar trong alpine không hỗ
 * trợ nhiều `-C` đổi dir giữa các path trong cùng lệnh, nên không gộp được hai cây
 * có gốc khác nhau vào một archive.
 */
export function defaultArchiveSources(): ArchiveSource[] {
  return [
    { tree: 'uploads', parent: path.resolve(process.cwd(), 'public') },
    { tree: 'media', parent: '/var/lib/cdkt' },
  ]
}

export interface RunBackupOptions {
  /** `false` = không xoay vòng sau lượt này (bản `pre-restore` dùng — xem `takeSafetyBackup`). */
  rotate?: boolean
  /** Cây cần nén — mặc định `defaultArchiveSources()`; kiểm thử thay bằng thư mục tạm. */
  archiveSources?: readonly ArchiveSource[]
  /**
   * Gọi một lần ngay khi đã giữ khoá chạy, TRƯỚC mọi việc khác (đọc cấu hình,
   * `mkdir`, dump). Scheduler ghi "đã bắt đầu một lượt" ở đây: hỏng ở bất kỳ bước nào
   * sau đó vẫn là một lượt, còn bị từ chối vì khoá bận thì không. Ném → lượt dừng.
   */
  onStarted?: () => Promise<void>
  /**
   * Chỉ bản `pre-restore` của chính lượt khôi phục (`takeSafetyBackup`): chạy dù khoá
   * khôi phục đang bị giữ — mọi lượt khác bị từ chối (`BackupRestoreInProgressError`).
   */
  allowDuringRestore?: boolean
}

/**
 * Tên tệp của lượt này đã có — trên đĩa HOẶC trong bảng `backups` (hai lượt cùng
 * trigger trong cùng một giây có cùng `stamp`; lượt trước có thể đã hỏng, xoá tệp
 * của nó nhưng để lại hàng `failed` mang đúng tên đó). Từ chối TRƯỚC khi ghi: ghi
 * tiếp là đè nội dung một bản đã đăng ký, hoặc sinh hàng thứ hai cùng tên.
 */
export class BackupNameCollisionError extends Error {
  constructor(filename: string) {
    super(`Tệp backup ${filename} đã tồn tại — một lượt khác vừa chạy trong cùng giây. Thử lại sau giây lát.`)
    this.name = 'BackupNameCollisionError'
  }
}

export interface BackupResult {
  stamp: string
  files: Array<{ name: string; type: 'sql' | 'media'; bytes: number }>
  driveUploaded: boolean
  driveError?: string
}

/** Trạng thái chạy hiện tại — cho endpoint status poll. */
export interface RunStatus {
  running: boolean
  phase: string
  message: string
  startedAt: number | null
  /** Tiến độ 0-100 (cho extract tar). */
  progress?: number
}
let currentBackupStatus: RunStatus = { running: false, phase: '', message: '', startedAt: null, progress: undefined }

export function getBackupStatus(): RunStatus { return { ...currentBackupStatus } }

/**
 * Đọc cấu hình backup từ settings (group `backup`), lùi về mặc định nếu thiếu.
 * Khoá service account lưu dạng envelope (`cdkt-backup-drive-key:v1`) — giải mã ở
 * đây, nơi duy nhất dùng nó; không mở được → rỗng + `driveServiceAccountUnreadable`.
 */
export async function readBackupConfig(db: ReturnType<typeof getDb>) {
  const rows = await db.select().from(settings)
  const map = new Map(rows.map(r => [r.key, r.value]))
  const serviceAccount = settingsSecretForUse('backup_drive_service_account', map.get('backup_drive_service_account'))
  return {
    keepCount: Number(map.get('backup_keep_count')) || 14,
    driveEnabled: map.get('backup_drive_enabled') === 'true' || map.get('backup_drive_enabled') === '1',
    driveServiceAccount: serviceAccount.value,
    driveServiceAccountUnreadable: serviceAccount.unreadable,
    driveFolderId: map.get('backup_drive_folder_id') || '',
  }
}

/** Nén `<parent>/<tree>` vào `target`, rồi kiểm kết quả là tệp thường không rỗng; trả số byte. */
async function writeArchive(target: string, source: ArchiveSource): Promise<number> {
  await execFileAsync('tar', ['czf', target, '-C', source.parent, source.tree], { maxBuffer: 1024 * 1024 * 1024 })
  const stats = await fs.stat(target)
  if (!stats.isFile() || stats.size === 0) throw new Error(`Archive ${path.basename(target)} rỗng hoặc không phải tệp.`)
  return stats.size
}

async function dirExists(p: string): Promise<boolean> {
  try { return (await fs.stat(p)).isDirectory() } catch { return false }
}

async function pathExists(p: string): Promise<boolean> {
  try { await fs.lstat(p); return true } catch { return false }
}

/**
 * Đang khôi phục — hoặc không hỏi được MySQL — thì ném (`refuseIfRestoreInProgress`:
 * `BackupRestoreInProgressError`, hoặc lớp con `BackupRestoreStateUnknownError` mang câu
 * "không kiểm tra được") sau khi log lượt từ chối.
 */
async function refuseDuringRestore(type: BackupType, trigger: BackupTrigger, runLock: 'held' | 'busy'): Promise<void> {
  try {
    await refuseIfRestoreInProgress({ trigger })
  } catch (err: unknown) {
    logInfo({ event: 'backup.refused_restore_in_progress', type, trigger, runLock, stateUnknown: err instanceof BackupRestoreStateUnknownError })
    throw err
  }
}

export async function runBackup(
  type: BackupType,
  trigger: BackupTrigger,
  adminUserId: number | null,
  options: RunBackupOptions = {},
): Promise<BackupResult> {
  const db = getDb()
  const pool = getPool()
  if (!pool) throw new Error('Cơ sở dữ liệu chưa sẵn sàng.')

  const stamp = timestampStamp()

  const outcome = await withNamedLock(pool, LOCK_RUN, LOCK_TIMEOUT, async () => {
    // Đang khôi phục CSDL (hoặc không biết) → từ chối, TRƯỚC `onStarted` (không phải một
    // lượt thử). Hỏi trong khoá chạy: một lượt khôi phục bắt đầu sau câu hỏi này cần
    // khoá chạy cho bản `pre-restore` của nó, nên sẽ đợi/409 thay vì chạy song song.
    if (!options.allowDuringRestore) await refuseDuringRestore(type, trigger, 'held')
    // Đã giữ khoá chạy: từ đây là một lượt (scheduler đếm lượt ở đây — kể cả khi
    // hỏng ngay ở `mkdir`/đọc cấu hình bên dưới).
    await options.onStarted?.()
    currentBackupStatus = { running: true, phase: 'start', message: 'Bắt đầu backup', startedAt: Date.now() }
    const dir = backupsDir()
    let config: Awaited<ReturnType<typeof readBackupConfig>>
    // Drive bật ⇒ mỗi tệp của lượt này phải có bản ngoài máy chủ. Đặt ngay sau khi đọc
    // cấu hình; `false` trước đó (chưa đăng ký tệp nào thì không có gì để đánh dấu).
    let offsiteExpected = false

    const files: BackupResult['files'] = []

    // ── Không để lại archive mồ côi (wave1 D11) ──
    // Mỗi dump/archive ghi dưới `<tên>.partial` (`pending`) và chỉ mang tên thật cùng
    // lúc với hàng `done` của nó (đổi tên trong transaction). Hỏng ở bất kỳ bước nào
    // → xoá mọi `.partial` còn lại, và hàng `failed` mang tên đúng tệp của bước đã
    // ném. Bị giết giữa chừng → chỉ còn `.partial`, lượt sau (hoặc lúc khởi động) dọn.
    // Trước đây cả hai archive được nén xong rồi mới ghi hàng, và nhánh lỗi ghi cứng
    // `cdkt-media-…`: media hỏng sau khi uploads đã nén thì archive uploads nằm lại
    // trên đĩa không hàng nào, còn uploads hỏng thì hàng `failed` lại nêu tên media.
    const pending = new Set<string>()
    let step: { name: string, kind: 'sql' | 'media' } | null = null

    /**
     * Bắt đầu một tệp: từ chối tên đã có (trên đĩa, hoặc một hàng bất kỳ trạng thái —
     * lượt hỏng trước đó trong cùng giây đã xoá tệp nhưng giữ hàng `failed` cùng tên),
     * trả đường dẫn `.partial` để ghi vào.
     */
    const begin = async (name: string, kind: 'sql' | 'media'): Promise<string> => {
      step = null
      const rowsWithName = (await db.select({ filename: backups.filename }).from(backups).where(eq(backups.filename, name)))
        .filter(row => row.filename === name)
      if (rowsWithName.length > 0 || await pathExists(path.join(dir, name))) {
        logWarn({ event: 'backup.name_collision', filename: name, trigger })
        throw new BackupNameCollisionError(name)
      }
      step = { name, kind }
      const partial = path.join(dir, `${name}${PARTIAL_SUFFIX}`)
      pending.add(partial)
      return partial
    }
    /**
     * Hàng `done` + audit cùng transaction, ngay sau khi tệp đã ghi xong và kiểm; tệp
     * nhận tên thật TRONG transaction đó — đổi tên hỏng thì hàng không được ghi.
     */
    const register = async (name: string, kind: 'sql' | 'media', bytes: number) => {
      const partial = path.join(dir, `${name}${PARTIAL_SUFFIX}`)
      const target = path.join(dir, name)
      const moved = { done: false }
      try {
        await db.transaction(async (tx) => {
          // Qua `insertBackupRow`: bảng `backups` hình dạng cũ (khôi phục hỏng giữa chừng)
          // vẫn nhận được hàng — đó là lúc bản `pre-restore` là đường lui duy nhất.
          await insertBackupRow(tx, {
            filename: name, type: kind, bytes, stamp, trigger, status: 'done', createdBy: adminUserId,
            offsiteStatus: offsiteStatusAtRegistration({ driveEnabled: offsiteExpected }),
          })
          await tx.insert(activityLogs).values({
            userId: adminUserId, action: 'backup_run', resource: 'settings', resourceId: null,
            meta: { type: kind, filename: name, bytes, trigger },
          })
          await fs.rename(partial, target)
          moved.done = true
        })
      } catch (err) {
        // Commit hỏng sau khi đã đổi tên: trả tệp về tên `.partial` để nhánh dọn xoá nó.
        if (moved.done) await fs.rename(target, partial).catch(() => fs.unlink(target).catch(() => {}))
        throw err
      }
      pending.delete(partial)
      files.push({ name, type: kind, bytes })
    }

    try {
      await fs.mkdir(dir, { recursive: true })
      // Đang giữ khoá chạy ⇒ không lượt nào khác trong app đang ghi: `.partial` mang tên
      // của app và tệp tên-app không có hàng là của một lượt đã bị giết.
      await deleteStaleFiles(dir, db)
      config = await readBackupConfig(db)
      offsiteExpected = config.driveEnabled

      if (type === 'sql' || type === 'all') {
        currentBackupStatus = { running: true, phase: 'sql', message: 'Đang dump CSDL', startedAt: Date.now() }
        const filename = `cdkt-${stamp}-${trigger}.sql.gz`
        const bytes = await dumpSql(await begin(filename, 'sql'))
        await register(filename, 'sql', bytes)
      }

      if (type === 'files' || type === 'all') {
        currentBackupStatus = { running: true, phase: 'files', message: 'Đang nén file', startedAt: Date.now() }
        let archived = 0
        for (const source of options.archiveSources ?? defaultArchiveSources()) {
          if (!(await dirExists(path.join(source.parent, source.tree)))) continue
          const name = `cdkt-${source.tree}-${stamp}-${trigger}.tar.gz`
          const bytes = await writeArchive(await begin(name, 'media'), source)
          await register(name, 'media', bytes)
          archived += 1
        }
        if (archived === 0) {
          step = { name: `cdkt-media-${stamp}-${trigger}.tar.gz`, kind: 'media' }
          throw new Error('Không tìm thấy thư mục uploads hoặc media để backup.')
        }
      }
    } catch (err) {
      const failedStep = step as { name: string, kind: 'sql' | 'media' } | null
      currentBackupStatus = {
        running: false, phase: 'failed',
        message: err instanceof BackupNameCollisionError ? 'Tên tệp backup đã tồn tại'
          : failedStep?.kind === 'sql' ? 'Dump SQL thất bại'
            : failedStep ? 'Nén file thất bại' : 'Backup thất bại',
        startedAt: Date.now(),
      }
      for (const partial of pending) await fs.unlink(partial).catch(() => {})
      // Tệp đã đăng ký `done` trước bước hỏng vẫn nằm trên đĩa, nhưng lượt chết trước
      // bước Drive: khi Drive bật thì chúng KHÔNG có bản ngoài máy chủ — nói thật là
      // `failed` thay vì để NULL. `markOffsiteStatus` không ném, nên không che lỗi gốc.
      if (offsiteExpected) await markOffsiteStatus(db, files.map(file => file.name), 'failed')
      // Không bước tệp nào (đọc cấu hình, `mkdir`, hoặc tên bị từ chối) → không có tên
      // nào để ghi hàng `failed`; lỗi vẫn ném ra cho nơi gọi.
      if (failedStep) {
        // Không để lỗi ghi hàng `failed` (CSDL đang hỏng) che lỗi gốc của lượt sao lưu.
        await insertBackupRow(db, {
          filename: failedStep.name, type: failedStep.kind, bytes: 0, stamp, trigger, status: 'failed',
          error: err instanceof Error ? err.message : String(err), createdBy: adminUserId,
        }).catch((insertErr: unknown) => {
          logWarn({ event: 'backup.failed_row_unwritten', filename: failedStep.name, error: insertErr instanceof Error ? insertErr.message : String(insertErr) })
        })
      }
      throw err
    }

    // Bản sao ngoài máy chủ (Google Drive, nếu bật + cấu hình) và `offsite_status` của
    // từng tệp — `backup-offsite.ts`. Không bao giờ ném: Drive hỏng thì tệp cục bộ ở
    // lại, hàng mang `failed`, lượt sao lưu vẫn thành công.
    if (config.driveEnabled && files.length > 0) {
      currentBackupStatus = { running: true, phase: 'drive', message: 'Đang upload Google Drive', startedAt: Date.now() }
    }
    const { driveUploaded, driveError } = await uploadRunOffsite(db, dir, stamp, files, config)

    // Xoay vòng — sau khi backup + Drive xong. Bản `pre-restore` bỏ qua bước này:
    // xoay vòng xoá bản `done` cũ nhất, và bản cũ nhất có thể chính là file sắp
    // được khôi phục.
    // Mọi tệp của lượt này đã có hàng `done`: lỗi xoay vòng (CSDL chập chờn) chỉ được
    // log — ném ra sẽ biến một bản sao lưu đã đăng ký thành "lượt hỏng", và scheduler
    // sẽ chạy lại cả một lượt đầy đủ.
    if (options.rotate !== false && config.keepCount > 0) {
      try {
        await rotateOldBackups(db, config.keepCount)
      } catch (err: unknown) {
        logWarn({ event: 'backup.rotate_failed', error: err instanceof Error ? err.message : String(err) })
      }
    }

    currentBackupStatus = { running: false, phase: 'done', message: 'Backup xong', startedAt: Date.now() }
    logInfo({ event: 'backup.complete', type, trigger, files: files.length, driveUploaded })
    return { stamp, files, driveUploaded, driveError }
  })

  if (!outcome.acquired) {
    // Khoá chạy bận có thể chính là bản `pre-restore` của một lượt khôi phục: lượt đó giữ
    // khoá khôi phục rồi giữ khoá chạy suốt bản dump an toàn (`allowDuringRestore`, có khi
    // vài phút). Nói đúng "đang khôi phục" — job media (`pre-job-backup.ts`) dừng thay vì
    // ghi tiếp như khi chỉ có một lượt sao lưu khác; vẫn là một lỗi "bận" (409, không phải
    // lần thử). Bản `pre-restore` của chính lượt khôi phục thì không hỏi: khoá là của nó.
    if (!options.allowDuringRestore) await refuseDuringRestore(type, trigger, 'busy')
    throw new BackupLockBusyError()
  }
  return outcome.value
}
