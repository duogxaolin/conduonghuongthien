/**
 * Session and challenge cookie issuance, shared by the login endpoint and the
 * second-factor verification endpoint so the two cannot drift apart in cookie
 * flags or in what a successful login records.
 */
import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { users, roles, permissions, activityLogs } from '../../db/schema'
import { signToken, signMfaChallenge, MFA_CHALLENGE_TTL_SECONDS } from '../auth'

export const SESSION_COOKIE = 'cdkt_admin'
/** Deliberately a different name from the session cookie: every existing
 *  /api/admin/** route reads only cdkt_admin, so a challenge is invisible to
 *  them by default rather than by remembering to check. */
export const CHALLENGE_COOKIE = 'cdkt_mfa'

const SESSION_MAX_AGE = 8 * 60 * 60

export function requestIsHttps(event: H3Event): boolean {
  return getRequestHeader(event, 'x-forwarded-proto') === 'https'
    || getRequestURL(event).protocol === 'https:'
}

export interface SessionUser {
  id: number
  username: string
  email: string | null
  roleId: number | null
  roleName: string | null
  isSystem: boolean | null
  tokenVersion: number | null
}

export function setSessionCookie(event: H3Event, user: SessionUser): string {
  const token = signToken({
    userId:   user.id,
    username: user.username,
    roleId:   user.roleId!,
    roleName: user.roleName!,
    tokenVersion: user.tokenVersion ?? 0,
  })
  setCookie(event, SESSION_COOKIE, token, {
    httpOnly: true,
    secure:   requestIsHttps(event),
    sameSite: 'lax',
    maxAge:   SESSION_MAX_AGE,
    path:     '/',
  })
  return token
}

export function setChallengeCookie(event: H3Event, user: SessionUser): void {
  const token = signMfaChallenge({
    userId:   user.id,
    username: user.username,
    tokenVersion: user.tokenVersion ?? 0,
  })
  setCookie(event, CHALLENGE_COOKIE, token, {
    httpOnly: true,
    secure:   requestIsHttps(event),
    sameSite: 'lax',
    maxAge:   MFA_CHALLENGE_TTL_SECONDS,
    path:     '/',
  })
}

export function clearChallengeCookie(event: H3Event): void {
  deleteCookie(event, CHALLENGE_COOKIE, { path: '/' })
}

/**
 * Everything a successful login records, regardless of which half of the flow
 * completed it: permissions loaded, last_login_at stamped, activity row written,
 * session cookie set.
 */
export async function completeLogin(
  event: H3Event,
  user: SessionUser,
  meta: { ip: string; method?: string },
) {
  const db = getDb()

  const userPermissions = user.roleId
    ? await db.select().from(permissions).where(eq(permissions.roleId, user.roleId))
    : []

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id))

  await db.insert(activityLogs).values({
    userId:   user.id,
    action:   'login',
    resource: 'auth',
    meta: {
      ip: meta.ip,
      userAgent: getRequestHeader(event, 'user-agent') || '',
      ...(meta.method ? { mfaMethod: meta.method } : {}),
    },
  })

  setSessionCookie(event, user)

  return {
    ok: true as const,
    user: {
      id:           user.id,
      username:     user.username,
      email:        user.email,
      roleName:     user.roleName,
      isSuperAdmin: user.isSystem === true,
      permissions:  userPermissions,
    },
  }
}

/** Loads the account a login or challenge refers to, with its role flags. */
export async function loadSessionUser(username: string) {
  const db = getDb()
  const [row] = await db
    .select({
      id:           users.id,
      username:     users.username,
      email:        users.email,
      passwordHash: users.passwordHash,
      isActive:     users.isActive,
      roleId:       users.roleId,
      roleName:     roles.name,
      isSystem:     roles.isSystem,
      tokenVersion: users.tokenVersion,
    })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.username, username))
    .limit(1)
  return row ?? null
}
