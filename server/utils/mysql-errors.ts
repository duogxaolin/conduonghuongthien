/**
 * Which MySQL error a failed query was — on the error itself or anywhere down its `cause` chain.
 *
 * Drizzle (0.45) wraps every driver error in a `DrizzleQueryError` ("Failed query: <SQL>
 * params: …") and keeps the mysql2 error, with its `code` and `errno`, on `cause`. A check that
 * reads only the top-level `code` never matches a Drizzle-wrapped error: the "duplicate question"
 * branch of the small-talk service was dead that way (FINDING-R7-6). One walker for every such
 * check, so a second copy cannot read one level less.
 *
 * Depth 5: Drizzle adds one level, a caller's own wrapper (a retry, a service error) at most one
 * or two more. A loop over a self-referencing `cause` stops there too.
 */
export function hasMysqlError(error: unknown, errno: number, code: string): boolean {
  for (let current: unknown = error, depth = 0; current && typeof current === 'object' && depth < 5; depth++) {
    const fields = current as { code?: unknown, errno?: unknown, cause?: unknown }
    if (fields.code === code || fields.errno === errno) return true
    current = fields.cause
  }
  return false
}

/** ER_DUP_ENTRY (1062): an insert or update hit a unique key. */
export function isDuplicateEntry(error: unknown): boolean {
  return hasMysqlError(error, 1062, 'ER_DUP_ENTRY')
}
