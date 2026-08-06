/**
 * How a reader's name is decided, and what a reader is allowed to be called.
 *
 * A LEAF module on purpose: services/readers.ts already imports
 * services/comments.ts, so the name logic cannot live in either of them without
 * the two importing each other. Both need it — the public comment thread renders
 * reader names, the moderation list renders the same names, and the profile page
 * writes them.
 *
 * The reason this is one module rather than a few lines at each call site: there
 * are TWO columns that can carry a reader's name and neither means anything
 * alone. `display_name` is refreshed from Google on every sign-in by the OAuth
 * callback — deliberately, so a reader who renames themselves at Google stops
 * appearing under the old name — and `custom_display_name` holds a name the
 * reader typed on the portal, which is exactly why it cannot live in the column
 * Google overwrites. Resolve that precedence per call site and the header, the
 * public thread and the moderation list will eventually disagree about what
 * somebody is called; the disagreement then surfaces only on a page showing two
 * of them at once, which is the page a moderator is on when they are trying to
 * find the person who wrote something.
 */

export const DISPLAY_NAME_MIN_LENGTH = 2
export const DISPLAY_NAME_MAX_LENGTH = 60

/** Shown when a reader has neither a chosen name nor a Google one. */
export const DISPLAY_NAME_FALLBACK = 'Người dùng'

/**
 * The name to show for a reader, from the two columns that can carry one.
 *
 * Never returns an empty string: a blank author on a public comment reads as a
 * rendering fault rather than as a missing name.
 */
export function effectiveDisplayName(row: {
  customDisplayName?: string | null
  displayName?:       string | null
}): string {
  return row.customDisplayName?.trim() || row.displayName?.trim() || DISPLAY_NAME_FALLBACK
}

export type DisplayNameValidation =
  | { ok: true, name: string }
  | { ok: false, message: string }

/**
 * A display name is ONE line of plain text.
 *
 * Unlike a comment body (services/comments.ts), newlines are not normalised —
 * they are refused along with every other control character. A comment is a
 * paragraph and its line breaks are the author's; a name that contains a newline
 * renders as a name that has broken the layout of every list it appears in, and
 * "helpfully" folding it to a space would mean storing something other than what
 * was typed.
 *
 * Too long is REFUSED with the limit stated, never silently truncated: someone
 * whose name got cut has no way to find out that it did.
 */
export function validateDisplayName(raw: unknown): DisplayNameValidation {
  if (typeof raw !== 'string') return { ok: false, message: 'Tên hiển thị không hợp lệ.' }

  // Collapse runs of spaces so "Nguyễn   Văn A" and "Nguyễn Văn A" cannot be two
  // visually identical names in the same thread.
  //
  // Spaces ONLY — a tab is not folded in here. Folding it would convert a control
  // character into a space and store something other than what was typed, which
  // is the same objection that makes the check below reject newlines instead of
  // normalising them. `trim()` still removes tabs at the edges; that is trimming
  // whitespace, not rewriting the name.
  const normalized = raw.replace(/ +/g, ' ').trim()

  if (!normalized) return { ok: false, message: 'Vui lòng nhập tên hiển thị.' }

  if (/[\u0000-\u001F\u007F]/.test(normalized)) {
    return { ok: false, message: 'Tên hiển thị chứa ký tự không được phép.' }
  }

  if (normalized.length < DISPLAY_NAME_MIN_LENGTH) {
    return { ok: false, message: `Tên hiển thị quá ngắn (tối thiểu ${DISPLAY_NAME_MIN_LENGTH} ký tự).` }
  }

  if (normalized.length > DISPLAY_NAME_MAX_LENGTH) {
    return { ok: false, message: `Tên hiển thị quá dài (tối đa ${DISPLAY_NAME_MAX_LENGTH} ký tự).` }
  }

  return { ok: true, name: normalized }
}

/** Initials for the locally drawn avatar (design.md D7 — no Google image request
 *  ever leaves a visitor's browser, so there is no photo to fall back on). */
export function initialsFrom(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0]!.slice(0, 1).toUpperCase()
  return (words[0]!.slice(0, 1) + words[words.length - 1]!.slice(0, 1)).toUpperCase()
}
