/**
 * Backup Drive OAuth **config** — Client ID + Client Secret riêng cho Drive,
 * hoàn toàn tách biệt với `google_oauth_settings` của đăng nhập người đọc.
 *
 * Hai lý do tách (xem plan D2 refactor):
 *   1. **Scope khác**: reader dùng `openid email profile`, Drive cần `drive.file`.
 *      Gộp OAuth Client thì consent screen reader phải khai scope Drive → mọi
 *      người đọc đăng nhập bị Google hỏi quyền Drive dù chỉ muốn bình luận.
 *   2. **Audience khác**: reader OAuth cho công dân (public), Drive OAuth cho
 *      admin (internal). Hai OAuth Client ID riêng là best practice Google.
 *
 * Cùng nhãn envelope `cdkt-backup-drive-oauth:v1` với refresh token (cùng
 * feature, một nhãn đủ) — tái sử dụng codec `backup-drive-oauth-crypto.ts`.
 *
 * Ba thuộc tính (giống `google-oauth-settings.ts`):
 *   1. Plaintext secret chỉ rò rỉ qua `getUsableDriveOauthConfig`.
 *   2. Decryption failure là trạng thái phân biệt (`secret_unreadable`), không
 *      đọc thành "not_configured" — xoay khoá gửi cán bộ nhập lại secret cũ.
 *   3. Validate xong trước khi ghi — half-applied credential pair là sign-in
 *      flow fail tại Google.
 */
import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'

import { getDb } from '../utils/db'
import { activityLogs, backupDriveOauthConfig, type BackupDriveOauthConfig } from '../db/schema'
import {
  decryptRefreshToken,
  encryptRefreshToken,
  type EncryptedRefreshToken,
} from '../utils/backup-drive-oauth-crypto'
import { resolveDriveRedirectUri, configuredBaseUrl } from '../utils/google-oauth/config'

/** Single-row table, cùng convention `google_oauth_settings` / `backup_drive_oauth`. */
export const BACKUP_DRIVE_OAUTH_CONFIG_ID = 1

const CLIENT_ID_MAX = 255
const CLIENT_SECRET_MAX = 512

export class BackupDriveOauthConfigValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupDriveOauthConfigValidationError'
  }
}

export async function getDriveOauthConfigRow(): Promise<BackupDriveOauthConfig> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(backupDriveOauthConfig)
    .where(eq(backupDriveOauthConfig.id, BACKUP_DRIVE_OAUTH_CONFIG_ID))
    .limit(1)
  if (row) return row

  await db.insert(backupDriveOauthConfig).values({ id: BACKUP_DRIVE_OAUTH_CONFIG_ID })
  const [created] = await db
    .select()
    .from(backupDriveOauthConfig)
    .where(eq(backupDriveOauthConfig.id, BACKUP_DRIVE_OAUTH_CONFIG_ID))
    .limit(1)
  if (!created) throw new Error('backup_drive_oauth_config row unavailable')
  return created
}

function hasCompleteEnvelope(row: BackupDriveOauthConfig): boolean {
  return Boolean(
    row.clientSecretCiphertext
    && row.clientSecretNonce
    && row.clientSecretAuthTag
    && row.clientSecretVersion
    && row.clientSecretKeyId,
  )
}

/** Plaintext secret, or null when absent or unreadable. */
function decryptStoredSecret(row: BackupDriveOauthConfig, secret = process.env.CHATBOT_ENCRYPTION_SECRET): string | null {
  if (!hasCompleteEnvelope(row)) return null
  try {
    return decryptRefreshToken(
      {
        ciphertext: row.clientSecretCiphertext!,
        nonce:      row.clientSecretNonce!,
        authTag:    row.clientSecretAuthTag!,
        version:    row.clientSecretVersion!,
        keyId:      row.clientSecretKeyId!,
        lastFour:   '',
      },
      secret,
    )
  } catch {
    return null
  }
}

export type ClientSecretStatus = 'not_configured' | 'configured' | 'secret_unreadable'

function clientSecretStatus(row: BackupDriveOauthConfig): ClientSecretStatus {
  if (!hasCompleteEnvelope(row)) return 'not_configured'
  return decryptStoredSecret(row) === null ? 'secret_unreadable' : 'configured'
}

export type UsableDriveOauthConfig =
  | { ok: true, clientId: string, clientSecret: string }
  | { ok: false, reason: 'disabled' | 'not_configured' | 'secret_unreadable' }

/**
 * Everything the Drive OAuth flow (start/callback) + backup upload needs, or a
 * reason it cannot run. Cùng interface `getUsableOAuthConfig` của reader để
 * thay thế 1:1 ở endpoint.
 */
export async function getUsableDriveOauthConfig(): Promise<UsableDriveOauthConfig> {
  const row = await getDriveOauthConfigRow()
  if (!row.isEnabled) return { ok: false, reason: 'disabled' }

  const clientId = (row.clientId || '').trim()
  if (!clientId || !hasCompleteEnvelope(row)) return { ok: false, reason: 'not_configured' }

  const clientSecret = decryptStoredSecret(row)
  if (clientSecret === null) return { ok: false, reason: 'secret_unreadable' }

  return { ok: true, clientId, clientSecret }
}

export type SerializedDriveOauthConfig = {
  clientId:            string
  hasClientSecret:     boolean
  clientSecretMasked:  string | null
  clientSecretStatus:  ClientSecretStatus
  isEnabled:           boolean
  redirectUri:         string
  redirectUriSource:   'config' | 'request'
  missing:             string[]
  updatedAt:           Date | null
}

export function serializeDriveOauthConfig(row: BackupDriveOauthConfig, event: H3Event): SerializedDriveOauthConfig {
  const status = clientSecretStatus(row)
  const clientId = (row.clientId || '').trim()

  const missing: string[] = []
  if (!clientId) missing.push('clientId')
  if (status === 'not_configured') missing.push('clientSecret')
  if (status === 'secret_unreadable') missing.push('clientSecretUnreadable')
  if (!row.isEnabled) missing.push('enabled')

  return {
    clientId,
    hasClientSecret:    status === 'configured',
    clientSecretMasked: status === 'not_configured' ? null : `••••${row.clientSecretLastFour || ''}`,
    clientSecretStatus: status,
    isEnabled:          row.isEnabled,
    // Derived, never stored — cán bộ copy sang Google Console, phải khớp byte-byte.
    redirectUri:        resolveDriveRedirectUri(event),
    redirectUriSource:  configuredBaseUrl() ? 'config' : 'request',
    missing,
    updatedAt:          row.updatedAt ?? null,
  }
}

export type DriveOauthConfigUpdate = {
  clientId?:      string
  clientSecret?:  string
  isEnabled?:     boolean
}

function validateUpdate(input: DriveOauthConfigUpdate): void {
  if (input.clientId !== undefined) {
    if (typeof input.clientId !== 'string') throw new BackupDriveOauthConfigValidationError('Client ID không hợp lệ.')
    const value = input.clientId.trim()
    if (value.length > CLIENT_ID_MAX) throw new BackupDriveOauthConfigValidationError(`Client ID quá dài (tối đa ${CLIENT_ID_MAX} ký tự).`)
    if (value && /\s/.test(value)) throw new BackupDriveOauthConfigValidationError('Client ID không được chứa khoảng trắng.')
  }

  if (input.clientSecret !== undefined) {
    if (typeof input.clientSecret !== 'string') throw new BackupDriveOauthConfigValidationError('Client secret không hợp lệ.')
    const value = input.clientSecret.trim()
    if (!value) throw new BackupDriveOauthConfigValidationError('Client secret không được để trống. Dùng nút xoá nếu muốn gỡ bỏ.')
    if (value.length > CLIENT_SECRET_MAX) throw new BackupDriveOauthConfigValidationError(`Client secret quá dài (tối đa ${CLIENT_SECRET_MAX} ký tự).`)
    if (/\s/.test(value)) throw new BackupDriveOauthConfigValidationError('Client secret không được chứa khoảng trắng.')
  }

  if (input.isEnabled !== undefined && typeof input.isEnabled !== 'boolean') {
    throw new BackupDriveOauthConfigValidationError('Giá trị bật/tắt không hợp lệ.')
  }
}

export async function updateDriveOauthConfig(
  actorId: number,
  input: DriveOauthConfigUpdate,
  requestId?: unknown,
): Promise<BackupDriveOauthConfig> {
  validateUpdate(input)

  const db = getDb()
  const current = await getDriveOauthConfigRow()

  const patch: Record<string, unknown> = {}
  if (input.clientId !== undefined) patch.clientId = input.clientId.trim() || null
  if (input.isEnabled !== undefined) patch.isEnabled = input.isEnabled

  if (input.clientSecret !== undefined) {
    const envelope = encryptRefreshToken(input.clientSecret.trim())
    patch.clientSecretCiphertext = envelope.ciphertext
    patch.clientSecretNonce      = envelope.nonce
    patch.clientSecretAuthTag    = envelope.authTag
    patch.clientSecretVersion    = envelope.version
    patch.clientSecretKeyId      = envelope.keyId
    patch.clientSecretLastFour   = envelope.lastFour
  }

  // Bật công tắc với nothing behind it → nút liên kết gửi admin tới Google
  // error page. Refused here rather than at endpoint.
  const willHaveClientId = input.clientId !== undefined ? Boolean(input.clientId.trim()) : Boolean((current.clientId || '').trim())
  const willHaveSecret = input.clientSecret !== undefined ? true : hasCompleteEnvelope(current)
  if (patch.isEnabled === true && (!willHaveClientId || !willHaveSecret)) {
    throw new BackupDriveOauthConfigValidationError('Cần lưu đủ Client ID và Client secret trước khi bật OAuth Drive.')
  }

  if (Object.keys(patch).length === 0) return current

  patch.updatedBy = actorId

  // Config change + audit trong một transaction. "Ai đã cấu hình Drive OAuth,
  // khi nào" đúng câu hỏi hàng này phải trả lời. Same write path, never
  // fire-and-forget. Field NAMES recorded; secret VALUE never — an audit row
  // quoting the credential it audits defeats the encryption it was stored under.
  await db.transaction(async (tx) => {
    await tx
      .update(backupDriveOauthConfig)
      .set(patch)
      .where(eq(backupDriveOauthConfig.id, BACKUP_DRIVE_OAUTH_CONFIG_ID))
    await tx.insert(activityLogs).values({
      userId:     actorId,
      action:     'update',
      resource:   'backup_drive_oauth',
      resourceId: BACKUP_DRIVE_OAUTH_CONFIG_ID,
      meta: {
        changedFields:  Object.keys(input),
        secretReplaced: input.clientSecret !== undefined,
        requestId:      requestId ?? null,
      },
    })
  })

  return getDriveOauthConfigRow()
}

/**
 * Drops the envelope, keeps the client id, forces the switch off. Leaving the
 * switch on with no secret → nút liên kết fail; cán bộ clear secret không phải
 * để yêu cầu đó.
 */
export async function clearDriveOauthSecret(actorId: number, requestId?: unknown): Promise<BackupDriveOauthConfig> {
  const db = getDb()
  await getDriveOauthConfigRow()

  await db.transaction(async (tx) => {
    await tx
      .update(backupDriveOauthConfig)
      .set({
        clientSecretCiphertext: null,
        clientSecretNonce:      null,
        clientSecretAuthTag:    null,
        clientSecretVersion:    null,
        clientSecretKeyId:      null,
        clientSecretLastFour:   null,
        isEnabled:              false,
        updatedBy:              actorId,
      })
      .where(eq(backupDriveOauthConfig.id, BACKUP_DRIVE_OAUTH_CONFIG_ID))

    await tx.insert(activityLogs).values({
      userId:     actorId,
      action:     'update',
      resource:   'backup_drive_oauth',
      resourceId: BACKUP_DRIVE_OAUTH_CONFIG_ID,
      meta:       { changedFields: ['clientSecret', 'isEnabled'], secretCleared: true, requestId: requestId ?? null },
    })
  })

  return getDriveOauthConfigRow()
}
