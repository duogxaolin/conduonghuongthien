import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { hardcodedDictionary } from '../app/composables/i18n-default-dictionary'
import { BLOCK_REGISTRY } from '../app/utils/blocks/registry'
import { OLD_HERO_DEFAULTS, resolveHeroContent } from '../app/utils/blocks/hero-content'
import { safeLinkOrNull } from '../shared/link-policy'
import { renderSfcTemplate } from './_render-sfc-template'

/**
 * Hero buttons follow the page builder (spec hero-block, design D21).
 *
 * The registry offered "Nút 1/Nút 2 — nhãn / liên kết" fields, editors saved
 * them, and `HeroBlock.vue` ignored them: the labels and links were hard-coded,
 * so nothing an editor typed ever reached the page. Now the stored value renders
 * (pick order of the title: translation → own value → dictionary → default), an
 * empty label hides its button, and a value equal to the OLD registry default
 * counts as unset so pages saved before this change look exactly as they did.
 */

const HERO = new URL('../app/components/blocks/HeroBlock.vue', import.meta.url).pathname
const tFor = (lang: string) => (key: string) => hardcodedDictionary[lang]?.[key] ?? key

async function render(data: Record<string, unknown>, lang: 'vi' | 'en') {
  const d = resolveHeroContent(data, lang, tFor(lang))
  const bgImage = d.bgImage || '/assets/hero_banner.jpg'
  return renderSfcTemplate(HERO, {
    d,
    bgImage,
    isDefaultHero: bgImage === '/assets/hero_banner.jpg',
    t: tFor(lang),
    safeLinkOrNull,
  })
}

/** The `<a>`/`<nuxt-link>` element holding a given icon, as text. */
const button = (html: string, icon: string) => {
  const match = new RegExp(`<(a|nuxt-link)[^>]*>(?:(?!</(?:a|nuxt-link)>).)*${icon}(?:(?!</(?:a|nuxt-link)>).)*</(?:a|nuxt-link)>`, 's').exec(html)
  return match?.[0] ?? null
}
const about = (html: string) => button(html, 'fa-circle-info')
const help = (html: string) => button(html, 'fa-headset')

test('vi: an edited label and link render as configured', async () => {
  const html = await render({ btnHelpText: 'Liên hệ hỗ trợ', btnHelpLink: '/contact' }, 'vi')
  assert.match(help(html) ?? '', /href="\/contact"/)
  assert.match(help(html) ?? '', /Liên hệ hỗ trợ/)
  assert.doesNotMatch(html, /Gửi yêu cầu trợ giúp/)
})

test('vi: an empty label hides its button', async () => {
  const html = await render({ btnAboutText: '', btnHelpText: 'Gửi yêu cầu trợ giúp' }, 'vi')
  assert.equal(about(html), null, 'the editor switched the about button off')
  assert.ok(help(html))
})

test('vi: pages saved with the old registry defaults keep today\'s labels and links', async () => {
  const html = await render({ ...OLD_HERO_DEFAULTS }, 'vi')
  assert.match(about(html) ?? '', /to="\/about"/)
  assert.match(about(html) ?? '', /Về chúng tôi/)
  assert.match(help(html) ?? '', /href="#tro-giup"/)
  assert.match(help(html) ?? '', /Gửi yêu cầu trợ giúp/)
  assert.doesNotMatch(html, /Nhận hỗ trợ 24\/7/, 'the old default label leaked onto an untouched page')
})

test('vi: legacy hero rows (boolean btnAbout/btnHelp, no labels) render today\'s buttons', async () => {
  const html = await render({ title: 'x', btnAbout: true, btnHelp: true }, 'vi')
  assert.match(about(html) ?? '', /Về chúng tôi/)
  assert.match(help(html) ?? '', /Gửi yêu cầu trợ giúp/)
})

test('an unsafe stored link is blanked to the default target', async () => {
  for (const lang of ['vi', 'en'] as const) {
    const html = await render({ btnAboutLink: 'javascript:alert(1)', btnHelpLink: 'JaVa\tScRiPt:alert(2)' }, lang)
    assert.doesNotMatch(html, /script:alert/i)
    assert.match(about(html) ?? '', /to="\/about"/)
    assert.match(help(html) ?? '', /href="#tro-giup"/)
  }
})

test('en: old defaults and untouched rows show the English dictionary labels', async () => {
  const html = await render({ ...OLD_HERO_DEFAULTS }, 'en')
  assert.match(about(html) ?? '', /About Us/)
  assert.match(help(html) ?? '', /Request Support/)
  assert.doesNotMatch(html, /Về chúng tôi|Gửi yêu cầu trợ giúp|Nhận hỗ trợ/)
})

test('en: a translation wins; the configured link applies in every language', async () => {
  const html = await render({
    btnHelpText: 'Liên hệ hỗ trợ',
    btnHelpLink: '/contact',
    translations: { en: { btnHelpText: 'Contact support' } },
  }, 'en')
  assert.match(help(html) ?? '', /Contact support/)
  assert.match(help(html) ?? '', /href="\/contact"/)
})

test('en: an untranslated Vietnamese label falls back to the dictionary, as the title does', async () => {
  const html = await render({ btnHelpText: 'Liên hệ hỗ trợ', btnHelpLink: '/contact' }, 'en')
  assert.match(help(html) ?? '', /Request Support/)
  assert.match(help(html) ?? '', /href="\/contact"/)
})

test('en: a button switched off in the block stays off', async () => {
  const html = await render({ btnAboutText: '' }, 'en')
  assert.equal(about(html), null)
})

test('the registry offers today\'s labels as defaults, and the old ones are the previous defaults', () => {
  const defaults = BLOCK_REGISTRY.hero!.defaultData as Record<string, unknown>
  assert.equal(defaults.btnAboutText, 'Về chúng tôi')
  assert.equal(defaults.btnAboutLink, '/about')
  assert.equal(defaults.btnHelpText, 'Gửi yêu cầu trợ giúp')
  assert.equal(defaults.btnHelpLink, '#tro-giup')
  // What `20073b4` shipped and editors saved since — never edit these.
  assert.deepEqual({ ...OLD_HERO_DEFAULTS }, {
    btnAboutText: 'Về chúng tôi',
    btnAboutLink: '/about',
    btnHelpText: 'Nhận hỗ trợ 24/7',
    btnHelpLink: '#tro-giup',
  })
})

test('HeroBlock reads its content through the resolver and no longer reads the dead fields', () => {
  const source = readFileSync(HERO, 'utf8')
  assert.match(source, /resolveHeroContent\(/)
  assert.doesNotMatch(source, /data\.btnAbout\b|data\.btnHelp\b/)
  // Defence in depth from 1A stays: the template binds through the link policy.
  assert.match(source, /safeLinkOrNull\(d\.btnAboutLink\)/)
  assert.match(source, /safeLinkOrNull\(d\.btnHelpLink\)/)
})
