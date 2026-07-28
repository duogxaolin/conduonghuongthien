/**
 * Factor state for the profile page.
 *
 * The response is built from an explicit allowlist of fields rather than by
 * spreading the row: a factor row holds ciphertext, a bcrypt hash, and a pending
 * code hash, and none of the three may ever reach a client. Spreading would leak
 * all of them the first time someone adds a column.
 */
import { isConfigured } from '../../../../utils/mailer'
import {
  FACTOR_TYPES,
  countUnusedRecoveryCodes,
  listFactors,
  usableFactorTypes,
  type FactorType,
} from '../../../../utils/mfa/factors'

export default defineEventHandler(async (event) => {
  const admin = event.context.adminUser
  if (!admin) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const rows = await listFactors(admin.id)
  const usable = await usableFactorTypes(admin.id)
  const recoveryCodesRemaining = await countUnusedRecoveryCodes(admin.id)
  const smtpReady = await isConfigured()

  const factors = FACTOR_TYPES.map((factorType: FactorType) => {
    const row = rows.find(r => r.factorType === factorType)
    return {
      factorType,
      state: row?.state ?? 'disabled',
      // False for an active TOTP row whose secret no longer decrypts, which is
      // how a JWT_SECRET rotation becomes visible in the UI.
      usable: usable.includes(factorType),
      enrolledAt: row?.createdAt ?? null,
      lastUsedAt: row?.lastUsedAt ?? null,
    }
  })

  const activeCount = factors.filter(f => f.state === 'active').length
  const emailUsable = usable.includes('email_otp')

  return {
    ok: true,
    email: admin.email ?? null,
    smtpReady,
    factors,
    recoveryCodesEnabled: recoveryCodesRemaining > 0,
    recoveryCodesRemaining,
    /**
     * Drives the lockout warning: a factor is required at login but nothing can
     * get the caller past it if they lose their device.
     */
    lockoutRisk: activeCount > 0 && recoveryCodesRemaining === 0 && !emailUsable,
  }
})
