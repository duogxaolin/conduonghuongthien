/**
 * The AI gateway as ONE family of files, for guards that read its code.
 *
 * `server/services/ai-gateway.ts` holds `callAi`, the single choke-point of every AI call
 * (wave3-long-term 4.3, D-SPLIT, splits it into `ai-gateway-*.ts` parts behind a barrel at
 * the same path). Three files were moved out of it verbatim before that and still belong
 * to it: `ai-text-cleaner.ts` (the "reasoning" cleaner, re-exported), `ai-response-parse.ts`
 * (pure response parsing, re-exported), and `ai-sse.ts` — `readChatSse`, the ONE reader of
 * a provider's SSE stream (CLAUDE.md "Luồng SSE của AI đọc ở MỘT nơi": `callAi` once
 * copied that loop four times, and each fix to one copy missed another).
 *
 * The parts live next to the barrel in `server/services/` — NOT in `server/utils/`, which
 * Nitro auto-imports (a part there would export each API name a second time and turn
 * private helpers into globals; the `chat-policy` split learned this).
 *
 * A guard that kept reading `ai-gateway.ts` alone would, after the split, read an export
 * list and go green on nothing. So the set is DERIVED from the directory — the barrel,
 * every `server/services/ai-gateway-*.ts`, and the three earlier extractions — and checked
 * against the files that carry gateway code today: renaming or removing one turns the guard
 * red instead of quietly shrinking what it scans, and a new part joins the scan without
 * anyone listing it.
 *
 * Other `ai-*` files are not part of it: the budget, cost, usage log, key crypto and
 * provider-URL policy live in `server/utils/` and are imported by the gateway, never
 * moved out of it.
 *
 * The `ai-gateway` family of `tests/service-split-boundaries.test.ts` uses the SAME pattern
 * (`AI_GATEWAY_PART`), so a file cannot be inside one scan and outside the other; the
 * guards that read this family are `ai-gateway-one-sse-reader` and `server-bare-fetch-guard`.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import ts from 'typescript'

const SERVICES = 'server/services'
const SERVICES_DIR = new URL('../server/services/', import.meta.url)

export const AI_GATEWAY_BARREL = `${SERVICES}/ai-gateway.ts`

/** The one file that reads a provider's SSE stream. */
export const AI_SSE_READER = `${SERVICES}/ai-sse.ts`

/** Moved out of `ai-gateway.ts` verbatim before wave3 4.3; still the gateway's code. */
export const AI_GATEWAY_EARLIER_PARTS: readonly string[] = ['ai-response-parse.ts', 'ai-sse.ts', 'ai-text-cleaner.ts']

/** Files that carry the gateway's code today. A subset check — new parts join the scan automatically. */
export const EXPECTED_AI_GATEWAY_FAMILY: readonly string[] = [
  'ai-gateway.ts',
  ...AI_GATEWAY_EARLIER_PARTS,
  // wave3 4.3.
  'ai-gateway-call.ts',
  'ai-gateway-config.ts',
  'ai-gateway-types.ts',
]

const escape = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A part of the family: `ai-gateway-<seam>.ts`, or one of the earlier extractions. */
export const AI_GATEWAY_PART = new RegExp(`^(?:ai-gateway-[a-z0-9-]+\\.ts|${AI_GATEWAY_EARLIER_PARTS.map(escape).join('|')})$`)

/** Is this file name (in `server/services/`) the barrel or a part? The same rule as the on-disk scan. */
export const isAiGatewayFile = (name: string): boolean =>
  `${SERVICES}/${name}` === AI_GATEWAY_BARREL || AI_GATEWAY_PART.test(name)

/** Repo-relative paths (`server/services/…`) of the barrel and every part, sorted. */
export function aiGatewayFiles(): string[] {
  const found = readdirSync(SERVICES_DIR).filter(isAiGatewayFile).sort()
  for (const expected of EXPECTED_AI_GATEWAY_FAMILY)
    assert.ok(
      found.includes(expected),
      `${expected} vắng khỏi tập quét ${JSON.stringify(found)} — đổi tên/di chuyển tệp của ai-gateway phải cập nhật guard, không âm thầm thu hẹp tập quét`,
    )
  return found.map(name => `${SERVICES}/${name}`)
}

export function readRepoFile(file: string): string {
  return readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
}

/**
 * Path → source of the whole family, with some files replaced or added (keyed by repo path,
 * `server/services/ai-gateway-x.ts`), for in-suite injection proofs. An added path joins only
 * if `isAiGatewayFile` classifies it — the same rule the on-disk scan uses — so a proof
 * cannot hand a guard a file the real scan would never read.
 */
export function aiGatewaySourcesWith(overrides: Record<string, string> = {}): Map<string, string> {
  const added = Object.keys(overrides).filter(file => file.startsWith(`${SERVICES}/`) && !file.slice(SERVICES.length + 1).includes('/')
    && isAiGatewayFile(file.slice(SERVICES.length + 1)))
  const files = [...new Set([...aiGatewayFiles(), ...added])].sort()
  return new Map(files.map(file => [file, overrides[file] ?? readRepoFile(file)]))
}

/**
 * What is wrong with the barrel's shape, or `[]`. The barrel holds named re-exports from
 * its own parts and nothing else: no code (`callAi` moved back into it would keep the API
 * pin green and slip out of every part-based check), no import, no `export *` (the API
 * would grow silently), and no source outside the family (a util re-exported here would
 * join the API without any guard classifying it).
 */
export function aiGatewayBarrelProblems(source: string): string[] {
  const sf = ts.createSourceFile('ai-gateway.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
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
    if (!target || target.includes('/') || !AI_GATEWAY_PART.test(target))
      problems.push(`not re-exported from a part of the family: ${text}`)
  }
  return problems
}
