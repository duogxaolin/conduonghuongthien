import assert from 'node:assert/strict'
import test from 'node:test'
import { ratchet, type FileRatchet } from './_ratchet'

/**
 * Hex-colour ratchet (wave3-long-term D-R, task 1.1).
 *
 * Counts arbitrary Tailwind hex classes — `bg-[#2c6e33]`, `text-[#667768]/80`,
 * `border-[#E2ECE3]` — per file in `app/**\/*.vue` and `app/**\/*.ts`. They are what the
 * colour-token migration (D-TOKENS) replaces with semantic tokens (`bg-brand-700`), one
 * directory per PR. A new file starts at 0: use a token, or an existing one.
 *
 * Baseline: tests/ratchets/hex-colors.baseline.json. Regenerate (lowers only):
 *   node --experimental-strip-types --import ./scripts/ts-resolver.mjs tests/ratchets/hex-colors.test.ts --update
 */

const HEX_CLASS = /\[#[0-9a-fA-F]{3,8}\]/g

export const HEX_COLORS: FileRatchet = {
  name: 'hex-colors',
  unit: 'hex colour classes',
  defaultForNewFiles: 0,
  inScope: file => /^app\/.+\.(?:vue|ts)$/.test(file),
  measure: text => text.match(HEX_CLASS)?.length ?? 0,
  hint: 'Use a semantic colour token from tailwind.config.js instead of an arbitrary `[#hex]` class (design D-TOKENS).',
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

  test('hex-colors: measures .vue and .ts under app/ only', () => {
    for (const file of ['app/app.vue', 'app/components/admin/Foo.vue', 'app/utils/colors.ts']) assert.ok(HEX_COLORS.inScope(file), file)
    for (const file of ['server/utils/x.ts', 'tailwind.config.js', 'app/assets/css/main.css', 'tests/x.test.ts', 'shared/x.ts']) {
      assert.ok(!HEX_COLORS.inScope(file), file)
    }
  })
})
