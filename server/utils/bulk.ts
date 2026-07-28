/**
 * Shared plumbing for the admin bulk endpoints.
 *
 * Every bulk route does the same three things: read a list of ids out of the
 * body, run a per-row operation over them, and report which rows went through.
 * The interesting part is what it deliberately does NOT do — see runBulk.
 */
import { createError } from 'h3'

/** A single lot is capped so a caller cannot ask the server to sweep a table. */
export const BULK_MAX_IDS = 200

/**
 * Read `{ ids: [...] }` from a request body.
 *
 * Rejects the whole request rather than silently skipping bad entries: a client
 * that sent `["3", null, 4]` has a bug, and quietly deleting row 4 while
 * dropping the rest would hide it. Duplicates are collapsed instead — the same
 * row selected twice is a UI artefact, not a mistake worth failing on.
 */
export function parseBulkIds(body: unknown): number[] {
  const raw = (body as { ids?: unknown } | null | undefined)?.ids
  if (!Array.isArray(raw) || raw.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Chưa chọn mục nào.' })
  }
  if (raw.length > BULK_MAX_IDS) {
    throw createError({ statusCode: 400, statusMessage: `Chỉ xử lý tối đa ${BULK_MAX_IDS} mục mỗi lần.` })
  }

  const ids: number[] = []
  const seen = new Set<number>()
  for (const value of raw) {
    if (!Number.isSafeInteger(value) || Number(value) <= 0) {
      throw createError({ statusCode: 400, statusMessage: 'Danh sách mục cần xử lý không hợp lệ.' })
    }
    const id = Number(value)
    if (!seen.has(id)) { seen.add(id); ids.push(id) }
  }
  return ids
}

export type BulkFailure = { id: number; message: string }

export type BulkOutcome = {
  ok: true
  requested: number
  succeeded: number
  /** Ids that went through, so the client can drop exactly those from its selection. */
  succeededIds: number[]
  failed: BulkFailure[]
}

/** The message an operator should see. Anything unexpected stays generic. */
function failureMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null) {
    const statusMessage = (error as { statusMessage?: unknown }).statusMessage
    if (typeof statusMessage === 'string' && statusMessage) return statusMessage
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return fallback
}

/**
 * Apply `operation` to each id and collect the outcome.
 *
 * Two decisions worth stating:
 *
 * PARTIAL SUCCESS. One blocked row does not cancel the lot. Guards here are
 * per-row facts ("this category still holds 3 articles"), so selecting twenty
 * categories where one is blocked should remove nineteen and explain the
 * twentieth. Aborting the whole batch would make bulk deletion useless on real
 * data, where one blocked row is the norm.
 *
 * SEQUENTIAL. Not Promise.all: media deletion does network I/O against R2, and
 * the relational guards count rows that earlier iterations may have removed.
 * Concurrency would make both racy for no useful gain at these sizes.
 */
export async function runBulk(
  ids: number[],
  operation: (id: number) => Promise<void>,
  fallbackMessage = 'Không thể xử lý mục này.',
): Promise<BulkOutcome> {
  const succeededIds: number[] = []
  const failed: BulkFailure[] = []

  for (const id of ids) {
    try {
      await operation(id)
      succeededIds.push(id)
    } catch (error) {
      failed.push({ id, message: failureMessage(error, fallbackMessage) })
    }
  }

  return { ok: true, requested: ids.length, succeeded: succeededIds.length, succeededIds, failed }
}
