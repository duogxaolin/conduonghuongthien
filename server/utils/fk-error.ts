/**
 * The foreign key an insert broke because the row it references is missing — ER_NO_REFERENCED_ROW_2
 * (1452) on the error or down its `cause` chain: on MySQL, Drizzle throws a DrizzleQueryError
 * ("Failed query: …") whose `cause` is the driver's error. The key is read from the driver's
 * message, verbatim from MySQL 8.0.46 (verify3 replay, database name masked):
 *
 *   Cannot add or update a child row: a foreign key constraint fails (`db`.`article_comments`,
 *   CONSTRAINT `fk_article_comments_parent` FOREIGN KEY (`parent_id`) REFERENCES `article_comments` (`id`) ON DELETE CASCADE)
 *
 * By table and column, not constraint name. Null for any other error, and for a 1452 whose
 * message names no key: a caller answers only the keys whose meaning it knows and rethrows the rest
 * (verifier round 4, L-3 — every 1452 used to read as "the parent is gone").
 */
export type MissingReference = { table: string, column: string, references: string }

const FK_MESSAGE = /constraint fails \(`[^`]*`\.`([^`]+)`, CONSTRAINT `[^`]*` FOREIGN KEY \(`([^`]+)`\) REFERENCES `([^`]+)`/

export function missingReference(error: unknown): MissingReference | null {
  for (let current: unknown = error, depth = 0; current && typeof current === 'object' && depth < 5; depth++) {
    const { code, errno, sqlMessage, message, cause } = current as Record<string, unknown>
    if (code === 'ER_NO_REFERENCED_ROW_2' || errno === 1452) {
      const text = typeof sqlMessage === 'string' ? sqlMessage : typeof message === 'string' ? message : ''
      const key = FK_MESSAGE.exec(text)
      return key ? { table: key[1]!, column: key[2]!, references: key[3]! } : null
    }
    current = cause
  }
  return null
}

/**
 * What a comment insert hung on and found gone — its parent comment, its article or its video —
 * removed between the checks before the transaction and the insert (a ban, purge or account
 * deletion took the parent; the article or video was deleted). Null for anything else, e.g. the
 * author's own reader row or the notification's keys: those are not "the thing replied to".
 */
export function missingCommentTarget(error: unknown): 'parent' | 'article' | 'media' | null {
  const key = missingReference(error)
  if (!key || key.table !== 'article_comments') return null
  if (key.column === 'parent_id' && key.references === 'article_comments') return 'parent'
  if (key.column === 'article_id' && key.references === 'articles') return 'article'
  if (key.column === 'media_item_id' && key.references === 'media_items') return 'media'
  return null
}
