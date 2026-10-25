import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * Per-file ratchets (wave3-long-term, design D-R).
 *
 * A ratchet compares one number per file with a checked-in baseline
 * (`tests/ratchets/<name>.baseline.json`) and fails only when a file gets WORSE:
 *   - a file in the baseline is above its entry;
 *   - a file not in the baseline is above the default for new files.
 * A file that improves passes and logs `baseline can be lowered: <file> <old>→<new>`.
 * Lowering the entry is a deliberate edit in the same PR (proposal D-RATCHET), never
 * automatic, so improvements show up in review.
 *
 * Three kinds of entry:
 *   - `"file": 512` — capped debt: may only go down;
 *   - `"file": { "value": 1060, "reason": "…" }` — capped WITH a reason: allowed above the
 *     default for good (e.g. a guard forbids splitting it), still may only go down;
 *   - `"file": { "exempt": true, "reason": "…" }` — exempt, UNCAPPED: the file grows by
 *     nature (append-only schema, seed data), so growth is not a regression. Only paths in
 *     the ratchet's `exemptAllowed` list may be exempt, and each of them must be (the
 *     baseline check fails either way). Only a hand edit writes one: no command writes
 *     `exempt`, and none changes or removes an exempt entry.
 *
 * The baseline cannot rot: an entry whose file is no longer tracked (or no longer
 * measured) fails as stale — exempt entries included — and the file is kept sorted by
 * path, with capped values above the default and a non-empty reason on every object entry.
 *
 * Files come from `git ls-files`, so untracked files never count, and there is no
 * fallback directory walk (it would count them). A tracked file deleted in the working
 * tree counts as gone. Nothing here touches the network or reads `.nuxt`/`.output`
 * (both untracked).
 *
 * Regenerating a baseline: run the metric's test file as a script.
 *
 *   node --experimental-strip-types --import ./scripts/ts-resolver.mjs tests/ratchets/<name>.test.ts --update [--raise <file>]…
 *
 * `--update` only LOWERS entries, removes entries whose file dropped to the default, and
 * removes stale entries. It never raises an entry, and never adds a file above the
 * default, unless that exact path is named with `--raise <file>` (repeatable). Reasons
 * on entries are kept; exempt entries are left exactly as they are (a stale one is
 * reported for a hand edit). `--init` writes a baseline from the current tree and
 * refuses when one exists.
 *
 * `--rebaseline` is for one moment only: after merging a base branch that moved (the
 * baseline was measured on an older tree). It sets every capped entry to today's value,
 * up or down, adds every file above the default and removes the rest — printing each
 * change — while keeping every reason and every exempt entry. It is `--update` with
 * `--raise` for every path; review its diff like any other baseline change.
 */

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))

/** Capped: a plain number, or a number with the reason the file is allowed above the default. */
export type CappedEntry = number | { value: number, reason: string }
/** Exempt and uncapped, with the reason; written by hand only. */
export interface ExemptEntry { exempt: true, reason: string }
export type BaselineEntry = CappedEntry | ExemptEntry
export type Baseline = Record<string, BaselineEntry>

export const isExempt = (entry: BaselineEntry): entry is ExemptEntry =>
  typeof entry === 'object' && (entry as Partial<ExemptEntry>).exempt === true

export interface FileRatchet {
  /** File stem: `tests/ratchets/<name>.test.ts` and `<name>.baseline.json`. */
  name: string
  /** What the number counts, for messages ("lines", "hex colour classes"). */
  unit: string
  /** The value a file not in the baseline may have. */
  defaultForNewFiles: number
  /** Whether a repo-relative path (forward slashes) is measured. */
  inScope: (file: string) => boolean
  /** The metric for one file's text. */
  measure: (text: string, file: string) => number
  /** How to fix a regression, printed with the failure. */
  hint: string
  /**
   * The only paths whose baseline entry may be `{ "exempt": true, "reason" }` — and each
   * of them must be. Empty for a metric with no growth-by-nature files.
   */
  exemptAllowed: readonly string[]
}

export interface Comparison {
  /** In the baseline, above its entry (`reason` when the entry is a named exemption). */
  worse: Array<{ file: string, value: number, baseline: number, reason?: string }>
  /** Not in the baseline, above the default for new files. */
  newOverDefault: Array<{ file: string, value: number }>
  /** In the baseline, below its entry. */
  lowerable: Array<{ file: string, value: number, baseline: number }>
  /** Baseline entries (exempt ones included) for files that are not measured any more. */
  stale: string[]
  /** Exempt entries and the current value, for information: they never fail on growth. */
  exempt: Array<{ file: string, value: number }>
}

export const entryValue = (entry: CappedEntry): number => (typeof entry === 'number' ? entry : entry.value)

/** Code-unit order: the same on every machine and locale. */
const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

export const updateCommand = (name: string) =>
  `node --experimental-strip-types --import ./scripts/ts-resolver.mjs tests/ratchets/${name}.test.ts --update`

/** Every file in the git index, sorted. Throws (never walks the directory) when git fails. */
export function trackedFiles(root: string = REPO_ROOT): string[] {
  let output: string
  try {
    output = execFileSync('git', ['ls-files', '-z'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message.split('\n')[0] : String(error)
    throw new Error(`ratchets list files with \`git ls-files\` so untracked files never count, and it failed in ${root} (${detail}). Run them from a git checkout with git installed.`)
  }
  return output.split('\0').filter(Boolean).sort(byPath)
}

/** The metric for every tracked, in-scope regular file that exists in the working tree. */
export function measureFiles(ratchet: FileRatchet, root: string = REPO_ROOT, files: string[] = trackedFiles(root)): Map<string, number> {
  const values = new Map<string, number>()
  for (const file of files) {
    if (!ratchet.inScope(file)) continue
    const full = path.join(root, file)
    let isFile = false
    try {
      isFile = lstatSync(full).isFile()
    } catch {
      continue // tracked but deleted in the working tree: the file is gone
    }
    if (!isFile) continue // a symlink or submodule is not source text
    values.set(file, ratchet.measure(readFileSync(full, 'utf8'), file))
  }
  return values
}

export function compare(ratchet: FileRatchet, current: Map<string, number>, baseline: Baseline): Comparison {
  const result: Comparison = { worse: [], newOverDefault: [], lowerable: [], stale: [], exempt: [] }
  for (const [file, value] of current) {
    const entry = baseline[file]
    if (entry === undefined) {
      if (value > ratchet.defaultForNewFiles) result.newOverDefault.push({ file, value })
      continue
    }
    if (isExempt(entry)) {
      result.exempt.push({ file, value })
      continue
    }
    const limit = entryValue(entry)
    if (value > limit) result.worse.push(typeof entry === 'number' ? { file, value, baseline: limit } : { file, value, baseline: limit, reason: entry.reason })
    else if (value < limit) result.lowerable.push({ file, value, baseline: limit })
  }
  for (const file of Object.keys(baseline)) {
    if (!current.has(file)) result.stale.push(file)
  }
  for (const list of [result.worse, result.newOverDefault, result.lowerable, result.exempt]) list.sort((a, b) => byPath(a.file, b.file))
  result.stale.sort(byPath)
  return result
}

/**
 * Shape problems: unsorted keys, non-integer values, capped values at or below the default,
 * an object entry without a non-empty reason, an exempt entry that is not exactly
 * `{ "exempt": true, "reason": "…" }`, an exempt entry for a path outside
 * `ratchet.exemptAllowed`, and an allowed path that is not listed as exempt.
 */
export function baselineProblems(ratchet: FileRatchet, baseline: unknown): string[] {
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) return ['the baseline is not a JSON object']
  const problems: string[] = []
  const keys = Object.keys(baseline)
  const sorted = [...keys].sort(byPath)
  if (keys.join('\n') !== sorted.join('\n')) problems.push('entries are not sorted by path (regenerate with --update)')
  const exemptSeen = new Set<string>()
  for (const [file, entry] of Object.entries(baseline as Record<string, unknown>)) {
    let value: unknown = entry
    if (entry && typeof entry === 'object') {
      const { value: inner, reason, ...rest } = entry as Record<string, unknown>
      if (typeof reason !== 'string' || reason.trim() === '') problems.push(`${file}: an object entry needs a non-empty "reason"`)
      if ('exempt' in rest) {
        const { exempt, ...others } = rest
        exemptSeen.add(file)
        if (!ratchet.exemptAllowed.includes(file)) {
          problems.push(`${file}: may not be exempt — the ${ratchet.name} ratchet allows "exempt" only for ${ratchet.exemptAllowed.length ? ratchet.exemptAllowed.join(', ') : 'no file'}`)
        }
        if (exempt !== true) problems.push(`${file}: "exempt" must be true (or the key removed)`)
        if (inner !== undefined) problems.push(`${file}: an exempt entry is uncapped and takes no "value"`)
        if (Object.keys(others).length) problems.push(`${file}: unknown keys ${Object.keys(others).join(', ')}`)
        continue
      }
      value = inner
      if (Object.keys(rest).length) problems.push(`${file}: unknown keys ${Object.keys(rest).join(', ')}`)
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      problems.push(`${file}: ${JSON.stringify(entry)} is not a non-negative integer`)
    } else if (value <= ratchet.defaultForNewFiles) {
      problems.push(`${file}: ${value} is not above the default (${ratchet.defaultForNewFiles}); the entry is redundant — remove it`)
    }
  }
  for (const file of ratchet.exemptAllowed) {
    if (!exemptSeen.has(file)) problems.push(`${file}: allowed to be exempt but not listed as { "exempt": true, "reason": "…" } — add it by hand, or drop it from exemptAllowed`)
  }
  return problems
}

export function serializeBaseline(baseline: Baseline): string {
  const sorted: Baseline = {}
  for (const file of Object.keys(baseline).sort(byPath)) sorted[file] = baseline[file]!
  return `${JSON.stringify(sorted, null, 2)}\n`
}

export interface Update {
  baseline: Baseline
  /** What changed, one line each. */
  changes: string[]
  /** Increases left alone because their path was not passed to --raise. */
  refused: Array<{ file: string, detail: string }>
  /** --raise paths that had nothing to raise. */
  unusedRaises: string[]
  /** Exempt entries whose file is gone: kept as they are, for a hand edit. */
  staleExempt: string[]
}

/**
 * The baseline after `--update`. Lowers, and removes entries at or below the default
 * or no longer measured. Raises (or adds above the default) ONLY the paths in `raise`.
 * Exempt entries are copied unchanged — never lowered, capped, removed or created.
 */
export function updateBaseline(ratchet: FileRatchet, current: Map<string, number>, baseline: Baseline, raise: Set<string> = new Set()): Update {
  const next: Baseline = {}
  const changes: string[] = []
  const refused: Update['refused'] = []
  const staleExempt: string[] = []
  const used = new Set<string>()
  const withValue = (entry: CappedEntry, value: number): CappedEntry =>
    (typeof entry === 'number' ? value : { value, reason: entry.reason })

  for (const [file, entry] of Object.entries(baseline)) {
    if (isExempt(entry)) {
      next[file] = entry
      if (!current.has(file)) staleExempt.push(file)
      continue
    }
    const old = entryValue(entry)
    const value = current.get(file)
    if (value === undefined) {
      changes.push(`removed (no longer tracked or measured): ${file} ${old}`)
    } else if (value <= ratchet.defaultForNewFiles) {
      changes.push(`removed (now at or below the default ${ratchet.defaultForNewFiles}): ${file} ${old}→${value}`)
    } else if (value < old) {
      next[file] = withValue(entry, value)
      changes.push(`lowered: ${file} ${old}→${value}`)
    } else if (value > old && raise.has(file)) {
      next[file] = withValue(entry, value)
      used.add(file)
      changes.push(`RAISED: ${file} ${old}→${value}`)
    } else {
      next[file] = entry
      if (value > old) refused.push({ file, detail: `${value} ${ratchet.unit}, baseline ${old}` })
    }
  }
  for (const [file, value] of current) {
    if (file in baseline || value <= ratchet.defaultForNewFiles) continue
    if (raise.has(file)) {
      next[file] = value
      used.add(file)
      changes.push(`ADDED: ${file} ${value}`)
    } else {
      refused.push({ file, detail: `${value} ${ratchet.unit}, new file (default ${ratchet.defaultForNewFiles})` })
    }
  }
  const unusedRaises = [...raise].filter(file => !used.has(file)).sort(byPath)
  const sorted: Baseline = {}
  for (const file of Object.keys(next).sort(byPath)) sorted[file] = next[file]!
  return { baseline: sorted, changes, refused, unusedRaises, staleExempt: staleExempt.sort(byPath) }
}

export function baselinePath(name: string, root: string = REPO_ROOT): string {
  return path.join(root, 'tests', 'ratchets', `${name}.baseline.json`)
}

export function readBaseline(file: string): Baseline {
  if (!existsSync(file)) throw new Error(`no baseline at ${file}`)
  return JSON.parse(readFileSync(file, 'utf8')) as Baseline
}

/** The `--update` / `--rebaseline` / `--init` command line. Returns the exit code. */
export function runUpdate(ratchet: FileRatchet, argv: string[], root: string = REPO_ROOT, log: (line: string) => void = console.log): number {
  const file = baselinePath(ratchet.name, root)
  const raise = new Set<string>()
  const rebaseline = argv.includes('--rebaseline')
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--raise') {
      const target = argv[i + 1]
      if (!target || target.startsWith('--')) {
        log('--raise needs a repo-relative file path')
        return 2
      }
      raise.add(target.replace(/^\.\//, ''))
      i += 1
    }
  }
  const current = measureFiles(ratchet, root)
  if (argv.includes('--init')) {
    if (existsSync(file)) {
      log(`${file} exists; --init only creates a baseline. Use --update.`)
      return 2
    }
    const init: Record<string, number> = {}
    for (const [path_, value] of current) if (value > ratchet.defaultForNewFiles) init[path_] = value
    writeFileSync(file, serializeBaseline(init))
    log(`created ${file}: ${Object.keys(init).length} files, ${Object.values(init).reduce((sum, v) => sum + v, 0)} ${ratchet.unit} (every entry capped; reasons and exemptions are hand edits)`)
    return 0
  }
  if (rebaseline) {
    if (raise.size) {
      log('--rebaseline already raises every path; drop --raise')
      return 2
    }
    for (const path_ of current.keys()) raise.add(path_)
    log(`--rebaseline: every capped entry follows the current tree; reasons and exempt entries are kept`)
  }
  const result = updateBaseline(ratchet, current, readBaseline(file), raise)
  writeFileSync(file, serializeBaseline(result.baseline))
  for (const line of result.changes) log(line)
  if (result.changes.length === 0) log('baseline unchanged')
  if (!rebaseline) for (const path_ of result.unusedRaises) log(`--raise ${path_}: nothing to raise (exempt, or not above its entry or the default)`)
  let code = 0
  if (result.staleExempt.length) {
    log(`\nExempt entries whose file is gone — left in place; edit the baseline by hand (rename the path, or delete the entry):`)
    for (const path_ of result.staleExempt) log(`  ${path_}`)
    code = 1
  }
  if (result.refused.length) {
    log(`\nNOT raised — ${result.refused.length} file(s) got worse. Fix them, or name each one deliberately:`)
    for (const { file: path_, detail } of result.refused) log(`  ${path_}: ${detail}`)
    log(`  ${updateCommand(ratchet.name)} ${result.refused.map(item => `--raise ${item.file}`).join(' ')}`)
    code = 1
  }
  return code
}

export function describeRegressions(ratchet: FileRatchet, result: Comparison): string {
  const lines = [
    ...result.worse.map(({ file, value, baseline, reason }) =>
      `  ${file}: ${value} ${ratchet.unit}, baseline ${baseline} (+${value - baseline})${reason ? `\n    capped, with reason: ${reason}` : ''}`),
    ...result.newOverDefault.map(({ file, value }) => `  ${file}: ${value} ${ratchet.unit}, not in the baseline (a new file may have at most ${ratchet.defaultForNewFiles})`),
  ]
  const files = [...result.worse, ...result.newOverDefault].map(item => item.file)
  return [
    `${ratchet.name} ratchet: ${files.length} file(s) got worse.`,
    ...lines,
    ratchet.hint,
    'If the increase is deliberate, raise exactly those entries in the same PR:',
    `  ${updateCommand(ratchet.name)} ${files.map(file => `--raise ${file}`).join(' ')}`,
  ].join('\n')
}

/**
 * Registers the ratchet's tests (plus `unitTests`, the metric's own checks), or — when
 * the file is run as a script with `--update` or `--init` — rewrites the baseline
 * instead and registers nothing. `node --test` never passes those flags to a test file,
 * so the test run is unaffected.
 */
export function ratchet(definition: FileRatchet, unitTests?: () => void): void {
  if (['--update', '--rebaseline', '--init'].some(flag => process.argv.includes(flag))) {
    process.exitCode = runUpdate(definition, process.argv.slice(2))
    return
  }
  unitTests?.()
  const file = baselinePath(definition.name)
  let cached: { current: Map<string, number>, baseline: Baseline } | undefined
  const load = () => (cached ??= { current: measureFiles(definition), baseline: readBaseline(file) })

  test(`${definition.name}: no file is above its baseline, and no new file is above ${definition.defaultForNewFiles} ${definition.unit}`, (t) => {
    const { current, baseline } = load()
    const result = compare(definition, current, baseline)
    for (const { file: path_, baseline: old, value } of result.lowerable) {
      t.diagnostic(`baseline can be lowered: ${path_} ${old}→${value}`)
    }
    if (result.lowerable.length) t.diagnostic(`lower them with: ${updateCommand(definition.name)}`)
    for (const { file: path_, value } of result.exempt) t.diagnostic(`exempt (uncapped): ${path_} ${value} ${definition.unit}`)
    assert.ok(result.worse.length + result.newOverDefault.length === 0, describeRegressions(definition, result))
  })

  test(`${definition.name}: every baseline entry is a tracked file the ratchet still measures`, () => {
    const { current, baseline } = load()
    const { stale } = compare(definition, current, baseline)
    assert.deepEqual(stale, [], `stale ${definition.name} baseline entries (renamed, deleted or out of scope). Remove capped ones with:\n  ${updateCommand(definition.name)}\nExempt ones are hand edits: rename the path, or delete the entry.`)
  })

  test(`${definition.name}: the baseline is sorted by path, capped values are above the default, and every object entry has a reason`, () => {
    const problems = baselineProblems(definition, load().baseline)
    assert.deepEqual(problems, [], `${file}:\n${problems.join('\n')}`)
  })
}
