/**
 * What the hero block shows, from its stored data (spec hero-block, design D21).
 *
 * Kept out of `HeroBlock.vue` so the rules can be tested without mounting it
 * (`tests/hero-block-buttons.test.ts` feeds this output to the real template).
 *
 * Text pick order — the one the title has always used:
 *   vi:    the block's own value → built-in Vietnamese default
 *   other: `data.translations[lang]` → UI dictionary → built-in English default
 * (the block's own value is Vietnamese source text, so it is not shown on an
 * English page; editors translate it in the page builder).
 *
 * Buttons, added rules:
 *   • A stored value equal to the PREVIOUS registry default (`OLD_HERO_DEFAULTS`)
 *     counts as unset. The buttons used to be hard-coded, so every page saved
 *     with the old defaults showed today's labels, not what it stored — treating
 *     the old defaults as unset keeps those pages looking exactly the same.
 *   • An empty (or blank) label switches its button off, in every language.
 *   • Links are language-neutral: translation → own value → default target, and
 *     an unsafe value (shared/link-policy.ts) falls back to the default target.
 *     `HeroBlock.vue` binds through `safeLinkOrNull` again (1A, defence in depth).
 */
import { safeLinkOrNull } from '../../../shared/link-policy'

/** Registry defaults as shipped in `20073b4` and saved by editors since. Never edit. */
export const OLD_HERO_DEFAULTS = Object.freeze({
  btnAboutText: 'Về chúng tôi',
  btnAboutLink: '/about',
  btnHelpText: 'Nhận hỗ trợ 24/7',
  btnHelpLink: '#tro-giup',
})

type ButtonField = keyof typeof OLD_HERO_DEFAULTS

export type HeroContent = {
  badge: string
  titleLine1: string
  titleLine2: string
  subtitle: string
  /** '' = button hidden. */
  btnAboutText: string
  btnAboutLink: string
  btnHelpText: string
  btnHelpLink: string
  bgImage: string | undefined
}

type Translate = (key: string) => string

export function resolveHeroContent(rawData: unknown, lang: string, t: Translate): HeroContent {
  const isVi = lang === 'vi'
  const data = (rawData && typeof rawData === 'object' ? rawData : {}) as Record<string, unknown>
  type Dict = Record<string, string>
  const translations = (data.translations && typeof data.translations === 'object' ? data.translations : {}) as Record<string, Dict>
  const tr: Dict = !isVi ? (translations[lang] || {}) : {}

  const dictionary = (key: string) => {
    const value = t(key)
    return value && value !== key ? value : ''
  }
  const pick = (field: string, i18nKey: string, fbEn: string, fbVi: string): string => {
    if (isVi) return String(data[field] ?? fbVi)
    if (tr[field]) return tr[field]
    return dictionary(i18nKey) || fbEn
  }

  /** The editor's own value for a button field, or `undefined` when unset. */
  const configured = (field: ButtonField): string | undefined => {
    const value = data[field]
    if (typeof value !== 'string') return undefined
    if (value === OLD_HERO_DEFAULTS[field]) return undefined
    return value.trim()
  }
  const buttonText = (field: ButtonField, i18nKey: string, fbEn: string, fbVi: string): string => {
    const own = configured(field)
    if (own === '') return ''
    if (isVi) return own ?? fbVi
    const translated = tr[field]?.trim()
    if (translated) return translated
    return dictionary(i18nKey) || fbEn
  }
  const buttonLink = (field: ButtonField, fallback: string): string => {
    const translated = !isVi ? tr[field]?.trim() : ''
    const candidate = translated || configured(field) || ''
    return (candidate && safeLinkOrNull(candidate)) || fallback
  }

  return {
    badge: data.badge
      ? (isVi ? String(data.badge) : (tr.badge || t('hero_badge') || 'C11 PORTAL - MINISTRY OF PUBLIC SAFETY'))
      : (isVi ? 'CỔNG THÔNG TIN C11 - BỘ CÔNG AN' : (t('hero_badge') || 'C11 PORTAL - MINISTRY OF PUBLIC SAFETY')),
    titleLine1: pick('titleLine1', 'hero_title_line1', 'Accompanying the', 'Đồng hành cùng'),
    titleLine2: pick('titleLine2', 'hero_title_line2', 'Journey of Rehabilitation', 'hành trình hướng thiện'),
    subtitle: pick('subtitle', 'hero_subtitle', 'A comprehensive platform offering vocational, legal, and psychological support to help former inmates reintegrate into society and build sustainable lives.', 'Nền tảng hỗ trợ toàn diện về nghề nghiệp, pháp lý và tư vấn tâm lý giúp người chấp hành xong án phạt tù vững vàng tái hòa nhập cộng đồng, xây dựng cuộc sống mới bền vững.'),
    btnAboutText: buttonText('btnAboutText', 'hero_btn_about', 'About Us', 'Về chúng tôi'),
    btnAboutLink: buttonLink('btnAboutLink', '/about'),
    btnHelpText: buttonText('btnHelpText', 'hero_btn_help', 'Request Support', 'Gửi yêu cầu trợ giúp'),
    btnHelpLink: buttonLink('btnHelpLink', '#tro-giup'),
    bgImage: data.bgImage != null ? String(data.bgImage) : undefined,
  }
}
