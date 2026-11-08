/**
 * The admin reads of citizen submissions (`GET /api/admin/submissions`, `GET
 * /api/admin/submissions/:id`) — moved out of the handlers verbatim (2026-11-08: no `server/api`
 * file calls getDb() itself). The handlers keep the permission (the list's
 * `requireResourcePermission`; the detail's inside `recordSubmissionView`), rejecting unknown
 * filter values, the 404, and the calls to `submission-workflow.ts` (`countSubmissionsByStatus`,
 * `recordSubmissionView`, `listSubmissionEvents`) — whose transition rules are untouched.
 */
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { submissions, users } from '../db/schema'
import type { SubmissionStatus } from '../../shared/submission-status'

/** Every submission (newest first) matching the two server-side filters, already validated. */
export async function listAdminSubmissions(statusFilter: SubmissionStatus | null, viewedFilter: string) {
  const conditions = []
  if (statusFilter) conditions.push(eq(submissions.status, statusFilter))
  if (viewedFilter === 'yes') conditions.push(isNotNull(submissions.firstViewedAt))
  if (viewedFilter === 'no') conditions.push(isNull(submissions.firstViewedAt))

  const db = getDb()
  const rows = await db
    .select({
      id: submissions.id,
      fullName: submissions.fullName,
      phone: submissions.phone,
      email: submissions.email,
      address: submissions.address,
      message: submissions.message,
      answers: submissions.answers,
      formTitle: submissions.formTitle,
      status: submissions.status,
      statusChangedAt: submissions.statusChangedAt,
      // leftJoin để đơn do một tài khoản ĐÃ XOÁ đổi trạng thái vẫn đọc được — mất
      // tên người thực hiện thì cột đó còn lại một khoảng trống không giải thích.
      statusChangedByName: users.username,
      firstViewedAt: submissions.firstViewedAt,
      notifiedAt: submissions.notifiedAt,
      createdAt: submissions.createdAt,
    })
    .from(submissions)
    .leftJoin(users, eq(users.id, submissions.statusChangedBy))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(submissions.createdAt))
  return rows
}

/** One submission with the name of whoever last changed its status, if it exists. */
export async function findAdminSubmissionDetail(id: number) {
  const db = getDb()
  const [row] = await db
    .select({
      id: submissions.id,
      fullName: submissions.fullName,
      phone: submissions.phone,
      email: submissions.email,
      address: submissions.address,
      message: submissions.message,
      answers: submissions.answers,
      formTitle: submissions.formTitle,
      status: submissions.status,
      statusChangedAt: submissions.statusChangedAt,
      // leftJoin để đơn do một tài khoản ĐÃ XOÁ đổi trạng thái vẫn đọc được —
      // mất tên người thực hiện thì dòng thời gian còn lại một khoảng trống.
      statusChangedByName: users.username,
      firstViewedAt: submissions.firstViewedAt,
      notifiedAt: submissions.notifiedAt,
      createdAt: submissions.createdAt,
    })
    .from(submissions)
    .leftJoin(users, eq(users.id, submissions.statusChangedBy))
    .where(eq(submissions.id, id))
    .limit(1)
  return row
}
