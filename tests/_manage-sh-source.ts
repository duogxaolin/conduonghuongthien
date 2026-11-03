/**
 * production/manage.sh read as ONE script (wave3-long-term task 4.4).
 *
 * manage.sh is a thin entry that sources production/lib/*.sh. Every guard that pins
 * the toolkit's text reads it through here: the entry plus EVERY `lib/*.sh` found on
 * disk. A function moving between libs, or a lib added later, cannot drop out of a
 * guard's scan set — in Wave 2 a split once silently shrank one.
 *
 * The lib list is derived from the directory, then `manageLayoutProblems()` requires
 * the directory == EXPECTED_MANAGE_LIBS == the entry's missing-lib check == the entry's
 * `.` lines (tests/ops-scripts.test.ts). A new lib is scanned at once, and the layout
 * test stays red until it is named in all four places.
 *
 * Order of `manageSource()`: the libs in the order the entry sources them (a lib on
 * disk the entry does not source is appended, so it is still scanned), then the entry
 * last — the order the single-file manage.sh had (helpers, Deploy, Update, Migrate,
 * media, cron, export, then `# ── Entry ──`).
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const MANAGE_ENTRY = 'production/manage.sh'
export const MANAGE_LIB_DIR = 'production/lib'
/** The libs, in the order manage.sh sources them. common.sh first: it holds every global. */
export const EXPECTED_MANAGE_LIBS = [
  'common',
  'log-driver',
  'menu',
  'deploy',
  'update-image',
  'update',
  'migrate',
  'media',
  'backup-cron',
  'export-env',
] as const

const readText = (root: string, rel: string) =>
  readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n')

/** Lib names (without `.sh`) present in production/lib/, sorted. No directory → []. */
export function manageLibsOnDisk(root: string = REPO_ROOT): string[] {
  let names: string[]
  try {
    names = readdirSync(path.join(root, MANAGE_LIB_DIR))
  } catch {
    return []
  }
  return names
    .filter((name) => name.endsWith('.sh'))
    .map((name) => name.slice(0, -'.sh'.length))
    .sort()
}

/** The names in the entry's missing-lib check: `for MANAGE_LIB in … ; do`. */
export function manageLibsChecked(entry: string): string[] {
  const loop = /^for MANAGE_LIB in ([^;\n]+); do$/m.exec(entry)
  return loop ? loop[1]!.trim().split(/\s+/) : []
}

/** The names in the entry's `. "$MANAGE_LIB_DIR/<name>.sh"` lines, in order. */
export function manageLibsSourced(entry: string): string[] {
  return [...entry.matchAll(/^\. "\$MANAGE_LIB_DIR\/([^"/]+)\.sh"$/gm)].map((match) => match[1]!)
}

/** Every disagreement between the directory, EXPECTED_MANAGE_LIBS and the entry. */
export function manageLayoutProblems(root: string = REPO_ROOT): string[] {
  const entry = readText(root, MANAGE_ENTRY)
  const expected = [...EXPECTED_MANAGE_LIBS]
  const onDisk = manageLibsOnDisk(root)
  const checked = manageLibsChecked(entry)
  const sourced = manageLibsSourced(entry)
  const problems: string[] = []
  if (onDisk.join(' ') !== [...expected].sort().join(' ')) {
    problems.push(
      `production/lib/*.sh on disk [${onDisk.join(' ')}] differs from EXPECTED_MANAGE_LIBS [${[...expected].sort().join(' ')}]`,
    )
  }
  if (checked.join(' ') !== expected.join(' ')) {
    problems.push(
      `manage.sh checks for [${checked.join(' ')}], expected [${expected.join(' ')}] in that order`,
    )
  }
  if (sourced.join(' ') !== expected.join(' ')) {
    problems.push(
      `manage.sh sources [${sourced.join(' ')}], expected [${expected.join(' ')}] in that order`,
    )
  }
  return problems
}

export interface ManagePart {
  file: string
  text: string
}

/** The toolkit's files: libs in the entry's sourcing order (+ any unsourced lib on disk), then the entry. */
export function manageParts(root: string = REPO_ROOT): ManagePart[] {
  const entry = readText(root, MANAGE_ENTRY)
  const onDisk = manageLibsOnDisk(root)
  const sourced = [...new Set(manageLibsSourced(entry))].filter((name) => onDisk.includes(name))
  const order = [...sourced, ...onDisk.filter((name) => !sourced.includes(name))]
  return [
    ...order.map((name) => ({
      file: `${MANAGE_LIB_DIR}/${name}.sh`,
      text: readText(root, `${MANAGE_LIB_DIR}/${name}.sh`),
    })),
    { file: MANAGE_ENTRY, text: entry },
  ]
}

/** The whole toolkit as one text, for guards that used to read production/manage.sh. */
export const manageSource = (root: string = REPO_ROOT): string =>
  manageParts(root)
    .map((part) => part.text)
    .join('\n')

/**
 * The body of `name() {` … the first column-0 `}` in the whole toolkit — the same rule
 * the single-file guards used. Empty when the function does not exist.
 */
export const manageFunction = (name: string, source: string = manageSource()): string =>
  new RegExp(`^${name}\\(\\) \\{\\n([\\s\\S]*?)\\n\\}`, 'm').exec(source)?.[1] ?? ''
