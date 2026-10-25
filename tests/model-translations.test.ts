import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test, { mock } from 'node:test'

/**
 * `server/utils/ai/model-translations.ts` — what a model's answer to "translate these
 * UI strings" may put in `lang_translations.value`. Before it, each AI path read the
 * answer its own way and let non-text through (`String(p.value)` → "null",
 * "undefined", "[object Object]"; a number stored as is; a model-invented key stored as
 * a new row). The HTTP paths are run end to end in
 * tests/language-translations-write-behavior.test.ts; here: the reader's rules, and
 * the auto-translation of a new category/content type, which runs in the background.
 */

const upserts: Array<{ code: string, items: unknown[] }> = []
let answer = ''
mock.module('../server/services/ai-gateway', { namedExports: { callAi: async () => ({ ok: true, text: answer }) } })
mock.module('../server/services/languages', {
  namedExports: {
    DEFAULT_LANGUAGES: [{ code: 'vi', name: 'Vietnamese' }, { code: 'en', name: 'English' }],
    upsertTranslations: async (_actor: unknown, code: string, items: unknown[]) => { upserts.push({ code, items }) },
  },
})

const { modelSingleTranslation, modelTranslationText, readModelTranslations } = await import('../server/utils/ai/model-translations')
const { autoTranslateCategory } = await import('../server/services/i18n-auto-translate')

test('only a non-blank string is a translation; "null"/"undefined" in any case are not', () => {
  assert.equal(modelTranslationText(' Accueil '), 'Accueil')
  for (const raw of [null, undefined, 5, true, {}, [], '', '   ', 'null', 'NULL', ' undefined ', 'Undefined']) {
    assert.equal(modelTranslationText(raw), null, JSON.stringify(raw))
  }
  assert.equal(modelTranslationText('nullable'), 'nullable', 'a word that only starts like it is text')
})

test('a single answer loses one pair of wrapping quotes, as the prompt asks for bare text', () => {
  assert.equal(modelSingleTranslation('"Actualités"'), 'Actualités')
  assert.equal(modelSingleTranslation("'News'"), 'News')
  assert.equal(modelSingleTranslation('"null"'), null)
  assert.equal(modelSingleTranslation('  '), null)
})

test('the JSON reader keeps asked-for keys with their group, first answer wins, and tolerates a fence', () => {
  const requested = [{ group: 'nav', key: 'home' }, { group: 'footer', key: 'about' }]
  const text = '```json\n' + JSON.stringify([
    { key: 'about', value: 'About' },
    { key: 'home', value: 'Home' },
    { key: 'home', value: 'Home again' },
    { key: 'invented', value: 'Nope' },
    'not an object',
    null,
    { value: 'no key' },
  ]) + '\n```'
  assert.deepEqual(readModelTranslations(text, requested), [
    { group: 'footer', key: 'about', value: 'About' },
    { group: 'nav', key: 'home', value: 'Home' },
  ])
})

test('an answer that is not a JSON array is no answer at all', () => {
  const requested = [{ group: 'nav', key: 'home' }]
  for (const text of ['', 'Xin lỗi, tôi không thể dịch.', '{"key":"home","value":"Home"}', '[{"key":"home","value":"Home"}']) {
    assert.deepEqual(readModelTranslations(text, requested), [], text)
  }
})

test('auto-translation of a new category stores only real text (RED before: the model\'s "null" was stored)', async () => {
  answer = JSON.stringify([{ key: 'cat_tin-tuc', value: 'News' }, { key: 'cat_tin-tuc_desc', value: 'null' }, { key: 'cat_other', value: 'Other' }])
  await autoTranslateCategory({ id: 1 } as never, 'tin-tuc', 'Tin tức', 'Tin hoạt động')
  for (let i = 0; i < 20 && upserts.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(upserts, [
    { code: 'vi', items: [{ group: 'categories', key: 'cat_tin-tuc', value: 'Tin tức' }, { group: 'categories', key: 'cat_tin-tuc_desc', value: 'Tin hoạt động' }] },
    { code: 'en', items: [{ group: 'categories', key: 'cat_tin-tuc', value: 'News' }] },
  ])
})

test('the universal "Dịch toàn cục" job reads model answers through the same reader (no String(p.value))', () => {
  const source = readFileSync(new URL('../server/services/universal-translation.ts', import.meta.url), 'utf8')
  assert.ok(/readModelTranslations\(res\.text, chunk\)/.test(source), 'the UI step reads the answer with readModelTranslations')
  assert.ok(!/String\(p\.value\)/.test(source), 'no String(p.value) left in the UI step')
})
