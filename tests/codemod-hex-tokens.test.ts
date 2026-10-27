/**
 * `scripts/codemod-hex-tokens.ts` (wave3-long-term D-TOKENS, task 3.2).
 *
 * The codemod turns `bg-[#2c6e33]` into `bg-brand-700` and must not change a single
 * pixel. These tests run it on sample strings and pin each rule that keeps it that way:
 * exact matches only (a near-duplicate stays), every colour utility family, variants,
 * `!` and opacity modifiers carried over, `:class` literals handled as plain text,
 * nothing outside a Tailwind arbitrary value touched (`style=`, `<style>`, chart hex
 * strings), never an interpolation emitted, idempotent — and the one pixel trap the
 * unit-level rewrite cannot see on its own: Tailwind v3 orders rules of one utility by
 * the ASCII order of the class names, so renaming one of two colour classes on the
 * same element can flip which one wins. Such rewrites are left alone and reported.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import {
  COLOR_PREFIXES,
  buildHexMap,
  buildMergeMap,
  collectFiles,
  formatFileReport,
  formatSummary,
  main,
  rewriteSource,
} from '../scripts/codemod-hex-tokens.ts'
import { COLOR_MERGES } from '../shared/color-merges.ts'
import { COLOR_TOKENS } from '../shared/color-tokens.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const SCRIPT = path.join(ROOT, 'scripts', 'codemod-hex-tokens.ts')

const rewrite = (source: string, fileName = 'sample.vue') => rewriteSource(source, { fileName }).output
const reasons = (source: string, fileName = 'sample.vue') =>
  rewriteSource(source, { fileName }).leftAlone.map((entry) => `${entry.text}:${entry.reason}`)

/** The ratchet's metric (design.md D-R): `[#hex]` occurrences. */
const ratchetCount = (source: string) => (source.match(/\[#[0-9a-fA-F]{3,8}\]/g) ?? []).length

describe('mapping table', () => {
  test('comes from the same shared table as tailwind.config.js, inverted value → token', () => {
    const map = buildHexMap(COLOR_TOKENS)
    assert.deepEqual(
      Object.fromEntries([...map].map(([value, token]) => [token, value])),
      { ...COLOR_TOKENS },
    )
  })

  test('refuses a table where two tokens share a value, or a value is not 6-hex', () => {
    assert.throws(() => buildHexMap({ a: '#2c6e33', b: '#2C6E33' }), /share/)
    assert.throws(() => buildHexMap({ a: '#fff' }), /6-digit/)
  })

  test('covers every Tailwind v3 colour utility family', () => {
    assert.deepEqual([...COLOR_PREFIXES].sort(), [
      'accent', 'bg', 'border', 'border-b', 'border-e', 'border-l', 'border-r', 'border-s', 'border-t', 'border-x', 'border-y',
      'caret', 'decoration', 'divide', 'fill', 'from', 'outline', 'placeholder', 'ring', 'ring-offset', 'shadow', 'stroke',
      'text', 'to', 'via',
    ])
  })
})

describe('rewrites exact matches', () => {
  for (const prefix of [
    'bg', 'text', 'border', 'border-x', 'border-y', 'border-s', 'border-e', 'border-t', 'border-r', 'border-b', 'border-l',
    'ring', 'ring-offset', 'outline', 'divide', 'from', 'via', 'to', 'fill', 'stroke', 'placeholder', 'caret', 'accent',
    'decoration', 'shadow',
  ]) {
    test(`${prefix}-[#2c6e33] → ${prefix}-brand-700`, () => {
      assert.equal(rewrite(`<div class="${prefix}-[#2c6e33]"></div>`), `<div class="${prefix}-brand-700"></div>`)
    })
  }

  test('keeps every variant and the ! important marker', () => {
    const before = 'hover:bg-[#2c6e33] focus-visible:ring-[#4a6741] md:text-[#667768] group-hover:border-[#e2ece3] dark:bg-[#122815] '
      + '!text-[#d12420] hover:!bg-[#1e4620] group-hover/item:text-[#c8d6c9] [&>svg]:fill-[#2c6e33] aria-[expanded=true]:bg-[#f0f7f1]'
    const after = 'hover:bg-brand-700 focus-visible:ring-brand-600 md:text-ink-muted group-hover:border-line dark:bg-brand-950 '
      + '!text-danger hover:!bg-brand-900 group-hover/item:text-line-strong [&>svg]:fill-brand-700 aria-[expanded=true]:bg-surface-tint'
    assert.equal(rewrite(`<p class="${before}"></p>`), `<p class="${after}"></p>`)
  })

  test('keeps opacity modifiers: /30 and /[0.35]', () => {
    assert.equal(
      rewrite('<i class="bg-[#2c6e33]/30 ring-[#4a6741]/[0.35] text-[#122815]/5"></i>'),
      '<i class="bg-brand-700/30 ring-brand-600/[0.35] text-brand-950/5"></i>',
    )
  })

  test('uppercase hex matches case-insensitively', () => {
    assert.equal(rewrite('<b class="text-[#2C6E33] bg-[#F0F7F1]/30"></b>'), '<b class="text-brand-700 bg-surface-tint/30"></b>')
  })

  test(':class object literal, array literal and template string — as plain text, no interpolation added', () => {
    const source = [
      `<a :class="{ 'bg-[#2c6e33] text-white': active, 'text-[#667768]': !active }"></a>`,
      `<a :class="['border-[#e2ece3]', open && 'bg-[#f0f7f1]']"></a>`,
      '<a :class="`text-[#122815] ${size}`"></a>',
    ].join('\n')
    const output = rewrite(source)
    assert.equal(output, [
      `<a :class="{ 'bg-brand-700 text-white': active, 'text-ink-muted': !active }"></a>`,
      `<a :class="['border-line', open && 'bg-surface-tint']"></a>`,
      '<a :class="`text-brand-950 ${size}`"></a>',
    ].join('\n'))
    assert.equal(output.split('${').length, source.split('${').length)
  })

  test('class strings in <script> and plain .ts files', () => {
    assert.equal(
      rewrite(`const badge = { ok: 'bg-[#f0f7f1] text-[#2c6e33]', bad: 'text-[#d12420]' }`, 'meta.ts'),
      `const badge = { ok: 'bg-surface-tint text-brand-700', bad: 'text-danger' }`,
    )
    assert.equal(
      rewrite(`<template><i /></template>\n<script setup lang="ts">\nconst cls = 'border-[#c8d6c9]'\n</script>`),
      `<template><i /></template>\n<script setup lang="ts">\nconst cls = 'border-line-strong'\n</script>`,
    )
  })

  test('3-digit hex maps only when its expansion is exactly a token value', () => {
    const tokens = { paper: '#ffffff', 'brand-700': '#2c6e33' }
    const run = (source: string) => rewriteSource(source, { fileName: 'x.vue', tokens })
    assert.equal(run('<i class="bg-[#fff] text-[#FFF]/30"></i>').output, '<i class="bg-paper text-paper/30"></i>')
    assert.deepEqual(run('<i class="bg-[#ffe]"></i>').leftAlone.map((e) => e.reason), ['unmapped'])
    // With the real table no token is expressible in 3 digits, so `#fff` stays.
    assert.deepEqual(reasons('<i class="bg-[#fff]"></i>'), ['bg-[#fff]:unmapped'])
  })
})

describe('leaves alone', () => {
  test('near-duplicates of a token value — even those in the merge table, unless merges are on', () => {
    // `#e2e8df` and `#f8faf8` are approved merges (shared/color-merges.ts): only `--merges` folds them.
    const source = '<i class="bg-[#2c6e34] text-[#2c3e2f] border-[#e2e8df] bg-[#f8faf8]"></i>'
    assert.equal(rewrite(source), source)
    assert.deepEqual(reasons(source), [
      'bg-[#2c6e34]:unmapped', 'text-[#2c3e2f]:unmapped', 'border-[#e2e8df]:unmapped', 'bg-[#f8faf8]:unmapped',
    ])
  })

  test('hex with an alpha channel (4 or 8 digits), even when the rgb part is a token', () => {
    const source = '<i class="bg-[#2c6e3380] text-[#2c6e33ff] border-[#fffe]"></i>'
    assert.equal(rewrite(source), source)
    assert.deepEqual(rewriteSource(source, { fileName: 'x.vue' }).leftAlone.map((e) => e.reason), ['alpha', 'alpha', 'alpha'])
  })

  test('inline style=, :style= and <style> blocks', () => {
    const source = [
      '<template>',
      `  <div style="--x: bg-[#2c6e33]; color: #2c6e33" :style="{ '--ring': 'ring-[#4a6741]' }" class="bg-[#2c6e33]"></div>`,
      '</template>',
      '<style scoped>',
      '.card { @apply bg-[#2c6e33]; color: #667768; }',
      '</style>',
    ].join('\n')
    const result = rewriteSource(source, { fileName: 'x.vue' })
    assert.equal(result.output, source.replace('class="bg-[#2c6e33]"', 'class="bg-brand-700"'))
    assert.deepEqual(result.leftAlone.map((e) => `${e.text}:${e.reason}`), [
      'bg-[#2c6e33]:style', 'ring-[#4a6741]:style', 'bg-[#2c6e33]:style',
    ])
  })

  test('JS colour strings (chart configs) and SVG attributes — no arbitrary-value brackets', () => {
    const source = `const chart = { color: '#2c6e33', stroke: '#667768' }\n<polyline stroke="#2c6e33" fill="#e2ece3" />`
    assert.equal(rewrite(source, 'chart.ts'), source)
    assert.deepEqual(rewriteSource(source, { fileName: 'chart.ts' }).leftAlone, [])
  })

  test('a type-hinted arbitrary value is never rewritten (reported, not counted by the ratchet)', () => {
    const source = '<i class="bg-[color:#2c6e33] text-[length:#667768]"></i>'
    assert.equal(rewrite(source), source)
    assert.deepEqual(reasons(source), ['bg-[color:#2c6e33]:type-hint', 'text-[length:#667768]:type-hint'])
  })

  test('compound arbitrary values and arbitrary properties', () => {
    const source = '<i class="shadow-[0_1px_2px_#2c6e33] [scrollbar-color:#2c6e33_#f0f4f0] [--c:#2c6e33]"></i>'
    assert.equal(rewrite(source), source)
  })

  test('not a colour utility: unknown prefix, glued prefix, unparseable or dynamic suffix', () => {
    const source = '<i class="xbg-[#2c6e33] foo-text-[#2c6e33] bg-[#2c6e33]x bg-[#2c6e33]/[0.3"></i>'
      + '\n<i :class="`bg-[#2c6e33]/${alpha}`"></i>'
    assert.equal(rewrite(source), source)
    assert.deepEqual(reasons(source), [
      'xbg-[#2c6e33]:no-colour-prefix', 'foo-text-[#2c6e33]:no-colour-prefix', 'bg-[#2c6e33]x:suffix',
      'bg-[#2c6e33]/[0.3:suffix', 'bg-[#2c6e33]/$:suffix',
    ])
  })
})

describe('cascade order (Tailwind v3 sorts one utility\'s rules by class name)', () => {
  test('rewrite that would flip which colour wins on one element is left alone', () => {
    // Before: `.bg-[#f8faf7]` sorts before `.bg-red-50` ("[" < "r") → red-50 wins when both apply.
    // After:  `.bg-red-50` sorts before `.bg-surface` ("r" < "s") → surface would win.
    const source = `<li class="bg-red-50" :class="{ 'bg-[#f8faf7]': selected }"></li>`
    assert.equal(rewrite(source), source)
    assert.deepEqual(reasons(source), ['bg-[#f8faf7]:order'])
  })

  test('two hexes on one element whose names sort the other way are both left alone', () => {
    // Before: [#2c6e33] < [#d12420] → danger wins. After: brand-700 < danger → danger still wins: rewritten.
    assert.equal(
      rewrite('<b class="text-[#2c6e33] hover:text-white" :class="{ \'text-[#d12420]\': bad }"></b>'),
      '<b class="text-brand-700 hover:text-white" :class="{ \'text-danger\': bad }"></b>',
    )
    // Before: [#1e251c] < [#2c6e33] → brand-700 wins. After: brand-700 < ink → ink would win: both stay.
    const flipped = `<b class="text-[#1e251c]" :class="{ 'text-[#2c6e33]': on }"></b>`
    assert.equal(rewrite(flipped), flipped)
    assert.deepEqual(reasons(flipped), ['text-[#1e251c]:order', 'text-[#2c6e33]:order'])
  })

  test('different variants, different utilities or different elements do not interact', () => {
    assert.equal(
      rewrite('<b class="bg-red-50 hover:bg-[#f8faf7] text-[#f8faf7]"></b>\n<b class="bg-[#f8faf7]"></b>\n<b class="bg-red-50"></b>'),
      '<b class="bg-red-50 hover:bg-surface text-surface"></b>\n<b class="bg-surface"></b>\n<b class="bg-red-50"></b>',
    )
  })

  test('in script and .ts files the scope is one line', () => {
    assert.deepEqual(reasons(`const a = active ? 'bg-red-50' : 'bg-[#f8faf7]'`, 'x.ts'), ['bg-[#f8faf7]:order'])
    assert.equal(rewrite(`const a = 'bg-red-50'\nconst b = 'bg-[#f8faf7]'`, 'x.ts'), `const a = 'bg-red-50'\nconst b = 'bg-surface'`)
  })
})

describe('properties of the whole run', () => {
  const SAMPLE = [
    '<template>',
    `  <div class="bg-[#2c6e33] text-white hover:bg-[#1e4620]/90 border-[#2c6e34]" :class="{ 'ring-[#4a6741]': f }">`,
    `    <span style="color: #2c6e33" class="text-[#667768] text-[#9a8b7c]">x</span>`,
    '  </div>',
    '</template>',
    '<script setup lang="ts">',
    `const pill = 'bg-[#f0f7f1] text-[#2C6E33]'`,
    '</script>',
  ].join('\n')

  test('idempotent: a second run changes nothing', () => {
    const once = rewrite(SAMPLE)
    assert.notEqual(once, SAMPLE)
    const twice = rewriteSource(once, { fileName: 'sample.vue' })
    assert.equal(twice.output, once)
    assert.equal(twice.rewrites.length, 0)
  })

  test('every [#hex] the ratchet counts is either rewritten or reported as left alone', () => {
    const result = rewriteSource(SAMPLE, { fileName: 'sample.vue' })
    const leftCounted = result.leftAlone.filter((e) => e.reason !== 'type-hint').length
    assert.equal(result.rewrites.length + leftCounted, ratchetCount(SAMPLE))
    assert.equal(ratchetCount(result.output), leftCounted)
  })

  test('per-file report: replacement count, value→token counts, then what was left alone', () => {
    // `text-[#667768]` shares the <span> with `text-[#9a8b7c]`: today "[#9…" sorts last and
    // wins; renamed to `text-ink-muted` it would sort after "[" and win instead → left alone.
    const result = rewriteSource(SAMPLE, { fileName: 'sample.vue' })
    assert.equal(
      formatFileReport('app/sample.vue', result),
      'app/sample.vue: 5 replacements (#2c6e33→brand-700 ×2, #1e4620→brand-900 ×1, #4a6741→brand-600 ×1, #f0f7f1→surface-tint ×1)\n'
        + '  left alone: 3 (#2c6e34 ×1 unmapped, #667768 ×1 order, #9a8b7c ×1 unmapped)',
    )
    assert.equal(formatFileReport('app/clean.vue', rewriteSource('<i class="p-2"></i>', { fileName: 'clean.vue' })), '')
    assert.equal(
      formatFileReport('app/left.vue', rewriteSource('<i class="bg-[#9a8b7c]"></i>', { fileName: 'left.vue' })),
      'app/left.vue: 0 replacements\n  left alone: 1 (#9a8b7c ×1 unmapped)',
    )
  })

  test('summary: totals, per directory, top unmapped values, reasons', () => {
    const entries = [
      { file: 'app/a/one.vue', result: rewriteSource(SAMPLE, { fileName: 'one.vue' }) },
      { file: 'app/b/two.ts', result: rewriteSource(`const x = 'bg-[#9a8b7c] text-[#2c6e33]'`, { fileName: 'two.ts' }) },
      { file: 'app/b/three.ts', result: rewriteSource(`const y = 'p-2'`, { fileName: 'three.ts' }) },
    ]
    const summary = formatSummary(entries, { write: false })
    assert.match(summary, /DRY RUN — no file written/)
    assert.match(summary, /files: 3 scanned, 2 with replacements\nreplacements: 6\nleft alone: 4 \(unmapped 3, order 1\)/)
    assert.match(summary, /\n {2}app\/a: 5 replacements in 1 file \(3 left alone\)\n {2}app\/b: 1 replacement in 1 file \(1 left alone\)\n/)
    assert.match(summary, /top unmapped values:\n {2}#9a8b7c 2\n {2}#2c6e34 1/)
    assert.match(formatSummary(entries, { write: true }), /WRITTEN/)
  })
})

describe('CLI', () => {
  const makeTree = () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'codemod-hex-'))
    mkdirSync(path.join(dir, 'nested'))
    writeFileSync(path.join(dir, 'nested', 'A.vue'), '<template><i class="bg-[#2c6e33]"></i></template>\n')
    writeFileSync(path.join(dir, 'b.ts'), `export const c = 'text-[#667768]'\n`)
    writeFileSync(path.join(dir, 'skip.css'), '.x { color: #2c6e33 }\n')
    return dir
  }

  test('collects .vue/.ts/.js files under each directory, sorted', () => {
    const dir = makeTree()
    try {
      assert.deepEqual(collectFiles([dir]).map((file) => path.relative(dir, file)), ['b.ts', path.join('nested', 'A.vue')])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('dry run by default writes nothing; --write writes', () => {
    const dir = makeTree()
    const lines: string[] = []
    const io = { log: (line: string) => lines.push(line), error: (line: string) => lines.push(`ERR ${line}`) }
    try {
      assert.equal(main([dir], io), 0)
      assert.equal(readFileSync(path.join(dir, 'nested', 'A.vue'), 'utf8'), '<template><i class="bg-[#2c6e33]"></i></template>\n')
      assert.match(lines.join('\n'), /A\.vue: 1 replacement \(#2c6e33→brand-700 ×1\)/)
      assert.match(lines.join('\n'), /DRY RUN/)

      assert.equal(main(['--write', dir], io), 0)
      assert.equal(readFileSync(path.join(dir, 'nested', 'A.vue'), 'utf8'), '<template><i class="bg-brand-700"></i></template>\n')
      assert.equal(readFileSync(path.join(dir, 'b.ts'), 'utf8'), `export const c = 'text-ink-muted'\n`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('rejects unknown flags and a missing directory', () => {
    const lines: string[] = []
    const io = { log: (line: string) => lines.push(line), error: (line: string) => lines.push(line) }
    assert.equal(main(['--wrte', 'app'], io), 2)
    assert.equal(main([], io), 2)
    assert.equal(main([path.join(tmpdir(), 'codemod-hex-does-not-exist')], io), 2)
  })

  test('runs under plain `node --experimental-strip-types` (no ts-resolver), dry run', () => {
    const dir = makeTree()
    try {
      const run = spawnSync(process.execPath, ['--experimental-strip-types', SCRIPT, dir], { encoding: 'utf8', cwd: ROOT })
      assert.equal(run.status, 0, run.stderr)
      assert.match(run.stdout, /b\.ts: 1 replacement \(#667768→ink-muted ×1\)/)
      assert.equal(readFileSync(path.join(dir, 'b.ts'), 'utf8'), `export const c = 'text-[#667768]'\n`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

/**
 * `--merges` (decision D-T1, task 3.7): the hexes of shared/color-merges.ts fold into a token
 * although they differ from it. Off by default; on, every guard above applies to them too.
 */
describe('--merges: the approved merge table', () => {
  const merged = (source: string, fileName = 'sample.vue') => rewriteSource(source, { fileName, merges: COLOR_MERGES })
  const mergedReasons = (source: string, fileName = 'sample.vue') => merged(source, fileName).leftAlone.map((e) => `${e.text}:${e.reason}`)

  test('off by default; on, a merged hex becomes its token, variants, ! and opacity kept', () => {
    const source = '<p class="bg-[#f8faf8] hover:!border-[#E2E8DF]/40 md:text-[#556450] group-hover/x:bg-[#fff4f3]/[0.5]"></p>'
    assert.equal(rewrite(source), source)
    assert.deepEqual(reasons(source).map((r) => r.split(':').at(-1)), ['unmapped', 'unmapped', 'unmapped', 'unmapped'])
    assert.equal(merged(source).output, '<p class="bg-surface hover:!border-line/40 md:text-ink-soft group-hover/x:bg-danger-bg/[0.5]"></p>')
  })

  test('the two modes do not share a cached mapping (one process may run both)', () => {
    const source = '<i class="bg-[#f8faf8]"></i>'
    assert.equal(rewrite(source), source)
    assert.equal(merged(source).output, '<i class="bg-surface"></i>')
    assert.equal(rewrite(source), source)
  })

  test('an exact match still wins; in a merge run every rewrite carries its ΔE (0 when exact)', () => {
    const result = merged('<i class="bg-[#2c6e33] text-[#e2e8df] border-[#e2e8df] fill-[#2d5a27]"></i>')
    assert.deepEqual(result.rewrites.map((r) => [r.value, r.token, r.dE, r.rule]), [
      ['#2c6e33', 'brand-700', 0, undefined],
      ['#e2e8df', 'line', 1.79, 'near'],
      ['#e2e8df', 'line', 1.79, 'near'],
    ])
    // A held fold (#2d5a27 measured ΔE 5.95 from brand-800) is not in the table: it stays.
    assert.deepEqual(result.leftAlone.map((e) => `${e.value}:${e.reason}`), ['#2d5a27:unmapped'])
    assert.equal(
      formatFileReport('app/x.vue', result),
      'app/x.vue: 3 replacements (#e2e8df→line (ΔE 1.79) ×2, #2c6e33→brand-700 (ΔE 0) ×1)\n  left alone: 1 (#2d5a27 ×1 unmapped)',
    )
    // Without merges, no ΔE at all: the report of an exact-only run is unchanged.
    assert.equal(rewrite('<i class="bg-[#2c6e33]"></i>'), '<i class="bg-brand-700"></i>')
    assert.equal(rewriteSource('<i class="bg-[#2c6e33]"></i>', { fileName: 'x.vue' }).rewrites[0]!.dE, undefined)
  })

  test('the summary buckets the colour changes of a merge run', () => {
    const entries = [{ file: 'app/a.vue', result: merged('<i class="bg-[#2c6e33] text-[#e2e8df] border-[#556450] fill-[#f8faf8]/50"></i>') }]
    assert.match(
      formatSummary(entries, { write: false }),
      /\ncolour changes \(merge table\): 3 of 4 replacements \(ΔE <1 1, ΔE 1–2 1, ΔE 2–3 1, ΔE ≥3 0; max ΔE 2\.95\)/,
    )
    const plain = [{ file: 'app/a.vue', result: rewriteSource('<i class="bg-[#2c6e33]"></i>', { fileName: 'a.vue' }) }]
    assert.doesNotMatch(formatSummary(plain, { write: false }), /colour changes/)
  })

  test('the table is validated before use', () => {
    assert.equal(buildMergeMap(COLOR_TOKENS, COLOR_MERGES).size, Object.keys(COLOR_MERGES).length)
    assert.throws(() => buildMergeMap(COLOR_TOKENS, { '#f8faf8': { token: 'nope', dE: 1 } }), /not a token/)
    assert.throws(() => buildMergeMap(COLOR_TOKENS, { '#2c6e33': { token: 'brand-700', dE: 1 } }), /exact value of brand-700/)
    assert.throws(() => buildMergeMap(COLOR_TOKENS, { '#F8FAF8': { token: 'surface', dE: 1 } }), /lowercase 6-digit/)
    assert.throws(() => buildMergeMap(COLOR_TOKENS, { '#f8faf8': { token: 'surface', dE: 0 } }), /positive/)
    assert.throws(() => rewriteSource('<i></i>', { fileName: 'x.vue', merges: { '#f8faf8': { token: 'nope', dE: 1 } } }), /not a token/)
  })

  test('the cascade-order guard applies to a merged value', () => {
    // Before: `bg-[#f8faf8]` sorts before `bg-red-50` → red-50 wins. As `bg-surface` it would win.
    const source = `<li class="bg-red-50" :class="{ 'bg-[#f8faf8]': selected }"></li>`
    assert.equal(merged(source).output, source)
    assert.deepEqual(mergedReasons(source), ['bg-[#f8faf8]:order'])
  })

  test('two hexes that would become one token on one element are both left alone (the guard is not loosened)', () => {
    const source = `<b class="text-[#2c3e2e]" :class="{ 'text-[#2c3e2d]': on }"></b>`
    // Exact only: the anchor is renamed, its near-duplicate stays — the order holds.
    assert.equal(rewrite(source), `<b class="text-ink-admin" :class="{ 'text-[#2c3e2d]': on }"></b>`)
    // With merges both would be `text-ink-admin`: no longer two rules in a known order → both stay.
    assert.equal(merged(source).output, source)
    assert.deepEqual(mergedReasons(source), ['text-[#2c3e2e]:order', 'text-[#2c3e2d]:order'])
  })

  test('idempotent, and every [#hex] the ratchet counts is rewritten or reported', () => {
    const source = [
      '<template>',
      `  <div class="bg-[#f4f7f4] border-[#dfe9e0] hover:bg-[#2c6e33]" :class="{ 'text-[#556450]': f }">`,
      `    <span class="text-[#8a9a88] bg-[#fce8e8] text-[#e4f2e5]/50">x</span>`,
      '  </div>',
      '</template>',
    ].join('\n')
    const once = merged(source)
    assert.notEqual(once.output, source)
    const twice = merged(once.output)
    assert.equal(twice.output, once.output)
    assert.equal(twice.rewrites.length, 0)
    const leftCounted = once.leftAlone.filter((e) => e.reason !== 'type-hint').length
    assert.equal(once.rewrites.length + leftCounted, ratchetCount(source))
    assert.equal(ratchetCount(once.output), leftCounted)
  })
})

describe('a decorative-only token (accent, 2.5:1 on white) never becomes a focus indicator', () => {
  test('rings, outlines and any colour under a focus variant keep their hex', () => {
    const source = '<a class="ring-[#7cb342] outline-[#7CB342] focus-visible:border-[#7cb342] group-focus-within/x:text-[#7cb342]/40 focus:!bg-[#7cb342] hover:ring-[#7cb342]/40"></a>'
    for (const result of [rewriteSource(source, { fileName: 'x.vue' }), rewriteSource(source, { fileName: 'x.vue', merges: COLOR_MERGES })]) {
      assert.equal(result.output, source)
      assert.deepEqual(result.leftAlone.map((e) => e.reason), ['indicator', 'indicator', 'indicator', 'indicator', 'indicator', 'indicator'])
    }
  })

  test('decorative uses are renamed', () => {
    assert.equal(
      rewrite('<a class="text-[#7cb342] border-[#7cb342] hover:border-[#7cb342] bg-[#7cb342]/20 ring-offset-[#7cb342] via-[#7CB342]"></a>'),
      '<a class="text-accent border-accent hover:border-accent bg-accent/20 ring-offset-accent via-accent"></a>',
    )
    // Any other token keeps its focus rings: brand-600 is the focus colour.
    assert.equal(rewrite('<a class="focus-visible:ring-[#4a6741] focus:border-[#4a6741]"></a>'), '<a class="focus-visible:ring-brand-600 focus:border-brand-600"></a>')
  })
})

describe('CLI --merges', () => {
  test('dry run reports each hex → token with its ΔE; --write --merges writes; without the flag the merge stays', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'codemod-hex-merges-'))
    const file = path.join(dir, 'A.vue')
    writeFileSync(file, '<template><i class="bg-[#f8faf8] text-[#2c6e33]"></i></template>\n')
    const lines: string[] = []
    const io = { log: (line: string) => lines.push(line), error: (line: string) => lines.push(`ERR ${line}`) }
    try {
      assert.equal(main(['--write', dir], io), 0)
      assert.equal(readFileSync(file, 'utf8'), '<template><i class="bg-[#f8faf8] text-brand-700"></i></template>\n')
      lines.length = 0
      assert.equal(main(['--merges', dir], io), 0)
      assert.match(lines.join('\n'), /A\.vue: 1 replacement \(#f8faf8→surface \(ΔE 0\.51\) ×1\)/)
      assert.equal(readFileSync(file, 'utf8'), '<template><i class="bg-[#f8faf8] text-brand-700"></i></template>\n')
      assert.equal(main(['--write', '--merges', dir], io), 0)
      assert.equal(readFileSync(file, 'utf8'), '<template><i class="bg-surface text-brand-700"></i></template>\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
