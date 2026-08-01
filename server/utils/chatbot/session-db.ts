import { getPool } from '../db'
import { logWarn } from '../logger'
import { detectName, detectPhone } from './contact-detect'

/**
 * Persists visitor chat turns.
 *
 * Every function here swallows its own failures. A chat reply that already
 * exists in memory must not be withheld because the transcript could not be
 * written — the visitor asked a question, not for an audit trail. Failures are
 * logged so a broken write is visible in the log stream instead of silent.
 *
 * The one thing these writes are strict about: the caller must hand over a
 * session id that has already passed HMAC verification. Nothing here validates
 * that, because the endpoint does it before calling.
 */

const MAX_CONTENT_CHARS = 8_000
const MAX_USER_AGENT_CHARS = 512

type PersistArgs = {
  sessionId: string
  ip: string | null
  userAgent: string | null
  userText: string
  botText: string
  kind: string | null
}

/**
 * Writes one turn: upserts the session row, appends both messages, and records
 * any contact details found in the visitor's text.
 *
 * Sequenced deliberately — the session row must exist before `chat_messages`
 * rows can satisfy the foreign key, so this is not parallelisable.
 */
export async function persistChatTurn(args: PersistArgs): Promise<void> {
  const pool = getPool()
  if (!pool) return

  const userText = args.userText.slice(0, MAX_CONTENT_CHARS)
  const botText = args.botText.slice(0, MAX_CONTENT_CHARS)

  try {
    // `started_at` is written only on insert: ON DUPLICATE KEY leaves it alone so
    // the column keeps meaning "when this visitor first spoke", which is what the
    // admin list sorts and filters on.
    await pool.query(
      `INSERT INTO \`chat_sessions\`
         (\`id\`, \`ip\`, \`user_agent\`, \`message_count\`, \`started_at\`, \`last_message_at\`)
       VALUES (?, ?, ?, 1, UTC_TIMESTAMP(), UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE
         \`message_count\` = \`message_count\` + 1,
         \`last_message_at\` = UTC_TIMESTAMP(),
         \`ip\` = VALUES(\`ip\`),
         \`user_agent\` = VALUES(\`user_agent\`)`,
      [args.sessionId, args.ip, args.userAgent?.slice(0, MAX_USER_AGENT_CHARS) ?? null],
    )

    await pool.query(
      `INSERT INTO \`chat_messages\` (\`session_id\`, \`role\`, \`content\`, \`kind\`, \`created_at\`)
       VALUES (?, 'user', ?, NULL, UTC_TIMESTAMP()), (?, 'assistant', ?, ?, UTC_TIMESTAMP())`,
      [args.sessionId, userText, args.sessionId, botText, args.kind],
    )

    const phone = detectPhone(userText)
    const name = detectName(userText)
    if (phone || name) {
      // COALESCE keeps an earlier detection when the current turn has only one of
      // the two: a visitor who gave a name in turn 2 and a phone in turn 5 should
      // end up with both, not with whichever came last.
      await pool.query(
        `UPDATE \`chat_sessions\`
            SET \`detected_phone\` = COALESCE(?, \`detected_phone\`),
                \`detected_name\`  = COALESCE(?, \`detected_name\`)
          WHERE \`id\` = ?`,
        [phone, name, args.sessionId],
      )
    }
  } catch (error) {
    logWarn({
      event: 'chat_session.persist_failed',
      sessionId: args.sessionId,
      reason: error instanceof Error ? error.message : 'unknown',
    })
  }
}
