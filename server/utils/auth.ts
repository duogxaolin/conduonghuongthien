import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

const ROUNDS = 12

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

export interface AdminTokenPayload {
  userId:   number
  username: string
  roleId:   number
  roleName: string
  /** Session generation; compared against users.token_version on every request. */
  tokenVersion?: number
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
  return jwt.sign(payload, jwtSecret(), { expiresIn: '8h' })
}

export function verifyToken(token: string): AdminTokenPayload | null {
  try {
    return jwt.verify(token, jwtSecret()) as AdminTokenPayload
  } catch {
    return null
  }
}

export function checkPermission(
  permissions: Array<{ resource: string; canCreate: boolean; canRead: boolean; canUpdate: boolean; canDelete: boolean }>,
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
