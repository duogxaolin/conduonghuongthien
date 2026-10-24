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
 * Shown instead of a Google name that folds to a reserved term ("Admin", "Ban
 * quản trị", "C11"…) until the reader chooses a name of their own (spec
 * reader-display-names-google, decision D-NAMES). Sign-in still succeeds:
 * refusing it would lock out a real person whose Google profile happens to say
 * "Admin".
 */
export const RESERVED_PROVIDER_NAME_FALLBACK = 'Bạn đọc'

/**
 * The name to show for a reader, from the columns that can carry one.
 *
 * `displayNameReserved` is a REQUIRED key on purpose: it is set by the OAuth
 * callback when the Google name is reserved, and a call site that forgot to
 * select it would print "Admin" on a public thread. Pass `null`/`undefined`
 * explicitly only where the row cannot have a Google name.
 *
 * Never returns an empty string: a blank author on a public comment reads as a
 * rendering fault rather than as a missing name.
 */
export function effectiveDisplayName(row: {
  customDisplayName?: string | null
  displayName?:       string | null
  displayNameReserved: boolean | null | undefined
}): string {
  const custom = row.customDisplayName?.trim()
  if (custom) return custom
  const provider = row.displayName?.trim()
  if (provider && row.displayNameReserved === true) return RESERVED_PROVIDER_NAME_FALLBACK
  return provider || DISPLAY_NAME_FALLBACK
}

export type DisplayNameValidation =
  | { ok: true, name: string }
  | { ok: false, message: string }

/**
 * Staff and authority names a reader may not choose (spec reader-display-names).
 *
 * A reader's name renders next to the portal's own replies. "Ban quản trị" posting
 * in a thread reads as the official answer the citizen was waiting for, and the
 * reply e-mail used to carry that name in its subject line.
 *
 * Written in FOLDED form (see `foldDisplayName`). Deliberately short: every entry
 * is a name somebody could plausibly use to pose as the portal, not a word list.
 * "công an" alone is NOT here — "Công" and "An" are ordinary Vietnamese names, so
 * "Nguyễn Công An" is a person, while "Bộ Công an" is the ministry.
 */
export const RESERVED_DISPLAY_NAMES: readonly string[] = Object.freeze([
  'ban quan tri',
  'quan tri vien',
  'ban bien tap',
  'admin',
  'administrator',
  'moderator',
  'c11',
  'bo cong an',
  'con duong huong thien',
])

/** Unicode "format" characters: zero-width (U+200B–U+200D, U+FEFF), bidi
 *  controls (U+200E/F, U+202A–U+202E, U+2066–U+2069), soft hyphen, … They
 *  render as nothing, so a name containing one looks like a different name. */
const FORMAT_CHARACTER = /\p{Cf}/u

/**
 * The form a name is compared in: what a reader SEES, with every way of writing
 * the same visible name collapsed onto one string.
 *
 *  1. NFKC — full-width `Ａｄｍｉｎ` and other compatibility forms become ASCII.
 *  2. NFD, then drop combining marks (`\p{Mn}`) — Vietnamese diacritics go.
 *  3. `đ`/`Đ` → `d`: they are letters of their own, NFD does not decompose them.
 *  4. Lower case.
 *  5. Every run of anything that is not a letter or a digit → one space, so
 *     `Ban-Quản_Trị` and `Ban quản trị` fold to the same thing. Digits are kept:
 *     collapsing them too would fold "C11" to "c".
 */
export function foldDisplayName(value: string): string {
  return value
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/[\p{Mn}\p{Cf}]/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * Does the folded name pose as a reserved one? Equal to it, or starting or ending
 * with it as a separate word ("Admin Hùng", "Hỗ trợ Bộ Công an"). Also equal once
 * the spaces are gone too, so `A.D.M.I.N` and `C-11` do not slip through as
 * "a d m i n" / "c 11". A reserved word INSIDE another word ("Adminh") is not a
 * match — that is somebody's name.
 *
 * Exported for the Google sign-in (spec reader-display-names-google): the SAME
 * folding decides whether a provider-supplied name is shown.
 */
export function isReservedDisplayName(name: string): boolean {
  const folded = foldDisplayName(name)
  const compact = folded.replace(/ /g, '')
  return RESERVED_DISPLAY_NAMES.some(term => folded === term
    || folded.startsWith(`${term} `)
    || folded.endsWith(` ${term}`)
    || compact === term.replace(/ /g, ''))
}

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

  // On the RAW input, before `trim()`: trim removes U+FEFF at the edges, which
  // would hide exactly the character this rule exists to catch.
  if (FORMAT_CHARACTER.test(raw)) {
    return { ok: false, message: 'Tên hiển thị chứa ký tự ẩn (ký tự rộng 0 hoặc ký tự điều khiển hướng chữ) không được phép.' }
  }

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

  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (/[\u0000-\u001F\u007F]/.test(normalized)) {
    return { ok: false, message: 'Tên hiển thị chứa ký tự không được phép.' }
  }

  if (normalized.length < DISPLAY_NAME_MIN_LENGTH) {
    return { ok: false, message: `Tên hiển thị quá ngắn (tối thiểu ${DISPLAY_NAME_MIN_LENGTH} ký tự).` }
  }

  if (normalized.length > DISPLAY_NAME_MAX_LENGTH) {
    return { ok: false, message: `Tên hiển thị quá dài (tối đa ${DISPLAY_NAME_MAX_LENGTH} ký tự).` }
  }

  if (isReservedDisplayName(normalized)) {
    return {
      ok: false,
      message: 'Tên hiển thị này dành riêng cho cán bộ và cơ quan quản lý cổng (ví dụ "Ban quản trị", "Admin", "C11", "Bộ Công an"). Vui lòng chọn tên khác.',
    }
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
