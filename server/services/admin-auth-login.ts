/**
 * The account lookup of the admin password login (`POST /api/admin/auth/login`), moved out of the
 * handler verbatim (2026-11-08: no `server/api` file calls getDb() itself). Everything that makes
 * the login safe stays in the handler, in its order: the per-source and per-account rate limits
 * (peeked before, counted on every failure branch, cleared on success), the captcha gate after
 * three failures, the password check, the identical 401 on all three failure branches, the MFA
 * challenge ticket (`cdkt_mfa`, separate from the `cdkt_admin` session) and `completeLogin`.
 *
 * Read-only: one SELECT, keyed on the username exactly as typed (trimmed by the handler).
 */
import { eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { users, roles } from '../db/schema'

/** The account a login names, with its role flags and session generation — or undefined. */
export async function findLoginAccount(username: string) {
  const db = getDb()

  // Tìm user
  const [user] = await db
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
  return user
}
