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
  collectFiles,
  formatFileReport,
  formatSummary,
  main,
  rewriteSource,
} from '../scripts/codemod-hex-tokens.ts'
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
  test('near-duplicates of a token value', () => {
    const source = '<i class="bg-[#2c6e34] text-[#2c3e2e] border-[#e2e8df] bg-[#f8faf8]"></i>'
    assert.equal(rewrite(source), source)
    assert.deepEqual(reasons(source), [
      'bg-[#2c6e34]:unmapped', 'text-[#2c3e2e]:unmapped', 'border-[#e2e8df]:unmapped', 'bg-[#f8faf8]:unmapped',
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
    `    <span style="color: #2c6e33" class="text-[#667768] text-[#8ed694]">x</span>`,
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
    // `text-[#667768]` shares the <span> with `text-[#8ed694]`: today "[#8…" sorts last and
    // wins; renamed to `text-ink-muted` it would sort after "[" and win instead → left alone.
    const result = rewriteSource(SAMPLE, { fileName: 'sample.vue' })
    assert.equal(
      formatFileReport('app/sample.vue', result),
      'app/sample.vue: 5 replacements (#2c6e33→brand-700 ×2, #1e4620→brand-900 ×1, #4a6741→brand-600 ×1, #f0f7f1→surface-tint ×1)\n'
        + '  left alone: 3 (#2c6e34 ×1 unmapped, #667768 ×1 order, #8ed694 ×1 unmapped)',
    )
    assert.equal(formatFileReport('app/clean.vue', rewriteSource('<i class="p-2"></i>', { fileName: 'clean.vue' })), '')
    assert.equal(
      formatFileReport('app/left.vue', rewriteSource('<i class="bg-[#8ed694]"></i>', { fileName: 'left.vue' })),
      'app/left.vue: 0 replacements\n  left alone: 1 (#8ed694 ×1 unmapped)',
    )
  })

  test('summary: totals, per directory, top unmapped values, reasons', () => {
    const entries = [
      { file: 'app/a/one.vue', result: rewriteSource(SAMPLE, { fileName: 'one.vue' }) },
      { file: 'app/b/two.ts', result: rewriteSource(`const x = 'bg-[#8ed694] text-[#2c6e33]'`, { fileName: 'two.ts' }) },
      { file: 'app/b/three.ts', result: rewriteSource(`const y = 'p-2'`, { fileName: 'three.ts' }) },
    ]
    const summary = formatSummary(entries, { write: false })
    assert.match(summary, /DRY RUN — no file written/)
    assert.match(summary, /files: 3 scanned, 2 with replacements\nreplacements: 6\nleft alone: 4 \(unmapped 3, order 1\)/)
    assert.match(summary, /\n {2}app\/a: 5 replacements in 1 file \(3 left alone\)\n {2}app\/b: 1 replacement in 1 file \(1 left alone\)\n/)
    assert.match(summary, /top unmapped values:\n {2}#8ed694 2\n {2}#2c6e34 1/)
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
