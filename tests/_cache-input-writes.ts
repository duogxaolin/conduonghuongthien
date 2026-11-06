/**
 * AST helper behind `chatbot-answer-cache-invalidation.test.ts`: does the code reachable
 * from an admin handler WRITE a table whose content goes into a cached chatbot answer?
 *
 * Why an AST walk and not a regex on the handler file: the regex gate this replaces only
 * saw `.update(articles…)` written in the handler itself. `articles/bulk-status.post.ts`
 * (→ `setArticleStatus`), `articles/bulk-delete.post.ts` (→ `deleteArticleById`) and
 * `chatbot/small-talk/[id]/toggle.patch.ts` (→ `setSmallTalkEnabled`) write the same
 * tables through a service, never bumped the version, and the gate stayed green
 * (2026-11-06). Same walk as `_admin-authz-classifier.ts` (its `loadModule`): start at the
 * handler's `export default`, follow local functions it calls and functions imported from
 * `server/services/**` / `server/utils/**`, up to `MAX_HOPS`.
 *
 * A "write" is `<x>.insert|update|delete(<table>…)` with `<table>` one of
 * `CACHE_INPUT_TABLES`, a raw SQL string/template that starts an `INSERT INTO` /
 * `UPDATE` / `DELETE FROM` on the same tables, or such a statement whose table is a
 * template SUBSTITUTION that is not a plain identifier (`sql\`UPDATE ${target.table} …\``,
 * `media-repoint.ts`): the table is not knowable statically, so it counts as a write (recall
 * first). A plain identifier (`${backups}`, `${RATE_LIMIT_TABLE}`) names its table and counts
 * only when that is a cache-input binding — a local `const table = 'articles'` would be missed.
 * `bumpAnswerCacheVersion` itself is never followed — its `UPDATE chatbot_settings` is the
 * invalidation, not a data write, and counting it made every bumping handler a "writer"
 * whether or not it wrote anything (verifier 2026-11-06).
 * Limitation (stated, not hidden): reachable, not "runs on every path"; a function passed
 * by reference without being called (`ids.map(setArticleStatus)`) is not followed.
 */
import path from 'node:path'
import ts from 'typescript'
import { loadModule, rel } from './_admin-authz-classifier'

/** Drizzle table bindings whose rows a cached answer is built from (or keyed on). */
export const CACHE_INPUT_TABLES = new Set([
  'chatbotKnowledge',
  'chatbotKnowledgeTerms',
  'chatbotSmallTalk',
  'articles',
  'chatbotSettings',
  'aiProviders',
  'aiServiceConfigs',
  // Ảnh (`search_c11_photos`) và video (`search_c11_videos`): model chép URL của chúng vào câu trả lời.
  'media',
  'mediaItems',
])

/** SQL names of `CACHE_INPUT_TABLES` (raw statements name tables by their SQL name). */
const CACHE_INPUT_SQL_TABLES = ['chatbot_knowledge', 'chatbot_knowledge_terms', 'chatbot_small_talk', 'articles', 'ai_providers', 'ai_service_configs', 'media', 'media_items']
/** Câu ghi mà tên bảng là một biến (`UPDATE ${table}`, `` UPDATE `${table}` ``): không biết bảng ⇒ tính là ghi. */
const DYNAMIC_TABLE_WRITE = /\b(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+`?$/iu
const WRITE_METHODS = new Set(['insert', 'update', 'delete'])
const MAX_HOPS = 4

/** What a walk looks for: writes to these tables, or a call to one of these functions. */
export interface WalkTarget {
  /** Drizzle table bindings (`articles`, `aiModerationRules`). */
  tables?: ReadonlySet<string>
  /** SQL table names for raw statements (`articles`, `ai_moderation_rules`). */
  sqlTables?: readonly string[]
  /** Function names whose CALL is the thing looked for (`invalidateModerationRulesCache`). */
  calls?: ReadonlySet<string>
  /** Function names never followed (an invalidation call is not a data write). */
  skipCalls?: ReadonlySet<string>
  /**
   * Count SQL whose table is a non-identifier substitution (`UPDATE ${target.table}`) as a write. On for the
   * answer-cache gate (the URL rewriters `media-repoint`/`media-sync-rewrite` really do write its tables);
   * off by default — for any other table set it only reports those rewriters as noise.
   */
  dynamicTables?: boolean
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function matcher(target: WalkTarget) {
  const tables = target.tables ?? new Set<string>()
  const raw = target.sqlTables?.length
    ? new RegExp(`\\b(?:UPDATE|INSERT\\s+INTO|DELETE\\s+FROM)\\s+\`?(?:${target.sqlTables.map(escape).join('|')})\`?(?=[\\s(]|$)`, 'iu')
    : null
  return (node: ts.Node): boolean => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (target.calls && ts.isIdentifier(callee) && target.calls.has(callee.text)) return true
      if (target.calls && ts.isPropertyAccessExpression(callee) && target.calls.has(callee.name.text)) return true
      if (ts.isPropertyAccessExpression(callee) && WRITE_METHODS.has(callee.name.text)) {
        const [table] = node.arguments
        if (table && ts.isIdentifier(table) && tables.has(table.text)) return true
      }
    }
    if (!raw) return false
    if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isStringLiteral(node)) return raw.test(node.text)
    if (ts.isTemplateExpression(node)) {
      const text = node.head.text + node.templateSpans.map(span => ` ? ${span.literal.text}`).join('')
      if (raw.test(text)) return true
      // Bảng là phần thay ngay sau từ khoá ghi. Định danh trơn (`${backups}`, `${RATE_LIMIT_TABLE}`, `${table}` của
      // bộ dọn dữ liệu) là một bảng có tên: chỉ tính khi đó là bảng đang tìm. Biểu thức khác (`${target.table}`) thì
      // không biết bảng nào ⇒ tính là ghi.
      return node.templateSpans.some((span, index) => {
        const before = index === 0 ? node.head.text : node.templateSpans[index - 1]!.literal.text
        if (!DYNAMIC_TABLE_WRITE.test(before)) return false
        return ts.isIdentifier(span.expression) ? tables.has(span.expression.text) : target.dynamicTables === true
      })
    }
    return false
  }
}

type Module = NonNullable<ReturnType<typeof loadModule>>
type Matcher = ReturnType<typeof matcher>

function reaches(module: Module, root: ts.Node, hit: Matcher, target: WalkTarget, visited: Set<string>, hops: number): boolean {
  let found = false
  const pending: ts.Node[] = [root]
  const seenLocals = new Set<string>()
  while (pending.length && !found) {
    const node = pending.pop()!
    const visit = (child: ts.Node) => {
      if (found) return
      if (hit(child)) { found = true; return }
      if (ts.isCallExpression(child)) {
        const callee = child.expression
        const name = ts.isIdentifier(callee) ? callee.text : null
        if (name && target.skipCalls?.has(name)) return
        const object = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) ? callee.expression.text : null
        if (name) {
          const local = module.locals.get(name)
          if (local && !seenLocals.has(name)) { seenLocals.add(name); pending.push(local) }
        }
        if (hops < MAX_HOPS) {
          const binding = object ? module.imports.get(object) : name ? module.imports.get(name) : undefined
          const importedName = object
            ? (binding?.name === '*' && ts.isPropertyAccessExpression(callee) ? callee.name.text : null)
            : binding?.name
          if (binding && importedName && importedReaches(binding.module, importedName, hit, target, visited, hops + 1)) { found = true; return }
        }
      }
      ts.forEachChild(child, visit)
    }
    visit(node)
  }
  return found
}

function importedReaches(modulePath: string, name: string, hit: Matcher, target: WalkTarget, visited: Set<string>, hops: number): boolean {
  if (!/^server\/(services|utils)\//.test(rel(modulePath))) return false
  const key = `${modulePath}#${name}`
  if (visited.has(key)) return false
  visited.add(key)
  const module = loadModule(modulePath)
  if (!module) return false
  const exported = module.exports.get(name)
  if (!exported) return false
  if ('from' in exported) return importedReaches(exported.from, exported.name, hit, target, visited, hops)
  return reaches(module, exported, hit, target, visited, hops)
}

/** Does the code reachable from the handler at `file` (absolute, or repo-relative) match `target`? */
export function handlerReaches(file: string, target: WalkTarget): boolean {
  const absolute = path.isAbsolute(file) ? file : path.resolve(import.meta.dirname, '..', file)
  const module = loadModule(absolute)
  if (!module) return false
  return reaches(module, module.defaultExport ?? module.sourceFile, matcher(target), target, new Set(), 0)
}

const CACHE_INPUT_TARGET: WalkTarget = {
  tables: CACHE_INPUT_TABLES,
  sqlTables: CACHE_INPUT_SQL_TABLES,
  dynamicTables: true,
  // Chính lời gọi tăng phiên bản — không phải lượt ghi dữ liệu nền.
  skipCalls: new Set(['bumpAnswerCacheVersion']),
}

/** Does the handler at `file` (absolute, or relative to the repo root) reach a write on a cache-input table? */
export function handlerWritesCacheInput(file: string): boolean {
  return handlerReaches(file, CACHE_INPUT_TARGET)
}
