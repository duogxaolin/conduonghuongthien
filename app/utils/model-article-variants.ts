/**
 * Cấu hình hai biến thể của `ModelArticlesListPage.vue`: `/role-models` (Tấm
 * gương tiêu biểu) và `/reintegration-models` (Mô hình tái hòa nhập).
 *
 * Hai trang từng là hai bản chép ~630 dòng chỉ khác nhau ở khoá i18n, màu nhấn,
 * đường dẫn chi tiết và một liên kết ở cột phải — và cùng mang một lỗi (phân trang
 * không nạp lại). Mọi khác biệt nay nằm ở đây; mỗi trang vẫn giữ route,
 * `useSeoMeta` và khoá i18n của riêng nó.
 *
 * - Khoá i18n viết **thẳng chữ** (không ghép `${prefix}_title`) để tìm được bằng
 *   grep; `tests/model-article-variants.test.ts` kiểm từng khoá có trong từ điển
 *   mặc định và trong seed — gõ sai một khoá thì `t()` lặng lẽ hiện ra tên khoá.
 * - Lớp màu cũng viết **thẳng chữ**: Tailwind quét mã nguồn tĩnh (`./app/**`), một
 *   lớp ghép chuỗi kiểu `bg-[${color}]` sẽ bị purge khỏi CSS production.
 */
export type ModelArticleVariant = 'role_model' | 'reintegration'

export type ModelArticleTextKey =
  | 'breadcrumb' | 'title' | 'desc' | 'searchPlaceholder' | 'searchAria' | 'clearSearch'
  | 'searchResult' | 'articlesCount' | 'listLoading' | 'loadErrorTitle' | 'loadErrorDesc'
  | 'emptyTitle' | 'emptyDesc' | 'viewAll' | 'featuredBadge' | 'categoryLabel' | 'readMore'
  | 'listTitle' | 'cardBadge' | 'cardFooterBadge' | 'relatedWidget'

export type ModelArticleThemeKey =
  | 'featuredCard' | 'featuredBadge' | 'titleHover' | 'actionLink' | 'dividerBar' | 'countPill'
  | 'card' | 'cardBadge' | 'cardTitle' | 'pageStep' | 'pageActive' | 'pageIdle'

export interface ModelArticleLink {
  to: string
  icon: string
  labelKey: string
}

export interface ModelArticleVariantConfig {
  /** `type` gửi `/api/public/articles`. */
  type: string
  /** Route danh sách; trang chi tiết là `${basePath}/<slug>`. */
  basePath: string
  /** Mỏ neo cuộn khi đổi trang (giữ nguyên id cũ của từng trang). */
  anchorId: string
  emptyIcon: string
  keys: Record<ModelArticleTextKey, string>
  /** Widget "Chuyên mục liên quan" — thứ tự giữ đúng như hai trang cũ. */
  relatedLinks: ModelArticleLink[]
  theme: Record<ModelArticleThemeKey, string>
}

export const MODEL_ARTICLE_VARIANTS: Record<ModelArticleVariant, ModelArticleVariantConfig> = {
  role_model: {
    type: 'role_model',
    basePath: '/role-models',
    anchorId: 'news-list-top',
    emptyIcon: 'fa-solid fa-award',
    keys: {
      breadcrumb: 'rm_breadcrumb', title: 'rm_title', desc: 'rm_desc',
      searchPlaceholder: 'rm_search_placeholder', searchAria: 'rm_search_aria', clearSearch: 'rm_clear_search',
      searchResult: 'rm_search_result', articlesCount: 'rm_articles_count', listLoading: 'rm_list_loading',
      loadErrorTitle: 'rm_load_error_title', loadErrorDesc: 'rm_load_error_desc',
      emptyTitle: 'rm_empty_title', emptyDesc: 'rm_empty_desc', viewAll: 'rm_view_all',
      featuredBadge: 'rm_featured_badge', categoryLabel: 'rm_category_label', readMore: 'rm_read_more',
      listTitle: 'rm_list_title', cardBadge: 'rm_card_badge', cardFooterBadge: 'rm_card_footer_badge',
      relatedWidget: 'rm_related_widget',
    },
    relatedLinks: [
      { to: '/news', icon: 'fa-solid fa-newspaper', labelKey: 'n_activity_heading' },
      { to: '/reintegration-models', icon: 'fa-solid fa-people-group', labelKey: 'reintegration' },
      { to: '/documents', icon: 'fa-solid fa-scale-balanced', labelKey: 'documents_title' },
      { to: '/legal-qa', icon: 'fa-solid fa-circle-question', labelKey: 'legal_qa' },
    ],
    theme: {
      featuredCard: 'border-[#E2E8DF] hover:shadow-[0_12px_30px_rgba(74,103,65,0.12)] hover:border-[#7CB342]',
      featuredBadge: 'bg-[#689F38]',
      titleHover: 'hover:text-[#2D5A27]',
      actionLink: 'text-[#385932] hover:text-[#1B3617]',
      dividerBar: 'bg-[#4A6741]',
      countPill: 'bg-[#EBF3E8] text-[#385932]',
      card: 'border-[#E2E8DF] hover:shadow-[0_10px_24px_rgba(74,103,65,0.12)] hover:border-[#7CB342]',
      cardBadge: 'bg-[#EEF4EC] text-[#3A6033] text-[0.68rem] px-2 py-0.5 rounded',
      cardTitle: 'group-hover:text-[#2D5A27]',
      pageStep: 'hover:border-[#4A6741] hover:text-brand-600 hover:bg-[#F2F7F0]',
      pageActive: 'bg-[#4A6741] text-white shadow-sm border border-[#4A6741]',
      pageIdle: 'bg-white border border-[#D5E1D3] text-[#4A5545] hover:border-[#4A6741] hover:text-brand-600 hover:bg-[#F2F7F0]',
    },
  },
  reintegration: {
    type: 'reintegration',
    basePath: '/reintegration-models',
    anchorId: 'models-list-top',
    emptyIcon: 'fa-solid fa-people-group',
    keys: {
      breadcrumb: 'ri_breadcrumb', title: 'ri_title', desc: 'ri_desc',
      searchPlaceholder: 'ri_search_placeholder', searchAria: 'ri_search_aria', clearSearch: 'ri_clear_search',
      searchResult: 'ri_search_result', articlesCount: 'ri_articles_count', listLoading: 'ri_list_loading',
      loadErrorTitle: 'ri_load_error_title', loadErrorDesc: 'ri_load_error_desc',
      emptyTitle: 'ri_empty_title', emptyDesc: 'ri_empty_desc', viewAll: 'ri_view_all',
      featuredBadge: 'ri_featured_badge', categoryLabel: 'ri_category_label', readMore: 'ri_read_more',
      listTitle: 'ri_list_title', cardBadge: 'ri_card_badge', cardFooterBadge: 'ri_card_footer_badge',
      relatedWidget: 'ri_related_widget',
    },
    relatedLinks: [
      { to: '/news', icon: 'fa-solid fa-newspaper', labelKey: 'n_activity_heading' },
      { to: '/role-models', icon: 'fa-solid fa-award', labelKey: 'rm_title' },
      { to: '/documents', icon: 'fa-solid fa-scale-balanced', labelKey: 'documents_title' },
      { to: '/legal-qa', icon: 'fa-solid fa-circle-question', labelKey: 'legal_qa' },
    ],
    theme: {
      featuredCard: 'border-[#DDE6DC] hover:shadow-[0_12px_30px_rgba(21,101,192,0.12)] hover:border-[#1565C0]',
      featuredBadge: 'bg-[#1565C0]',
      titleHover: 'hover:text-[#1565C0]',
      actionLink: 'text-[#1565C0] hover:text-[#0D47A1]',
      dividerBar: 'bg-[#1565C0]',
      countPill: 'bg-[#E3F2FD] text-[#1565C0]',
      card: 'border-[#DDE6DC] hover:shadow-[0_10px_24px_rgba(21,101,192,0.12)] hover:border-[#1565C0]',
      cardBadge: 'bg-[#E3F2FD] text-[#1565C0] text-[0.7rem] px-2.5 py-0.5 rounded-md',
      cardTitle: 'group-hover:text-[#1565C0]',
      pageStep: 'hover:border-[#1565C0] hover:text-[#1565C0] hover:bg-[#F0F7FF]',
      pageActive: 'bg-[#1565C0] text-white shadow-sm border border-[#1565C0]',
      pageIdle: 'bg-white border border-[#D5E1D3] text-[#4A5545] hover:border-[#1565C0] hover:text-[#1565C0] hover:bg-[#F0F7FF]',
    },
  },
}
