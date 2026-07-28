import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

const ROUNDS = 12

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

/**
 * Which half of the login a token belongs to.
 *
 * 'session' grants admin access. 'mfa-challenge' grants nothing but the right to
 * submit a second factor: it is issued after the password verifies and exchanged
 * for a session only once a factor is satisfied. Both are signed by the same
 * key, so the stage claim — checked explicitly in server/middleware/admin-auth.ts
 * — is what keeps a challenge token from being spent as a session.
 */
export type AdminTokenStage = 'session' | 'mfa-challenge'

export interface AdminTokenPayload {
  userId:   number
  username: string
  roleId:   number
  roleName: string
  /** Session generation; compared against users.token_version on every request. */
  tokenVersion?: number
  /**
   * Absent on tokens minted before this claim existed. Those are sessions by
   * definition (the challenge stage did not exist yet), so absence reads as
   * 'session' and live sessions survive the deploy.
   */
  stage?: AdminTokenStage
}

/** Minutes, not hours: long enough to fetch a code from an app or an inbox. */
export const MFA_CHALLENGE_TTL_SECONDS = 5 * 60

export interface MfaChallengePayload {
  userId:   number
  username: string
  stage:    'mfa-challenge'
  /**
   * Ties the challenge to the account's session generation at password time. If
   * anything revokes sessions mid-challenge, the challenge dies with them.
   */
  tokenVersion: number
}

// Resolve the JWT signing secret. In production a real secret is REQUIRED — there
// is no hardcoded fallback (a known default would let anyone forge an admin token).
// Boot is additionally guarded by server/plugins/require-secrets.ts.
function jwtSecret(): string {
  const secret = (process.env.JWT_SECRET || '').trim()
  if (secret) return secret
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is not configured (required in production).')
  }
  // Development only — never reached in production (guarded above + startup plugin).
  return 'cdkt_dev_only_insecure_jwt_secret_do_not_use_in_prod'
}

export function signToken(payload: AdminTokenPayload): string {
  return jwt.sign({ stage: 'session' as const, ...payload }, jwtSecret(), { expiresIn: '8h' })
}

export function verifyToken(token: string): AdminTokenPayload | null {
  try {
    return jwt.verify(token, jwtSecret()) as AdminTokenPayload
  } catch {
    return null
  }
}

/** True for a session token, including legacy tokens minted without a stage. */
export function isSessionStage(payload: { stage?: string } | null | undefined): boolean {
  return !payload?.stage || payload.stage === 'session'
}

export function signMfaChallenge(payload: Omit<MfaChallengePayload, 'stage'>): string {
  return jwt.sign(
    { ...payload, stage: 'mfa-challenge' as const },
    jwtSecret(),
    { expiresIn: MFA_CHALLENGE_TTL_SECONDS },
  )
}

/**
 * Verify a challenge token. Returns null for anything that is not *explicitly*
 * stage 'mfa-challenge' — a session token must never be accepted here either,
 * or holding a session would let a caller skip a fresh password check.
 */
export function verifyMfaChallenge(token: string): MfaChallengePayload | null {
  try {
    const payload = jwt.verify(token, jwtSecret()) as MfaChallengePayload
    if (payload?.stage !== 'mfa-challenge') return null
    return payload
  } catch {
    return null
  }
}

export function checkPermission(
  // Nullable flags: the permission matrix comes straight out of MySQL, where an
  // unset column reads as null. Every check below is `=== true`, so null is
  // already treated as "not granted".
  permissions: Array<{ resource: string; canCreate: boolean | null; canRead: boolean | null; canUpdate: boolean | null; canDelete: boolean | null }>,
  resource: string,
  action: 'create' | 'read' | 'update' | 'delete',
  isSuperAdmin: boolean = false
): boolean {
  if (isSuperAdmin) return true
  const perm = permissions.find(p => p.resource === resource)
  if (!perm) return false
  const map = { create: perm.canCreate, read: perm.canRead, update: perm.canUpdate, delete: perm.canDelete }
  return map[action] === true
}
