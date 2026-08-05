/**
 * The single-row Google OAuth configuration, and the only place that decrypts
 * the client secret (design.md D3 / D4, reader-google-login-comments).
 *
 * Three properties this module exists to hold:
 *
 *   1. **The plaintext secret leaves here only through `getUsableOAuthConfig`.**
 *      `serializeGoogleOAuthSettings` builds an explicit projection and has no
 *      access to the plaintext at all, so there is no field an accidental spread
 *      could publish. The admin surface sees `••••1234` and nothing else, ever.
 *   2. **Decryption failure is a distinguishable state, not "not configured".**
 *      Rotating CHATBOT_ENCRYPTION_SECRET makes the stored envelope unreadable.
 *      Reporting that as "no credentials" sends an officer to re-enter a client
 *      secret they already entered, when the real remedy is either restoring the
 *      old key or clearing and re-saving. `secret_unreadable` is carried all the
 *      way to the page so the remedy can be printed next to the symptom.
 *   3. **Validation completes before any write.** A patch carrying a good client
 *      id and a rejected secret must store neither: a half-applied credential
 *      pair is a sign-in flow that fails at Google with a message nobody in this
 *      codebase controls.
 */

import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'

import { getDb } from '../utils/db'
import { activityLogs, googleOauthSettings, type GoogleOauthSettings } from '../db/schema'
import { decryptGoogleOAuthSecret, encryptGoogleOAuthSecret } from '../utils/google-oauth/crypto'
import { resolveRedirectUri, configuredBaseUrl } from '../utils/google-oauth/config'

/** Single-row table, same convention as chatbot_settings. */
export const GOOGLE_OAUTH_SETTINGS_ID = 1

/** Google client ids are long but bounded; the column is VARCHAR(255). */
const CLIENT_ID_MAX = 255

/** Well below any real client secret, and short enough to catch a pasted file. */
const CLIENT_SECRET_MAX = 512

export class GoogleOAuthSettingsValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GoogleOAuthSettingsValidationError'
  }
}

export async function getGoogleOAuthSettings(): Promise<GoogleOauthSettings> {
  const db = getDb()
  const [row] = await db.select().from(googleOauthSettings).where(eq(googleOauthSettings.id, GOOGLE_OAUTH_SETTINGS_ID)).limit(1)
  if (row) return row

  await db.insert(googleOauthSettings).values({ id: GOOGLE_OAUTH_SETTINGS_ID })
  const [created] = await db.select().from(googleOauthSettings).where(eq(googleOauthSettings.id, GOOGLE_OAUTH_SETTINGS_ID)).limit(1)
  if (!created) throw new Error('Google OAuth settings unavailable')
  return created
}

function hasCompleteEnvelope(settings: GoogleOauthSettings): boolean {
  return Boolean(
    settings.clientSecretCiphertext
    && settings.clientSecretNonce
    && settings.clientSecretAuthTag
    && settings.clientSecretVersion
    && settings.clientSecretKeyId,
  )
}

/** Plaintext secret, or null when absent or unreadable. Callers that need to
 *  tell those two apart use `getUsableOAuthConfig`. */
function decryptStoredSecret(settings: GoogleOauthSettings, secret = process.env.CHATBOT_ENCRYPTION_SECRET): string | null {
  if (!hasCompleteEnvelope(settings)) return null
  try {
    return decryptGoogleOAuthSecret({
      ciphertext: settings.clientSecretCiphertext!,
      nonce:      settings.clientSecretNonce!,
      authTag:    settings.clientSecretAuthTag!,
      version:    settings.clientSecretVersion!,
      keyId:      settings.clientSecretKeyId!,
      lastFour:   settings.clientSecretLastFour || '',
    }, secret)
  } catch {
    return null
  }
}

export type ClientSecretStatus = 'not_configured' | 'configured' | 'secret_unreadable'

function clientSecretStatus(settings: GoogleOauthSettings): ClientSecretStatus {
  if (!hasCompleteEnvelope(settings)) return 'not_configured'
  return decryptStoredSecret(settings) === null ? 'secret_unreadable' : 'configured'
}

export type UsableOAuthConfig =
  | { ok: true, clientId: string, clientSecret: string, defaultCommentsEnabled: boolean }
  | { ok: false, reason: 'disabled' | 'not_configured' | 'secret_unreadable' }

/**
 * Everything the sign-in flow needs, or a reason it cannot run — fails closed in
 * every branch. The reasons are kept apart because they have different remedies
 * and the endpoints log which one fired: "switched off" is a decision somebody
 * made, "unreadable" is an encryption key that no longer matches.
 */
export async function getUsableOAuthConfig(): Promise<UsableOAuthConfig> {
  const settings = await getGoogleOAuthSettings()
  if (!settings.isEnabled) return { ok: false, reason: 'disabled' }

  const clientId = (settings.clientId || '').trim()
  if (!clientId || !hasCompleteEnvelope(settings)) return { ok: false, reason: 'not_configured' }

  const clientSecret = decryptStoredSecret(settings)
  if (clientSecret === null) return { ok: false, reason: 'secret_unreadable' }

  return { ok: true, clientId, clientSecret, defaultCommentsEnabled: settings.defaultCommentsEnabled }
}

/** The stored default for a newly created article (design.md D9). Falls back to
 *  closed on any failure — the safe direction, since the opposite opens threads
 *  nobody chose to open. */
export async function defaultCommentsEnabled(): Promise<boolean> {
  try {
    return (await getGoogleOAuthSettings()).defaultCommentsEnabled
  } catch {
    return false
  }
}

export type SerializedGoogleOAuthSettings = {
  clientId:               string
  hasClientSecret:        boolean
  clientSecretMasked:     string | null
  clientSecretStatus:     ClientSecretStatus
  isEnabled:              boolean
  defaultCommentsEnabled: boolean
  redirectUri:            string
  redirectUriSource:      'config' | 'request'
  missing:                string[]
  updatedAt:              Date | null
}

/**
 * The admin projection. Field-by-field on purpose: this object is the boundary
 * between a table holding an encrypted credential and a browser, and a spread
 * would put the ciphertext, the nonce and the auth tag on the wire the first
 * time somebody widened the select.
 *
 * `missing` is what still has to happen before sign-in works, computed here
 * rather than in the page — the page would have to re-derive the same rules and
 * the two copies would disagree the moment one of them changed.
 */
export function serializeGoogleOAuthSettings(settings: GoogleOauthSettings, event: H3Event): SerializedGoogleOAuthSettings {
  const status = clientSecretStatus(settings)
  const clientId = (settings.clientId || '').trim()

  const missing: string[] = []
  if (!clientId) missing.push('clientId')
  if (status === 'not_configured') missing.push('clientSecret')
  if (status === 'secret_unreadable') missing.push('clientSecretUnreadable')
  if (!settings.isEnabled) missing.push('enabled')

  return {
    clientId,
    hasClientSecret:        status === 'configured',
    clientSecretMasked:     status === 'not_configured' ? null : `••••${settings.clientSecretLastFour || ''}`,
    clientSecretStatus:     status,
    isEnabled:              settings.isEnabled,
    defaultCommentsEnabled: settings.defaultCommentsEnabled,
    // Derived, never stored and never accepted from the client — the officer
    // copies this into the Google console rather than typing it into both.
    redirectUri:            resolveRedirectUri(event),
    // Read through the same helper resolveRedirectUri uses. Testing
    // `process.env.PUBLIC_BASE_URL` directly here would report "request" on a
    // deployment that set only NUXT_PUBLIC_BASE_URL — the page would print a
    // warning about a fallback it is not actually using.
    redirectUriSource:      configuredBaseUrl() ? 'config' : 'request',
    missing,
    updatedAt:              settings.updatedAt ?? null,
  }
}

export type GoogleOAuthSettingsUpdate = {
  clientId?:               string
  clientSecret?:           string
  isEnabled?:              boolean
  defaultCommentsEnabled?: boolean
}

/** Every field checked before the first write. See the module header, point 3. */
function validateUpdate(input: GoogleOAuthSettingsUpdate): void {
  if (input.clientId !== undefined) {
    if (typeof input.clientId !== 'string') throw new GoogleOAuthSettingsValidationError('Client ID không hợp lệ.')
    const value = input.clientId.trim()
    if (value.length > CLIENT_ID_MAX) throw new GoogleOAuthSettingsValidationError(`Client ID quá dài (tối đa ${CLIENT_ID_MAX} ký tự).`)
    // Whitespace inside a client id is always a copy-paste artefact, and it
    // produces an `invalid_client` at Google that says nothing about the cause.
    if (value && /\s/.test(value)) throw new GoogleOAuthSettingsValidationError('Client ID không được chứa khoảng trắng.')
  }

  if (input.clientSecret !== undefined) {
    if (typeof input.clientSecret !== 'string') throw new GoogleOAuthSettingsValidationError('Client secret không hợp lệ.')
    const value = input.clientSecret.trim()
    if (!value) throw new GoogleOAuthSettingsValidationError('Client secret không được để trống. Dùng nút xoá nếu muốn gỡ bỏ.')
    if (value.length > CLIENT_SECRET_MAX) throw new GoogleOAuthSettingsValidationError(`Client secret quá dài (tối đa ${CLIENT_SECRET_MAX} ký tự).`)
    if (/\s/.test(value)) throw new GoogleOAuthSettingsValidationError('Client secret không được chứa khoảng trắng.')
  }

  if (input.isEnabled !== undefined && typeof input.isEnabled !== 'boolean') {
    throw new GoogleOAuthSettingsValidationError('Giá trị bật/tắt không hợp lệ.')
  }

  if (input.defaultCommentsEnabled !== undefined && typeof input.defaultCommentsEnabled !== 'boolean') {
    throw new GoogleOAuthSettingsValidationError('Giá trị mặc định bình luận không hợp lệ.')
  }
}

export async function updateGoogleOAuthSettings(actorId: number, input: GoogleOAuthSettingsUpdate, requestId?: unknown): Promise<GoogleOauthSettings> {
  validateUpdate(input)

  const db = getDb()
  const current = await getGoogleOAuthSettings()

  const patch: Record<string, unknown> = {}
  if (input.clientId !== undefined) patch.clientId = input.clientId.trim() || null
  if (input.isEnabled !== undefined) patch.isEnabled = input.isEnabled
  if (input.defaultCommentsEnabled !== undefined) patch.defaultCommentsEnabled = input.defaultCommentsEnabled

  if (input.clientSecret !== undefined) {
    const envelope = encryptGoogleOAuthSecret(input.clientSecret.trim())
    patch.clientSecretCiphertext = envelope.ciphertext
    patch.clientSecretNonce      = envelope.nonce
    patch.clientSecretAuthTag    = envelope.authTag
    patch.clientSecretVersion    = envelope.version
    patch.clientSecretKeyId      = envelope.keyId
    patch.clientSecretLastFour   = envelope.lastFour
  }

  // Turning the switch on with nothing behind it produces a sign-in button that
  // sends every reader to a Google error page. Refused here rather than at the
  // endpoint so the same rule holds for every caller.
  const willHaveClientId = input.clientId !== undefined ? Boolean(input.clientId.trim()) : Boolean((current.clientId || '').trim())
  const willHaveSecret = input.clientSecret !== undefined ? true : hasCompleteEnvelope(current)
  if (patch.isEnabled === true && (!willHaveClientId || !willHaveSecret)) {
    throw new GoogleOAuthSettingsValidationError('Cần lưu đủ Client ID và Client secret trước khi bật đăng nhập Google.')
  }

  if (Object.keys(patch).length === 0) return current

  patch.updatedBy = actorId

  // Config change and audit row in one transaction. "Who turned Google sign-in on,
  // and when" is exactly the question this row has to answer, and a credential
  // change that committed while its log did not would leave nobody able to say
  // when the deployment started accepting readers.
  //
  // Same write path, never a fire-and-forget helper (design.md D14). The field
  // NAMES are recorded; the secret VALUE never is — an audit row that quotes the
  // credential it is auditing defeats the encryption it was stored under.
  await db.transaction(async (tx) => {
    await tx.update(googleOauthSettings).set(patch).where(eq(googleOauthSettings.id, GOOGLE_OAUTH_SETTINGS_ID))
    await tx.insert(activityLogs).values({
      userId:     actorId,
      action:     'update',
      resource:   'google_oauth_settings',
      resourceId: GOOGLE_OAUTH_SETTINGS_ID,
      meta: {
        changedFields:  Object.keys(input),
        secretReplaced: input.clientSecret !== undefined,
        requestId:      requestId ?? null,
      },
    })
  })

  return getGoogleOAuthSettings()
}

/**
 * Drops the envelope, keeps the client id, and forces the master switch off.
 *
 * Leaving the switch on with no secret would leave a sign-in button that always
 * fails; the officer clearing a credential is not thereby asking for that.
 */
export async function clearGoogleOAuthSecret(actorId: number, requestId?: unknown): Promise<GoogleOauthSettings> {
  const db = getDb()
  await getGoogleOAuthSettings()

  await db.transaction(async (tx) => {
    await tx.update(googleOauthSettings).set({
      clientSecretCiphertext: null,
      clientSecretNonce:      null,
      clientSecretAuthTag:    null,
      clientSecretVersion:    null,
      clientSecretKeyId:      null,
      clientSecretLastFour:   null,
      isEnabled:              false,
      updatedBy:              actorId,
    }).where(eq(googleOauthSettings.id, GOOGLE_OAUTH_SETTINGS_ID))

    await tx.insert(activityLogs).values({
      userId:     actorId,
      action:     'update',
      resource:   'google_oauth_settings',
      resourceId: GOOGLE_OAUTH_SETTINGS_ID,
      meta:       { changedFields: ['clientSecret', 'isEnabled'], secretCleared: true, requestId: requestId ?? null },
    })
  })

  return getGoogleOAuthSettings()
}
