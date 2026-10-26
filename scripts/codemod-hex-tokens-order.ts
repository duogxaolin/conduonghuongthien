/**
 * Cascade-order protection for `scripts/codemod-hex-tokens.ts` — the one pixel trap a
 * per-class rewrite cannot see.
 *
 * Tailwind v3 sorts its candidate class names in ASCII order before generating rules,
 * and rules of one utility with the same variants keep that order
 * (`expandTailwindAtRules`; ties in `offsets.compare` fall back to it). `[` sorts
 * before every letter, so today an arbitrary `bg-[#…]` sits BEFORE `bg-red-50` in the
 * CSS and loses to it; renamed to `bg-surface` it would sort after and win.
 *
 * So, for every element (a start tag in a `.vue` template) or line (script, `.ts`),
 * colour utilities with the same variants and prefix are compared pairwise: if a
 * rewrite flips the ASCII order of a pair, both members keep their original text. This
 * is conservative (two branches of a ternary never apply together, but are compared
 * anyway) — never the other way round. Classes written ELSEWHERE that meet on one
 * element (a `:class` variable or helper, a module, a component root, a prop) join extra
 * "merge" groups built by scripts/codemod-hex-tokens-reach.ts; see `CascadeMember`.
 *
 * Imports nothing from the codemod: the codemod imports this module, never the reverse.
 */

/** Characters that end a class name in source text (whitespace, quotes, JS/HTML punctuation). */
export const END_CHARS = '\\s\'"`,;(){}<>'
export const IS_END = new RegExp(`[${END_CHARS}]`)

export type Range = readonly [number, number]
export const inRanges = (index: number, ranges: readonly Range[]) => ranges.some(([start, end]) => index >= start && index < end)

/** Start tags (`<div …>`, quotes respected) in a template region of a `.vue` file. */
function startTags(source: string, from: number, to: number): Range[] {
  const tags: Range[] = []
  let i = from
  while (i < to) {
    const lt = source.indexOf('<', i)
    if (lt === -1 || lt >= to) break
    if (source.startsWith('<!--', lt)) {
      const close = source.indexOf('-->', lt + 4)
      i = close === -1 ? to : close + 3
      continue
    }
    if (!/[A-Za-z]/.test(source[lt + 1] ?? '')) { i = lt + 1; continue }
    let j = lt + 1
    let quote = ''
    for (; j < to; j++) {
      const ch = source[j]!
      if (quote) { if (ch === quote) quote = '' }
      else if (ch === '"' || ch === '\'') quote = ch
      else if (ch === '>') break
    }
    tags.push([lt, Math.min(j + 1, to)])
    i = j + 1
  }
  return tags
}

/**
 * Which colour utilities can apply to the same element at once: in a `.vue` template,
 * those inside one start tag; in a script block or a `.ts` file, those on one line.
 */
function scopeResolver(source: string, isSfc: boolean): (index: number) => string {
  const lineStarts = [0]
  for (let i = source.indexOf('\n'); i !== -1; i = source.indexOf('\n', i + 1)) lineStarts.push(i + 1)
  const lineOf = (index: number) => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid]! <= index) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  if (!isSfc) return (index) => `L${lineOf(index)}`

  const blocks: Range[] = []
  const scripts: Range[] = []
  for (const m of source.matchAll(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi)) {
    const range: Range = [m.index, m.index + m[0].length]
    blocks.push(range)
    if (m[1]!.toLowerCase() === 'script') scripts.push(range)
  }
  const tags: Range[] = []
  let cursor = 0
  for (const [start, end] of [...blocks].sort((a, b) => a[0] - b[0])) {
    tags.push(...startTags(source, cursor, start))
    cursor = end
  }
  tags.push(...startTags(source, cursor, source.length))
  return (index) => {
    if (inRanges(index, scripts)) return `L${lineOf(index)}`
    const tag = tags.find(([start, end]) => index >= start && index < end)
    return tag ? `T${tag[0]}` : `X${index}` // text outside any tag: interacts with nothing
  }
}

/** The variants and `!` written before a utility (`hover:!`, `md:`), up to the start of the class. */
export function variantsBefore(source: string, start: number): string {
  let i = start
  while (i > 0 && !IS_END.test(source[i - 1]!)) i--
  return source.slice(i, start)
}

/**
 * `(index, prefix) → group key` for one source: utilities in the same group land in one
 * rule list of the CSS with the same variants, on the same element — their relative
 * order decides which colour wins.
 */
export function cascadeGroups(source: string, isSfc: boolean): (index: number, prefix: string) => string {
  const scopeOf = scopeResolver(source, isSfc)
  return (index, prefix) => `${scopeOf(index)}|${variantsBefore(source, index)}|${prefix}`
}

/**
 * A colour utility: its text now (`before`) and after the planned rewrite (`after`).
 *
 * `group` is the element (or line) it is written on. `extraGroups` are the merge groups of
 * scripts/codemod-hex-tokens-reach.ts — elements it can ALSO land on through a `:class`
 * variable, a helper, a component root or a prop. A `fixed` member lives in another file:
 * this run cannot revert it, and it may still be in either state there (`before`, or `later`
 * once its own file is rewritten), so a pair with it must keep its order in both.
 */
export interface CascadeMember {
  readonly group: string
  readonly extraGroups?: readonly string[]
  readonly before: string
  after: string
  readonly fixed?: boolean
  readonly later?: string
  /** The colour it sets, spelling aside (`#4a5545`, `#4a5545/30`, `red-50`): two members that set the same one never conflict. */
  readonly colour?: string
}

/** Merge-group keys start with this; primary keys (one tag, one line) never do. */
export const MERGE_GROUP = 'M:'

const sign = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const states = (member: CascadeMember) => (member.fixed ? [member.before, member.later ?? member.before] : [member.after])

/**
 * Keeps every pair's ASCII order (= CSS order, = which colour wins) as it is today:
 * when a pair in one group would flip, every member of it that was going to change is
 * reverted (`after = before`) and reported through `onRevert`, once, with the group and the
 * other member of the pair. Primary groups are settled first, so a pair that also shares a
 * tag or line is reported as such. Repeats until no pair flips — reverting only moves back
 * toward the source, so it terminates.
 */
export function keepCascadeOrder<T extends CascadeMember>(
  members: readonly T[],
  onRevert: (member: T, cause: { group: string; partner: T }) => void,
): void {
  const groups = new Map<string, T[]>()
  for (const member of members) {
    for (const key of new Set([member.group, ...(member.extraGroups ?? [])])) groups.set(key, [...(groups.get(key) ?? []), member])
  }
  const flips = (a: T, b: T) => {
    if (a.colour !== undefined && a.colour === b.colour) return false // same declaration whichever wins
    const was = sign(a.before, b.before)
    return states(a).some((x) => states(b).some((y) => sign(x, y) !== was))
  }
  const settle = (lists: Array<[string, T[]]>) => {
    for (let changed = true; changed;) {
      changed = false
      for (const [key, list] of lists) {
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) {
            const a = list[i]!
            const b = list[j]!
            if (!flips(a, b)) continue
            for (const [member, partner] of [[a, b], [b, a]] as const) {
              if (member.fixed || member.after === member.before) continue
              onRevert(member, { group: key, partner })
              member.after = member.before
              changed = true
            }
          }
        }
      }
    }
  }
  const all = [...groups]
  settle(all.filter(([key]) => !key.startsWith(MERGE_GROUP)))
  settle(all)
}
