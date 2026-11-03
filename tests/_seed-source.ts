/**
 * Reading `server/db/seed.ts`'s default data without running the seed.
 *
 * `seed.ts` runs itself on import (and ends with `process.exit`), so its defaults
 * cannot be imported. Most are literal constants, which the upgrade suite evaluates
 * from the TypeScript AST. A few are CODE — the permission matrix (`RESOURCES.map(…)`
 * per role) and the small-talk rows (`CHATBOT_SMALL_TALK_SEED.map(…)`). Those
 * initializers are transpiled and evaluated here in an empty `vm` context that holds
 * only what the caller passes in. They are pure functions of their inputs, so the
 * result is exactly what the seed would write. A missing name fails loudly.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import type * as TS from 'typescript'

const requireFromHere = createRequire(import.meta.url)
let typescriptModule: typeof TS | undefined
const typescript = (): typeof TS => (typescriptModule ??= requireFromHere('typescript') as typeof TS)

export const SEED_PATH = 'server/db/seed.ts'
export const readRepoFile = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

/** The source text of the initializer of the one variable `name` declared in `source`. */
export function initializerText(source: string, name: string, path = SEED_PATH): string {
  const ts = typescript()
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
  const found: string[] = []
  const visit = (node: TS.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) found.push(node.initializer.getText(file))
    ts.forEachChild(node, visit)
  }
  visit(file)
  if (found.length !== 1) throw new Error(`${path} declares ${found.length} variables named ${name}`)
  return found[0]!
}

/**
 * Evaluates the initializer of `name` with only `context` in scope. The result is
 * passed through JSON, so it holds plain values of this realm, not `vm` objects.
 */
export function evaluateInitializer(source: string, name: string, context: Record<string, unknown>, path = SEED_PATH): unknown {
  const js = typescript().transpileModule(`(${initializerText(source, name, path)})`, {
    compilerOptions: { target: typescript().ScriptTarget.ES2022, module: typescript().ModuleKind.ESNext },
  }).outputText
  const value = vm.runInNewContext(js, { ...context }, { timeout: 2000 })
  return JSON.parse(JSON.stringify(value))
}

export const PERMISSION_FLAGS = ['canCreate', 'canRead', 'canUpdate', 'canDelete', 'canPublish', 'canArchive', 'canTest'] as const
export type PermissionFlag = typeof PERMISSION_FLAGS[number]
export type PermissionRow = { role: string, resource: string } & Record<PermissionFlag, boolean>

export const DEFAULT_ROLE_PERMISSION_ARRAYS = { superadmin: 'superadminPerms', editor: 'editorPerms', moderator: 'moderatorPerms', viewer: 'viewerPerms' } as const

/** `RESOURCES`, as seed.ts declares it. */
export function seedResources(source = readRepoFile(SEED_PATH)): string[] {
  return evaluateInitializer(source, 'RESOURCES', {}) as string[]
}

/** The default role → resource → flags matrix, exactly as seed.ts builds it. */
export function seedPermissionMatrix(source = readRepoFile(SEED_PATH)): PermissionRow[] {
  const RESOURCES = seedResources(source)
  const roles = Object.fromEntries(Object.keys(DEFAULT_ROLE_PERMISSION_ARRAYS).map(role => [`${role}Role`, { id: role, name: role }]))
  return Object.entries(DEFAULT_ROLE_PERMISSION_ARRAYS).flatMap(([role, variable]) => {
    const rows = evaluateInitializer(source, variable, { RESOURCES, ...roles }) as Array<Record<string, unknown>>
    return rows.map((row) => {
      if (row.roleId !== role) throw new Error(`${variable} assigns role ${String(row.roleId)}, expected ${role}`)
      const flags = Object.fromEntries(PERMISSION_FLAGS.map(flag => [flag, row[flag] === true])) as Record<PermissionFlag, boolean>
      return { role, resource: String(row.resource), ...flags }
    })
  })
}
