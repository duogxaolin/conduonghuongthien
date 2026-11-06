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

const RAW_SQL_WRITE = /\b(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+`?(?:chatbot_knowledge|chatbot_knowledge_terms|chatbot_small_talk|articles|ai_providers|ai_service_configs|media|media_items)`?(?=[\s(]|$)/iu
/** Câu ghi mà tên bảng là một biến (`UPDATE ${table}`, `` UPDATE `${table}` ``): không biết bảng ⇒ tính là ghi. */
const DYNAMIC_TABLE_WRITE = /\b(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+`?$/iu
/** Chính lời gọi tăng phiên bản — không phải lượt ghi dữ liệu nền. */
const INVALIDATION_CALLS = new Set(['bumpAnswerCacheVersion'])
const WRITE_METHODS = new Set(['insert', 'update', 'delete'])
const MAX_HOPS = 4

function writesHere(node: ts.Node): boolean {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && WRITE_METHODS.has(node.expression.name.text)) {
    const [table] = node.arguments
    if (table && ts.isIdentifier(table) && CACHE_INPUT_TABLES.has(table.text)) return true
  }
  if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isStringLiteral(node)) return RAW_SQL_WRITE.test(node.text)
  if (ts.isTemplateExpression(node)) {
    const text = node.head.text + node.templateSpans.map(span => ` ? ${span.literal.text}`).join('')
    if (RAW_SQL_WRITE.test(text)) return true
    // Bảng là phần thay ngay sau từ khoá ghi. Định danh trơn (`${backups}`, `${RATE_LIMIT_TABLE}`, `${table}` của
    // bộ dọn dữ liệu) là một bảng có tên: chỉ tính khi đó là bảng nguồn. Biểu thức khác (`${target.table}`) thì
    // không biết bảng nào ⇒ tính là ghi.
    return node.templateSpans.some((span, index) => {
      const before = index === 0 ? node.head.text : node.templateSpans[index - 1]!.literal.text
      if (!DYNAMIC_TABLE_WRITE.test(before)) return false
      return ts.isIdentifier(span.expression) ? CACHE_INPUT_TABLES.has(span.expression.text) : true
    })
  }
  return false
}

type Module = NonNullable<ReturnType<typeof loadModule>>

function reachesWrite(module: Module, root: ts.Node, visited: Set<string>, hops: number): boolean {
  let found = false
  const pending: ts.Node[] = [root]
  const seenLocals = new Set<string>()
  while (pending.length && !found) {
    const node = pending.pop()!
    const visit = (child: ts.Node) => {
      if (found) return
      if (writesHere(child)) { found = true; return }
      if (ts.isCallExpression(child)) {
        const callee = child.expression
        const name = ts.isIdentifier(callee) ? callee.text : null
        if (name && INVALIDATION_CALLS.has(name)) return
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
          if (binding && importedName && importedWrites(binding.module, importedName, visited, hops + 1)) { found = true; return }
        }
      }
      ts.forEachChild(child, visit)
    }
    visit(node)
  }
  return found
}

function importedWrites(modulePath: string, name: string, visited: Set<string>, hops: number): boolean {
  if (!/^server\/(services|utils)\//.test(rel(modulePath))) return false
  const key = `${modulePath}#${name}`
  if (visited.has(key)) return false
  visited.add(key)
  const module = loadModule(modulePath)
  if (!module) return false
  const target = module.exports.get(name)
  if (!target) return false
  if ('from' in target) return importedWrites(target.from, target.name, visited, hops)
  return reachesWrite(module, target, visited, hops)
}

/** Does the handler at `file` (absolute, or relative to the repo root) reach a write on a cache-input table? */
export function handlerWritesCacheInput(file: string): boolean {
  const absolute = path.isAbsolute(file) ? file : path.resolve(import.meta.dirname, '..', file)
  const module = loadModule(absolute)
  if (!module) return false
  return reachesWrite(module, module.defaultExport ?? module.sourceFile, new Set(), 0)
}
