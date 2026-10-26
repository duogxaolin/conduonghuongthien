/**
 * The chatbot answering policy as ONE family of files, for guards that read its code.
 *
 * `server/utils/chatbot/chat-policy.ts` was a 769-line file until wave3 4.3 (D-SPLIT). It
 * is now a barrel at the same path, and the code lives in `server/services/chat-policy-*.ts`
 * parts. The parts are NOT next to the barrel: Nitro auto-imports every export of
 * `server/utils/**`, so a part there would export each API name a second time
 * (`tests/server-utils-unique-exports.test.ts`) and turn its private helpers into globals.
 *
 * Three security guards read the policy's text — the raw-SQL / hand-built-LIKE ban on the
 * model's tool queries (`security-chatbot-article-search`), the rate-limit key built from
 * the resolved client address (`client-ip`), and the per-session AI quota on the durable
 * store (`chatbot-live-sessions`). Kept on the barrel, their "is absent" checks would read
 * an export list and go green on nothing.
 *
 * So the set is DERIVED from the directory — the barrel plus every
 * `server/services/chat-policy-*.ts` — and checked against the files that carry code today:
 * renaming or removing one turns the guard red instead of quietly shrinking what it scans,
 * a new part joins the scan without anyone listing it, and a part put back next to the
 * barrel (outside the scan) is an error. Neighbours with a similar name (`chat.ts`,
 * `chat-turns.ts`) are not part of it: they never were in the policy file.
 *
 * "Is absent" checks read the whole family (`chatPolicySource`). "Is present" checks read
 * the one declaration that must carry the code (`chatPolicyDeclaration`) — not the file
 * and not the barrel, where a comment or a re-export line would satisfy them.
 *
 * The `chat-policy` family of `tests/service-split-boundaries.test.ts` uses the SAME
 * pattern and directory (`CHAT_POLICY_PART`, `CHAT_POLICY_PARTS_DIR`), so a file cannot be
 * inside one scan and outside the other.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

export const CHAT_POLICY_BARREL = 'server/utils/chatbot/chat-policy.ts'
/** Where the parts live (see the header for why not next to the barrel). */
export const CHAT_POLICY_PARTS_DIR = 'server/services'

/** Parts that carry the policy's code today. A subset check — new parts join the scan automatically. */
export const EXPECTED_CHAT_POLICY_PARTS: readonly string[] = [
  'chat-policy-answer.ts',
  'chat-policy-contract.ts',
  'chat-policy-fallbacks.ts',
  'chat-policy-prompt.ts',
  'chat-policy-provider.ts',
  'chat-policy-rate-limit.ts',
  'chat-policy-request.ts',
]

/** A part of the family: `chat-policy-<seam>.ts` (in `CHAT_POLICY_PARTS_DIR`). */
export const CHAT_POLICY_PART = /^chat-policy-[a-z0-9-]+\.ts$/

/** Repo path of a part: `chatPolicyPart('provider')` → `server/services/chat-policy-provider.ts`. */
export const chatPolicyPart = (seam: string): string => `${CHAT_POLICY_PARTS_DIR}/chat-policy-${seam}.ts`

/** Is this repo path the barrel or a part? The same rule as the on-disk scan. */
export const isChatPolicyFile = (file: string): boolean =>
  file === CHAT_POLICY_BARREL ||
  (path.posix.dirname(file) === CHAT_POLICY_PARTS_DIR && CHAT_POLICY_PART.test(path.posix.basename(file)))

/** Part-shaped names next to the barrel — out of every scan, so never allowed. */
export const strayChatPolicyParts = (barrelDirNames: readonly string[]): string[] =>
  barrelDirNames.filter(name => CHAT_POLICY_PART.test(name))

export function readRepoFile(file: string): string {
  return readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
}

/** Repo paths of the barrel and every part, sorted. */
export function chatPolicyFiles(): string[] {
  const parts = readdirSync(new URL(`../${CHAT_POLICY_PARTS_DIR}/`, import.meta.url)).filter(name => CHAT_POLICY_PART.test(name)).sort()
  for (const expected of EXPECTED_CHAT_POLICY_PARTS)
    assert.ok(
      parts.includes(expected),
      `${expected} vắng khỏi tập quét ${JSON.stringify(parts)} — đổi tên/di chuyển tệp của chat-policy phải cập nhật guard, không âm thầm thu hẹp tập quét`,
    )
  const strays = strayChatPolicyParts(readdirSync(new URL(`../${path.posix.dirname(CHAT_POLICY_BARREL)}/`, import.meta.url)))
  assert.deepEqual(
    strays,
    [],
    `tệp con của chat-policy nằm cạnh barrel (${path.posix.dirname(CHAT_POLICY_BARREL)}/) — ngoài mọi tập quét, và Nitro tự import nó; đặt ở ${CHAT_POLICY_PARTS_DIR}/`,
  )
  return [CHAT_POLICY_BARREL, ...parts.map(name => `${CHAT_POLICY_PARTS_DIR}/${name}`)].sort()
}

/** Family paths, plus any override path the scan itself would classify as a family file. */
function familyPathsWith(overrides: Record<string, string>): string[] {
  return [...new Set([...chatPolicyFiles(), ...Object.keys(overrides).filter(isChatPolicyFile)])].sort()
}

/** The text of the whole family — what used to be the single `chat-policy.ts`. */
export function chatPolicySource(): string {
  return chatPolicySourceWith()
}

/**
 * The family text with some files replaced or added (`{ 'server/services/chat-policy-x.ts':
 * source }`, keyed by repo path), for in-suite injection proofs. An added path joins only if
 * `isChatPolicyFile` classifies it — the same rule the on-disk scan uses — so a proof cannot
 * hand the guard a file the real scan would never read.
 */
export function chatPolicySourceWith(overrides: Record<string, string> = {}): string {
  return familyPathsWith(overrides)
    .map(file => overrides[file] ?? readRepoFile(file))
    .join('\n')
}

function topLevelNames(statement: ts.Statement): string[] {
  if (ts.isVariableStatement(statement))
    return statement.declarationList.declarations.flatMap(declaration => (ts.isIdentifier(declaration.name) ? [declaration.name.text] : []))
  if ((ts.isFunctionDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) && statement.name)
    return [statement.name.text]
  return []
}

/**
 * The ONE top-level declaration named `name` across the family (function, const or
 * type), as code: its own text without the comments above it. Exactly one match — a
 * guard never reads a stale copy, and never goes green because the name vanished.
 * `overrides` as in `chatPolicySourceWith`.
 */
export function chatPolicyDeclaration(name: string, overrides: Record<string, string> = {}): { file: string, text: string } {
  const matches: Array<{ file: string, text: string }> = []
  for (const file of familyPathsWith(overrides)) {
    const source = overrides[file] ?? readRepoFile(file)
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    for (const statement of sf.statements)
      if (topLevelNames(statement).includes(name)) matches.push({ file, text: statement.getText(sf) })
  }
  assert.equal(
    matches.length,
    1,
    `${name} phải được khai báo ở đúng một tệp của chat-policy, thấy: ${JSON.stringify(matches.map(match => match.file))}`,
  )
  return matches[0]!
}

/**
 * What is wrong with the barrel's shape, or `[]`. The barrel holds named re-exports from
 * its own parts (`../../services/chat-policy-*`) and nothing else: no code (code with the
 * same name moved back into it would keep the API pin green), no import, no `export *`
 * (the API would grow silently), and no source outside the family (a neighbour, a part
 * put back next to the barrel, or another service re-exported here would join the API
 * without any guard classifying it).
 */
export function chatPolicyBarrelProblems(source: string): string[] {
  const sf = ts.createSourceFile('chat-policy.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
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
    const target = from.text.startsWith('.')
      ? `${path.posix.normalize(path.posix.join(path.posix.dirname(CHAT_POLICY_BARREL), from.text)).replace(/\.ts$/, '')}.ts`
      : null
    if (!target || !isChatPolicyFile(target) || target === CHAT_POLICY_BARREL)
      problems.push(`not re-exported from a part of the family: ${text}`)
  }
  return problems
}
