import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import ts from 'typescript'
import { baselinePath, baselineProblems, ratchet, readBaseline, REPO_ROOT, type FileRatchet } from './_ratchet'

/**
 * Hex-colour ratchet (wave3-long-term D-R, task 1.1).
 *
 * Counts arbitrary Tailwind hex classes — `bg-[#2c6e33]`, `text-[#667768]/80`,
 * `border-[#E2ECE3]` — per file, in every file Tailwind compiles classes from: the scope
 * IS the `content` array of tailwind.config.js (today `./app/**\/*.{vue,ts,js}`,
 * `./server/**\/*.{ts,js}`, `./shared/**\/*.{ts,js}`), read from the config and matched
 * with Tailwind's own micromatch, so the two cannot drift. A class in `shared/` or
 * `server/` (status badges, search highlights) ships in the CSS like one in `app/`.
 * They are what the colour-token migration (D-TOKENS) replaces with semantic tokens
 * (`bg-brand-700`), one directory per PR. A new file starts at 0: use a token.
 *
 * Baseline: tests/ratchets/hex-colors.baseline.json. Regenerate (lowers only):
 *   node --experimental-strip-types --import ./scripts/ts-resolver.mjs tests/ratchets/hex-colors.test.ts --update
 */

const HEX_CLASS = /\[#[0-9a-fA-F]{3,8}\]/g

/**
 * The `content` globs of `module.exports = { content: [...] }` in tailwind.config.js, read
 * with the TypeScript parser (the config is CommonJS inside a `"type": "module"` package,
 * so it cannot simply be imported; tests/tailwind-content-shared.test.ts reads it the same way).
 */
export function tailwindContentGlobs(root: string = REPO_ROOT): string[] {
  const file = path.join(root, 'tailwind.config.js')
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  for (const statement of sf.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression)) continue
    const { left, right } = statement.expression
    if (left.getText(sf) !== 'module.exports' || !ts.isObjectLiteralExpression(right)) continue
    for (const prop of right.properties) {
      if (!ts.isPropertyAssignment(prop) || prop.name.getText(sf) !== 'content') continue
      if (!ts.isArrayLiteralExpression(prop.initializer)) throw new Error('tailwind.config.js: `content` is no longer an array of globs — update the hex ratchet')
      return prop.initializer.elements.map((element) => {
        if (!ts.isStringLiteral(element)) throw new Error(`tailwind.config.js: a content entry is not a string: ${element.getText(sf)}`)
        return element.text
      })
    }
  }
  throw new Error('tailwind.config.js: no `module.exports = { content: [...] }` found — update the hex ratchet')
}

// The same micromatch Tailwind uses to match its content globs.
const requireFromTailwind = createRequire(createRequire(import.meta.url).resolve('tailwindcss'))
const micromatch = requireFromTailwind('micromatch') as { isMatch: (file: string, globs: string[]) => boolean }
const CONTENT_GLOBS = tailwindContentGlobs()

export const HEX_COLORS: FileRatchet = {
  name: 'hex-colors',
  unit: 'hex colour classes',
  defaultForNewFiles: 0,
  inScope: file => micromatch.isMatch(file, CONTENT_GLOBS),
  measure: text => text.match(HEX_CLASS)?.length ?? 0,
  hint: 'Use a semantic colour token from tailwind.config.js instead of an arbitrary `[#hex]` class (design D-TOKENS).',
  exemptAllowed: [],
}

ratchet(HEX_COLORS, () => {
  test('hex-colors: counts every arbitrary hex class, whatever the utility, case or opacity suffix', () => {
    const sample = [
      '<div class="bg-[#2c6e33] text-[#FFF] hover:border-[#e2ece3]/40">',
      "  :class=\"{ 'ring-[#4a6741]': on }\"",
      '  shadow-[0_1px_2px_#000] fill-[#12345678]',
    ].join('\n')
    assert.equal(HEX_COLORS.measure(sample, 'app/x.vue'), 5)
    // Not an arbitrary colour class: too short, too long, or not `[#…]`.
    assert.equal(HEX_COLORS.measure('bg-[#12] bg-[#123456789] color: #2c6e33; [#zzz]', 'app/x.vue'), 0)
  })

  test('hex-colors: the scope is exactly what Tailwind compiles (tailwind.config.js `content`)', () => {
    // Derived, not mirrored: a change to `content` moves the scope with it (newly scanned
    // files with hex classes then fail as new files until they are baselined).
    assert.ok(CONTENT_GLOBS.length > 0, 'no content globs read from tailwind.config.js')
    for (const file of ['app/app.vue', 'app/components/admin/Foo.vue', 'app/utils/colors.ts', 'app/plugins/x.js',
      'server/api/public/search.get.ts', 'shared/submission-status.ts']) {
      assert.ok(HEX_COLORS.inScope(file), file)
    }
    for (const file of ['server/x.vue', 'tailwind.config.js', 'app/assets/css/main.css', 'tests/x.test.ts', 'scripts/x.ts', 'public/x.js']) {
      assert.ok(!HEX_COLORS.inScope(file), file)
    }
  })

  test('hex-colors: no entry may be exempt — every hex class is debt', () => {
    const baseline = readBaseline(baselinePath(HEX_COLORS.name))
    assert.deepEqual(baselineProblems(HEX_COLORS, baseline), [])
    const turned = { ...baseline, 'app/components/LiveHero.vue': { exempt: true as const, reason: 'lots of colours' } }
    assert.ok(baselineProblems(HEX_COLORS, turned).some(problem => problem.startsWith('app/components/LiveHero.vue: may not be exempt')))
  })
})
