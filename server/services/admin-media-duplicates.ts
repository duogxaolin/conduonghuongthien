/**
 * The duplicate report of `GET /api/admin/media/duplicates`, run on the shared handle and pool —
 * moved out of the handler verbatim (`getPool()` first, then `getDb()`, as before). The handler
 * keeps the permission check, the 503 when there is no pool and the 409 a busy report
 * (`DuplicateReportBusyError`, one report at a time) maps to.
 *
 * Its own file because it imports `getPool`: a test that fakes the database layer with `getDb`
 * alone must still load the other admin media services.
 */
import { getDb, getPool } from '../utils/db'
import { runMediaDuplicateReport } from './media-duplicates'

/**
 * The report, or `null` when there is no pool (the database is not up) — in that case nothing is
 * read. Throws `DuplicateReportBusyError` while another report holds its lock.
 */
export async function runSharedMediaDuplicateReport() {
  const pool = getPool()
  if (!pool) return null
  const report = await runMediaDuplicateReport(getDb(), pool)
  return report
}
