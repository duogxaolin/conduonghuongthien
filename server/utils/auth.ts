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
}

export function signToken(payload: AdminTokenPayload): string {
  const secret = process.env.JWT_SECRET || 'cdkt_admin_secret_change_me'
  return jwt.sign(payload, secret, { expiresIn: '8h' })
}

export function verifyToken(token: string): AdminTokenPayload | null {
  try {
    const secret = process.env.JWT_SECRET || 'cdkt_admin_secret_change_me'
    return jwt.verify(token, secret) as AdminTokenPayload
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
