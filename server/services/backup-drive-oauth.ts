/**
 * Backup Drive OAuth link — single-row `backup_drive_oauth` table.
 *
 * The only place that decrypts the refresh token (other than `backup.ts` /
 * `backup-drive.ts` at upload time). Three properties the module exists to hold:
 *
 *   1. **The plaintext refresh token leaves here only through `getUsableDriveLink`.**
 *      `serializeDriveLink` builds an explicit projection with no access to the
 *      plaintext, so no field an accidental spread could publish. The admin
 *      surface sees the linked email + a "linked" boolean, nothing else.
 *   2. **Decryption failure is a distinguishable state, not "not linked".**
 *      Rotating `CHATBOT_ENCRYPTION_SECRET` makes the stored envelope unreadable;
 *      reporting that as "not linked" sends an officer to re-link a Drive they
 *      already linked. `secret_unreadable` is carried to the page with the remedy.
 *   3. **Link + audit in one transaction** — "who connected Drive, and when" is
 *      exactly the question this row has to answer.
 */
import { eq } from 'drizzle-orm'

import { getDb } from '../utils/db'
import { activityLogs, backupDriveOauth, type BackupDriveOauth } from '../db/schema'
import {
  decryptRefreshToken,
  encryptRefreshToken,
  type EncryptedRefreshToken,
} from '../utils/backup-drive-oauth-crypto'

/** Single-row table, same convention as `google_oauth_settings` / `chatbot_settings`. */
export const BACKUP_DRIVE_OAUTH_ID = 1

export async function getDriveLinkRow(): Promise<BackupDriveOauth | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(backupDriveOauth)
    .where(eq(backupDriveOauth.id, BACKUP_DRIVE_OAUTH_ID))
    .limit(1)
  return row ?? null
}

function hasCompleteEnvelope(row: BackupDriveOauth): boolean {
  return Boolean(
    row.refreshTokenCiphertext
    && row.refreshTokenNonce
    && row.refreshTokenAuthTag
    && row.refreshTokenVersion
    && row.refreshTokenKeyId,
  )
}

/** Plaintext refresh token, or null when absent or unreadable. */
function decryptStoredToken(row: BackupDriveOauth, secret = process.env.CHATBOT_ENCRYPTION_SECRET): string | null {
  if (!hasCompleteEnvelope(row)) return null
  try {
    return decryptRefreshToken(
      {
        ciphertext: row.refreshTokenCiphertext!,
        nonce:      row.refreshTokenNonce!,
        authTag:    row.refreshTokenAuthTag!,
        version:    row.refreshTokenVersion!,
        keyId:      row.refreshTokenKeyId!,
        lastFour:   '',
      },
      secret,
    )
  } catch {
    return null
  }
}

export type DriveLinkStatus = 'not_linked' | 'linked' | 'secret_unreadable'

function driveLinkStatus(row: BackupDriveOauth | null): DriveLinkStatus {
  if (!row || !hasCompleteEnvelope(row)) return 'not_linked'
  return decryptStoredToken(row) === null ? 'secret_unreadable' : 'linked'
}

export type UsableDriveLink =
  | { ok: true, refreshToken: string }
  | { ok: false, reason: 'not_linked' | 'secret_unreadable' }

/** Everything the backup upload path needs, or a reason it cannot run. */
export async function getUsableDriveLink(): Promise<UsableDriveLink> {
  const row = await getDriveLinkRow()
  if (!row || !hasCompleteEnvelope(row)) return { ok: false, reason: 'not_linked' }
  const refreshToken = decryptStoredToken(row)
  if (refreshToken === null) return { ok: false, reason: 'secret_unreadable' }
  return { ok: true, refreshToken }
}

export type SerializedDriveLink = {
  linked:            boolean
  linkedEmail:       string | null
  linkedSub:         string | null
  linkedAt:          Date | null
  status:            DriveLinkStatus
}

/** The admin projection — explicit field-by-field, no spread of the envelope. */
export function serializeDriveLink(row: BackupDriveOauth | null): SerializedDriveLink {
  return {
    linked:      driveLinkStatus(row) === 'linked',
    linkedEmail: row?.linkedEmail ?? null,
    linkedSub:   row?.linkedSub ?? null,
    linkedAt:    row?.linkedAt ?? null,
    status:      driveLinkStatus(row),
  }
}

export type StoreDriveLinkInput = {
  refreshToken: string
  linkedEmail:  string
  linkedSub:    string
}

/** Upsert the single row + audit in one transaction. */
export async function storeDriveLink(actorId: number, input: StoreDriveLinkInput): Promise<BackupDriveOauth> {
  const envelope = encryptRefreshToken(input.refreshToken)
  const db = getDb()

  await db.transaction(async (tx) => {
    await tx
      .insert(backupDriveOauth)
      .values({
        id: BACKUP_DRIVE_OAUTH_ID,
        refreshTokenCiphertext: envelope.ciphertext,
        refreshTokenNonce:      envelope.nonce,
        refreshTokenAuthTag:    envelope.authTag,
        refreshTokenVersion:    envelope.version,
        refreshTokenKeyId:      envelope.keyId,
        linkedEmail:            input.linkedEmail,
        linkedSub:              input.linkedSub,
        updatedBy:              actorId,
      })
      .onDuplicateKeyUpdate({
        set: {
          refreshTokenCiphertext: envelope.ciphertext,
          refreshTokenNonce:      envelope.nonce,
          refreshTokenAuthTag:    envelope.authTag,
          refreshTokenVersion:    envelope.version,
          refreshTokenKeyId:      envelope.keyId,
          linkedEmail:            input.linkedEmail,
          linkedSub:              input.linkedSub,
          updatedBy:              actorId,
        },
      })
    await tx.insert(activityLogs).values({
      userId:     actorId,
      action:     'update',
      resource:   'backup_drive_oauth',
      resourceId: BACKUP_DRIVE_OAUTH_ID,
      meta:       { linkedEmail: input.linkedEmail, linkedSub: input.linkedSub },
    })
  })

  const row = await getDriveLinkRow()
  if (!row) throw new Error('backup_drive_oauth row unavailable after upsert')
  return row
}

/** Drop the envelope + metadata + audit. Does NOT revoke the token at Google. */
export async function clearDriveLink(actorId: number): Promise<void> {
  const db = getDb()
  await db.transaction(async (tx) => {
    await tx
      .delete(backupDriveOauth)
      .where(eq(backupDriveOauth.id, BACKUP_DRIVE_OAUTH_ID))
    await tx.insert(activityLogs).values({
      userId:     actorId,
      action:     'delete',
      resource:   'backup_drive_oauth',
      resourceId: BACKUP_DRIVE_OAUTH_ID,
      meta:       { cleared: true },
    })
  })
}
