/**
 * Rewrites Tailwind arbitrary hex colours into the semantic tokens of
 * `shared/color-tokens.ts`, without changing a pixel (wave3-long-term D-TOKENS, task 3.2).
 *
 *   node --experimental-strip-types scripts/codemod-hex-tokens.ts [--write] <dir|file>…
 *
 * Dry run by default: prints, per file, `file: N replacements (value→token ×n, …)` and
 * the `[#hex]` values it left alone (with the reason), then a summary. `--write`
 * writes the files. It runs on plain Node (no ts-resolver), so imports carry `.ts`.
 *
 * What it rewrites: `<prefix>-[#hex]` → `<prefix>-<token>` for every Tailwind v3 colour
 * utility (COLOR_PREFIXES), when the hex is EXACTLY a token value (case-insensitive;
 * a 3-digit hex only when its expansion is exactly a token value). Everything before
 * the prefix (variants such as `hover:`/`md:`/`group-hover/x:`/`[&>svg]:`, and `!`) and
 * after the bracket (`/30`, `/[0.35]`) is kept byte for byte. The output is always a
 * literal class name — never an interpolation — because Tailwind only generates CSS
 * for class names it can read in the source. `:class` objects, arrays and template
 * strings are handled as plain text, like Tailwind's own scanner does.
 *
 * What it leaves alone, and reports:
 *   unmapped          the hex is not a token value — near-duplicates included (`#2c6e34`
 *                     is not `#2c6e33`); merging those is decision D-T1, not this tool's
 *   alpha / invalid   4/8-digit hex (alpha channel), 5/7-digit hex
 *   suffix            anything after `]` other than `/<number>` or `/[<number>]`,
 *                     e.g. a dynamic `/${alpha}` — the rewrite would not be a literal
 *   style             inside a `<style>` block or a `style=` / `:style=` attribute
 *   type-hint         `bg-[color:#…]`: an explicitly typed arbitrary value is never
 *                     touched (0 in app/ when written; not counted by the hex ratchet)
 *   no-colour-prefix  `[#hex]` that is not the value of a colour utility (`xbg-[#…]`)
 *   order             renaming would change which of two colour classes on one element
 *                     wins the cascade — see scripts/codemod-hex-tokens-order.ts
 * A hex that is not in Tailwind arbitrary-value brackets (CSS, chart configs, SVG
 * attributes) is never even looked at.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { COLOR_TOKENS } from '../shared/color-tokens.ts'
import { END_CHARS, IS_END, cascadeGroups, inRanges, keepCascadeOrder, type CascadeMember, type Range } from './codemod-hex-tokens-order.ts'

/** Every Tailwind v3 utility whose arbitrary value can be a colour. */
export const COLOR_PREFIXES: readonly string[] = Object.freeze([
  'bg', 'text',
  'border', 'border-x', 'border-y', 'border-s', 'border-e', 'border-t', 'border-r', 'border-b', 'border-l',
  'ring', 'ring-offset', 'outline', 'divide', 'from', 'via', 'to',
  'fill', 'stroke', 'placeholder', 'caret', 'accent', 'decoration', 'shadow',
])

export type LeaveReason = 'unmapped' | 'alpha' | 'invalid' | 'suffix' | 'style' | 'type-hint' | 'no-colour-prefix' | 'order'
export interface Rewrite { index: number; from: string; to: string; value: string; token: string }
export interface LeftAlone { index: number; text: string; value: string; reason: LeaveReason }
export interface RewriteResult { output: string; rewrites: Rewrite[]; leftAlone: LeftAlone[] }
export interface RewriteOptions { fileName?: string; tokens?: Readonly<Record<string, string>> }

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')
const byLengthDesc = (a: string, b: string) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0)

// Longest first, so `ring-offset` wins over `ring` and `border-x` over `border`.
const PREFIX_ALT = [...COLOR_PREFIXES].sort(byLengthDesc).map(escapeRe).join('|')
/** `bg-[#2c6e33]` + whatever follows up to the end of the class (validated afterwards). */
const HEX_UTILITY = new RegExp(`(?<![\\w-])(${PREFIX_ALT})-\\[#([0-9a-fA-F]{3,8})\\]([^${END_CHARS}]*)`, 'g')
/** `bg-[color:#2c6e33]` — a typed arbitrary value. */
const TYPED_HEX_UTILITY = new RegExp(`(?<![\\w-])(${PREFIX_ALT})-\\[([a-zA-Z][\\w-]*):#([0-9a-fA-F]+)\\]`, 'g')
/** The hex ratchet's metric (design.md D-R): every `[#hex]`. */
const RATCHET_HEX = /\[#[0-9a-fA-F]{3,8}\]/g
const OPACITY_SUFFIX = /^(?:\/(?:\d+(?:\.\d+)?|\[(?:\d*\.)?\d+%?\]))?$/
const OPACITY_SOURCE = '(?:\\/(?:\\d+(?:\\.\\d+)?|\\[[^\\]\\s]+\\]))?'
/** Named colours of Tailwind's default palette, plus arbitrary colours that are not hex. */
const DEFAULT_COLOURS = '(?:inherit|current|transparent|black|white'
  + '|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00|950)'
  + '|\\[(?:rgba?|hsla?)\\([^\\]\\s]*\\)\\]|\\[var\\(--[^\\]\\s]+\\)\\]|\\[color:[^\\]\\s]+\\])'

/** Token table → `#rrggbb` (lowercase) → token. Refuses anything the codemod could not map exactly. */
export function buildHexMap(tokens: Readonly<Record<string, string>>): Map<string, string> {
  const map = new Map<string, string>()
  for (const [token, value] of Object.entries(tokens)) {
    if (!/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error(`token ${token}: ${value} is not a 6-digit hex`)
    const key = value.toLowerCase()
    const other = map.get(key)
    if (other) throw new Error(`tokens ${other} and ${token} share ${key} — the codemod cannot choose a name`)
    map.set(key, token)
  }
  return map
}

interface Prepared { hexMap: Map<string, string>; named: RegExp }
const preparedCache = new WeakMap<object, Prepared>()
function prepare(tokens: Readonly<Record<string, string>>): Prepared {
  let prepared = preparedCache.get(tokens)
  if (!prepared) {
    const hexMap = buildHexMap(tokens)
    const tokenAlt = Object.keys(tokens).sort(byLengthDesc).map(escapeRe).join('|')
    const colour = tokenAlt ? `(?:${tokenAlt}|${DEFAULT_COLOURS})` : DEFAULT_COLOURS
    const named = new RegExp(`(?<![\\w-])(${PREFIX_ALT})-${colour}${OPACITY_SOURCE}(?=[${END_CHARS}]|$)`, 'g')
    prepared = { hexMap, named }
    preparedCache.set(tokens, prepared)
  }
  return prepared
}

/** `<style>` blocks and `style=` / `:style=` / `v-bind:style=` attribute values. */
function styleRanges(source: string): Range[] {
  const ranges: Range[] = []
  for (const m of source.matchAll(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi)) ranges.push([m.index, m.index + m[0].length])
  for (const m of source.matchAll(/(?<![\w-])(?:v-bind)?:?style\s*=\s*(?:"[^"]*"|'[^']*')/g)) ranges.push([m.index, m.index + m[0].length])
  return ranges
}

/** The whole class around `index` (for reporting a `[#hex]` that is not a colour utility). */
function classAround(source: string, index: number): string {
  let start = index
  while (start > 0 && !IS_END.test(source[start - 1]!)) start--
  let end = index
  while (end < source.length && !IS_END.test(source[end]!)) end++
  return source.slice(start, end)
}

function expandHex(hex: string): string {
  const lower = hex.toLowerCase()
  return lower.length === 3 ? [...lower].map((c) => c + c).join('') : lower
}

interface Member extends CascadeMember {
  index: number
  end: number
  rewrite?: Rewrite
}

export function rewriteSource(source: string, options: RewriteOptions = {}): RewriteResult {
  const { hexMap, named } = prepare(options.tokens ?? COLOR_TOKENS)
  const isSfc = options.fileName ? options.fileName.endsWith('.vue') : /<template[\s>]/.test(source)
  const masked = styleRanges(source)
  const groupOf = cascadeGroups(source, isSfc)
  const leftAlone: LeftAlone[] = []
  const members: Member[] = []
  const coveredBrackets = new Set<number>()

  for (const m of source.matchAll(HEX_UTILITY)) {
    const text = m[0]
    const prefix = m[1]!
    const hex = m[2]!
    const tail = m[3] ?? ''
    const index = m.index
    coveredBrackets.add(index + prefix.length + 1)
    const value = `#${hex.toLowerCase()}`
    const leave = (reason: LeaveReason) => leftAlone.push({ index, text, value, reason })
    if (inRanges(index, masked)) { leave('style'); continue }
    const member: Member = { index, end: index + text.length, group: groupOf(index, prefix), before: text, after: text }
    members.push(member)
    if (!OPACITY_SUFFIX.test(tail)) { leave('suffix'); continue }
    if (hex.length === 4 || hex.length === 8) { leave('alpha'); continue }
    if (hex.length !== 3 && hex.length !== 6) { leave('invalid'); continue }
    const normalized = `#${expandHex(hex)}`
    const token = hexMap.get(normalized)
    if (!token) { leave('unmapped'); continue }
    member.after = `${prefix}-${token}${tail}`
    member.rewrite = { index, from: text, to: member.after, value: normalized, token }
  }

  for (const m of source.matchAll(RATCHET_HEX)) {
    if (coveredBrackets.has(m.index)) continue
    leftAlone.push({
      index: m.index,
      text: classAround(source, m.index),
      value: m[0].slice(1, -1).toLowerCase(),
      reason: inRanges(m.index, masked) ? 'style' : 'no-colour-prefix',
    })
  }
  for (const m of source.matchAll(TYPED_HEX_UTILITY)) {
    leftAlone.push({ index: m.index, text: m[0], value: `#${m[3]!.toLowerCase()}`, reason: 'type-hint' })
  }

  // Named colour utilities share the cascade with the hex ones (they never change).
  for (const m of source.matchAll(named)) {
    if (inRanges(m.index, masked)) continue
    members.push({ index: m.index, end: m.index + m[0].length, group: groupOf(m.index, m[1]!), before: m[0], after: m[0] })
  }

  // A rewrite that would change which colour wins on an element is undone (see the order module).
  keepCascadeOrder(members, (member) => {
    leftAlone.push({ index: member.index, text: member.before, value: member.rewrite!.value, reason: 'order' })
    member.rewrite = undefined
  })

  const rewrites = members.flatMap((member) => (member.rewrite ? [member.rewrite] : [])).sort((a, b) => a.index - b.index)
  let output = ''
  let cursor = 0
  for (const rewrite of rewrites) {
    output += source.slice(cursor, rewrite.index) + rewrite.to
    cursor = rewrite.index + rewrite.from.length
  }
  output += source.slice(cursor)
  leftAlone.sort((a, b) => a.index - b.index)
  return { output, rewrites, leftAlone }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function tally<T>(items: readonly T[], key: (item: T) => string): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
}

/** `file: N replacements (#2c6e33→brand-700 ×2, …)` + `  left alone: M (#8ed694 ×1 unmapped, …)`; '' when nothing to say. */
export function formatFileReport(file: string, result: RewriteResult): string {
  const { rewrites, leftAlone } = result
  if (!rewrites.length && !leftAlone.length) return ''
  let head = `${file}: ${plural(rewrites.length, 'replacement')}`
  if (rewrites.length) {
    head += ` (${tally(rewrites, (r) => `${r.value}→${r.token}`).map(([key, n]) => `${key} ×${n}`).join(', ')})`
  }
  if (!leftAlone.length) return head
  const left = tally(leftAlone, (e) => `${e.value}\u0000${e.reason}`)
    .map(([key, n]) => {
      const [value, reason] = key.split('\u0000')
      return `${value} ×${n} ${reason}`
    })
  return `${head}\n  left alone: ${leftAlone.length} (${left.join(', ')})`
}

export function formatSummary(entries: ReadonlyArray<{ file: string; result: RewriteResult }>, options: { write: boolean }): string {
  const rewrites = entries.flatMap((e) => e.result.rewrites)
  const leftAlone = entries.flatMap((e) => e.result.leftAlone)
  const lines = [
    `== hex → token codemod: ${options.write ? 'WRITTEN' : 'DRY RUN — no file written'} ==`,
    `files: ${entries.length} scanned, ${entries.filter((e) => e.result.rewrites.length).length} with replacements`,
    `replacements: ${rewrites.length}`,
    `left alone: ${leftAlone.length}${leftAlone.length ? ` (${tally(leftAlone, (e) => e.reason).map(([reason, n]) => `${reason} ${n}`).join(', ')})` : ''}`,
  ]
  const byDir = new Map<string, { rewrites: number; files: number; left: number }>()
  for (const { file, result } of entries) {
    if (!result.rewrites.length && !result.leftAlone.length) continue
    const dir = path.posix.dirname(file.split(path.sep).join('/'))
    const row = byDir.get(dir) ?? { rewrites: 0, files: 0, left: 0 }
    row.rewrites += result.rewrites.length
    row.files += result.rewrites.length ? 1 : 0
    row.left += result.leftAlone.length
    byDir.set(dir, row)
  }
  if (byDir.size) {
    lines.push('by directory:')
    for (const [dir, row] of [...byDir].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      lines.push(`  ${dir}: ${plural(row.rewrites, 'replacement')} in ${plural(row.files, 'file')} (${row.left} left alone)`)
    }
  }
  const unmapped = tally(leftAlone.filter((e) => e.reason === 'unmapped'), (e) => e.value).slice(0, 20)
  if (unmapped.length) {
    lines.push('top unmapped values:')
    for (const [value, n] of unmapped) lines.push(`  ${value} ${n}`)
  }
  return lines.join('\n')
}

const SOURCE_EXTENSIONS = new Set(['.vue', '.ts', '.js'])
const SKIP_DIRS = new Set(['node_modules', '.nuxt', '.output', '.git', '.data'])

/** `.vue`/`.ts`/`.js` files under each path (a file path is taken as is), sorted. */
export function collectFiles(paths: readonly string[]): string[] {
  const files = new Set<string>()
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) walk(full)
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        files.add(full)
      }
    }
  }
  for (const target of paths) {
    if (statSync(target).isDirectory()) walk(target)
    else files.add(target)
  }
  return [...files].sort()
}

const USAGE = 'usage: node --experimental-strip-types scripts/codemod-hex-tokens.ts [--write] <dir|file>…'

export interface Io { log(line: string): void; error(line: string): void }
const STDIO: Io = { log: (line) => process.stdout.write(`${line}\n`), error: (line) => process.stderr.write(`${line}\n`) }

export function main(argv: readonly string[], io: Io = STDIO): number {
  if (argv.includes('--help') || argv.includes('-h')) { io.log(USAGE); return 0 }
  const unknown = argv.filter((arg) => arg.startsWith('-') && arg !== '--write')
  if (unknown.length) { io.error(`unknown option: ${unknown.join(' ')}`); io.error(USAGE); return 2 }
  const write = argv.includes('--write')
  const targets = argv.filter((arg) => !arg.startsWith('-'))
  if (!targets.length) { io.error(USAGE); return 2 }
  const missing = targets.filter((target) => !existsSync(target))
  if (missing.length) { io.error(`not found: ${missing.join(' ')}`); return 2 }

  const entries: Array<{ file: string; result: RewriteResult }> = []
  for (const file of collectFiles(targets)) {
    const source = readFileSync(file, 'utf8')
    const result = rewriteSource(source, { fileName: file })
    const shown = (path.relative(process.cwd(), file) || file).split(path.sep).join('/')
    entries.push({ file: shown, result })
    const report = formatFileReport(shown, result)
    if (report) io.log(report)
    if (write && result.output !== source) writeFileSync(file, result.output)
  }
  io.log('')
  io.log(formatSummary(entries, { write }))
  return 0
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
