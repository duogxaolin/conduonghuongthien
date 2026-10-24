/**
 * No focus indicator anywhere in `app/` uses `#7CB342` (spec public-accessibility,
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

const root = new URL('../app/', import.meta.url)

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
  for (const file of walk(root)) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/[\w:-]*focus[\w-]*:[^\s"'`]*\[#7cb342\][^\s"'`]*/gi)) {
      const line = source.slice(0, match.index).split('\n').length
      offenders.push(`${file.pathname.split('/app/')[1]}:${line} ${match[0]}`)
    }
  }
  assert.deepEqual(offenders, [], 'use #4A6741 (white ring + dark offset on dark green)')
})

test('the two dark launchers carry a white ring with a dark offset', () => {
  for (const [file, marker] of [
    ['components/ChatWidget.vue', 'chatbot-toggle-btn'],
    ['components/SocialBubble.client.vue', 'from-[#1e4620] to-[#153317]'],
  ] as const) {
    const source = readFileSync(new URL(file, root), 'utf8')
    const classLine = source.split('\n').find(line => line.includes(marker) && line.includes('class='))
    assert.ok(classLine, `${file}: launcher class not found`)
    assert.match(classLine!, /focus-visible:ring-white\b/, `${file}: launcher focus ring is not white`)
    assert.match(classLine!, /focus-visible:ring-offset-2\b/)
    assert.match(classLine!, /focus-visible:ring-offset-\[#1e4620\]/)
  }
})
