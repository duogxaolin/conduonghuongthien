import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'

/**
 * Every source file the runtime image EXECUTES must be IN the runtime image.
 *
 * The runtime stage copies a hand-picked list of directories (`.output` from the
 * builder; `server`, `scripts`, `public`, … from the context). `.output` is
 * self-contained, but the container also runs TypeScript straight from source with
 * `node --experimental-strip-types`: the CMD (`server/db/init.ts`, `server/db/seed.ts`)
 * and every `npm run db:* / analytics:* …` an operator runs with `docker exec`
 * (`db:sanitize-html` is in the production runbook). Those import other files by
 * relative path. A value import that reaches a directory the image does not copy —
 * `shared/` was the case: `server/utils/permissions.ts` imports
 * `../../shared/permissions` — dies with ERR_MODULE_NOT_FOUND inside the container,
 * while every test on the host (which has the whole checkout) stays green.
 *
 * This walks the real import graph with the TypeScript parser, from those entry
 * points, the way Node will load it:
 *   - `import type …` and `export type … from` are erased: no load;
 *   - `import { type X } from` / `export { type X } from` are NOT: Node's type
 *     stripping leaves `import {} from …`, which still loads the module (pinned by
 *     the first test below against the Node running the suite);
 *   - side-effect imports, re-exports and literal dynamic `import()` load;
 *   - relative specifiers resolve like scripts/ts-resolver.mjs (exact, `.ts`,
 *     `/index.ts`, `.mts`, `.js`); bare specifiers are packages (node_modules).
 * Then it checks each top-level directory/file of that closure is COPYed into /app by
 * the runtime stage and not excluded by .dockerignore.
 */

const REPO = resolve(new URL('..', import.meta.url).pathname)
const SUFFIXES = ['', '.ts', '/index.ts', '.mts', '.js']

const roots: string[] = []
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

/** Specifiers in `source` that Node loads when it runs the file (types stripped). */
function runtimeSpecifiers(fileName: string, source: string): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const out: string[] = []
  const literal = (node: ts.Node | undefined) =>
    node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      // `import type { X } from` is erased; `import { type X } from` is not.
      if (!node.importClause?.isTypeOnly) {
        const spec = literal(node.moduleSpecifier)
        if (spec) out.push(spec)
      }
    } else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && !node.isTypeOnly) {
        const spec = literal(node.moduleSpecifier)
        if (spec) out.push(spec)
      }
    } else if (ts.isImportEqualsDeclaration(node)) {
      if (!node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)) {
        const spec = literal(node.moduleReference.expression)
        if (spec) out.push(spec)
      }
    } else if (ts.isCallExpression(node)) {
      const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require'
      if (isImport || isRequire) {
        const spec = literal(node.arguments[0])
        if (spec) out.push(spec)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

function resolveRelative(fromFile: string, spec: string): string | undefined {
  const base = resolve(dirname(fromFile), spec)
  for (const suffix of SUFFIXES) {
    const candidate = base + suffix
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return undefined
}

/** Repo-relative paths of every local file the entries load, transitively. */
function importClosure(root: string, entries: string[]) {
  const files = new Set<string>()
  const unresolved: string[] = []
  const queue = entries.map((entry) => resolve(root, entry))
  while (queue.length) {
    const file = queue.pop()!
    const rel = relative(root, file)
    if (files.has(rel)) continue
    files.add(rel)
    if (!/\.(m?ts|m?js)$/.test(file)) continue
    for (const spec of runtimeSpecifiers(file, readFileSync(file, 'utf8'))) {
      if (!spec.startsWith('.') && !spec.startsWith('/')) continue // package or node: builtin
      const target = resolveRelative(file, spec)
      if (target) queue.push(target)
      else unresolved.push(`${rel} → ${spec}`)
    }
  }
  return { files, unresolved }
}

/** Runtime-stage instructions: `\`-continued lines joined, comments dropped. */
function runtimeStage(dockerfile: string): string[] {
  return dockerfile
    .slice(dockerfile.lastIndexOf('\nFROM '))
    .replace(/\\\n/g, ' ')
    .split('\n')
    .filter((line) => /^[A-Z]+ /.test(line))
}

// Docker/Go glob → RegExp: `*` and `?` stay within one path segment; a `**` followed
// by a slash spans any depth, a trailing `**` matches everything below.
// Placeholders: two private-use characters no glob contains.
const GLOBSTAR_DIR = String.fromCharCode(0xe000)
const GLOBSTAR = String.fromCharCode(0xe001)
const globRegex = (glob: string) =>
  new RegExp(
    `^${glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replaceAll('**/', GLOBSTAR_DIR)
      .replaceAll('**', GLOBSTAR)
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
      .replaceAll(GLOBSTAR_DIR, '(?:.*/)?')
      .replaceAll(GLOBSTAR, '.*')}$`,
  )

/** Context paths the runtime stage COPYs into /app at the same relative path. */
function copiedIntoApp(dockerfile: string): RegExp[] {
  const copied: RegExp[] = []
  for (const line of runtimeStage(dockerfile)) {
    if (!line.startsWith('COPY ') || /--from=/.test(line)) continue
    const args = line.slice(5).trim().split(/\s+/).filter((arg) => !arg.startsWith('--'))
    const dest = args.pop()!
    for (const source of args) {
      // `COPY x ./x` and `COPY a b ./` keep the layout under WORKDIR /app; a COPY to
      // an absolute path elsewhere (the entrypoint script) puts nothing into /app.
      const name = source.replace(/\/$/, '')
      const keepsPath = dest === './' || dest === '.' || dest === '/app/' || dest.replace(/\/$/, '') === `./${name}` || dest.replace(/\/$/, '') === `/app/${name}`
      if (keepsPath) copied.push(globRegex(name))
    }
  }
  return copied
}

/** Whether .dockerignore keeps `path` (repo-relative) out of the build context. */
function dockerignored(dockerignore: string, path: string): boolean {
  let excluded = false
  const parts = path.split('/')
  for (const raw of dockerignore.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const negate = line.startsWith('!')
    const pattern = globRegex((negate ? line.slice(1) : line).replace(/^\/+|\/+$/g, ''))
    // A pattern that matches a parent directory excludes everything below it.
    const hit = parts.some((_, i) => pattern.test(parts.slice(0, i + 1).join('/')))
    if (hit) excluded = !negate
  }
  return excluded
}

/** The .ts files the container runs: the CMD, and npm scripts that run a file under scripts/ or server/. */
function containerEntrypoints(dockerfile: string, pkg: { scripts?: Record<string, string> }): string[] {
  const cmd = runtimeStage(dockerfile).filter((line) => line.startsWith('CMD ')).at(-1) ?? ''
  // A path that STARTS with server/ or scripts/ (not `.output/server/index.mjs`, the bundle).
  const entries = new Set([...cmd.matchAll(/(?:^|[\s"'])(?:\.\/)?((?:server|scripts)\/[\w./-]+\.m?[jt]s)\b/g)].map((m) => m[1]!))
  for (const script of Object.values(pkg.scripts ?? {})) {
    if (!/^node\b/.test(script)) continue
    for (const token of script.split(/\s+/)) {
      if (/^(?:\.\/)?(?:server|scripts)\/[\w./-]+\.m?[jt]s$/.test(token)) entries.add(token.replace(/^\.\//, ''))
    }
  }
  return [...entries].sort()
}

/** Top-level entries (dir or root file) of the runtime closure the image would lack. */
function missingFromImage(root: string) {
  const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8')
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const ignore = existsSync(join(root, '.dockerignore')) ? readFileSync(join(root, '.dockerignore'), 'utf8') : ''
  const entries = containerEntrypoints(dockerfile, pkg)
  const { files, unresolved } = importClosure(root, entries)
  const copied = copiedIntoApp(dockerfile)
  const missing = new Set<string>()
  for (const file of files) {
    const top = file.split('/')[0]!
    if (!copied.some((re) => re.test(top)) || dockerignored(ignore, file)) missing.add(top)
  }
  return { entries, files, unresolved, missing: [...missing].sort() }
}

// ─── The rules the checker assumes, against the Node that runs this suite ─────

test('Node erases `import type` / `export type … from`, but still loads `import { type X }`', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cdkt-strip-'))
  roots.push(dir)
  for (const name of ['a', 'b', 'c', 'd', 'e', 'f'])
    writeFileSync(join(dir, `${name}.ts`), `console.log('loaded ${name}')\nexport type T = number\nexport const v = 1\n`)
  const main = [
    "import type { T } from './a.ts'",
    "import { type T as U } from './b.ts'",
    "export type { T as V } from './c.ts'",
    "export { type T as W } from './d.ts'",
    "import './e.ts'",
    "const x: T | U = 1; void x",
    "await import('./f.ts')",
    '',
  ].join('\n')
  writeFileSync(join(dir, 'main.ts'), main)
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', join(dir, 'main.ts')], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const loaded = r.stdout.split('\n').filter(Boolean).map((l) => l.replace('loaded ', '')).sort()
  assert.deepEqual(loaded, ['b', 'd', 'e', 'f'], 'Node changed what type stripping erases — update runtimeSpecifiers()')
  assert.deepEqual(runtimeSpecifiers('main.ts', main).sort(), ['./b.ts', './d.ts', './e.ts', './f.ts'])
})

// ─── The checker, on a fixture tree ──────────────────────────────────────────

function fixture(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'cdkt-image-sources-'))
  roots.push(dir)
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  return dir
}

const FIXTURE_DOCKERFILE = (extraCopy = '') => [
  'FROM node:24-alpine AS builder',
  'COPY . .',
  'FROM node:24-alpine',
  'WORKDIR /app',
  'COPY --chown=node:node package*.json ./',
  'COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh',
  'COPY --chown=node:node --from=builder /app/.output ./.output',
  'COPY --chown=node:node server ./server',
  'COPY --chown=node:node scripts ./scripts',
  extraCopy,
  'CMD ["sh", "-c", "node --experimental-strip-types server/db/init.ts && exec node .output/server/index.mjs"]',
  '',
].join('\n')

const FIXTURE_PACKAGE = JSON.stringify({
  scripts: {
    'db:fix': 'node --experimental-strip-types --import ./scripts/ts-resolver.mjs scripts/fix.ts',
    test: 'node --test tests/*.test.ts',
    build: 'nuxt build',
  },
})

test('the checker reports a directory the closure needs and the image does not copy', () => {
  const base = {
    'package.json': FIXTURE_PACKAGE,
    'scripts/ts-resolver.mjs': '',
    'server/db/init.ts': "import { ok } from '../utils/ok'\nconsole.log(ok)\n",
    'server/utils/ok.ts': 'export const ok = 1\n',
    'scripts/fix.ts': "import { clean } from '../server/utils/clean'\nclean()\n",
    'shared/rules.ts': 'export type Rule = string\nexport const RULES = []\n',
    'types/only.ts': 'export type Only = number\n',
    'tests/x.test.ts': "import '../elsewhere/never'\n",
  }
  // A value import from shared/, two hops from an npm script.
  const valueImport = fixture({
    ...base,
    Dockerfile: FIXTURE_DOCKERFILE(),
    'server/utils/clean.ts': "import { RULES } from '../../shared/rules'\nimport type { Only } from '../../types/only'\nexport const clean = (): Only => RULES.length\n",
  })
  const found = missingFromImage(valueImport)
  // The `--import` resolver hook is loaded too; tests/* and non-node scripts are not entry points.
  assert.deepEqual(found.entries, ['scripts/fix.ts', 'scripts/ts-resolver.mjs', 'server/db/init.ts'])
  assert.deepEqual(found.missing, ['shared'])
  assert.deepEqual(found.unresolved, [])

  // `import { type X }` still loads the module under Node — still missing.
  const inlineType = fixture({
    ...base,
    Dockerfile: FIXTURE_DOCKERFILE(),
    'server/utils/clean.ts': "import { type Rule } from '../../shared/rules'\nexport const clean = (r?: Rule) => r\n",
  })
  assert.deepEqual(missingFromImage(inlineType).missing, ['shared'])

  // `import type` only: erased, nothing to copy.
  const typeOnly = fixture({
    ...base,
    Dockerfile: FIXTURE_DOCKERFILE(),
    'server/utils/clean.ts': "import type { Rule } from '../../shared/rules'\nexport const clean = (r?: Rule) => r\n",
  })
  assert.deepEqual(missingFromImage(typeOnly).missing, [])

  // Copied → nothing missing; copied but excluded by .dockerignore → missing again.
  const files = { ...base, 'server/utils/clean.ts': "export { RULES as clean } from '../../shared/rules'\n" }
  const copied = fixture({ ...files, Dockerfile: FIXTURE_DOCKERFILE('COPY --chown=node:node shared ./shared') })
  assert.deepEqual(missingFromImage(copied).missing, [])
  const ignored = fixture({ ...files, Dockerfile: FIXTURE_DOCKERFILE('COPY --chown=node:node shared ./shared'), '.dockerignore': 'node_modules\nshared\n' })
  assert.deepEqual(missingFromImage(ignored).missing, ['shared'])
  const ignoredBelow = fixture({ ...files, Dockerfile: FIXTURE_DOCKERFILE('COPY --chown=node:node shared ./shared'), '.dockerignore': 'shared/**\n' })
  assert.deepEqual(missingFromImage(ignoredBelow).missing, ['shared'])
  const reincluded = fixture({ ...files, Dockerfile: FIXTURE_DOCKERFILE('COPY --chown=node:node shared ./shared'), '.dockerignore': '*.md\n!README.md\n**/.cache\n' })
  assert.deepEqual(missingFromImage(reincluded).missing, [])
})

// ─── The real image ──────────────────────────────────────────────────────────

test('the runtime image contains every directory the container\'s TypeScript entry points load', () => {
  const found = missingFromImage(REPO)
  for (const entry of ['server/db/init.ts', 'server/db/seed.ts', 'scripts/sanitize-stored-html.ts', 'scripts/ts-resolver.mjs']) {
    assert.ok(found.entries.includes(entry), `${entry} is not treated as a container entry point: ${found.entries.join(', ')}`)
  }
  assert.deepEqual(found.unresolved, [], 'a relative import that does not resolve even on the host')
  assert.deepEqual(
    found.missing,
    [],
    `the runtime image lacks ${found.missing.join(', ')} — loaded by ${[...found.files].filter((f) => found.missing.includes(f.split('/')[0]!)).join(', ')}`,
  )
})

/**
 * Directories that shipped `server/` code imports but that the image deliberately
 * does not copy, each with the reason. Only code Nitro bundles into `.output` may
 * reach them; the test above proves no container entry point does.
 */
const NOT_COPIED_ON_PURPOSE: Record<string, string> = {
  app: 'client code; only API handlers/services reach it (page-versions → blocks/registry, submission-status), and those run from the Nitro bundle in .output, never from source',
}

/** Every .ts/.mts file under the given repo-relative directories. */
function shippedSources(root: string, dirs: string[]): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of existsSync(join(root, dir)) ? readdirSync(join(root, dir), { withFileTypes: true }) : []) {
      const rel = `${dir}/${name.name}`
      if (name.isDirectory()) walk(rel)
      else if (/\.m?ts$/.test(name.name)) out.push(rel)
    }
  }
  for (const dir of dirs) walk(dir)
  return out
}

test('everything the image ships under server/ and scripts/ can load what it imports (or is bundle-only, by name)', () => {
  // The image copies ALL of server/ and scripts/ so any of it can be run with
  // strip-types (`docker exec … npm run …`, a one-off `node … server/…ts`). The
  // entry points of today are not the only ones tomorrow: one more import in
  // init.ts/seed.ts/sanitize-html.ts reaching `server/utils/permissions.ts` would put
  // `shared/` in the entry closure. So every top-level directory the shipped sources
  // load must be copied — or be named above with the reason it never runs from source.
  const dockerfile = readFileSync(join(REPO, 'Dockerfile'), 'utf8')
  const copied = copiedIntoApp(dockerfile)
  const { files } = importClosure(REPO, shippedSources(REPO, ['server', 'scripts']))
  const reached = new Set([...files].map((f) => f.split('/')[0]!))
  const entryClosure = missingFromImage(REPO).files
  const ignore = readFileSync(join(REPO, '.dockerignore'), 'utf8')
  for (const top of reached) {
    if (copied.some((re) => re.test(top))) {
      const ignored = [...files].filter((f) => f.startsWith(`${top}/`) && dockerignored(ignore, f))
      assert.deepEqual(ignored, [], `.dockerignore keeps these out of the build context, so COPY ${top} ships without them`)
      continue
    }
    assert.ok(NOT_COPIED_ON_PURPOSE[top], `shipped server/scripts code loads ${top}/ but the runtime image does not copy it: ${[...files].filter((f) => f.startsWith(`${top}/`)).join(', ')}`)
    assert.ok(![...entryClosure].some((f) => f.startsWith(`${top}/`)), `a container entry point now reaches ${top}/ — copy it`)
  }
  for (const name of Object.keys(NOT_COPIED_ON_PURPOSE)) {
    assert.ok(reached.has(name), `${name}/ is no longer reached — drop it from NOT_COPIED_ON_PURPOSE`)
  }
})
