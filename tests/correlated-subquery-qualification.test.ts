/**
 * Correlated subqueries must qualify their columns with table names.
 *
 * The trap, found by calling a built endpoint rather than by reading code:
 * **Drizzle only prefixes a column with its table name when the surrounding query
 * has a JOIN.** Without one it emits the bare column name. So this, which reads
 * as obviously correct:
 *
 *     sql`(SELECT ... FROM ${chatMessages}
 *          WHERE ${chatMessages.sessionId} = ${chatSessions.id})`
 *
 * compiles to `WHERE \`session_id\` = \`id\`` — and inside a subquery over
 * `chat_messages`, that bare `id` resolves to `chat_messages.id`, not to the outer
 * session's. The correlation stops correlating. MySQL raises nothing: the subquery
 * simply matches no rows, the column comes back NULL, and the caller's `?? fallback`
 * quietly takes over. The symptom reads as "the fallback is being used a lot",
 * which is not a symptom anyone investigates.
 *
 * The same expression IS correct in server/api/public/articles/[slug].get.ts — but
 * only because that query happens to carry two leftJoins for the author and the
 * category. Its correctness depends on an unrelated part of the query staying the
 * way it is; delete the joins and the view counter starts reporting zero for every
 * article, with nothing failing.
 *
 * So the rule is: inside a correlated subquery, write the table names out. A
 * qualified name is right whether or not a join is present, which is exactly the
 * property the interpolated form lacks.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const serverRoot = new URL('../server/', import.meta.url)

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(new URL(dir, serverRoot), { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else if (entry.name.endsWith('.ts')) out.push(path)
  }
  return out
}

/**
 * Every `sql\`...\`` template that contains a SELECT — i.e. a subquery.
 *
 * The terminator has to skip ESCAPED backticks. SQL identifiers are quoted with
 * backticks, so inside a template literal they appear as `\``, and a naive
 * `` /sql`([\s\S]*?)`/ `` stops at the first one — capturing a few characters and
 * silently missing the WHERE clause this test exists to inspect. That is how the
 * first version of this file passed while the bug it was written for was sitting
 * in two files.
 */
function subqueryTemplates(source: string): string[] {
  const found: string[] = []
  // (?:[^`\\]|\\.)* — any run of characters that is neither a backtick nor a
  // backslash, or any escaped pair. The escaped pair is what lets \` through.
  const pattern = /sql(?:<[^>]*>)?`((?:[^`\\]|\\.)*)`/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    const body = match[1]!
    if (/\bSELECT\b/i.test(body)) found.push(body)
  }
  return found
}

test('the extractor sees past escaped backticks', () => {
  // Guards the guard. Without this, a regression in subqueryTemplates turns the
  // test below into one that inspects nothing and passes unconditionally.
  const sample = 'const q = sql<number>`(SELECT 1 FROM \\`t\\` WHERE \\`t\\`.\\`a\\` = ${x.y})`'
  const [body] = subqueryTemplates(sample)
  assert.ok(body, 'no template extracted at all')
  assert.match(body!, /WHERE/, 'the extractor stopped at the first escaped backtick')
  assert.match(body!, /\$\{x\.y\}/, 'the interpolation after the escaped identifiers was not reached')
})

test('no correlated subquery relies on Drizzle qualifying a bare column', () => {
  const offenders: string[] = []

  for (const file of walk('.')) {
    const source = readFileSync(new URL(file, serverRoot), 'utf8')
    for (const body of subqueryTemplates(source)) {
      // A `${table.column}` interpolation inside a WHERE clause of a subquery is
      // the shape that breaks. `${TABLE}` on its own (the FROM target) is fine —
      // a table name is always emitted in full.
      const whereClause = /\bWHERE\b([\s\S]*?)(?:\bORDER BY\b|\bLIMIT\b|\bGROUP BY\b|\)\s*$)/i.exec(body)?.[1] ?? ''
      const interpolatedColumns = whereClause.match(/\$\{[A-Za-z_$][\w$]*\.[\w$]+\}/g) ?? []

      if (interpolatedColumns.length > 0) {
        offenders.push(`${file}: ${interpolatedColumns.join(', ')}`)
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'a correlated subquery interpolates ${table.column} in its WHERE clause. Drizzle only '
    + 'emits the table prefix when the OUTER query has a join, so without one this compiles '
    + 'to a bare column name that binds to the SUBQUERY\'s table — the correlation silently '
    + 'matches nothing and the column comes back NULL. Write the names out:\n'
    + offenders.join('\n'),
  )
})

test('the reader chat list titles conversations from the visitor\'s first question', () => {
  // The specific query the bug was found in. Pinned by shape rather than by output
  // because this file makes no database connection; the behaviour itself was
  // verified by calling the built endpoint.
  const source = readFileSync(new URL('api/public/reader/chats.get.ts', serverRoot), 'utf8')
  // The source text carries backslash-escaped backticks (`\`m\``), because the SQL
  // lives inside a template literal. Matching the rendered SQL instead of the
  // source bytes is what this pattern gets wrong if written naively.
  assert.match(
    source,
    /\\`m\\`\.\\`session_id\\`\s*=\s*\\`chat_sessions\\`\.\\`id\\`/,
    'the correlation is no longer written with qualified table names',
  )
  assert.match(source, /\\`m\\`\.\\`role\\`\s*=\s*'user'/, 'the title would come from the assistant\'s opening line')
})
