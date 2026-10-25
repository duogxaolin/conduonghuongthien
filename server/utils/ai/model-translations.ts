/**
 * What a model's answer to "translate these UI strings" may put in
 * `lang_translations.value`.
 *
 * Each AI path that stores UI translations used to read the answer its own way, and
 * each let something other than text through: the chunk endpoint and the universal
 * job stored `String(p.value)` — "null", "undefined", "[object Object]" — the bulk
 * endpoint stored whatever the model sent (a number reached the column), and the
 * single-key endpoint stored the answer even when it was the word "null". The public
 * `t()` shows any non-empty value as is, so those words reached readers.
 *
 * Only a non-blank string is a translation. "null"/"undefined" are a model spelling
 * "nothing" (or a stringified missing value), never a UI string — they are dropped,
 * and the row stays untranslated for the next run.
 */

const NOTHING = new Set(['null', 'undefined'])

/** The model's value as text to store, or `null` when it is not a translation. */
export function modelTranslationText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (!text || NOTHING.has(text.toLowerCase())) return null
  return text
}

/** A single answer (no JSON): one pair of wrapping quotes removed, as the prompt asks for bare text. */
export function modelSingleTranslation(answer: string): string | null {
  return modelTranslationText(answer.trim().replace(/^["']|["']$/g, ''))
}

/**
 * The model's JSON array of `{ "key", "value" }` (a ```json fence is tolerated), read
 * against the items that were ASKED for: a key the model invented never becomes a
 * row, and each answer keeps the group it was asked under. Unreadable JSON is no
 * answer at all (`[]`), as before.
 */
export function readModelTranslations(
  answer: string,
  requested: ReadonlyArray<{ group: string; key: string }>,
): Array<{ group: string; key: string; value: string }> {
  let parsed: unknown
  try {
    parsed = JSON.parse(answer.replace(/```json\s*/gi, '').replace(/```\s*$/g, '').trim())
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const out: Array<{ group: string; key: string; value: string }> = []
  const taken = new Set<string>()
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue
    const { key, value } = entry as { key?: unknown; value?: unknown }
    const asked = typeof key === 'string' ? requested.find(item => item.key === key) : undefined
    const text = modelTranslationText(value)
    if (!asked || text === null || taken.has(`${asked.group}::${asked.key}`)) continue
    taken.add(`${asked.group}::${asked.key}`)
    out.push({ group: asked.group, key: asked.key, value: text })
  }
  return out
}
