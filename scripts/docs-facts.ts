/**
 * CLAUDE.md facts block (wave3-long-term, design D-FACTS).
 *
 * CLAUDE.md used to quote counts measured by hand ("Hiện 335 endpoint: 173 `getDb()`
 * thẳng…", "641 cột/62 bảng", "22 file đã dùng helper", "init.ts hiện 80"). Each was right
 * on the day it was written and wrong after the next merge, and the same number sat in
 * two or three places that drifted apart ("172 endpoint cũ" beside "173 `getDb()`"). This
 * script computes every count CLAUDE.md quotes that can be measured offline and
 * deterministically, and writes them as ONE table between `<!-- facts:start -->` and
 * `<!-- facts:end -->`. Prose elsewhere points at the table instead of repeating a value.
 * tests/docs-facts.test.ts fails when the table no longer matches the tree.
 *
 *   npm run docs:facts               check: prints the diff and exits 1 when the block is stale
 *   npm run docs:facts -- --write    regenerate the block in CLAUDE.md
 *
 * The npm script is `node --experimental-strip-types --import ./scripts/ts-resolver.mjs
 * scripts/docs-facts.ts`. The resolver is required, as for `db:drift`: the drift parser and
 * the seed modules import project files extension-less.
 *
 * DEV-ONLY — run it in a git checkout with `npm ci` done, never in the container. It needs
 * the `.git` directory (`git ls-files`; the image has none — .dockerignore drops `.git`) and
 * two devDependencies, `typescript` and `js-yaml`, that the runtime image does not install
 * (`npm ci --omit=dev`). The image still ships this file, because the runtime stage copies
 * all of `scripts/`; `docker exec … npm run docs:facts` fails there by design.
 *
 * How each count is measured (the methods CLAUDE.md used to print next to the numbers):
 *   - tables · columns: `tablesFromSchema()` of scripts/check-schema-drift.ts on
 *     server/db/schema.ts — the same parser as `db:drift`, not a second one. Columns are the
 *     declared columns, which equal the count `db:drift` compares when there is no drift;
 *     `--write` refuses while the drift comparison reports a problem.
 *   - endpoints: tracked `server/api/**.ts` (`find server/api -name '*.ts' | wc -l`); of
 *     those, files containing `getDb()` (`grep -rl 'getDb()'`) and files with a line
 *     matching `from '.*services/` (`grep -rlE "from '.*services/"`).
 *   - `requireResourcePermission`: tracked files under `server/` and under `server/api/`
 *     that name it, the definer included (`grep -rl requireResourcePermission server`).
 *   - `rateLimitDeps`: files that IMPORT it — its callers, neither the definer nor a file
 *     that only mentions it in a comment.
 *   - integration suites: tracked `tests/*-integration.test.ts`, against the `file` of every
 *     `integration-tests` matrix entry in .github/workflows/ci.yml. Only "khớp"/"lệch" is
 *     shown; tests/ci-integration-matrix.test.ts is the guard on the wiring itself.
 *   - lines: newline count, i.e. `wc -l` (the file-length ratchet measures the same way).
 *   - i18n: distinct `key` and rows of DEFAULT_TRANSLATIONS_SEED; keys of `baseDictionary.vi`
 *     in app/composables/i18n-default-dictionary.ts (the Vietnamese fallback), counted with
 *     the TypeScript parser on the file's TEXT. Importing it is not an option: the runtime
 *     image ships all of scripts/ and no shipped code may load app/
 *     (tests/runtime-image-sources.test.ts).
 *   - Page Builder: BLOCK_REGISTRY by `category`. Small talk: CHATBOT_SMALL_TALK_SEED rows.
 *
 * Files come from `git ls-files` with no directory-walk fallback, like the ratchets
 * (tests/ratchets/_ratchet.ts), so untracked files never count; a tracked file deleted in
 * the working tree counts as gone. No network, nothing from `.nuxt`/`.output`. The block
 * carries no date: the test keeps it current, and a date would change it on every run.
 *
 * Left in CLAUDE.md as prose WITH the date they were measured, because the tree alone does
 * not produce them:
 *   - test totals (tests/pass/skip): only running the whole suite yields them, it takes
 *     minutes, and the skip count depends on whether the machine has MySQL and FFmpeg;
 *   - integration/E2E results and the ESLint warning count: they need MySQL, a browser or a
 *     full lint run;
 *   - sizes of a guard's own list (audited endpoints/services, request-body baseline,
 *     pinned AdminModal dialogs, error/retry pages): the guard test is their source;
 *   - counts with no definition a script can apply ("50 file public đã dùng `t()`").
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import ts from 'typescript'
import * as schema from '../server/db/schema.ts'
import { DEFAULT_TRANSLATIONS_SEED } from '../server/data/default-translations-seed.ts'
import { CHATBOT_SMALL_TALK_SEED } from '../server/data/chatbot-small-talk-seed.ts'
import { BLOCK_REGISTRY } from '../shared/blocks/registry.ts'
import { compareSchemas, readDdlSource, tablesFromDdl, tablesFromSchema } from './check-schema-drift.ts'

export const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url))
export const CLAUDE_MD = 'CLAUDE.md'
export const START = '<!-- facts:start -->'
export const END = '<!-- facts:end -->'
export const WRITE_COMMAND = 'npm run docs:facts -- --write'

/** The files whose line count CLAUDE.md quotes, in table order, with their short label. */
export const LINE_COUNTED: ReadonlyArray<{ file: string, label: string }> = [
  { file: 'app/layouts/default.vue', label: 'default.vue' },
  { file: 'server/db/init.ts', label: 'init.ts' },
  { file: 'app/composables/useI18n.ts', label: 'useI18n.ts' },
  { file: 'app/composables/useChatbot.ts', label: 'useChatbot.ts' },
  { file: 'app/pages/admin/profile.vue', label: 'admin/profile.vue' },
]

const CI_WORKFLOW = '.github/workflows/ci.yml'
const I18N_DICTIONARY = 'app/composables/i18n-default-dictionary.ts'
const INTEGRATION_SUITE = /^tests\/[^/]+-integration\.test\.ts$/
const SERVICES_IMPORT = /from '.*services\//
const IMPORTS_RATE_LIMIT_DEPS = /import\s*\{[^}]*\brateLimitDeps\b[^}]*\}\s*from/

/** Counts measured from file texts: everything that is not a module export. */
export interface TreeFacts {
  endpoints: number
  endpointsWithGetDb: number
  endpointsImportingServices: number
  permissionFilesServer: number
  permissionFilesApi: number
  rateLimitDepsImporters: number
  integrationSuites: number
  /** `null` when the suites and the CI matrix name the same files; otherwise the matrix size. */
  integrationMatrixMismatch: number | null
  lines: Record<string, number>
  i18nViFallback: number
}

/** Counts read from the modules the application itself loads. */
export interface ModuleFacts {
  tables: number
  columns: number
  /** Disagreements `db:drift` reports; the counts are not published while there are any. */
  driftProblems: string[]
  i18nKeys: number
  i18nRows: number
  blocksByCategory: { section: number, content: number, layout: number }
  smallTalkEntries: number
}

export type DocsFacts = TreeFacts & ModuleFacts

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
    throw new Error(`docs-facts lists files with \`git ls-files\` so untracked files never count, and it failed in ${root} (${detail}).`)
  }
  return output.split('\0').filter(Boolean).sort()
}

/** `wc -l`: the number of newline characters. */
export const lineCount = (text: string): number => text.split('\n').length - 1

/** Matrix entries' `file` values of the `integration-tests` job, or [] when there is none. */
export function integrationMatrixFiles(ciYaml: string): string[] {
  const ci = yaml.load(ciYaml) as {
    jobs?: Record<string, { strategy?: { matrix?: { include?: Array<{ file?: unknown }> } } }>
  } | null
  const include = ci?.jobs?.['integration-tests']?.strategy?.matrix?.include ?? []
  return include.map(entry => entry.file).filter((file): file is string => typeof file === 'string')
}

/**
 * Keys of `baseDictionary.vi` in the dictionary's source text. `hardcodedDictionary` spreads
 * `baseDictionary` and `extraDictionaries`, whose type only allows zh/fr/ru/lo, so these are
 * all the Vietnamese fallbacks. Throws on a shape it cannot count (a spread, a computed key)
 * rather than publish a wrong number.
 */
export function viFallbackKeyCount(source: string): number {
  const file = ts.createSourceFile(I18N_DICTIONARY, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let vi: ts.ObjectLiteralExpression | undefined
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'baseDictionary'
      && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      for (const property of node.initializer.properties) {
        if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === 'vi'
          && ts.isObjectLiteralExpression(property.initializer)) vi = property.initializer
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  if (!vi) throw new Error(`docs-facts: no \`baseDictionary = { vi: { … } }\` object literal in ${I18N_DICTIONARY}.`)
  const countable = vi.properties.filter(property => ts.isPropertyAssignment(property)
    && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)))
  if (countable.length !== vi.properties.length) {
    throw new Error(`docs-facts: baseDictionary.vi in ${I18N_DICTIONARY} has a spread or computed key; its keys cannot be counted from the text.`)
  }
  return new Set(countable.map(property => (property.name as ts.Identifier | ts.StringLiteral).text)).size
}

/**
 * Pure over its inputs: `files` is the tracked-file list and `read` returns a file's text,
 * or `null` when a tracked file is missing from the working tree (it then counts as gone).
 */
export function measureTree(files: readonly string[], read: (file: string) => string | null): TreeFacts {
  const texts = new Map<string, string>()
  for (const file of files) {
    const text = read(file)
    if (text !== null) texts.set(file, text)
  }
  const present = [...texts.keys()]
  const containing = (prefix: string, test: (text: string) => boolean) =>
    present.filter(file => file.startsWith(prefix) && test(texts.get(file)!)).length

  const endpoints = present.filter(file => file.startsWith('server/api/') && file.endsWith('.ts'))
  const endpointsMatching = (test: (text: string) => boolean) => endpoints.filter(file => test(texts.get(file)!)).length
  const names = (text: string) => text.includes('requireResourcePermission')

  const suites = present.filter(file => INTEGRATION_SUITE.test(file))
  const ciYaml = texts.get(CI_WORKFLOW)
  const matrix = ciYaml === undefined ? [] : integrationMatrixFiles(ciYaml)
  const sameFiles = matrix.length === suites.length && new Set(matrix).size === suites.length
    && matrix.every(file => suites.includes(file))

  const lines: Record<string, number> = {}
  for (const { file } of LINE_COUNTED) {
    const text = texts.get(file)
    if (text === undefined) throw new Error(`docs-facts counts the lines of ${file}, which is not a tracked file any more — update LINE_COUNTED and the prose that names it.`)
    lines[file] = lineCount(text)
  }
  const dictionary = texts.get(I18N_DICTIONARY)
  if (dictionary === undefined) throw new Error(`docs-facts counts the Vietnamese fallback keys of ${I18N_DICTIONARY}, which is not a tracked file any more.`)

  return {
    endpoints: endpoints.length,
    endpointsWithGetDb: endpointsMatching(text => text.includes('getDb()')),
    endpointsImportingServices: endpointsMatching(text => SERVICES_IMPORT.test(text)),
    permissionFilesServer: containing('server/', names),
    permissionFilesApi: containing('server/api/', names),
    rateLimitDepsImporters: present.filter(file => file.startsWith('server/') && file.endsWith('.ts')
      && IMPORTS_RATE_LIMIT_DEPS.test(texts.get(file)!)).length,
    integrationSuites: suites.length,
    integrationMatrixMismatch: sameFiles ? null : matrix.length,
    lines,
    i18nViFallback: viFallbackKeyCount(dictionary),
  }
}

/** The counts that come from the application's own modules (schema, seeds, registry). */
export function measureModules(): ModuleFacts {
  const declared = tablesFromSchema(schema as Record<string, unknown>, new Set<string>())
  const { problems } = compareSchemas(declared, tablesFromDdl(readDdlSource()))
  const blocksByCategory = { section: 0, content: 0, layout: 0 }
  for (const definition of Object.values(BLOCK_REGISTRY)) blocksByCategory[definition.category]++
  return {
    tables: declared.size,
    columns: [...declared.values()].reduce((sum, table) => sum + table.columns.size, 0),
    driftProblems: problems,
    i18nKeys: new Set(DEFAULT_TRANSLATIONS_SEED.map(row => row.key)).size,
    i18nRows: DEFAULT_TRANSLATIONS_SEED.length,
    blocksByCategory,
    smallTalkEntries: CHATBOT_SMALL_TALK_SEED.length,
  }
}

/** Every fact for the checkout at `root` (the working tree of tracked files). */
export function computeFacts(root: string = REPO_ROOT): DocsFacts {
  const read = (file: string) => {
    const absolute = path.join(root, file)
    return existsSync(absolute) ? readFileSync(absolute, 'utf8') : null
  }
  return { ...measureTree(trackedFiles(root), read), ...measureModules() }
}

/** The block, markers included, exactly as it must appear in CLAUDE.md. */
export function renderFactsBlock(facts: DocsFacts): string {
  const join = (...values: Array<number | string>) => values.join(' · ')
  const suites = facts.integrationMatrixMismatch === null
    ? `${facts.integrationSuites} (khớp)`
    : `${facts.integrationSuites} (matrix ${facts.integrationMatrixMismatch} — lệch)`
  const rows: Array<[string, string]> = [
    ['Bảng · cột (`db:drift`)', join(facts.tables, facts.columns)],
    ['Endpoint `server/api` · có `getDb()` · import `services/`', join(facts.endpoints, facts.endpointsWithGetDb, facts.endpointsImportingServices)],
    ['Tệp nhắc `requireResourcePermission`: `server/` · `server/api/`', join(facts.permissionFilesServer, facts.permissionFilesApi)],
    ['Tệp import `rateLimitDeps`', String(facts.rateLimitDepsImporters)],
    ['Suite `*-integration` (so matrix CI)', suites],
    [`Dòng ${LINE_COUNTED.map(({ label }) => `\`${label}\``).join(' · ')}`, join(...LINE_COUNTED.map(({ file }) => facts.lines[file]))],
    ['i18n seed: key · hàng · fallback `vi`', join(facts.i18nKeys, facts.i18nRows, facts.i18nViFallback)],
    ['Page Builder: section · content · layout', join(facts.blocksByCategory.section, facts.blocksByCategory.content, facts.blocksByCategory.layout)],
    ['Mục small talk mặc định', String(facts.smallTalkEntries)],
  ]
  return [
    START,
    `<!-- Sinh bởi \`${WRITE_COMMAND}\`, đừng sửa tay. -->`,
    '| Số liệu | Giá trị |',
    '|---|---|',
    ...rows.map(([label, value]) => `| ${label} | ${value} |`),
    END,
  ].join('\n')
}

/** Where the block sits in `doc`. Throws unless each marker appears exactly once, in order. */
function blockRange(doc: string): { from: number, to: number } {
  const count = (marker: string) => doc.split(marker).length - 1
  if (count(START) !== 1 || count(END) !== 1) {
    throw new Error(`${CLAUDE_MD} must contain \`${START}\` and \`${END}\` exactly once each (found ${count(START)} and ${count(END)}).`)
  }
  const from = doc.indexOf(START)
  const to = doc.indexOf(END) + END.length
  if (to < from) throw new Error(`${CLAUDE_MD}: \`${END}\` comes before \`${START}\`.`)
  return { from, to }
}

/** The block currently in `doc`, markers included. */
export function extractFactsBlock(doc: string): string {
  const { from, to } = blockRange(doc)
  return doc.slice(from, to)
}

/** `doc` with its block replaced by `block`; everything outside the markers is untouched. */
export function replaceFactsBlock(doc: string, block: string): string {
  const { from, to } = blockRange(doc)
  return doc.slice(0, from) + block + doc.slice(to)
}

/** Lines only in the current block (`- `) and only in the expected one (`+ `), in order. */
export function blockDiff(current: string, expected: string): string[] {
  const now = current.split('\n')
  const want = expected.split('\n')
  return [
    ...now.filter(line => !want.includes(line)).map(line => `- ${line}`),
    ...want.filter(line => !now.includes(line)).map(line => `+ ${line}`),
  ]
}

/** The CLI. Returns the exit code; prints through `log`/`error` so tests can drive it. */
export function run(
  argv: readonly string[],
  root: string = REPO_ROOT,
  log: (line: string) => void = console.log,
  error: (line: string) => void = console.error,
): number {
  const write = argv.includes('--write')
  const unknown = argv.filter(arg => arg !== '--write')
  if (unknown.length > 0) {
    error(`docs-facts: unknown argument ${unknown.join(' ')} (usage: scripts/docs-facts.ts [--write])`)
    return 2
  }
  const facts = computeFacts(root)
  const file = path.join(root, CLAUDE_MD)
  const doc = readFileSync(file, 'utf8')
  const current = extractFactsBlock(doc)
  const expected = renderFactsBlock(facts)

  if (write && facts.driftProblems.length > 0) {
    error(`docs-facts: db:drift reports ${facts.driftProblems.length} problem(s); the table and column counts would describe a schema the database does not have. Fix them first (npm run db:drift).`)
    return 1
  }
  if (current === expected) {
    log(`${CLAUDE_MD} facts block is up to date.`)
    return 0
  }
  const diff = blockDiff(current, expected)
  if (write) {
    writeFileSync(file, replaceFactsBlock(doc, expected))
    log(`${CLAUDE_MD} facts block regenerated:`)
    for (const line of diff) log(`  ${line}`)
    return 0
  }
  error(`${CLAUDE_MD} facts block is stale:`)
  for (const line of diff) error(`  ${line}`)
  error(`Regenerate it with: ${WRITE_COMMAND}`)
  return 1
}

if (import.meta.main) process.exitCode = run(process.argv.slice(2))
