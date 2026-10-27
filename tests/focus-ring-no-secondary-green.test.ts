/**
 * No focus indicator anywhere in `app/` or `shared/` uses `#7CB342` (spec public-accessibility,
 * design D9).
 *
 * `tests/focus-ring-contrast.test.ts` checks five named files. Thirteen others —
 * article page, comments, profile, chat, notification bell, list pages, search,
 * carousel — still drew their focus ring in the secondary green, 2.50:1 on white:
 * a keyboard user could barely see where they were. This sweep covers every file,
 * every `focus*:` variant (`focus:`, `focus-visible:`, `focus-within:`, group
 * variants), and ring, outline and border alike, translucent halos included.
 *
 * On the two dark-green floating launchers the indicator is a white ring with a
 * dark offset (`ring-white ring-offset-2 ring-offset-[#1e4620]`): on a light page
 * the 2 px dark band is what changes, on a dark section the white ring is.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { COLOR_MERGES } from '../shared/color-merges.ts'
import { COLOR_TOKENS, DECORATIVE_ONLY_TOKENS } from '../shared/color-tokens.ts'

const repo = new URL('../', import.meta.url)
const root = new URL('app/', repo)
// shared/ cũng giữ lớp Tailwind mà giao diện vẽ (registry block, huy hiệu trạng thái đơn).
const roots = [root, new URL('shared/', repo)]

function walk(dir: URL): URL[] {
  const files: URL[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir)
    if (entry.isDirectory()) files.push(...walk(child))
    else if (/\.(vue|ts)$/.test(entry.name)) files.push(child)
  }
  return files
}

test('no focus ring, outline or focus border uses #7CB342', () => {
  const offenders: string[] = []
  for (const file of roots.flatMap(walk)) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/[\w:-]*focus[\w-]*:[^\s"'`]*\[#7cb342\][^\s"'`]*/gi)) {
      const line = source.slice(0, match.index).split('\n').length
      offenders.push(`${file.pathname.slice(repo.pathname.length)}:${line} ${match[0]}`)
    }
  }
  assert.deepEqual(offenders, [], 'use #4A6741 (white ring + dark offset on dark green)')
})

/**
 * Since D-T1 (task 3.7) `#7CB342` has a token name, `accent` (shared/color-tokens.ts,
 * DECORATIVE_ONLY_TOKENS). The hex sweep above cannot see that spelling, so this one forbids
 * the name of every decorative-only token: as any ring or outline colour (focused or not),
 * and as any colour under a focus variant. The codemod never emits these
 * (scripts/codemod-hex-tokens.ts, reason `indicator`); this catches a hand-written one.
 */
const DECORATIVE = DECORATIVE_ONLY_TOKENS.map((name) => name.replace(/-/g, '\\-')).join('|')
const OPACITY = '(?:\\/(?:\\d+(?:\\.\\d+)?|\\[[^\\]\\s]+\\]))?'
const DECORATIVE_INDICATOR = new RegExp(
  `(?<![\\w-])[^\\s"'\`]*?(?:(?<![\\w-])(?:ring|outline)-(?:${DECORATIVE})|focus[\\w-]*:[^\\s"'\`]*?-(?:${DECORATIVE}))${OPACITY}(?![\\w-])`,
  'g',
)

test('the decorative-only token sweep reads every spelling it must forbid (not vacuous)', () => {
  assert.deepEqual([...DECORATIVE_ONLY_TOKENS], ['accent'])
  const hits = (text: string) => [...text.matchAll(DECORATIVE_INDICATOR)].map((m) => m[0])
  assert.deepEqual(
    hits('ring-accent hover:ring-accent/40 outline-accent focus-visible:border-accent focus:!text-accent/[0.5] group-focus-within/x:ring-accent'),
    ['ring-accent', 'hover:ring-accent/40', 'outline-accent', 'focus-visible:border-accent', 'focus:!text-accent/[0.5]', 'group-focus-within/x:ring-accent'],
  )
  // Decorative uses, and other tokens, are not indicators.
  assert.deepEqual(hits('text-accent border-accent hover:border-accent bg-accent/20 ring-offset-accent accent-accent focus-visible:ring-brand-600 ring-accent-x'), [])
  // The hex spelling of the token (and of anything merged into it) is the sweep above.
  const spellings = [COLOR_TOKENS.accent, ...Object.entries(COLOR_MERGES).filter(([, m]) => m.token === 'accent').map(([hex]) => hex)]
  assert.deepEqual(spellings, ['#7cb342'], 'a hex merged into accent needs its own entry in the hex sweep')
})

test('no ring, outline or focus colour uses a decorative-only token (accent)', () => {
  const files = roots.flatMap(walk)
  assert.ok(files.length > 300, `only ${files.length} files under app/ and shared/`)
  const offenders: string[] = []
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(DECORATIVE_INDICATOR)) {
      const line = source.slice(0, match.index).split('\n').length
      offenders.push(`${file.pathname.slice(repo.pathname.length)}:${line} ${match[0]}`)
    }
  }
  assert.deepEqual(offenders, [], 'accent (#7CB342) reaches 2.5:1 on white: use brand-600 for a focus indicator')
})

/**
 * The launchers' dark green `#1e4620` — written as its token (`brand-900`) or as that token's
 * hex in an arbitrary class; both read from COLOR_TOKENS, so neither spelling is pinned here.
 */
const DARK_GREEN = `(?:brand-900|\\[${COLOR_TOKENS['brand-900']}\\])`

test('the two dark launchers carry a white ring with a dark offset', () => {
  let launchers = 0
  for (const [file, marker] of [
    ['components/ChatWidget.vue', /chatbot-toggle-btn/],
    ['components/SocialBubble.client.vue', new RegExp(`from-${DARK_GREEN} to-\\[#153317\\]`, 'i')],
  ] as const) {
    const source = readFileSync(new URL(file, root), 'utf8')
    const classLine = source.split('\n').find(line => marker.test(line) && line.includes('class='))
    assert.ok(classLine, `${file}: launcher class not found`)
    launchers += 1
    assert.match(classLine!, /focus-visible:ring-white\b/, `${file}: launcher focus ring is not white`)
    assert.match(classLine!, /focus-visible:ring-offset-2\b/)
    assert.match(classLine!, new RegExp(`focus-visible:ring-offset-${DARK_GREEN}(?![\\w-])`, 'i'))
  }
  assert.equal(launchers, 2, 'both launchers were found and checked')
})
