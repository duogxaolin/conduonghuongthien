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
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { eq, desc, sql } from 'drizzle-orm'
import type { RowDataPacket } from 'mysql2'

import { getDb, getPool } from '../utils/db'
import { backups, activityLogs, settings } from '../db/schema'
import { withNamedLock } from '../utils/named-lock'
import { logInfo, logWarn } from '../utils/logger'

const execFileAsync = promisify(execFile)

const LOCK_RUN = 'cdkt:backup:run'
const LOCK_RESTORE = 'cdkt:backup:restore'
const LOCK_TIMEOUT = 0

export type BackupType = 'sql' | 'files' | 'all'
export type BackupTrigger = 'manual' | 'scheduled' | 'pre-sync' | 'pre-repoint' | 'pre-repair-urls'

export interface BackupResult {
  stamp: string
  files: Array<{ name: string; type: 'sql' | 'media'; bytes: number }>
  driveUploaded: boolean
  driveError?: string
}

/** Trạng thái chạy hiện tại — cho endpoint status poll. */
interface RunStatus {
  running: boolean
  phase: string
  message: string
  startedAt: number | null
}
let currentBackupStatus: RunStatus = { running: false, phase: '', message: '', startedAt: null }
let currentRestoreStatus: RunStatus = { running: false, phase: '', message: '', startedAt: null }

export function getBackupStatus(): RunStatus { return { ...currentBackupStatus } }
export function getRestoreStatus(): RunStatus { return { ...currentRestoreStatus } }

function timestampStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
}

function backupsDir(): string {
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

/**
 * Dump CSDL bằng Node `mysql2` driver — không phụ thuộc `mysqldump` binary.
 *
 * Lý do: app container (alpine + `mysql-client` = mariadb-client) không có plugin
 * `caching_sha2_password` mà MySQL 8 mặc định dùng, nên `mysqldump` từ app container
 * không kết nối được. Node driver không gặp vấn đề này. Dump sinh SQL text thuần:
 * `DROP TABLE IF EXISTS` + `CREATE TABLE` + `INSERT VALUES` cho mỗi bảng.
 */
function escapeSqlValue(v: unknown): string {
  if (v === null) return 'NULL'
  if (v === undefined) return 'NULL'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  if (typeof v === 'boolean') return v ? '1' : '0'
  if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace('T', ' ')}'`
  if (Buffer.isBuffer(v)) return `X'${v.toString('hex')}'`
  // Object/Array (cột JSON) — stringify thành JSON text rồi escape như string.
  if (typeof v === 'object') {
    const json = JSON.stringify(v)
    return `'${json.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\0/g, '\\0')}'`
  }
  // String — escape ký tự đặc biệt.
  return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\0/g, '\\0')}'`
}

async function dumpSql(target: string): Promise<number> {
  const pool = getPool()
  if (!pool) throw new Error('Cơ sở dữ liệu chưa sẵn sàng.')
  const conn = await pool.getConnection()
  try {
    const [tables] = await conn.query<RowDataPacket[]>('SHOW TABLES')
    const dbName = process.env.DB_NAME || 'cdkt_admin'
    const lines: string[] = [
      `-- CDKT backup: ${dbName}`,
      `-- Generated: ${new Date().toISOString()}`,
      'SET NAMES utf8mb4;',
      'SET FOREIGN_KEY_CHECKS=0;',
      '',
    ]
    for (const row of tables) {
      const table = Object.values(row)[0] as string
      // Table name từ SHOW TABLES — an toàn để nhét trực tiếp (không user input).
      const [createRows] = await conn.query<RowDataPacket[]>(`SHOW CREATE TABLE \`${table}\``)
      const createSql = (createRows[0] as Record<string, string>)['Create Table']
      lines.push(`DROP TABLE IF EXISTS \`${table}\`;`)
      lines.push(createSql + ';')
      // Đếm dòng.
      const [cntRows] = await conn.query<RowDataPacket[]>(`SELECT COUNT(*) AS cnt FROM \`${table}\``)
      const cnt = Number((cntRows[0] as Record<string, unknown> | undefined)?.cnt ?? 0)
      if (cnt > 0) {
        const [rows] = await conn.query<RowDataPacket[]>(`SELECT * FROM \`${table}\``)
        const firstRow = rows[0]
        const cols = firstRow ? Object.keys(firstRow) : []
        if (cols.length) {
          lines.push(`INSERT INTO \`${table}\` (\`${cols.join('`, `')}\`) VALUES`)
          const valuesChunks: string[] = []
          for (const r of rows) {
            valuesChunks.push(`(${cols.map(c => escapeSqlValue((r as Record<string, unknown>)[c])).join(', ')})`)
          }
          lines.push(valuesChunks.join(',\n') + ';')
        }
      }
      lines.push('')
    }
    lines.push('SET FOREIGN_KEY_CHECKS=1;', '')

    const zlib = await import('node:zlib')
    const gzipped = zlib.gzipSync(Buffer.from(lines.join('\n'), 'utf8'), { level: 6 })
    await fs.writeFile(target, gzipped)
    return gzipped.length
  } finally {
    conn.release()
  }
}

/**
 * Nén uploads + media thành 2 file tar.gz riêng (cùng stamp) — BusyBox tar trong
 * alpine không hỗ trợ nhiều `-C` đổi dir giữa các path trong cùng lệnh, nên không
 * thể gộp 2 cây có gốc khác nhau vào 1 archive. Trả mảng 2 file (hoặc ít hơn nếu
 * thư mục vắng).
 */
async function archiveFiles(
  dir: string,
  stamp: string,
  trigger: BackupTrigger,
): Promise<Array<{ name: string; bytes: number }>> {
  const uploadsParent = path.resolve(process.cwd(), 'public')
  const mediaParent = '/var/lib/cdkt'
  const out: Array<{ name: string; bytes: number }> = []

  if (await dirExists(path.join(uploadsParent, 'uploads'))) {
    const name = `cdkt-uploads-${stamp}-${trigger}.tar.gz`
    const target = path.join(dir, name)
    await execFileAsync('tar', ['czf', target, '-C', uploadsParent, 'uploads'], { maxBuffer: 1024 * 1024 * 1024 })
    out.push({ name, bytes: (await fs.stat(target)).size })
  }
  if (await dirExists(path.join(mediaParent, 'media'))) {
    const name = `cdkt-media-${stamp}-${trigger}.tar.gz`
    const target = path.join(dir, name)
    await execFileAsync('tar', ['czf', target, '-C', mediaParent, 'media'], { maxBuffer: 1024 * 1024 * 1024 })
    out.push({ name, bytes: (await fs.stat(target)).size })
  }
  if (out.length === 0) throw new Error('Không tìm thấy thư mục uploads hoặc media để backup.')
  return out
}

async function dirExists(p: string): Promise<boolean> {
  try { return (await fs.stat(p)).isDirectory() } catch { return false }
}

/** Xoá bản cũ vượt keepCount — chỉ đếm bản `done` để không xoá bản đang chạy. */
async function rotateOldBackups(db: ReturnType<typeof getDb>, keepCount: number): Promise<number> {
  const all = await db.select().from(backups).where(eq(backups.status, 'done')).orderBy(desc(backups.stamp))
  if (all.length <= keepCount) return 0
  const toRemove = all.slice(keepCount)
  let deleted = 0
  for (const row of toRemove) {
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

    if (type === 'sql' || type === 'all') {
      currentBackupStatus = { running: true, phase: 'sql', message: 'Đang dump CSDL', startedAt: Date.now() }
      const filename = `cdkt-${stamp}-${trigger}.sql.gz`
      const target = path.join(dir, filename)
      try {
        const bytes = await dumpSql(target)
        files.push({ name: filename, type: 'sql', bytes })
        await db.transaction(async (tx) => {
          await tx.insert(backups).values({
            filename, type: 'sql', bytes, stamp, trigger, status: 'done', createdBy: adminUserId,
          })
          await tx.insert(activityLogs).values({
            userId: adminUserId, action: 'backup_run', resource: 'settings', resourceId: null,
            meta: { type: 'sql', filename, bytes, trigger },
          })
        })
      } catch (err) {
        currentBackupStatus = { running: false, phase: 'failed', message: 'Dump SQL thất bại', startedAt: Date.now() }
        await fs.unlink(target).catch(() => {})
        await db.insert(backups).values({
          filename, type: 'sql', bytes: 0, stamp, trigger, status: 'failed',
          error: err instanceof Error ? err.message : String(err), createdBy: adminUserId,
        })
        throw err
      }
    }

    if (type === 'files' || type === 'all') {
      currentBackupStatus = { running: true, phase: 'files', message: 'Đang nén file', startedAt: Date.now() }
      try {
        const archived = await archiveFiles(dir, stamp, trigger)
        for (const f of archived) {
          files.push({ name: f.name, type: 'media', bytes: f.bytes })
          await db.transaction(async (tx) => {
            await tx.insert(backups).values({
              filename: f.name, type: 'media', bytes: f.bytes, stamp, trigger, status: 'done', createdBy: adminUserId,
            })
            await tx.insert(activityLogs).values({
              userId: adminUserId, action: 'backup_run', resource: 'settings', resourceId: null,
              meta: { type: 'media', filename: f.name, bytes: f.bytes, trigger },
            })
          })
        }
      } catch (err) {
        currentBackupStatus = { running: false, phase: 'failed', message: 'Nén file thất bại', startedAt: Date.now() }
        await db.insert(backups).values({
          filename: `cdkt-media-${stamp}-${trigger}.tar.gz`, type: 'media', bytes: 0, stamp, trigger, status: 'failed',
          error: err instanceof Error ? err.message : String(err), createdBy: adminUserId,
        })
        throw err
      }
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

    // Xoay vòng — sau khi backup + Drive xong.
    if (config.keepCount > 0) {
      await rotateOldBackups(db, config.keepCount)
    }

    currentBackupStatus = { running: false, phase: 'done', message: 'Backup xong', startedAt: Date.now() }
    logInfo({ event: 'backup.complete', type, trigger, files: files.length, driveUploaded })
    return { stamp, files, driveUploaded, driveError }
  })

  if (!outcome.acquired) {
    throw new Error('Một lượt backup khác đang chạy. Thử lại sau.')
  }
  return outcome.value
}

export async function runRestore(filename: string, adminUserId: number | null): Promise<void> {
  const db = getDb()
  const pool = getPool()
  if (!pool) throw new Error('Cơ sở dữ liệu chưa sẵn sàng.')

  const filePath = path.resolve(backupsDir(), filename)
  if (!filePath.startsWith(backupsDir() + path.sep)) {
    throw new Error('Đường dẫn file không hợp lệ.')
  }
  try { await fs.stat(filePath) } catch { throw new Error(`File backup "${filename}" không tồn tại.`) }

  const outcome = await withNamedLock(pool, LOCK_RESTORE, LOCK_TIMEOUT, async () => {
    currentRestoreStatus = { running: true, phase: 'start', message: `Đang khôi phục ${filename}`, startedAt: Date.now() }

    if (filename.endsWith('.sql.gz')) {
      currentRestoreStatus = { running: true, phase: 'sql', message: 'Đang phục hồi CSDL', startedAt: Date.now() }
      await restoreSql(filePath)
    } else if (filename.endsWith('.tar.gz')) {
      currentRestoreStatus = { running: true, phase: 'files', message: 'Đang giải nén file', startedAt: Date.now() }
      await restoreFiles(filePath)
    } else {
      throw new Error(`Định dạng file không hỗ trợ: ${filename}`)
    }

    await db.transaction(async (tx) => {
      await tx.insert(activityLogs).values({
        userId: adminUserId, action: 'backup_restore', resource: 'settings', resourceId: null,
        meta: { filename },
      })
    })
    currentRestoreStatus = { running: false, phase: 'done', message: 'Khôi phục xong', startedAt: Date.now() }
    logInfo({ event: 'backup.restored', filename })
  })

  if (!outcome.acquired) {
    throw new Error('Một lượt khôi phục khác đang chạy. Thử lại sau.')
  }
}

async function restoreSql(filePath: string): Promise<void> {
  const zlib = await import('node:zlib')
  const buf = await fs.readFile(filePath)
  const sqlText = zlib.gunzipSync(buf).toString('utf8')

  // Tạo connection riêng với `multipleStatements: true` để chạy toàn bộ SQL dump
  // trong 1 lượt — không tách statement thủ công (dễ sai khi string literal chứa `;`).
  // Pool của app tắt multipleStatements (mặc định) nên phải tạo connection riêng.
  const mysql = await import('mysql2/promise')
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || process.env.MYSQL_DATABASE || 'cdkt_admin',
    multipleStatements: true,
  })
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0')
    await conn.query(sqlText)
    await conn.query('SET FOREIGN_KEY_CHECKS = 1')
  } finally {
    await conn.end()
  }
}

async function restoreFiles(filePath: string): Promise<void> {
  // Mỗi file backup chỉ chứa 1 cây: `uploads/` (nén từ public/) hoặc `media/`
  // (từ /var/lib/cdkt/). Xác định cây qua tên file rồi extract về gốc đúng.
  const filename = path.basename(filePath)
  const isMedia = filename.includes('-media-')
  const target = isMedia ? '/var/lib/cdkt' : path.resolve(process.cwd(), 'public')
  await fs.mkdir(target, { recursive: true }).catch(() => {})
  const treeName = isMedia ? 'media' : 'uploads'
  await execFileAsync('tar', ['-xzf', filePath, '-C', target, treeName])
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

/** Lưu file upload vào backups/ rồi khôi phục. */
export async function restoreUploaded(filename: string, fileBuffer: Buffer, adminUserId: number | null): Promise<void> {
  const dir = backupsDir()
  await fs.mkdir(dir, { recursive: true })
  const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_')
  const target = path.resolve(dir, safeName)
  if (!target.startsWith(dir + path.sep)) throw new Error('Tên file không hợp lệ.')
  await fs.writeFile(target, fileBuffer)
  // Ghi hàng backups (trigger=manual) để công khai
  const db = getDb()
  await db.insert(backups).values({
    filename: safeName, type: safeName.endsWith('.sql.gz') ? 'sql' : 'media',
    bytes: fileBuffer.length, stamp: timestampStamp(), trigger: 'manual', status: 'done',
    createdBy: adminUserId,
  })
  await runRestore(safeName, adminUserId)
}
