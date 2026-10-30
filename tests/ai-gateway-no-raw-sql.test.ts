/**
 * No raw SQL in the AI gateway family (CLAUDE.md "Không ghép dữ liệu người dùng vào SQL").
 *
 * `callAi` reads three tables (service config, provider, pricing) through the Drizzle query
 * builder, keyed by a service key, a provider name and a model name. Those values come from
 * callers and from the admin-edited config — and the model name of a request is, in the end,
 * typed by an operator. `tests/security-chatbot-article-search.test.ts` bans `sql.raw` for
 * the chat policy family; nothing banned it here, and splitting `callAi` into parts made the
 * family a place where a part with its own query could appear unread (the verifier planted
 * `sql.raw` in `ai-gateway-record.ts` and every test stayed green).
 *
 * What it reads: the whole family (`_ai-gateway-family.ts` — barrel, every `ai-gateway-*.ts`
 * part, the earlier extractions), by TypeScript AST, so a comment is not code. Red for:
 *   - `.raw` taken from Drizzle's `sql` — under any local name, through a namespace import
 *     (`d.sql.raw`), by element access (`sql['raw']`) or by destructuring (`const { raw } = sql`);
 *   - a `query(…)`/`execute(…)` whose SQL argument is built from strings — a template with
 *     substitutions or a `+` concatenation (`pool.query(\`… ${x}\`)`).
 * `sql\`… ${x}\`` (Drizzle's tagged template) binds `x` as a parameter and stays green.
 * Each rule has an injection proof below.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
import { aiGatewayFiles, aiGatewaySourcesWith } from './_ai-gateway-family.ts'

const unwrap = (node: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isTypeAssertionExpression(node)
    ? unwrap(node.expression)
    : node

function rawSqlSites(sources: Map<string, string>): string[] {
  const sites: string[] = []
  for (const [file, source] of sources) {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const at = (node: ts.Node, what: string) => sites.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1} ${what}`)
    // Local names of Drizzle's `sql`, and of namespace imports of drizzle-orm.
    const sqlNames = new Set<string>()
    const namespaces = new Set<string>()
    for (const statement of sf.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.moduleSpecifier.text.startsWith('drizzle-orm')) continue
      const bindings = statement.importClause?.namedBindings
      if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text)
      if (bindings && ts.isNamedImports(bindings))
        for (const element of bindings.elements) if ((element.propertyName ?? element.name).text === 'sql') sqlNames.add(element.name.text)
    }
    const isSqlTag = (node: ts.Expression): boolean => {
      const inner = unwrap(node)
      if (ts.isIdentifier(inner)) return sqlNames.has(inner.text)
      return ts.isPropertyAccessExpression(inner) && inner.name.text === 'sql' && ts.isIdentifier(unwrap(inner.expression))
        && namespaces.has((unwrap(inner.expression) as ts.Identifier).text)
    }
    const builtFromStrings = (node: ts.Expression | undefined): boolean => {
      if (!node) return false
      const inner = unwrap(node)
      return (ts.isTemplateExpression(inner) && inner.templateSpans.length > 0)
        || (ts.isBinaryExpression(inner) && inner.operatorToken.kind === ts.SyntaxKind.PlusToken)
    }
    const visit = (node: ts.Node) => {
      if (ts.isPropertyAccessExpression(node) && node.name.text === 'raw' && isSqlTag(node.expression)) at(node, 'sql.raw')
      if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === 'raw' && isSqlTag(node.expression))
        at(node, "sql['raw']")
      if (ts.isVariableDeclaration(node) && node.initializer && isSqlTag(node.initializer) && ts.isObjectBindingPattern(node.name)
        && node.name.elements.some(element => ((element.propertyName ?? element.name) as ts.Identifier).text === 'raw'))
        at(node, 'raw destructured from sql')
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ['query', 'execute'].includes(node.expression.name.text)
        && builtFromStrings(node.arguments[0]))
        at(node, `${node.expression.name.text}() with SQL built from strings`)
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return sites
}

// ─── Real code ───────────────────────────────────────────────────────────────

test('no file of the AI gateway family assembles SQL from strings', () => {
  const sources = aiGatewaySourcesWith()
  assert.deepEqual([...sources.keys()], aiGatewayFiles(), 'the scan is the whole family')
  assert.ok(sources.size >= 13, JSON.stringify([...sources.keys()]))
  assert.deepEqual(rawSqlSites(sources), [])
})

// ─── Injection proofs ────────────────────────────────────────────────────────

const RECORD = 'server/services/ai-gateway-record.ts'
const plantIn = (file: string, code: string) => aiGatewaySourcesWith({ [file]: `${aiGatewaySourcesWith().get(file)}\n${code}\n` })

test('proof: the verifier\'s plant (G-b) in ai-gateway-record.ts goes red', () => {
  const plant = "import { sql } from 'drizzle-orm'\nexport const _probe = (m: string) => sql.raw(`SELECT * FROM ai_model_pricing WHERE model = '${m}'`)"
  const sites = rawSqlSites(plantIn(RECORD, plant))
  assert.equal(sites.length, 1, JSON.stringify(sites))
  assert.match(sites[0]!, /^server\/services\/ai-gateway-record\.ts:\d+ sql\.raw$/)
})

test('proof: every way of reaching sql.raw goes red, in an existing part or a new one', () => {
  const red: Array<[string, string]> = [
    ['alias', "import { sql as q } from 'drizzle-orm'\nexport const a = (m: string) => q.raw(m)"],
    ['element access', "import { sql } from 'drizzle-orm'\nexport const a = (m: string) => sql['raw'](m)"],
    ['namespace', "import * as d from 'drizzle-orm'\nexport const a = (m: string) => d.sql.raw(m)"],
    ['destructured', "import { sql } from 'drizzle-orm'\nconst { raw } = sql\nexport const a = (m: string) => raw(m)"],
    ['pool.query with a template', 'export const a = (pool: { query: (s: string) => unknown }, m: string) => pool.query(`SELECT * FROM ai_model_pricing WHERE model = \'${m}\'`)'],
    ['db.execute with +', "export const a = (db: { execute: (s: string) => unknown }, m: string) => db.execute('SELECT * FROM ai_providers WHERE provider = ' + m)"],
  ]
  for (const [label, code] of red) {
    assert.equal(rawSqlSites(plantIn('server/services/ai-gateway-call.ts', code)).length, 1, `${label} (existing part)`)
    assert.equal(rawSqlSites(aiGatewaySourcesWith({ 'server/services/ai-gateway-pricing-sql.ts': code })).length, 1, `${label} (new part)`)
  }
})

test('proof: a comment, Drizzle\'s parameterised sql`…`, a constant query and String.raw stay green', () => {
  const green = [
    '// never sql.raw(`… ${model}`) here, never pool.query(`… ${x}`)',
    "import { sql } from 'drizzle-orm'\nexport const a = (m: string) => sql`SELECT * FROM ai_model_pricing WHERE model = ${m}`",
    "export const a = (pool: { query: (s: string, p: unknown[]) => unknown }, m: string) => pool.query('SELECT 1 FROM ai_providers WHERE provider = ?', [m])",
    'export const a = String.raw`C:\\\\path`',
  ]
  for (const code of green) assert.deepEqual(rawSqlSites(plantIn(RECORD, code)), [], code)
})
