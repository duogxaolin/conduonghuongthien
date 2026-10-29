/**
 * Reader IP bans — the database side.
 *
 * Kept out of server/utils/ip-ban.ts on purpose: that module is pure so every
 * validation and matching case can be tested without a MySQL server, and mixing
 * a query into it would take that property away. This module is the only place
 * that reads or writes the table, so the "validate before insert" rule has one
 * home rather than one copy per endpoint.
 */

import { desc, eq } from 'drizzle-orm'

import { getDb } from '../utils/db'
import { activityLogs, readerIpBans, users } from '../db/schema'
import { validateBanValue } from '../utils/ip-ban'
import { readAffectedRows } from '../utils/affected-rows'

/** Every ban value, for the two enforcement points (sign-in start, comment write). */
export async function loadIpBanValues(): Promise<string[]> {
  const rows = await getDb().select({ value: readerIpBans.value }).from(readerIpBans)
  return rows.map(row => row.value)
}

export type IpBanRow = {
  id:        number
  value:     string
  reason:    string | null
  createdAt: Date | null
  createdBy: number | null
  createdByName: string | null
}

/** Newest first — the officer reviewing bans cares about recent decisions (the page
 *  does not re-sort; this used to order by id ascending — FINDING-R6-11). The
 *  leftJoin keeps a row readable after the account that made it is deleted. */
export async function listIpBans(): Promise<IpBanRow[]> {
  return getDb()
    .select({
      id:            readerIpBans.id,
      value:         readerIpBans.value,
      reason:        readerIpBans.reason,
      createdAt:     readerIpBans.createdAt,
      createdBy:     readerIpBans.createdBy,
      createdByName: users.username,
    })
    .from(readerIpBans)
    .leftJoin(users, eq(readerIpBans.createdBy, users.id))
    .orderBy(desc(readerIpBans.id))
}

export type CreateIpBanResult =
  | { ok: true, id: number }
  | { ok: false, statusCode: number, message: string }

export async function createIpBan(params: { value: string, reason: string | null, actorId: number }): Promise<CreateIpBanResult> {
  // Validated before the insert, never after: a stored value that matches nothing
  // is a ban the officer believes is in force (design.md D11).
  const verdict = validateBanValue(params.value)
  if (!verdict.ok) return { ok: false, statusCode: 400, message: verdict.error }

  const db = getDb()

  const [existing] = await db.select({ id: readerIpBans.id }).from(readerIpBans).where(eq(readerIpBans.value, verdict.value)).limit(1)
  if (existing) return { ok: false, statusCode: 409, message: 'Địa chỉ này đã có trong danh sách chặn.' }

  // Ban and audit row commit together. A ban in force that no log accounts for is
  // a restriction nobody can explain or lift with confidence later.
  let id = 0
  const created = await db.transaction(async (tx) => {
    // IGNORE: when another request inserted the same value since the check above, the
    // unique key skips this row — a 409 like the check's, not ER_DUP_ENTRY's 500
    // (FINDING-R6-10 family, verifier M1).
    const inserted = await tx.insert(readerIpBans).ignore().values({
      value:     verdict.value,
      reason:    params.reason?.trim() || null,
      createdBy: params.actorId,
    })
    if (readAffectedRows(inserted) !== 1) return false
    // Array-with-header, not the header itself — see the note in
    // server/api/auth/google/callback.get.ts. Reading it the other way yielded 0,
    // and the audit row below carried `resourceId: 0`: a ban in force whose log
    // entry points at no row, which is the one thing wrapping these two writes in
    // a transaction was meant to prevent.
    const [header] = inserted
    id = Number(header?.insertId ?? 0)

    await tx.insert(activityLogs).values({
      userId:     params.actorId,
      action:     'create',
      resource:   'reader_ip_bans',
      resourceId: id,
      meta:       { value: verdict.value, reason: params.reason?.trim() || null },
    })
    return true
  })
  if (!created) {
    // IGNORE also turns other errors (a foreign key on created_by) into 0 rows: only a row
    // holding this value now makes it a duplicate — anything else is not "already listed".
    const [listed] = await db.select({ id: readerIpBans.id }).from(readerIpBans).where(eq(readerIpBans.value, verdict.value)).limit(1)
    if (!listed) throw new Error('createIpBan: the insert was ignored, and not for a duplicate value')
    return { ok: false, statusCode: 409, message: 'Địa chỉ này đã có trong danh sách chặn.' }
  }

  return { ok: true, id }
}

export type DeleteIpBanResult =
  | { ok: true }
  | { ok: false, statusCode: number, message: string }

export async function deleteIpBan(params: { id: number, actorId: number }): Promise<DeleteIpBanResult> {
  const db = getDb()

  const [row] = await db.select({ id: readerIpBans.id, value: readerIpBans.value }).from(readerIpBans).where(eq(readerIpBans.id, params.id)).limit(1)
  if (!row) return { ok: false, statusCode: 404, message: 'Không tìm thấy mục chặn này.' }

  // One transaction: the value is the only remaining evidence of what was lifted
  // once the row is gone, so losing the log to a failed second statement would
  // leave an address silently un-banned with nothing saying so. The DELETE is counted:
  // when another request lifted the ban since the read above, this one removed nothing
  // and records nothing — the same 404 as a ban that was never there (FINDING-R6-10
  // family, verifier M1: two lifts at once wrote two "delete" rows for one lift).
  const lifted = await db.transaction(async (tx) => {
    const removed = readAffectedRows(await tx.delete(readerIpBans).where(eq(readerIpBans.id, params.id)))
    if (removed === 0) return false
    if (removed !== 1) throw new Error('deleteIpBan: the driver did not report the affected rows')
    await tx.insert(activityLogs).values({
      userId:     params.actorId,
      action:     'delete',
      resource:   'reader_ip_bans',
      resourceId: params.id,
      meta:       { value: row.value },
    })
    return true
  })
  if (!lifted) return { ok: false, statusCode: 404, message: 'Không tìm thấy mục chặn này.' }

  return { ok: true }
}
