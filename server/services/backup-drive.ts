/**
 * Upload file backup lên Google Drive — HAI mode:
 *
 * 1. **Service Account** (`uploadBackupToDrive`): JSON key dán trong settings,
 *    không cần OAuth flow. Phù hợp scheduler chạy nền. Cần share folder Drive
 *    với email service account.
 * 2. **OAuth login** (`uploadBackupToDriveOAuth`): refresh token từ lượt liên kết
 *    tài khoản Google cá nhân (flow `server/api/admin/backup/drive/*`). Phù hợp
 *    cán bộ bấm backup thủ công. `googleapis` tự refresh access token khi hết
 *    hạn — refresh token không hết hạn (trừ khi bị revoke).
 *
 * Cả hai dùng `googleapis` (npm) — lazy import để không nặng bundle nếu tắt Drive.
 *
 * Cấu trúc folder trên Drive (tự tạo):
 *   <root hoặc folder cán bộ chọn>/
 *   └── cdht_backup/
 *       ├── database/<YYYY-MM-DD>/cdkt-<stamp>-<trigger>.sql.gz
 *       └── file/<YYYY-MM-DD>/cdkt-<stamp>-<trigger>.tar.gz
 *
 * `cdht_backup` tạo 1 lần (lần backup đầu), không cần anh share trước. App có
 * quyền `drive.file` → tạo folder + file tự do. Cán bộ có thể override root bằng
 * `backup_drive_folder_id` (lúc đó `cdht_backup` nằm trong folder đó thay vì root).
 */
import { createReadStream } from 'node:fs'
import type { drive_v3 } from 'googleapis'

/** Cache folder ID theo (tên, parentId) trong một lượt backup — tránh query lại. */
type FolderCache = Map<string, string>

const BACKUP_ROOT_FOLDER_NAME = 'cdht_backup'

function folderCacheKey(name: string, parentId: string | null): string {
  return `${parentId ?? 'root'}::${name}`
}

/**
 * Lấy parentId của root Drive. Drive API dùng `parents: ['root']` hoặc bỏ qua
 * parents. Trả `null` để gọi API không kèm parents (= root).
 */
function rootParentId(folderId?: string): string | null {
  return folderId ? folderId : null
}

/**
 * Tìm folder theo tên trong parent. Tạo nếu chưa có. Trả folderId.
 *
 * Dùng `files.list` với query `name='...' and parents='...' and trashed=false`
 * — Drive API không có "get folder by name" endpoint. Cache theo (tên, parentId)
 * để một lượt backup tạo cùng một folder ngày không query 2 lần.
 */
export async function ensureDriveFolder(
  drive: drive_v3.Drive,
  name: string,
  parentId: string | null,
  cache: FolderCache,
): Promise<string> {
  const key = folderCacheKey(name, parentId)
  const cached = cache.get(key)
  if (cached) return cached

  const qParts = [
    `name='${name.replace(/'/g, "\\'")}'`,
    `mimeType='application/vnd.google-apps.folder'`,
    `trashed=false`,
  ]
  if (parentId) qParts.push(`'${parentId}' in parents`)
  else qParts.push(`'root' in parents`)

  const list = await drive.files.list({
    q: qParts.join(' and '),
    fields: 'files(id, name)',
    pageSize: 10,
  })

  const existing = list.data.files?.[0]?.id
  if (existing) {
    cache.set(key, existing)
    return existing
  }

  const create = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: 'id',
  })
  const newId = create.data.id
  if (!newId) throw new Error(`Không tạo được folder '${name}' trên Drive.`)
  cache.set(key, newId)
  return newId
}

/**
 * Parse `YYYY-MM-DD` từ stamp `YYYYMMDDTHHMMSSZ` (UTC). Trả theo ngày UTC để
 * nhất nhất giữa scheduler và manual — không lệch theo giờ địa phương.
 */
function dayFolderFromStamp(stamp: string): string {
  // stamp dạng 20260921T141439Z → 2026-09-21
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(stamp)
  if (!m) throw new Error(`Stamp không hợp lệ để suy ngày: ${stamp}`)
  return `${m[1]}-${m[2]}-${m[3]}`
}

/** Map backup type (từ DB) → tên subfolder cấp 2. */
function subfolderForType(backupType: 'sql' | 'media'): string {
  return backupType === 'sql' ? 'database' : 'file'
}

/**
 * Tạo (hoặc tìm) cấu trúc folder 3 cấp cho một file backup, trả folderId của
 * folder ngày (cấp sâu nhất) — đó là `parents` khi upload file.
 *
 * Cấp 1: `cdht_backup` (nếu `rootFolderId` trống → root Drive) hoặc nằm trong
 *          folder cán bộ chọn (`rootFolderId`).
 * Cấp 2: `database` (sql) / `file` (media).
 * Cấp 3: `YYYY-MM-DD` (suy từ stamp).
 */
export async function ensureBackupFolderStructure(
  drive: drive_v3.Drive,
  backupType: 'sql' | 'media',
  stamp: string,
  rootFolderId?: string,
  cache: FolderCache = new Map(),
): Promise<string> {
  const rootId = rootFolderId || undefined
  const rootParent = rootParentId(rootId)

  // Cấp 1: cdht_backup (hoặc nằm trong folder cán bộ chọn).
  const rootFolderIdResolved = rootId
    ? await ensureDriveFolder(drive, BACKUP_ROOT_FOLDER_NAME, rootParent, cache)
    : await ensureDriveFolder(drive, BACKUP_ROOT_FOLDER_NAME, null, cache)

  // Cấp 2: database / file.
  const subName = subfolderForType(backupType)
  const subId = await ensureDriveFolder(drive, subName, rootFolderIdResolved, cache)

  // Cấp 3: ngày.
  const dayName = dayFolderFromStamp(stamp)
  const dayId = await ensureDriveFolder(drive, dayName, subId, cache)

  return dayId
}

/**
 * Upload một file lên Google Drive qua Service Account. Trả file ID.
 *
 * `serviceAccountJson` là chuỗi JSON raw (chưa giải mã — caller lo decrypt
 * trước khi gọi, hoặc truyền plain nếu feature flag tắt encrypt).
 *
 * `media.body` PHẢI là readable stream, không phải Buffer — `googleapis` v105+
 * pipe stream trực tiếp sang uploader; truyền Buffer triggers
 * `part.body.pipe is not a function`.
 */
export async function uploadBackupToDrive(
  filePath: string,
  filename: string,
  serviceAccountJson: string,
  backupType: 'sql' | 'media',
  stamp: string,
  rootFolderId?: string,
): Promise<string> {
  const { google } = await import('googleapis')

  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(serviceAccountJson),
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  })
  const drive = google.drive({ version: 'v3', auth })
  const cache: FolderCache = new Map()

  const parentId = await ensureBackupFolderStructure(drive, backupType, stamp, rootFolderId, cache)
  const res = await drive.files.create({
    requestBody: { name: filename, parents: [parentId] },
    media: { mimeType: 'application/octet-stream', body: createReadStream(filePath) },
  })
  const fileId = res.data.id
  if (!fileId) throw new Error('Google Drive không trả file ID.')
  return fileId
}

/**
 * Upload một file lên Google Drive qua OAuth refresh token (tài khoản cá nhân).
 *
 * `clientId`/`clientSecret` từ `backup_drive_oauth_config` (giải mã bởi caller
 * qua `getUsableDriveOauthConfig`). `googleapis` tự refresh access token khi
 * hết hạn — caller chỉ cần truyền refresh token, không cần lo access token.
 */
export async function uploadBackupToDriveOAuth(
  filePath: string,
  filename: string,
  refreshToken: string,
  clientId: string,
  clientSecret: string,
  backupType: 'sql' | 'media',
  stamp: string,
  rootFolderId?: string,
): Promise<string> {
  const { google } = await import('googleapis')

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret)
  oauth2Client.setCredentials({ refresh_token: refreshToken })
  const drive = google.drive({ version: 'v3', auth: oauth2Client })
  const cache: FolderCache = new Map()

  const parentId = await ensureBackupFolderStructure(drive, backupType, stamp, rootFolderId, cache)
  const res = await drive.files.create({
    requestBody: { name: filename, parents: [parentId] },
    media: { mimeType: 'application/octet-stream', body: createReadStream(filePath) },
  })
  const fileId = res.data.id
  if (!fileId) throw new Error('Google Drive không trả file ID.')
  return fileId
}
