/**
 * The moderation regex module as ONE family of files, for guards that read its code.
 *
 * `server/services/moderation-regex.ts` was a 686-line file until wave3-long-term 4.3
 * (D-SPLIT): pattern checks at save time, the compile cache, the Layer-1 parser and shape
 * analysis, and the Layer-2 windowed runner that disables a slow rule for 10 minutes. It
 * is now a barrel at the same path, and the code lives in `moderation-regex-*.ts` parts
 * next to it — in `server/services/`, NOT `server/utils/` (Nitro auto-imports every export
 * there, so a part would export each API name a second time and turn `Parser`,
 * `analyzePattern` and the sample tables into globals).
 *
 * A guard that kept reading `moderation-regex.ts` alone would, after the split, read an
 * export list and go green on nothing. So the set is DERIVED from the directory — the
 * barrel and every `server/services/moderation-regex-*.ts` — and checked against the files
 * that carry the code today: renaming or removing one turns the guard red instead of
 * quietly shrinking what it scans, and a new part joins the scan without anyone listing it.
 *
 * The family is NOT part of the moderation worker (`_moderation-worker-family.ts`): the
 * worker's file pattern is `moderation-*.ts`, and it excludes this whole family through
 * `MODERATION_REGEX_PART` — one pattern, so a file cannot be in both scans or in neither.
 * The `moderation-regex` family of `tests/service-split-boundaries.test.ts` uses the SAME
 * pattern (rules 1, 4, 5, 6).
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import ts from 'typescript'

const SERVICES = 'server/services'
const SERVICES_DIR = new URL('../server/services/', import.meta.url)

export const MODERATION_REGEX_BARREL = `${SERVICES}/moderation-regex.ts`

/** A part of the family: `moderation-regex-<seam>.ts` in `server/services/`. */
export const MODERATION_REGEX_PART = /^moderation-regex-[a-z0-9-]+\.ts$/

/** Files that carry the module's code today. A subset check — new parts join the scan automatically. */
export const EXPECTED_MODERATION_REGEX_FAMILY: readonly string[] = [
  'moderation-regex.ts',
  // wave3 4.3.
  'moderation-regex-analysis.ts',
  'moderation-regex-check.ts',
  'moderation-regex-limits.ts',
  'moderation-regex-parser.ts',
  'moderation-regex-runtime.ts',
]

/** Is this file name (in `server/services/`) the barrel or a part? The same rule as the on-disk scan. */
export const isModerationRegexFile = (name: string): boolean =>
  `${SERVICES}/${name}` === MODERATION_REGEX_BARREL || MODERATION_REGEX_PART.test(name)

/** Repo-relative paths (`server/services/…`) of the barrel and every part, sorted. */
export function moderationRegexFiles(): string[] {
  const found = readdirSync(SERVICES_DIR).filter(isModerationRegexFile).sort()
  for (const expected of EXPECTED_MODERATION_REGEX_FAMILY)
    assert.ok(
      found.includes(expected),
      `${expected} vắng khỏi tập quét ${JSON.stringify(found)} — đổi tên/di chuyển tệp của moderation-regex phải cập nhật guard, không âm thầm thu hẹp tập quét`,
    )
  return found.map(name => `${SERVICES}/${name}`)
}

export function readRepoFile(file: string): string {
  return readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
}

/**
 * Path → source of the whole family, with some files replaced or added (keyed by repo path,
 * `server/services/moderation-regex-x.ts`), for in-suite injection proofs. An added path joins
 * only if `isModerationRegexFile` classifies it — the same rule the on-disk scan uses — so a
 * proof cannot hand a guard a file the real scan would never read.
 */
export function moderationRegexSourcesWith(overrides: Record<string, string> = {}): Map<string, string> {
  const added = Object.keys(overrides).filter(file => file.startsWith(`${SERVICES}/`)
    && !file.slice(SERVICES.length + 1).includes('/')
    && isModerationRegexFile(file.slice(SERVICES.length + 1)))
  const files = [...new Set([...moderationRegexFiles(), ...added])].sort()
  return new Map(files.map(file => [file, overrides[file] ?? readRepoFile(file)]))
}

/**
 * What is wrong with the barrel's shape, or `[]`. The barrel holds named re-exports from
 * its own parts and nothing else: no code (`testModerationRegex` moved back into it would
 * keep the API pin green and slip out of every part-based check — including the one owner
 * of the slow-rule state), no import, no `export *` (the API would grow silently, and the
 * parser's internals with it), and no source outside the family.
 */
export function moderationRegexBarrelProblems(source: string): string[] {
  const sf = ts.createSourceFile('moderation-regex.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
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
    if (!target || target.includes('/') || !MODERATION_REGEX_PART.test(target))
      problems.push(`not re-exported from a part of the family: ${text}`)
  }
  return problems
}

/**
 * Module-level state of the family that is EXPORTED, as `file#name`. The state that decides
 * whether a rule runs — the clock, the 10-minute disable book, the truncation-log book, the
 * compile cache — is changed only through its owner's functions; rule 4 of the boundaries
 * guard sees writes through an import, not through an object handed back by a function, so
 * that state must stay unexported. The read-only sample tables of the parser are the only
 * exported state, by name.
 */
export const EXPORTED_STATE_ALLOWED: readonly string[] = [
  `${SERVICES}/moderation-regex-parser.ts#ALL_SAMPLES`,
]

export function exportedFamilyState(sources: ReadonlyMap<string, string>): string[] {
  const out: string[] = []
  for (const [file, source] of sources) {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    for (const statement of sf.statements) {
      if (!ts.isVariableStatement(statement)) continue
      const exported = statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
      if (!exported) continue
      const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0
      for (const declaration of statement.declarationList.declarations) {
        let init = declaration.initializer
        while (init && (ts.isAsExpression(init) || ts.isSatisfiesExpression(init) || ts.isParenthesizedExpression(init)))
          init = init.expression
        const state = !isConst || (init !== undefined && (ts.isObjectLiteralExpression(init) || ts.isArrayLiteralExpression(init) || ts.isNewExpression(init)))
        if (state) out.push(`${file}#${declaration.name.getText(sf)}`)
      }
    }
  }
  return out.sort()
}
