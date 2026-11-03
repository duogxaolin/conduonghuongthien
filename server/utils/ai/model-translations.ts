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
 * The model's JSON array of `{ "i", "key", "value" }` (a ```json fence is tolerated),
 * read against the items that were ASKED for — `requested[n - 1]` is prompt line `[n]`.
 * A key the model invented never becomes a row, and each answer lands on ONE asked
 * item, which it then claims:
 *   1. the line number it echoes (`i`, a number or a numeric string), when that line
 *      asked for this key;
 *   2. else the group it echoes, if any: the first unclaimed item with that group+key;
 *   3. else the first unclaimed item with that key — answers taken in the order asked.
 * The same key exists in several groups (`retry`, …): matching on the key alone used
 * to drop the second answer and could file a reordered one under the wrong group. An
 * answer without usable text still claims its item (so the next answer is for the next
 * one) but stores nothing. Unreadable JSON is no answer at all (`[]`).
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
  const claimed = new Set<number>()
  const free = (at: number) => at >= 0 && !claimed.has(at)
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue
    const { i, group, key, value } = entry as { i?: unknown; group?: unknown; key?: unknown; value?: unknown }
    if (typeof key !== 'string') continue
    const line = typeof i === 'number' ? i : typeof i === 'string' && /^\d+$/.test(i) ? Number(i) : NaN
    let at = Number.isInteger(line) && requested[line - 1]?.key === key && free(line - 1) ? line - 1 : -1
    if (at < 0 && typeof group === 'string') at = requested.findIndex((item, n) => free(n) && item.key === key && item.group === group)
    if (at < 0) at = requested.findIndex((item, n) => free(n) && item.key === key)
    if (at < 0) continue
    claimed.add(at)
    const text = modelTranslationText(value)
    if (text !== null) out.push({ group: requested[at]!.group, key: requested[at]!.key, value: text })
  }
  return out
}

/** The element every UI-translation prompt asks for; each prompt says `n` is the line's `[n]`. */
export const MODEL_TRANSLATION_ANSWER_FORMAT = '{"i": n, "key": "...", "value": "..."}'
