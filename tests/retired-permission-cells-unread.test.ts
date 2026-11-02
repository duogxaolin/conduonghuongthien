import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

/**
 * The retired permission cells are read by NO gate (CHANGELOG § 66, verifier finding W1).
 *
 * `assertAssignablePermissions` and `assertRoleWithinActor` skip the retired cells
 * (`RETIRED_PERMISSION_RESOURCES` = `home_sections`, `RETIRED_PERMISSION_FLAGS` = `canTest`,
 * shared/permissions.ts): the role editor no longer shows them and nobody can obtain them, so
 * counting them would lock delegated managers out of the seeded `editor`. That skip is safe
 * ONLY while no handler, page or helper decides anything on those cells. The day one does —
 * a route gated on `home_sections`, a `canTest` read, the chatbot `'test'` action back — a
 * delegated `roles.update` holder could grant that cell without holding it. This file makes
 * that day red, so the cell is taken out of `RETIRED_PERMISSION_*` in the same change
 * (docs/decisions/realm-safety.md § "Ô quyền đã ngừng", "Hồi sinh một ô").
 *
 * What is scanned: the TypeScript AST of every `.ts`/`.mjs` file and every `.vue` script block
 * and template under server/, app/, shared/, scripts/ (tests/ excluded: they name the cells on
 * purpose). Comments are not code and are not read. An object KEY such as the activity-log
 * label `home_sections: 'Khối trang chủ'` (app/pages/admin/users/activity.vue) is an
 * identifier, not a string, and decides nothing — it is not flagged.
 *
 * Prototype by the independent verifier of wave3/roles-ui (7/7 mutants L01–L07 red); adopted
 * as is, minus a per-file allowance that turned out unnecessary.
 */
const ROOT = path.resolve(import.meta.dirname, '..')
const { RETIRED_PERMISSION_RESOURCES, RETIRED_PERMISSION_FLAGS, PERMISSION_RESOURCES, PERMISSION_ACTIONS } = await import('../shared/permissions')

/** Files allowed to NAME a retired cell: the catalog itself, and storage (DDL, schema, seed). */
const ALLOWED = new Set([
  'shared/permissions.ts',
  'server/db/schema.ts',
  'server/db/schema-tables/core.ts',
  'server/db/migrations-additive.ts',
  'server/db/seed.ts',
])
/** Every function that decides on a permission (resource string + action string). */
const GATES = new Set([
  'requireResourcePermission', 'checkPermission', 'hasPermission',
  'requireChatbotSettingsPermission', 'requireChatbotKnowledgePermission', 'requireChatbotSmallTalkPermission',
])
/** `canTest` under each of its spellings: the flag, the DB column, the action. */
const retiredFlagNames = new Set<string>([...RETIRED_PERMISSION_FLAGS].flatMap((flag) => {
  const action = PERMISSION_ACTIONS.find(a => a.flag === flag)!.action
  const column = flag.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`) // canTest → can_test
  return [flag, column, action]
}))

const REVIVE = 'Một ô quyền đã ngừng lại được đọc: gỡ nó khỏi RETIRED_PERMISSION_RESOURCES / RETIRED_PERMISSION_FLAGS '
  + '(shared/permissions.ts) trong cùng thay đổi — sau khi quyết với các giá trị đã lưu lúc ô bị ẩn '
  + '(docs/decisions/realm-safety.md § "Ô quyền đã ngừng", mục "Hồi sinh một ô"). Nếu vẫn để trong RETIRED_*, '
  + 'người có roles.update cấp được ô đó mà không cần giữ nó.'

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|vue|mjs)$/.test(name)) out.push(full)
  }
  return out
}

/** Script code of a file (SFC: every <script> block, and the template with its expressions kept as text). */
function sources(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  if (!file.endsWith('.vue')) return [text]
  const scripts = [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]!)
  const template = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '')
  return [...scripts, template]
}

function violations(file: string): string[] {
  const rel = path.relative(ROOT, file).split(path.sep).join('/')
  const found: string[] = []
  for (const code of sources(file)) {
    const sf = ts.createSourceFile(rel, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const visit = (node: ts.Node) => {
      // (1) a gate called with a retired resource, or with the retired action ('test')
      if (ts.isCallExpression(node)) {
        const callee = ts.isIdentifier(node.expression) ? node.expression.text
          : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : ''
        if (GATES.has(callee)) {
          for (const arg of node.arguments) {
            if (ts.isStringLiteralLike(arg) && (RETIRED_PERMISSION_RESOURCES.has(arg.text) || retiredFlagNames.has(arg.text))) {
              found.push(`${rel}: ${callee}(…'${arg.text}'…)`)
            }
          }
        }
      }
      if (!ALLOWED.has(rel)) {
        // (2) the retired flag read anywhere outside storage: x.canTest, x['canTest'], 'can_test'
        if (ts.isPropertyAccessExpression(node) && retiredFlagNames.has(node.name.text) && node.name.text !== 'test') found.push(`${rel}: .${node.name.text}`)
        if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && retiredFlagNames.has(node.argumentExpression.text)) found.push(`${rel}: ['${node.argumentExpression.text}']`)
        if ((ts.isStringLiteralLike(node) || ts.isIdentifier(node)) && /^(canTest|can_test)$/.test(node.text)) found.push(`${rel}: ${node.text}`)
        // (3) a retired resource named as a string anywhere a decision could read it
        if (ts.isStringLiteralLike(node) && RETIRED_PERMISSION_RESOURCES.has(node.text)) found.push(`${rel}: '${node.text}'`)
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return found
}

test('retired cells are catalog-only: every retired name is still in the stored catalog', () => {
  for (const resource of RETIRED_PERMISSION_RESOURCES) assert.ok(PERMISSION_RESOURCES.some(r => r.key === resource), resource)
  for (const flag of RETIRED_PERMISSION_FLAGS) assert.ok(PERMISSION_ACTIONS.some(a => a.flag === flag), flag)
})

test('no permission gate in server/, app/, shared/, scripts/ reads a retired cell', () => {
  const files = ['server', 'app', 'shared', 'scripts'].flatMap(dir => walk(path.join(ROOT, dir)))
  assert.ok(files.length > 500, `walked ${files.length} files`)
  assert.deepEqual(files.flatMap(violations), [], REVIVE)
})

test('dynamic resources resolve only to live resources', async () => {
  const { articleResource } = await import('../server/services/articles')
  for (const type of ['news', 'role_model', 'reintegration', 'document', 'faq', '', 'home_sections', '__proto__']) {
    assert.ok(!RETIRED_PERMISSION_RESOURCES.has(articleResource(type)), `${type}: ${REVIVE}`)
  }
})
