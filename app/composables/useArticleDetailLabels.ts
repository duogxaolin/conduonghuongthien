import { computed } from 'vue'

// Variant → i18n key map. Props win when set; otherwise the variant picks the key.
const VARIANT_KEYS = {
  news: { back: 'a_back_news', crumb: 'a_news_crumb', notFound: 'a_news_not_found', cat: 'a_category_news', seoTitle: 'a_news_seo_title', seoDesc: 'a_news_seo_desc' },
  role: { back: 'a_back_role', crumb: 'a_role_crumb', notFound: 'a_role_not_found', cat: 'a_category_role', seoTitle: 'a_role_seo_title', seoDesc: 'a_role_seo_desc' },
  reintegration: { back: 'a_back_reintegration', crumb: 'a_reintegration_crumb', notFound: 'a_reintegration_not_found', cat: 'a_category_reintegration', seoTitle: 'a_reintegration_seo_title', seoDesc: 'a_reintegration_seo_desc' },
} as const

/**
 * The labels of the shared article detail view (`components/ArticleDetail.vue`, moved out in
 * wave3 4.2): each one the wrapper page's prop when it passes one, else the i18n key of the
 * view's variant (news / role / reintegration). `t` comes from the component's `useI18n()`.
 */
export function useArticleDetailLabels(
  props: {
    variant: string
    backLabel: string | null
    backCtaLabel: string | null
    currentCrumb: string | null
    notFoundText: string | null
    categoryFallback: string | null
    seoFallbackTitle: string | null
    seoFallbackDescription: string | null
  },
  t: (key: string) => string,
) {
  const vkeys = computed(() => VARIANT_KEYS[props.variant as keyof typeof VARIANT_KEYS] ?? VARIANT_KEYS.news)

  return {
    backLabelText: computed(() => props.backLabel ?? t(vkeys.value.back)),
    backCtaText: computed(() => props.backCtaLabel ?? t('a_back_cta')),
    currentCrumbText: computed(() => props.currentCrumb ?? t(vkeys.value.crumb)),
    notFoundTextValue: computed(() => props.notFoundText ?? t(vkeys.value.notFound)),
    categoryFallbackValue: computed(() => props.categoryFallback ?? t(vkeys.value.cat)),
    seoFallbackTitleValue: computed(() => props.seoFallbackTitle ?? t(vkeys.value.seoTitle)),
    seoFallbackDescriptionValue: computed(() => props.seoFallbackDescription ?? t(vkeys.value.seoDesc)),
  }
}
