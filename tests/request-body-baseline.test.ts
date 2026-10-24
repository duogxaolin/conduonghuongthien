import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import ts from 'typescript'

/**
 * Baseline guard for request bodies (wave2 5.2, design D5, spec request-validation:
 * "the number of legacy endpoints that read bodies without the shared reader
 * SHALL NOT increase").
 *
 * A body read straight from h3 — `readBody(event).catch(() => ({}))`, `.catch(() =>
 * null)`, any other `.catch(…)`, or `readBody(…)` with no catch at all — is the
 * LEGACY form. New code reads through `server/utils/request-body.ts`
 * (`readJsonBody`, `readValidated`, `readValidatedQuery`): malformed JSON is a 400
 * instead of `{}`, and zod's issue list never reaches the client (h3's own
 * `readValidatedBody` sends it in `data`, so that counts as legacy too).
 *
 * `LEGACY_BODY_READERS` is every file that read a body the legacy way when the
 * guard was written: 139 call sites in 139 files (TypeScript parser, wave1
 * integration tip 2516422), 138 after `admin/backup/run.post.ts` moved to
 * `readValidated` in the same change. The design's "133" was `grep 'readBody('`,
 * which misses the six generic calls `readBody<{ type?: string }>(event)`.
 *
 * Ratchet:
 *  - a file NOT in the list with a legacy read fails — use the shared reader;
 *  - a listed file with a SECOND legacy read fails (each had exactly one);
 *  - a listed file with none left (migrated or deleted) passes, and the test
 *    prints that its entry can be removed. Removing an entry is always allowed;
 *    adding one never is.
 *
 * Scope is all of `server/` (a handler under `server/routes/` or a middleware reads
 * a body the same way), except the shared reader itself. Calls are found with the
 * TypeScript parser — a comment or a string mentioning `readBody(event)` is not a
 * call — and found under every name: the Nitro auto-import (no import line, as in
 * `settings/navigation/navbar.put.ts`), `import { readBody as x }`, `h3.readBody`.
 */

const REPO = resolve(new URL('..', import.meta.url).pathname)
const SHARED_READER = 'server/utils/request-body.ts'
const H3_BODY_READERS = new Set(['readBody', 'readValidatedBody'])

const LEGACY_BODY_READERS: readonly string[] = [
  'server/api/admin/ai/budget/index.put.ts',
  'server/api/admin/ai/editorial.post.ts',
  'server/api/admin/ai/moderation/queue/[id]/resolve.post.ts',
  'server/api/admin/ai/moderation/rules.post.ts',
  'server/api/admin/ai/moderation/rules/[id].put.ts',
  'server/api/admin/ai/moderation/settings.put.ts',
  'server/api/admin/ai/pricing/[model].put.ts',
  'server/api/admin/ai/pricing/bulk-delete.post.ts',
  'server/api/admin/ai/pricing/index.post.ts',
  'server/api/admin/ai/providers/[id].put.ts',
  'server/api/admin/ai/providers/bulk-delete.post.ts',
  'server/api/admin/ai/providers/index.post.ts',
  'server/api/admin/ai/services/[id].put.ts',
  'server/api/admin/ai/test-call.post.ts',
  'server/api/admin/ai/translate-ui.post.ts',
  'server/api/admin/ai/translate.post.ts',
  'server/api/admin/articles/[id].put.ts',
  'server/api/admin/articles/[id]/boost.post.ts',
  'server/api/admin/articles/[id]/translations/[lang].put.ts',
  'server/api/admin/articles/[id]/translations/[lang]/status.patch.ts',
  'server/api/admin/articles/[id]/translations/translate-all.post.ts',
  'server/api/admin/articles/[id]/translations/translate.post.ts',
  'server/api/admin/articles/bulk-comments.post.ts',
  'server/api/admin/articles/bulk-delete.post.ts',
  'server/api/admin/articles/bulk-publish-translations.post.ts',
  'server/api/admin/articles/bulk-status.post.ts',
  'server/api/admin/articles/bulk-translate.post.ts',
  'server/api/admin/articles/export-google.post.ts',
  'server/api/admin/articles/index.post.ts',
  'server/api/admin/articles/scan-thumbnails.post.ts',
  'server/api/admin/auth/login.post.ts',
  'server/api/admin/auth/mfa/verify.post.ts',
  'server/api/admin/backup/drive/config.put.ts',
  'server/api/admin/backup/restore.post.ts',
  'server/api/admin/cache-clear.post.ts',
  'server/api/admin/categories/[id].put.ts',
  'server/api/admin/categories/bulk-delete.post.ts',
  'server/api/admin/categories/index.post.ts',
  'server/api/admin/chatbot/knowledge/[id].put.ts',
  'server/api/admin/chatbot/knowledge/bulk-delete.post.ts',
  'server/api/admin/chatbot/knowledge/bulk-quick-question.post.ts',
  'server/api/admin/chatbot/knowledge/bulk-status.post.ts',
  'server/api/admin/chatbot/knowledge/index.post.ts',
  'server/api/admin/chatbot/sessions/bulk-delete.post.ts',
  'server/api/admin/chatbot/settings/index.patch.ts',
  'server/api/admin/chatbot/small-talk/[id].put.ts',
  'server/api/admin/chatbot/small-talk/bulk-delete.post.ts',
  'server/api/admin/chatbot/small-talk/bulk-enabled.post.ts',
  'server/api/admin/chatbot/small-talk/index.post.ts',
  'server/api/admin/comments/[id]/visibility.patch.ts',
  'server/api/admin/comments/ai-moderate.post.ts',
  'server/api/admin/comments/reply.post.ts',
  'server/api/admin/content-types/[id].put.ts',
  'server/api/admin/content-types/bulk-delete.post.ts',
  'server/api/admin/content-types/index.post.ts',
  'server/api/admin/home-sections/[id].put.ts',
  'server/api/admin/home-sections/reorder.put.ts',
  'server/api/admin/ip-bans/index.post.ts',
  'server/api/admin/languages/[code].put.ts',
  'server/api/admin/languages/[code]/translations/index.put.ts',
  'server/api/admin/languages/ai-translate-chunk.post.ts',
  'server/api/admin/languages/ai-translate-key.post.ts',
  'server/api/admin/languages/ai-translate.post.ts',
  'server/api/admin/languages/index.post.ts',
  'server/api/admin/languages/reorder.post.ts',
  'server/api/admin/livestream/start.post.ts',
  'server/api/admin/livestream/stop.post.ts',
  'server/api/admin/media-portal/[id].put.ts',
  'server/api/admin/media-portal/[id]/process.post.ts',
  'server/api/admin/media-portal/[id]/thumbnail.post.ts',
  'server/api/admin/media-portal/categories/[id].put.ts',
  'server/api/admin/media-portal/categories/index.post.ts',
  'server/api/admin/media-portal/external.post.ts',
  'server/api/admin/media-portal/upload/[id]/complete.post.ts',
  'server/api/admin/media-portal/upload/housekeep.post.ts',
  'server/api/admin/media-portal/upload/init.post.ts',
  'server/api/admin/media-portal/youtube-meta.post.ts',
  'server/api/admin/media/bulk-delete.post.ts',
  'server/api/admin/media/repoint-r2-urls.post.ts',
  'server/api/admin/media/scan.post.ts',
  'server/api/admin/media/self-heal.post.ts',
  'server/api/admin/media/sync-storage.post.ts',
  'server/api/admin/pages/[id].put.ts',
  'server/api/admin/pages/[id]/blocks/[blockId].put.ts',
  'server/api/admin/pages/[id]/blocks/index.post.ts',
  'server/api/admin/pages/[id]/blocks/reorder.put.ts',
  'server/api/admin/pages/[id]/draft.put.ts',
  'server/api/admin/pages/[id]/publish.post.ts',
  'server/api/admin/pages/[id]/versions/index.post.ts',
  'server/api/admin/pages/bulk-delete.post.ts',
  'server/api/admin/pages/index.post.ts',
  'server/api/admin/profile/mfa/confirm.post.ts',
  'server/api/admin/profile/mfa/disable.post.ts',
  'server/api/admin/profile/mfa/enroll.post.ts',
  'server/api/admin/profile/mfa/recovery-codes.delete.ts',
  'server/api/admin/profile/mfa/recovery-codes.post.ts',
  'server/api/admin/profile/password.put.ts',
  'server/api/admin/readers/[id]/ban.post.ts',
  'server/api/admin/roles/[id].put.ts',
  'server/api/admin/roles/index.post.ts',
  'server/api/admin/settings/backup.put.ts',
  'server/api/admin/settings/google-oauth/index.patch.ts',
  'server/api/admin/settings/index.put.ts',
  'server/api/admin/settings/layout.put.ts',
  'server/api/admin/settings/media-portal.put.ts',
  'server/api/admin/settings/navigation.put.ts',
  'server/api/admin/settings/navigation/mobile.put.ts',
  'server/api/admin/settings/navigation/navbar.put.ts',
  'server/api/admin/settings/retention-run.post.ts',
  'server/api/admin/settings/retention.put.ts',
  'server/api/admin/settings/sitemap/index.put.ts',
  'server/api/admin/settings/test-email.post.ts',
  'server/api/admin/settings/test-r2.post.ts',
  'server/api/admin/social-links/[id].put.ts',
  'server/api/admin/social-links/index.post.ts',
  'server/api/admin/social-links/reorder.post.ts',
  'server/api/admin/submissions/[id]/contact.post.ts',
  'server/api/admin/submissions/[id]/notes.post.ts',
  'server/api/admin/submissions/[id]/status.put.ts',
  'server/api/admin/submissions/bulk-delete.post.ts',
  'server/api/admin/submissions/bulk-status.post.ts',
  'server/api/admin/system/universal-translate.post.ts',
  'server/api/admin/users/[id].put.ts',
  'server/api/admin/users/bulk-active.post.ts',
  'server/api/admin/users/bulk-delete.post.ts',
  'server/api/admin/users/index.post.ts',
  'server/api/chat.post.ts',
  'server/api/public/articles/[slug]/view.post.ts',
  'server/api/public/chatbot/index.post.ts',
  'server/api/public/chatbot/lead.post.ts',
  'server/api/public/comments/index.post.ts',
  'server/api/public/livestream/chat/send.post.ts',
  'server/api/public/media/[shortId]/view.post.ts',
  'server/api/public/reader/claim-chats.post.ts',
  'server/api/public/reader/notifications/read.post.ts',
  'server/api/public/reader/profile.put.ts',
  'server/api/public/reader/profile/email-notifications.put.ts',
  'server/api/submissions.post.ts',
]

type LegacyForm = 'catch(() => ({}))' | 'catch(() => null)' | 'catch(other)' | 'uncaught' | 'h3 readValidatedBody'
type LegacyRead = { line: number, form: LegacyForm }

function isEmptyObjectArrow(node: ts.Expression): boolean {
  if (!ts.isArrowFunction(node)) return false
  let body: ts.Node = node.body
  while (ts.isParenthesizedExpression(body)) body = body.expression
  return ts.isObjectLiteralExpression(body) && body.properties.length === 0
}

function isNullArrow(node: ts.Expression): boolean {
  if (!ts.isArrowFunction(node)) return false
  let body: ts.Node = node.body
  while (ts.isParenthesizedExpression(body)) body = body.expression
  return body.kind === ts.SyntaxKind.NullKeyword
}

/** Every legacy body read in one file. */
function scanSource(fileName: string, source: string): LegacyRead[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  // Local name → h3 export name. Nitro auto-imports both names with no import line.
  const bound = new Map<string, string>([...H3_BODY_READERS].map(name => [name, name]))
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    const bindings = statement.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    for (const element of bindings.elements) {
      const exported = (element.propertyName ?? element.name).text
      const local = element.name.text
      if (H3_BODY_READERS.has(exported)) bound.set(local, exported)
      else bound.delete(local) // that local name is something else in this file
    }
  }

  const reads: LegacyRead[] = []
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      // `readBody(…)` / an alias, or `<anything>.readBody(…)` (`import * as h3`).
      const exported = ts.isIdentifier(callee)
        ? bound.get(callee.text)
        : ts.isPropertyAccessExpression(callee) && H3_BODY_READERS.has(callee.name.text) ? callee.name.text : undefined
      if (exported) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
        let form: LegacyForm = exported === 'readValidatedBody' ? 'h3 readValidatedBody' : 'uncaught'
        const parent = node.parent
        if (form === 'uncaught' && ts.isPropertyAccessExpression(parent) && parent.expression === node
          && parent.name.text === 'catch' && ts.isCallExpression(parent.parent) && parent.parent.expression === parent) {
          const handler = parent.parent.arguments[0]
          form = handler && isEmptyObjectArrow(handler) ? 'catch(() => ({}))'
            : handler && isNullArrow(handler) ? 'catch(() => null)'
              : 'catch(other)'
        }
        reads.push({ line, form })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return reads
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (/\.(?:m?ts|m?js)$/.test(name)) out.push(path)
  }
  return out
}

/** Repo-relative path → its legacy body reads, for every file under `<root>/server`. */
function scan(root: string): Map<string, LegacyRead[]> {
  const found = new Map<string, LegacyRead[]>()
  for (const file of sourceFiles(join(root, 'server'))) {
    const rel = relative(root, file).split(sep).join('/')
    if (rel === SHARED_READER) continue
    const reads = scanSource(file, readFileSync(file, 'utf8'))
    if (reads.length) found.set(rel, reads)
  }
  return found
}

function compare(found: Map<string, LegacyRead[]>, baseline: readonly string[]) {
  const listed = new Set(baseline)
  const describe = (file: string, reads: LegacyRead[]) =>
    `${file} — ${reads.map(read => `line ${read.line}: ${read.form}`).join('; ')}`
  const added: string[] = []
  const grown: string[] = []
  for (const [file, reads] of found) {
    if (!listed.has(file)) added.push(describe(file, reads))
    else if (reads.length > 1) grown.push(describe(file, reads))
  }
  const shrinkable = baseline.filter(file => !found.has(file))
  return { added, grown, shrinkable }
}

const HOW_TO = 'Read the body with readJsonBody / readValidated (and the query with readValidatedQuery) from server/utils/request-body.ts.'

test('no file outside the baseline reads a request body the legacy way, and no listed file gained a second one', (t) => {
  const { added, grown, shrinkable } = compare(scan(REPO), LEGACY_BODY_READERS)
  for (const file of shrinkable) t.diagnostic(`baseline can shrink: ${file} no longer reads a body the legacy way — remove it from LEGACY_BODY_READERS`)
  assert.deepEqual(added, [], `New legacy body reads (the baseline only shrinks). ${HOW_TO}`)
  assert.deepEqual(grown, [], `A listed file gained a second legacy body read. ${HOW_TO}`)
})

test('the baseline is sorted, has no duplicates, and never grew past the 138 files it was cut to', () => {
  assert.deepEqual([...LEGACY_BODY_READERS], [...new Set(LEGACY_BODY_READERS)].sort(), 'keep LEGACY_BODY_READERS sorted and unique')
  assert.ok(LEGACY_BODY_READERS.length <= 138, 'entries are only ever removed')
})

// ─── The scanner bites ──────────────────────────────────────────────────────────

const roots: string[] = []
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'request-body-baseline-'))
  roots.push(root)
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), source)
  }
  return root
}

const EVERY_LEGACY_FORM = `
import { readBody as rb } from 'h3'
import * as h3 from 'h3'
export default defineEventHandler(async (event) => {
  const a = await readBody(event).catch(() => ({}))
  const b = await readBody(event).catch(() => null)
  const c = await readBody<{ ids?: number[] }>(event).catch(() => ({ ids: [] }))
  const d = await readBody<{ type?: string }>(event)
  const e = await rb(event)
  const f = await h3.readBody(event)
  const g = await readValidatedBody(event, (x: unknown) => x)
  return { a, b, c, d, e, f, g }
})
`

const SHARED_READER_USE = `
import { readJsonBody, readValidated, readValidatedQuery } from '../utils/request-body'
// await readBody(event).catch(() => ({})) — a comment is not a call
const note = 'await readBody(event)'
export default defineEventHandler(async (event) => {
  const body = await readJsonBody(event)
  const input = await readValidated(event, schema)
  const query = await readValidatedQuery(event, schema)
  return { body, input, query, note }
})
`

test('the scanner finds every legacy form under every name, and nothing in a file using the shared reader', () => {
  const root = fixture({
    'server/api/new.post.ts': EVERY_LEGACY_FORM,
    'server/routes/hook.post.ts': 'export default defineEventHandler(async event => readBody(event))\n',
    'server/api/clean.post.ts': SHARED_READER_USE,
    [SHARED_READER]: `import { readBody } from 'h3'\nexport const readJsonBody = (event: unknown) => readBody(event as never, { strict: true })\n`,
  })
  const found = scan(root)
  assert.deepEqual([...found.keys()].sort(), ['server/api/new.post.ts', 'server/routes/hook.post.ts'])
  assert.deepEqual(found.get('server/api/new.post.ts')!.map(read => read.form), [
    'catch(() => ({}))',
    'catch(() => null)',
    'catch(other)',
    'uncaught',
    'uncaught',
    'uncaught',
    'h3 readValidatedBody',
  ])
  assert.deepEqual(found.get('server/routes/hook.post.ts')!.map(read => read.form), ['uncaught'])
})

test('the ratchet: a new file fails, a second read in a listed file fails, a migrated file passes and is reported', () => {
  const root = fixture({
    'server/api/legacy-a.post.ts': 'export default defineEventHandler(async event => readBody(event).catch(() => ({})))\n',
    'server/api/legacy-b.post.ts': 'export default defineEventHandler(async (event) => { await readBody(event).catch(() => null); return readBody(event) })\n',
    'server/api/legacy-c.post.ts': SHARED_READER_USE,
    'server/api/brand-new.post.ts': 'export default defineEventHandler(async event => readBody(event).catch(() => ({})))\n',
  })
  const baseline = ['server/api/legacy-a.post.ts', 'server/api/legacy-b.post.ts', 'server/api/legacy-c.post.ts']
  const { added, grown, shrinkable } = compare(scan(root), baseline)
  assert.deepEqual(added, ['server/api/brand-new.post.ts — line 1: catch(() => ({}))'])
  assert.deepEqual(grown, ['server/api/legacy-b.post.ts — line 1: catch(() => null); line 1: uncaught'])
  assert.deepEqual(shrinkable, ['server/api/legacy-c.post.ts'])
})
