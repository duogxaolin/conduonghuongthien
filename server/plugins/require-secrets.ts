/**
 * Fail-fast at boot (production only) if critical secrets are missing or are a
 * known committed default. Mirrors the existing chatbot-encryption-secret guard.
 * Prevents shipping with a forgeable JWT secret.
 */
import { passwordRejectionMessage } from '../utils/password-policy'

const KNOWN_WEAK_JWT = new Set([
  'cdkt_admin_secret_change_me',
  'cdkt_docker_jwt_secret_987654321',
  'cdkt_secret_key_change_me_123456',
])

export default defineNitroPlugin(() => {
  if (process.env.NODE_ENV !== 'production') return

  const jwt = (process.env.JWT_SECRET || '').trim()
  if (!jwt) throw new Error('JWT_SECRET is required in production.')
  if (jwt.length < 16) throw new Error('JWT_SECRET must be at least 16 characters.')
  if (KNOWN_WEAK_JWT.has(jwt)) throw new Error('JWT_SECRET must not be a known default value — set a unique secret.')

  // ADMIN_PASSWORD only seeds the first account, but a container restarted with
  // the documented default still hands an attacker the obvious guess.
  const adminPassword = (process.env.ADMIN_PASSWORD || '').trim()
  if (adminPassword) {
    const problem = passwordRejectionMessage(adminPassword, { username: 'admin' })
    if (problem) throw new Error(`ADMIN_PASSWORD does not meet the password policy: ${problem}`)
  }
})
