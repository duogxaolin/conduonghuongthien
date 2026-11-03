/**
 * The "Dịch AI còn thiếu" scan of the languages page (`pages/admin/languages/index.vue`).
 *
 * A key is missing in a language when its row there has no text, OR when the language
 * has no row for it at all — a vi key added after the language was created and before
 * "Đồng bộ key" ran. The scan used to look at the language's own rows only (and only
 * the first 500 of them), so it could report "đã có bản dịch đầy đủ 100%" while the
 * coverage card still counted missing keys.
 */

type Row = { group: string; key: string; value: string | null }
export type MissingTranslation = { group: string; key: string; sourceText: string }

/** How the page keys a translation across languages. */
export const translationKey = (group: string, key: string) => `${group}::${key}`

/**
 * The keys of one language to translate, each with its Vietnamese text as the source
 * (the key itself when vi has none): blank rows in the language's order, then the vi
 * keys the language has no row for, in vi order. `viSource` maps `group::key` → text
 * for EVERY vi key.
 */
export function missingTranslations(rows: readonly Row[], viSource: ReadonlyMap<string, string>): MissingTranslation[] {
  const present = new Set<string>()
  const missing: MissingTranslation[] = []
  const add = (group: string, key: string) => missing.push({ group, key, sourceText: viSource.get(translationKey(group, key)) || key })
  for (const row of rows) {
    present.add(translationKey(row.group, row.key))
    if (!row.value || !row.value.trim()) add(row.group, row.key)
  }
  for (const id of viSource.keys()) {
    if (present.has(id)) continue
    const at = id.indexOf('::')
    add(id.slice(0, at), id.slice(at + 2))
  }
  return missing
}
