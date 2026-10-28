/**
 * The moderation worker as ONE family of files, for guards that read its code.
 *
 * `server/services/moderation-worker.ts` was an 822-line file until wave3 4.3 (D-SPLIT);
 * it is now a barrel, and the code lives in `moderation-worker-*.ts` parts plus three
 * files split from it earlier (`moderation-instant.ts`, `moderation-rules-cache.ts`,
 * `moderation-stats.ts`). A guard that kept reading `moderation-worker.ts` would read an
 * export list and go green on nothing (`moderation-always-scan` did, the moment the
 * split landed: its two "the old threshold is gone" checks passed on an empty scan).
 *
 * So the set is DERIVED from the directory — every `server/services/moderation-*.ts`
 * except the named siblings — and checked against the files that carry code today:
 * renaming or removing one turns the guard red instead of quietly shrinking what it
 * scans, and a new part joins the scan without anyone listing it.
 *
 * The `moderation-worker` family of `tests/service-split-boundaries.test.ts` uses the
 * SAME pattern (`MODERATION_WORKER_PART`), so a file cannot be inside one scan and
 * outside the other.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import ts from 'typescript'
import { MODERATION_REGEX_PART } from './_moderation-regex-family.ts'

const SERVICES = 'server/services'
const SERVICES_DIR = new URL('../server/services/', import.meta.url)

export const MODERATION_WORKER_BARREL = `${SERVICES}/moderation-worker.ts`

/**
 * `moderation-*.ts` files that were never part of `moderation-worker.ts`:
 *  - `moderation-regex.ts`: its own module (pattern validation, timing, slow-rule state),
 *    also imported by the rules endpoints — a barrel since wave3 4.3, whose parts
 *    `moderation-regex-*.ts` (`MODERATION_REGEX_PART`, `_moderation-regex-family.ts`) are
 *    excluded with it below;
 *  - `moderation-rescan-job.ts`: a CONSUMER — it imports the barrel on purpose
 *    (`rescanExistingContent`). Counting it as a part would turn "a part never imports
 *    its barrel" red on correct code.
 */
export const MODERATION_SIBLINGS: readonly string[] = ['moderation-regex.ts', 'moderation-rescan-job.ts']

/** Files that carry the worker's code today. A subset check — new parts join the scan automatically. */
export const EXPECTED_MODERATION_WORKER_FAMILY: readonly string[] = [
  'moderation-worker.ts',
  // Split from moderation-worker.ts before wave3; the barrel re-exports from them.
  'moderation-instant.ts',
  'moderation-rules-cache.ts',
  'moderation-stats.ts',
  // wave3 4.3.
  'moderation-worker-check.ts',
  'moderation-worker-persist.ts',
  'moderation-worker-prescreen.ts',
  'moderation-worker-rescan.ts',
  'moderation-worker-types.ts',
]

const escape = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A part of the family: `moderation-<seam>.ts`, minus the barrel, the siblings, and every
 * part of the `moderation-regex` family (the same pattern its guards use — a regex part
 * read here would be a worker file that the regex rules 1/4/5/6 also own, and the regex
 * barrel importing it would read as a consumer bypassing the worker barrel).
 */
export const MODERATION_WORKER_PART = new RegExp(
  `^(?!(?:${['moderation-worker.ts', ...MODERATION_SIBLINGS].map(escape).join('|')})$)(?!${MODERATION_REGEX_PART.source})moderation-[a-z0-9-]+\\.ts$`,
)

export const isModerationWorkerFile = (name: string): boolean =>
  `${SERVICES}/${name}` === MODERATION_WORKER_BARREL || MODERATION_WORKER_PART.test(name)

/** Repo-relative paths (`server/services/…`) of the barrel and every part, sorted. */
export function moderationWorkerFiles(): string[] {
  const onDisk = readdirSync(SERVICES_DIR)
  const found = onDisk.filter(isModerationWorkerFile).sort()
  for (const expected of EXPECTED_MODERATION_WORKER_FAMILY)
    assert.ok(
      found.includes(expected),
      `${expected} vắng khỏi tập quét ${JSON.stringify(found)} — đổi tên/di chuyển tệp của moderation-worker phải cập nhật guard, không âm thầm thu hẹp tập quét`,
    )
  for (const sibling of MODERATION_SIBLINGS)
    assert.ok(onDisk.includes(sibling), `anh em ${sibling} không còn tồn tại — sửa MODERATION_SIBLINGS`)
  return found.map(name => `${SERVICES}/${name}`)
}

export function readServiceFile(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

/** The text of the whole family — what used to be the single `moderation-worker.ts`. */
export function moderationWorkerSource(): string {
  return moderationWorkerSourceWith()
}

/**
 * The family text with some files replaced or added (`{ 'moderation-worker-x.ts': source }`),
 * for in-suite injection proofs. An added name joins only if `isModerationWorkerFile`
 * classifies it — the same rule the on-disk scan uses — so a proof cannot hand the guard
 * a file the real scan would never read.
 */
export function moderationWorkerSourceWith(overrides: Record<string, string> = {}): string {
  const names = new Set([
    ...moderationWorkerFiles().map(file => file.slice(SERVICES.length + 1)),
    ...Object.keys(overrides).filter(isModerationWorkerFile),
  ])
  return [...names]
    .sort()
    .map(name => overrides[name] ?? readServiceFile(`${SERVICES}/${name}`))
    .join('\n')
}

/**
 * The ONE family file that declares `function <name>` (exported or not, async or not),
 * with its source. Exactly one match: a guard never reads a stale copy, and never goes
 * green because the name vanished.
 */
export function moderationFileDeclaring(name: string): { file: string, source: string } {
  const declaration = new RegExp(`(?:^|\\n)(?:export )?(?:async )?function ${name}\\b`)
  const matches = moderationWorkerFiles()
    .map(file => ({ file, source: readServiceFile(file) }))
    .filter(({ source }) => declaration.test(source))
  assert.equal(
    matches.length,
    1,
    `${name} phải được khai báo ở đúng một tệp của moderation-worker, thấy: ${JSON.stringify(matches.map(match => match.file))}`,
  )
  return matches[0]!
}

/**
 * What is wrong with the barrel's shape, or `[]`. The barrel holds named re-exports from
 * its own parts and nothing else: no code (code with the same name moved back into it
 * would keep the API pin green), no import, no `export *` (the API would grow silently),
 * and no source outside the family (a sibling or a util re-exported here would join the
 * family without any guard classifying it).
 */
export function moderationWorkerBarrelProblems(source: string): string[] {
  const sf = ts.createSourceFile('moderation-worker.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const problems: string[] = []
  if (sf.statements.length === 0) problems.push('the barrel exports nothing')
  for (const statement of sf.statements) {
    const text = statement.getText(sf).split('\n')[0]!
    if (!ts.isExportDeclaration(statement)) {
      problems.push(`not a re-export: ${text}`)
      continue
    }
    const from = statement.moduleSpecifier
    if (!from || !ts.isStringLiteral(from)) {
      problems.push(`a re-export without a module: ${text}`)
      continue
    }
    if (!statement.exportClause || !ts.isNamedExports(statement.exportClause))
      problems.push(`not a named re-export (export * / export * as): ${text}`)
    const target = from.text.startsWith('./') ? `${from.text.slice(2).replace(/\.ts$/, '')}.ts` : null
    if (!target || target.includes('/') || !MODERATION_WORKER_PART.test(target))
      problems.push(`not re-exported from a part of the family: ${text}`)
  }
  return problems
}
