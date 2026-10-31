import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import test from 'node:test'
import ts from 'typescript'

/**
 * No value is exported under the same name by two modules of `server/utils/**`.
 *
 * Nitro auto-imports every export of `server/utils`. A name exported twice — the same
 * function re-exported by a second module, as `outbound.ts` did with `isPublicIpAddress`
 * after it moved to `public-ip.ts` — makes typecheck and build print
 * `Duplicated imports "isPublicIpAddress", the one from … has been ignored`, and which
 * module an auto-imported call resolves to is then decided by scan order. Import the
 * name from the one module that defines it instead.
 *
 * Value exports only (`export function/const/class/let/var/enum`, `export { … }` and
 * `export { … } from`); `export type`/`interface` are not auto-imported values.
 */

const REPO = resolve(new URL('..', import.meta.url).pathname)

function files(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...files(path))
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(relative(REPO, path).split(sep).join('/'))
  }
  return out.sort()
}

/** The value names a module exports. */
export function valueExports(source: string): string[] {
  const sf = ts.createSourceFile('m.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const names: string[] = []
  const exported = (node: ts.Node) => ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword)
  for (const statement of sf.statements) {
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && exported(statement) && statement.name) {
      names.push(statement.name.text)
    } else if (ts.isVariableStatement(statement) && exported(statement)) {
      for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text)
    } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) if (!element.isTypeOnly) names.push(element.name.text)
    }
  }
  return names
}

test('the reader of exports sees each value form and skips types', () => {
  assert.deepEqual(valueExports([
    'export function a() {}', 'export const b = 1, c = 2', 'export class D {}', 'export enum E { X }',
    'const f = 1', 'export { f }', "export { g as h } from './x'", 'export type T = 1', 'export interface I {}',
    'export { type J }', "export type { K } from './y'",
  ].join('\n')), ['a', 'b', 'c', 'D', 'E', 'f', 'h'])
})

test('no value name is exported by two server/utils modules (RED before: isPublicIpAddress from outbound.ts and public-ip.ts)', () => {
  const owners = new Map<string, string[]>()
  for (const file of files(join(REPO, 'server/utils'))) {
    for (const name of valueExports(readFileSync(join(REPO, file), 'utf8'))) owners.set(name, [...(owners.get(name) ?? []), file])
  }
  const duplicated = [...owners].filter(([, where]) => where.length > 1)
  assert.deepEqual(duplicated, [], 'import the name from the module that defines it; do not re-export it from a second server/utils module')
})
