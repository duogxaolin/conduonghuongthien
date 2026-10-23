/**
 * Backup & khôi phục — CSDL (mysqldump) + File (uploads + media) + Google Drive.
 *
 * Cùng tiền lệ `scripts/backup-db.sh` + `scripts/backup-media.sh` nhưng chạy từ
 * admin UI / scheduler, không cần SSH. Mysqldump + tar chạy trong app container
 * (Dockerfile thêm `mysql-client`); kết nối MySQL qua TCP (DB_HOST/DB_PORT).
 *
 * **Khoá MySQL `cdkt:backup:run`** (timeout 0) — 2 backup không chạy chồng.
 * **Khoá `cdkt:backup:restore`** — restore không chạy chồng backup.
 * **File hỏng → bỏ qua + log** — không rollback, đã backup xong là giữ.
 * **Xoay vòng N bản** — xoá bản cũ vượt N (mặc định 14) sau khi backup + Drive xong.
 *
 * **Khôi phục** nằm ở `backup-restore.ts` (chỉ SuperAdmin — endpoint chặn);
 * dump/chạy SQL ở `backup-sql.ts`; kiểm file trước khi khôi phục ở
 * `backup-restore-guards.ts`.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { eq, desc, sql } from 'drizzle-orm'
import type { RowDataPacket } from 'mysql2/promise'

import { getDb, getPool } from '../utils/db'
import { backups, activityLogs, settings } from '../db/schema'
import { withNamedLock } from '../utils/named-lock'
import { logInfo, logWarn } from '../utils/logger'
import { dumpSql } from './backup-sql'
import { backupKindOf, expectedArchiveTop } from './backup-restore-guards'

const execFileAsync = promisify(execFile)

const LOCK_RUN = 'cdkt:backup:run'
const LOCK_TIMEOUT = 0

export type BackupType = 'sql' | 'files' | 'all'
/**
 * Mọi giá trị ghi vào `backups.trigger` (và vào tên file). Cột là VARCHAR(32):
 * `pre-fix-thumbnails` (18 ký tự) từng vượt VARCHAR(16) cũ → dưới strict
 * sql_mode lượt sao lưu trước khi sửa thumbnail chết với ER_DATA_TOO_LONG, không
 * ghi hàng nào. `tests/backup-trigger-length.test.ts` so độ dài từng giá trị với
 * cột trong `schema.ts`; thêm trigger dài hơn thì nới cột trước.
 */
export const BACKUP_TRIGGERS = [
  'manual', 'scheduled', 'pre-sync', 'pre-repoint', 'pre-repair-urls', 'pre-self-heal', 'pre-fix-thumbnails', 'pre-restore',
] as const
export type BackupTrigger = typeof BACKUP_TRIGGERS[number]

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
}

/** Một lượt backup khác giữ khoá — phân biệt bằng kiểu, không so chuỗi. */
export class BackupLockBusyError extends Error {
  constructor() {
    super('Một lượt backup khác đang chạy. Thử lại sau.')
    this.name = 'BackupLockBusyError'
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

export function timestampStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
}

export function backupsDir(): string {
  return path.resolve(process.cwd(), 'backups')
}

/** Đọc cấu hình backup từ settings (group `backup`), lùi về mặc định nếu thiếu. */
async function readBackupConfig(db: ReturnType<typeof getDb>) {
  const rows = await db.select().from(settings)
  const map = new Map(rows.map(r => [r.key, r.value]))
  return {
    keepCount: Number(map.get('backup_keep_count')) || 14,
    driveEnabled: map.get('backup_drive_enabled') === 'true' || map.get('backup_drive_enabled') === '1',
    driveServiceAccount: map.get('backup_drive_service_account') || '',
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

/** Họ file của một backup: SQL, archive `uploads/` hay archive `media/` (cùng quy tắc tên với `archiveFiles`). */
export function backupFamilyOf(filename: string): 'sql' | 'uploads' | 'media' | null {
  const kind = backupKindOf(filename)
  if (kind === 'sql') return 'sql'
  if (kind === 'media') return expectedArchiveTop(filename)
  return null
}

/** Bản an toàn trước khi khôi phục — không bao giờ bị xoay vòng xoá (chỉ xoá tay). */
export function isPreRestoreBackup(row: { filename: string, trigger?: string | null }): boolean {
  return row.trigger === 'pre-restore' || /-pre-restore\.(sql|tar)\.gz$/.test(row.filename)
}

type RotationRow = { id: number, filename: string, stamp: string, trigger?: string | null, status?: string | null }

/**
 * Chọn bản bị xoá khi xoay vòng. Hai bất biến, đúng với MỌI `keepCount` (kể cả 1):
 *  - bản `pre-restore` không bao giờ là ứng viên, cũng không chiếm chỗ trong N bản
 *    giữ lại (nó là ảnh chụp trước một lần khôi phục, không phải lịch sử);
 *  - bản MỚI NHẤT của mỗi họ (`sql`, `uploads`, `media`) luôn được giữ. Một lượt
 *    "files" sinh hai archive cùng `type='media'` (`cdkt-uploads-…`, `cdkt-media-…`),
 *    nên họ đọc từ TÊN file chứ không từ cột `type` — đếm theo cột, `keepCount=1`
 *    sẽ giữ archive media và xoá archive uploads duy nhất.
 * Thuần, để kiểm thử không cần CSDL hay đĩa.
 */
export function selectRotationVictims<T extends RotationRow>(rows: readonly T[], keepCount: number): T[] {
  const candidates = rows
    .filter(row => (row.status ?? 'done') === 'done' && !isPreRestoreBackup(row))
    .slice()
    .sort((a, b) => (a.stamp === b.stamp ? b.id - a.id : a.stamp < b.stamp ? 1 : -1))
  const newestOfFamily = new Set<number>()
  const seenFamilies = new Set<string>()
  for (const row of candidates) {
    const family = backupFamilyOf(row.filename) ?? `other:${row.filename}`
    if (seenFamilies.has(family)) continue
    seenFamilies.add(family)
    newestOfFamily.add(row.id)
  }
  const keep = Math.max(1, Math.floor(keepCount))
  return candidates.slice(keep).filter(row => !newestOfFamily.has(row.id))
}

// ─── Xoay vòng không được xoá file đang được khôi phục ─────────────────────────
//
// Bản `pre-restore` đã bỏ xoay vòng, nhưng một lượt backup KHÁC (lịch chạy, bấm
// tay, pre-sync…) kết thúc đúng lúc đang khôi phục một bản CŨ vẫn xoay vòng — và
// bản cũ nhất chính là ứng viên đầu tiên. Hai lớp chặn:
//  1. Khoá `cdkt:backup:restore` đang bị giữ (bất kỳ tiến trình/container nào —
//     `IS_USED_LOCK` hỏi MySQL, không chờ) → bỏ cả lượt xoay vòng, log
//     `backup.rotate_skipped_restore_active`. Không đọc được trạng thái khoá →
//     cũng bỏ (bỏ một lượt xoay vòng vô hại; xoá file đang đọc thì không).
//  2. Tên file đang khôi phục trong tiến trình này (`holdRestoreTarget`, đăng ký
//     TRƯỚC khi `runRestore` kiểm file và lấy khoá — phủ khoảng hở trước khi khoá
//     được giữ) → không bao giờ là nạn nhân; kiểm lại ngay trước mỗi lần xoá.
// Sổ đăng ký nằm ở đây chứ không ở `backup-restore.ts` vì tệp đó import tệp này
// (`runBackup` cho bản `pre-restore`) — đặt ngược lại thành vòng import.
// Còn lại một khe đã biết, an toàn: lượt xoay vòng đã qua phép kiểm của một file
// rồi mới tới lượt khôi phục đăng ký file đó → khôi phục thất bại sạch (file
// biến mất trước khi được đọc: `runRestore` 404, hoặc `ENOENT` ở bước kiểm/giải
// nén trước khi ghi gì; khôi phục CSDL còn bị chặn 409 vì backup đang giữ khoá
// chạy), không có lượt khôi phục nửa chừng.

/** Khoá MySQL của lượt khôi phục — một nguồn cho `backup-restore.ts` và cho xoay vòng. */
export const LOCK_RESTORE = 'cdkt:backup:restore'

const activeRestoreTargets = new Map<string, number>()

/**
 * Đánh dấu `filename` (tên trong thư mục backups) là đang được khôi phục cho tới
 * khi gọi hàm trả về. Đếm tham chiếu: `restoreUploaded` và `runRestore` cùng giữ
 * một file mà không nhả sớm cho nhau. Gọi nhả nhiều lần vô hại.
 */
export function holdRestoreTarget(filename: string): () => void {
  activeRestoreTargets.set(filename, (activeRestoreTargets.get(filename) ?? 0) + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    const left = (activeRestoreTargets.get(filename) ?? 1) - 1
    if (left <= 0) activeRestoreTargets.delete(filename)
    else activeRestoreTargets.set(filename, left)
  }
}

export function restoreTargetsInProgress(): ReadonlySet<string> {
  return new Set(activeRestoreTargets.keys())
}

/** Hai câu hỏi xoay vòng phải hỏi trước khi xoá — thay được trong kiểm thử. */
export interface RotationGuards {
  /** Khoá `cdkt:backup:restore` có đang bị giữ không (ném = không biết → bỏ xoay vòng). */
  restoreLockHeld: () => Promise<boolean>
  /** Tên file đang được khôi phục trong tiến trình này. */
  restoreTargets: () => ReadonlySet<string>
}

async function restoreLockHeldOnServer(): Promise<boolean> {
  const pool = getPool()
  if (!pool) throw new Error('Cơ sở dữ liệu chưa sẵn sàng.')
  const [rows] = await pool.query<RowDataPacket[]>('SELECT IS_USED_LOCK(?) AS holder', [LOCK_RESTORE])
  const holder = rows[0]?.holder
  return holder !== null && holder !== undefined
}

const DEFAULT_ROTATION_GUARDS: RotationGuards = {
  restoreLockHeld: restoreLockHeldOnServer,
  restoreTargets: restoreTargetsInProgress,
}

/**
 * Xoá bản cũ vượt keepCount — chỉ đếm bản `done` để không xoá bản đang chạy, và
 * không xoá gì khi đang có lượt khôi phục (xem khối chú thích ở trên).
 */
export async function rotateOldBackups(
  db: ReturnType<typeof getDb>,
  keepCount: number,
  guardOverrides: Partial<RotationGuards> = {},
): Promise<number> {
  const guards: RotationGuards = { ...DEFAULT_ROTATION_GUARDS, ...guardOverrides }
  let restoreActive: boolean
  try {
    restoreActive = await guards.restoreLockHeld()
  } catch (err: unknown) {
    logWarn({ event: 'backup.rotate_skipped_restore_unknown', error: err instanceof Error ? err.message : String(err) })
    return 0
  }
  if (restoreActive) {
    logWarn({ event: 'backup.rotate_skipped_restore_active', reason: 'restore_lock_held' })
    return 0
  }

  const all = await db.select().from(backups).where(eq(backups.status, 'done')).orderBy(desc(backups.stamp))
  const toRemove = selectRotationVictims(all, keepCount)
  if (toRemove.length === 0) return 0
  let deleted = 0
  for (const row of toRemove) {
    if (guards.restoreTargets().has(row.filename)) {
      logWarn({ event: 'backup.rotate_skipped_restore_active', reason: 'restore_target', filename: row.filename })
      continue
    }
    try {
      const filePath = path.resolve(backupsDir(), row.filename)
      await fs.unlink(filePath).catch(() => {})
      await db.delete(backups).where(eq(backups.id, row.id))
      deleted += 1
    } catch (err) {
      logWarn({ event: 'backup.rotate_failed', filename: row.filename, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return deleted
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
    currentBackupStatus = { running: true, phase: 'start', message: 'Bắt đầu backup', startedAt: Date.now() }
    const dir = backupsDir()
    await fs.mkdir(dir, { recursive: true })
    const config = await readBackupConfig(db)

    const files: BackupResult['files'] = []

    // ── Không để lại archive mồ côi (wave1 D11) ──
    // Mỗi tệp lượt này TẠO ra được ghi vào `created`; tệp nào có hàng `done` vào
    // `registered`. Hỏng ở bất kỳ bước nào → xoá mọi tệp đã tạo mà chưa có hàng
    // `done` (kể cả archive `tar` viết dở), và hàng `failed` mang tên đúng tệp của
    // bước đã ném. Trước đây cả hai archive được nén xong rồi mới ghi hàng, và nhánh
    // lỗi ghi cứng `cdkt-media-…`: media hỏng sau khi uploads đã nén thì archive
    // uploads nằm lại trên đĩa không hàng nào (danh sách admin không thấy, xoay vòng
    // không bao giờ xoá), còn uploads hỏng thì hàng `failed` lại nêu tên media.
    const created = new Set<string>()
    const registered = new Set<string>()
    let step: { name: string, kind: 'sql' | 'media' } | null = null

    /**
     * Bắt đầu một tệp. Tệp đã có sẵn cùng tên (hai lượt cùng trigger trong cùng một
     * giây có cùng stamp) không thuộc lượt này — không bao giờ bị dọn.
     */
    const begin = async (name: string, kind: 'sql' | 'media'): Promise<string> => {
      step = { name, kind }
      const target = path.join(dir, name)
      if (!(await pathExists(target))) created.add(name)
      return target
    }
    /** Hàng `done` + audit cùng transaction, ngay sau khi tệp đã ghi xong và kiểm. */
    const register = async (name: string, kind: 'sql' | 'media', bytes: number) => {
      await db.transaction(async (tx) => {
        await tx.insert(backups).values({
          filename: name, type: kind, bytes, stamp, trigger, status: 'done', createdBy: adminUserId,
        })
        await tx.insert(activityLogs).values({
          userId: adminUserId, action: 'backup_run', resource: 'settings', resourceId: null,
          meta: { type: kind, filename: name, bytes, trigger },
        })
      })
      registered.add(name)
      files.push({ name, type: kind, bytes })
    }

    try {
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
        message: failedStep?.kind === 'sql' ? 'Dump SQL thất bại' : 'Nén file thất bại',
        startedAt: Date.now(),
      }
      for (const name of created) {
        if (!registered.has(name)) await fs.unlink(path.join(dir, name)).catch(() => {})
      }
      if (failedStep) {
        // Không để lỗi ghi hàng `failed` (CSDL đang hỏng) che lỗi gốc của lượt sao lưu.
        await db.insert(backups).values({
          filename: failedStep.name, type: failedStep.kind, bytes: 0, stamp, trigger, status: 'failed',
          error: err instanceof Error ? err.message : String(err), createdBy: adminUserId,
        }).catch((insertErr: unknown) => {
          logWarn({ event: 'backup.failed_row_unwritten', filename: failedStep.name, error: insertErr instanceof Error ? insertErr.message : String(insertErr) })
        })
      }
      throw err
    }

    // Upload Google Drive (nếu bật + cấu hình). HAI mode:
    //   1. OAuth login (ưu tiên nếu đã liên kết) — refresh token từ `backup_drive_oauth`,
    //      dùng client_id/secret **riêng cho Drive** từ `backup_drive_oauth_config`
    //      (không dùng chung `google_oauth_settings` của reader — scope/audience khác).
    //   2. Service Account (fallback) — JSON key từ settings.
    let driveUploaded = false
    let driveError: string | undefined
    if (config.driveEnabled && files.length > 0) {
      currentBackupStatus = { running: true, phase: 'drive', message: 'Đang upload Google Drive', startedAt: Date.now() }
      try {
        // Mode 1: OAuth link (ưu tiên — refresh token ổn định, không cần share folder).
        const { getUsableDriveLink } = await import('./backup-drive-oauth')
        const link = await getUsableDriveLink()
        if (link.ok) {
          const { getUsableDriveOauthConfig } = await import('./backup-drive-oauth-config')
          const oauthConfig = await getUsableDriveOauthConfig()
          if (!oauthConfig.ok) {
            throw new Error(`OAuth config (${oauthConfig.reason}) — cần cấu hình Drive OAuth trước`)
          }
          const { uploadBackupToDriveOAuth } = await import('./backup-drive')
          for (const f of files) {
            const fileId = await uploadBackupToDriveOAuth(
              path.join(dir, f.name), f.name, link.refreshToken,
              oauthConfig.clientId, oauthConfig.clientSecret,
              f.type === 'sql' ? 'sql' : 'media', stamp,
              config.driveFolderId || undefined,
            )
            await db.update(backups).set({ driveUploaded: true, driveFileId: fileId }).where(eq(backups.filename, f.name))
          }
          driveUploaded = true
        } else if (config.driveServiceAccount) {
          // Mode 2: Service Account (fallback).
          const { uploadBackupToDrive } = await import('./backup-drive')
          for (const f of files) {
            const fileId = await uploadBackupToDrive(
              path.join(dir, f.name), f.name, config.driveServiceAccount,
              f.type === 'sql' ? 'sql' : 'media', stamp,
              config.driveFolderId || undefined,
            )
            await db.update(backups).set({ driveUploaded: true, driveFileId: fileId }).where(eq(backups.filename, f.name))
          }
          driveUploaded = true
        } else if (link.reason === 'secret_unreadable') {
          throw new Error('Refresh token không giải mã được — dịch khoá hoặc liên kết lại Drive')
        }
        // else: not_linked + no service account → không upload, không lỗi.
      } catch (err) {
        driveError = err instanceof Error ? err.message : String(err)
        logWarn({ event: 'backup.drive_failed', error: driveError })
      }
    }

    // Xoay vòng — sau khi backup + Drive xong. Bản `pre-restore` bỏ qua bước này:
    // xoay vòng xoá bản `done` cũ nhất, và bản cũ nhất có thể chính là file sắp
    // được khôi phục.
    if (options.rotate !== false && config.keepCount > 0) {
      await rotateOldBackups(db, config.keepCount)
    }

    currentBackupStatus = { running: false, phase: 'done', message: 'Backup xong', startedAt: Date.now() }
    logInfo({ event: 'backup.complete', type, trigger, files: files.length, driveUploaded })
    return { stamp, files, driveUploaded, driveError }
  })

  if (!outcome.acquired) {
    throw new BackupLockBusyError()
  }
  return outcome.value
}

/** Liệt kê backup cho trang admin. */
export async function listBackups(page: number, pageSize: number, typeFilter?: string) {
  const db = getDb()
  const where = typeFilter && typeFilter !== 'all' ? eq(backups.type, typeFilter) : undefined
  const [rows, totalRow] = await Promise.all([
    where
      ? db.select().from(backups).where(where).orderBy(desc(backups.id)).limit(pageSize).offset((page - 1) * pageSize)
      : db.select().from(backups).orderBy(desc(backups.id)).limit(pageSize).offset((page - 1) * pageSize),
    where
      ? db.select({ c: sql<number>`COUNT(*)` }).from(backups).where(where)
      : db.select({ c: sql<number>`COUNT(*)` }).from(backups),
  ])
  return { items: rows, total: totalRow[0]?.c ?? 0 }
}

export async function deleteBackup(filename: string, adminUserId: number | null): Promise<void> {
  const db = getDb()
  const filePath = path.resolve(backupsDir(), filename)
  if (!filePath.startsWith(backupsDir() + path.sep)) throw new Error('Đường dẫn không hợp lệ.')
  await fs.unlink(filePath).catch(() => {})
  await db.transaction(async (tx) => {
    await tx.delete(backups).where(eq(backups.filename, filename))
    await tx.insert(activityLogs).values({
      userId: adminUserId, action: 'delete', resource: 'settings', resourceId: null,
      meta: { backup: filename },
    })
  })
}
