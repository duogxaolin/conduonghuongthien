/**
 * Coverage ratchet per directory (wave3-long-term, design D-R, task 1.4).
 *
 * Compares line coverage per directory, from an lcov report, with the checked-in
 * baseline `tests/ratchets/coverage.baseline.json`. It fails when:
 *   - a directory drops MORE than 0.5 point below its baseline;
 *   - a baseline directory is no longer measured (stale);
 *   - a measured directory is NOT in the baseline (new). A new directory has no floor,
 *     so an untested `server/jobs/big.ts`, or a never-loaded file `git mv`-ed out of
 *     `server/services` (which then rises), would otherwise pass unseen. It must be added
 *     deliberately: `--update --add-dir <directory>`, and the reviewer sees its number.
 * A rise passes and prints the new value. There is no absolute threshold anywhere: only
 * "not worse than before".
 *
 * The number is the "lines, all files" column of scripts/coverage-summary.ts, computed
 * by the same code: duplicate lcov records merged, and every tracked source file no
 * test loads counted at 0 % (its code lines). So a file that stops being loaded, or a
 * new untested file, counts as a drop.
 *
 * Directory = the finest row of that report: `server/<first level>` (server/api,
 * server/services, server/utils, …), and `shared`, `app/utils`, `app/composables` as a
 * whole. These are the rows of the Wave 2 measure in docs/test-coverage-baseline-2026-10.md,
 * they change only when a top-level directory is created or removed, and each is a
 * layer someone owns. Deeper levels (server/api/admin/…) are small enough that one file
 * moves them by several points.
 *
 * The 0.5-point tolerance absorbs run-to-run wobble (measured for the baseline, see the
 * doc). Small directories (server/middleware, server/plugins, server/data, shared) move
 * more per line: adding one untested file there can be a real, visible drop.
 *
 *   node --experimental-strip-types scripts/coverage-ratchet.ts <lcov> [--baseline <file>] [--root <repo>]
 *   node --experimental-strip-types scripts/coverage-ratchet.ts <lcov> --update [--allow-drop <dir>]… [--add-dir <dir>]…
 *   node --experimental-strip-types scripts/coverage-ratchet.ts <lcov> --rebaseline
 *
 * `--update` RAISES entries that rose (to the measured value, rounded down to 2
 * decimals) and removes stale ones. It never lowers an entry unless that directory is
 * named with `--allow-drop <dir>`, and never adds a new directory unless it is named
 * with `--add-dir <dir>` (both repeatable).
 *
 * `--rebaseline` is for one moment only: after merging a base branch that moved. Every
 * directory follows the measured value, up or down, new ones are added and stale ones
 * removed, each change printed — `--update` with every `--allow-drop`/`--add-dir`.
 *
 * A missing or empty report FAILS (exit 1): unlike the summary, this is a gate, and
 * "no data" must not read as "no drop".
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  directoryGroups, listSourceFiles, parseLcov, withUnloadedSources, type FileCoverage, type Ratio,
} from './coverage-summary.ts'

export const TOLERANCE = 0.5
export const DEFAULT_BASELINE = 'tests/ratchets/coverage.baseline.json'
const COMMAND = 'node --experimental-strip-types scripts/coverage-ratchet.ts'

export type CoverageBaseline = Record<string, number>

/** The ratcheted directory of a source file: the finest group of the coverage report. */
export function ratchetDirectory(file: string): string | undefined {
  const groups = directoryGroups(file)
  return groups[groups.length - 1]
}

/** Line coverage (all files, unloaded ones at 0 %) per ratcheted directory. */
export function directoryCoverage(files: FileCoverage[]): Map<string, Ratio> {
  const result = new Map<string, Ratio>()
  for (const file of files) {
    const directory = ratchetDirectory(file.path)
    if (!directory) continue
    const ratio = result.get(directory) ?? { hit: 0, total: 0 }
    for (const hits of file.lines.values()) {
      ratio.total += 1
      if (hits > 0) ratio.hit += 1
    }
    result.set(directory, ratio)
  }
  for (const [directory, ratio] of result) if (ratio.total === 0) result.delete(directory)
  return new Map([...result].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

export const linePercent = (ratio: Ratio): number => (100 * ratio.hit) / ratio.total
/** Stored values are rounded DOWN, so a baseline never claims more than was measured. */
export const floor2 = (value: number): number => Math.floor(value * 100 + 1e-9) / 100
const fixed = (value: number) => value.toFixed(2)

export type RowStatus = 'drop' | 'within' | 'same' | 'rise' | 'new' | 'stale'
export interface CoverageRow {
  directory: string
  status: RowStatus
  baseline?: number
  current?: number
  ratio?: Ratio
}

export function compareCoverage(baseline: CoverageBaseline, current: Map<string, Ratio>, tolerance: number = TOLERANCE): CoverageRow[] {
  const rows: CoverageRow[] = []
  for (const [directory, ratio] of current) {
    const value = linePercent(ratio)
    const old = baseline[directory]
    if (old === undefined) {
      rows.push({ directory, status: 'new', current: value, ratio })
      continue
    }
    let status: RowStatus = 'same'
    if (floor2(value) > old) status = 'rise'
    else if (value < old) status = old - value > tolerance + 1e-9 ? 'drop' : 'within'
    rows.push({ directory, status, baseline: old, current: value, ratio })
  }
  for (const [directory, old] of Object.entries(baseline)) {
    if (!current.has(directory)) rows.push({ directory, status: 'stale', baseline: old })
  }
  return rows.sort((a, b) => (a.directory < b.directory ? -1 : a.directory > b.directory ? 1 : 0))
}

/** A drop beyond the tolerance, a stale baseline directory, or a directory with no baseline. */
export const isFailure = (row: CoverageRow) => row.status === 'drop' || row.status === 'stale' || row.status === 'new'

export function describeRow(row: CoverageRow, tolerance: number = TOLERANCE): string {
  const counts = row.ratio ? ` (${row.ratio.hit}/${row.ratio.total} lines)` : ''
  const gap = row.baseline !== undefined && row.current !== undefined ? Math.abs(row.current - row.baseline) : undefined
  const delta = gap === undefined ? '' : ` (${row.current! >= row.baseline! ? '+' : '−'}${gap < 0.005 ? '<0.01' : fixed(gap)})`
  switch (row.status) {
    case 'drop': return `DROP  ${row.directory}: ${fixed(row.baseline!)}% → ${fixed(row.current!)}%${delta}${counts} — more than ${tolerance} point below the baseline`
    case 'within': return `ok    ${row.directory}: ${fixed(row.baseline!)}% → ${fixed(row.current!)}%${delta}${counts} — within the ${tolerance}-point tolerance`
    case 'same': return `ok    ${row.directory}: ${fixed(row.current!)}%${counts}`
    case 'rise': return `RISE  ${row.directory}: ${fixed(row.baseline!)}% → ${fixed(row.current!)}%${delta}${counts} — new value ${fixed(floor2(row.current!))}; raise the baseline with --update`
    case 'new': return `NEW   ${row.directory}: ${fixed(row.current!)}%${counts} — no baseline for this directory, so nothing guards it; add it deliberately with --update --add-dir ${row.directory}`
    case 'stale': return `STALE ${row.directory}: in the baseline (${fixed(row.baseline!)}%) but no tracked source file is measured there any more — remove it with --update`
  }
}

export interface CoverageUpdate {
  baseline: CoverageBaseline
  changes: string[]
  /** Drops left alone (no --allow-drop) and new directories left out (no --add-dir). */
  refused: string[]
}

/**
 * Raises and removes stale on its own; lowers only the directories in `allowDrop`, and
 * adds only the new directories in `addDirs`.
 */
export function updateCoverageBaseline(
  baseline: CoverageBaseline,
  current: Map<string, Ratio>,
  allowDrop: Set<string> = new Set(),
  addDirs: Set<string> = new Set(),
): CoverageUpdate {
  const next: CoverageBaseline = {}
  const changes: string[] = []
  const refused: string[] = []
  for (const row of compareCoverage(baseline, current)) {
    const value = row.current === undefined ? undefined : floor2(row.current)
    if (row.status === 'stale') {
      changes.push(`removed (stale): ${row.directory} ${fixed(row.baseline!)}`)
    } else if (row.status === 'new') {
      if (addDirs.has(row.directory)) {
        next[row.directory] = value!
        changes.push(`ADDED (--add-dir): ${row.directory} ${fixed(value!)}`)
      } else {
        refused.push(`${row.directory}: new directory at ${fixed(row.current!)}% — pass --add-dir ${row.directory}`)
      }
    } else if (row.status === 'rise') {
      next[row.directory] = value!
      changes.push(`raised: ${row.directory} ${fixed(row.baseline!)}→${fixed(value!)}`)
    } else if ((row.status === 'drop' || row.status === 'within') && allowDrop.has(row.directory)) {
      next[row.directory] = value!
      changes.push(`LOWERED (--allow-drop): ${row.directory} ${fixed(row.baseline!)}→${fixed(value!)}`)
    } else {
      next[row.directory] = row.baseline!
      if (row.status === 'drop') refused.push(`${row.directory}: ${fixed(row.current!)}%, baseline ${fixed(row.baseline!)}% — pass --allow-drop ${row.directory}`)
    }
  }
  return { baseline: next, changes, refused }
}

export function serializeCoverageBaseline(baseline: CoverageBaseline): string {
  const sorted: CoverageBaseline = {}
  for (const directory of Object.keys(baseline).sort()) sorted[directory] = baseline[directory]!
  return `${JSON.stringify(sorted, null, 2)}\n`
}

/** Shape problems of a baseline file: not an object, unsorted, values outside 0–100 or with more than 2 decimals. */
export function coverageBaselineProblems(baseline: unknown): string[] {
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) return ['the baseline is not a JSON object']
  const problems: string[] = []
  const keys = Object.keys(baseline)
  if (keys.join('\n') !== [...keys].sort().join('\n')) problems.push('directories are not sorted (regenerate with --update)')
  for (const [directory, value] of Object.entries(baseline as Record<string, unknown>)) {
    if (typeof value !== 'number' || value < 0 || value > 100 || Math.abs(Math.round(value * 100) - value * 100) > 1e-6) {
      problems.push(`${directory}: ${JSON.stringify(value)} is not a percentage with at most 2 decimals`)
    }
  }
  return problems
}

/** The directories the tracked sources fall into: what the baseline must cover, no more. */
export function trackedCoverageDirectories(root: string): Set<string> {
  return new Set(listSourceFiles(root).map(ratchetDirectory).filter((d): d is string => Boolean(d)))
}

/** Measures `lcovPath` the way the summary does. Throws when there is nothing to compare. */
export function measureDirectories(lcovPath: string, root: string): Map<string, Ratio> {
  if (!existsSync(lcovPath)) throw new Error(`no lcov report at ${lcovPath} — the test run did not write one`)
  const coverage = parseLcov(readFileSync(lcovPath, 'utf8'), root)
  if (coverage.size === 0) throw new Error(`${lcovPath} has no record for any measured source file — the coverage run is broken, not the code`)
  const sources = listSourceFiles(root).map(file => ({ path: file, text: readFileSync(path.join(root, file), 'utf8') }))
  return directoryCoverage(withUnloadedSources(coverage, sources))
}

function markdown(rows: CoverageRow[], failed: boolean): string {
  const table = rows.map(row => `| \`${row.directory}\` | ${row.baseline === undefined ? '—' : `${fixed(row.baseline)}%`} | ${row.current === undefined ? '—' : `${fixed(row.current)}%`} | ${row.status} |`)
  return [
    '### Coverage ratchet',
    '',
    failed
      ? `**Failed:** a directory dropped more than ${TOLERANCE} point below \`${DEFAULT_BASELINE}\`, a baseline directory is stale, or a new directory has no baseline.`
      : `Passed: no directory dropped more than ${TOLERANCE} point below \`${DEFAULT_BASELINE}\`.`,
    '',
    '| directory | baseline | now | status |',
    '|---|---|---|---|',
    ...table,
    '',
  ].join('\n')
}

/** Values of a repeatable flag; `undefined` when one is missing its value. */
function repeated(argv: string[], flag: string): Set<string> | undefined {
  const values = new Set<string>()
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== flag) continue
    const value = argv[i + 1]
    if (!value || value.startsWith('--')) return undefined
    values.add(value.replace(/\/$/, ''))
    i += 1
  }
  return values
}

/** The command line. Returns the exit code. */
export function runCoverageRatchet(argv: string[], log: (line: string) => void = console.log, cwd: string = process.cwd()): number {
  const valueOf = (flag: string) => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : undefined
  }
  const allowDrop = repeated(argv, '--allow-drop')
  const addDirs = repeated(argv, '--add-dir')
  if (!allowDrop || !addDirs) {
    log('--allow-drop / --add-dir need a directory, e.g. --allow-drop server/api')
    return 2
  }
  const rebaseline = argv.includes('--rebaseline')
  const updating = rebaseline || argv.includes('--update')
  if (rebaseline && (allowDrop.size || addDirs.size)) {
    log('--rebaseline already follows every directory; drop --allow-drop/--add-dir')
    return 2
  }
  if (!updating && (allowDrop.size || addDirs.size)) {
    log('--allow-drop / --add-dir only make sense with --update')
    return 2
  }
  const root = path.resolve(cwd, valueOf('--root') ?? '.')
  const baselineFile = path.resolve(root, valueOf('--baseline') ?? DEFAULT_BASELINE)
  const flagsWithValue = new Set(['--root', '--baseline', '--allow-drop', '--add-dir'])
  const lcovPath = argv.find((arg, index) => !arg.startsWith('--') && !flagsWithValue.has(argv[index - 1] ?? ''))
  if (!lcovPath) {
    log(`usage: coverage-ratchet.ts <lcov> [--baseline <file>] [--root <repo>] [--update [--allow-drop <dir>]… [--add-dir <dir>]… | --rebaseline]`)
    return 2
  }

  let current: Map<string, Ratio>
  try {
    current = measureDirectories(path.resolve(cwd, lcovPath), root)
  } catch (error) {
    log(`coverage ratchet: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
  if (!existsSync(baselineFile)) {
    log(`coverage ratchet: no baseline at ${baselineFile}`)
    return 1
  }
  const baseline = JSON.parse(readFileSync(baselineFile, 'utf8')) as CoverageBaseline
  const problems = coverageBaselineProblems(baseline)
  if (problems.length && !updating) {
    log(`coverage ratchet: ${baselineFile} is malformed:\n${problems.join('\n')}`)
    return 1
  }

  if (updating) {
    if (rebaseline) {
      log('--rebaseline: every directory follows the measured value; new directories are added, stale ones removed')
      for (const directory of current.keys()) {
        allowDrop.add(directory)
        addDirs.add(directory)
      }
    }
    const update = updateCoverageBaseline(baseline, current, allowDrop, addDirs)
    writeFileSync(baselineFile, serializeCoverageBaseline(update.baseline))
    for (const line of update.changes) log(line)
    if (update.changes.length === 0) log('coverage baseline unchanged')
    if (update.refused.length) {
      log(`\nNOT recorded — ${update.refused.length} directory(ies) need an explicit decision. Add tests, or name each one deliberately:`)
      for (const line of update.refused) log(`  ${line}`)
      return 1
    }
    return 0
  }

  const rows = compareCoverage(baseline, current)
  const failed = rows.some(isFailure)
  const shownBaseline = path.relative(root, baselineFile).startsWith('..') ? baselineFile : path.relative(root, baselineFile)
  log(`Coverage ratchet — line coverage per directory (all tracked sources), tolerance ${TOLERANCE} point, baseline ${shownBaseline}`)
  for (const row of rows) log(describeRow(row))
  const drops = rows.filter(row => row.status === 'drop')
  if (drops.length) {
    log(`\nFAILED. Add tests for the code that lowered coverage. If the drop is deliberate (e.g. code moved to a directory the unit suite cannot load), lower exactly that entry in the same PR:`)
    log(`  ${COMMAND} ${lcovPath} --update ${drops.map(row => `--allow-drop ${row.directory}`).join(' ')}`)
  }
  const added = rows.filter(row => row.status === 'new')
  if (added.length) {
    log(`\nFAILED. A directory without a baseline is not guarded (an untested new directory, or files moved out of a guarded one). Add tests if it is low, then record it deliberately in the same PR:`)
    log(`  ${COMMAND} ${lcovPath} --update ${added.map(row => `--add-dir ${row.directory}`).join(' ')}`)
  }
  if (rows.some(row => row.status === 'stale')) {
    log(`\nFAILED. The baseline names a directory with no measured source any more. Remove it in the same PR:`)
    log(`  ${COMMAND} ${lcovPath} --update`)
  }
  if (!failed && rows.some(row => row.status === 'rise')) {
    log(`\nRecord the new values in the same PR: ${COMMAND} ${lcovPath} --update`)
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown(rows, failed))
  return failed ? 1 : 0
}

if (import.meta.main) {
  process.exitCode = runCoverageRatchet(process.argv.slice(2))
}
