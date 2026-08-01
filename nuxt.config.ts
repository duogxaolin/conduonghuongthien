import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveAnalyticsRetentionConfig } from './server/utils/analytics-config'

const parseAnalyticsInteger = (name: string, fallback: number, min: number, max: number) => {
  const rawValue = process.env[name]
  if (rawValue === undefined || rawValue === '') return fallback

  const value = Number(rawValue)
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`)
  }

  return value
}

const parseAnalyticsBoolean = (name: string, fallback: boolean) => {
  const rawValue = process.env[name]
  if (rawValue === undefined || rawValue === '') return fallback
  if (rawValue === 'true' || rawValue === '1') return true
  if (rawValue === 'false' || rawValue === '0') return false
  throw new Error(`${name} must be one of: true, false, 1, 0`)
}

const analyticsHmacSecret = process.env.ANALYTICS_HMAC_SECRET?.trim() || ''
if (analyticsHmacSecret && analyticsHmacSecret.length < 32) {
  throw new Error('ANALYTICS_HMAC_SECRET must contain at least 32 characters')
}
if (process.env.NODE_ENV === 'production' && !analyticsHmacSecret) {
  throw new Error('ANALYTICS_HMAC_SECRET is required in production')
}

/**
 * Inter is loaded from Google unless the webfont has been self-hosted, which is
 * what `node scripts/fetch-fonts.mjs` does. Self-hosting keeps every visitor's
 * IP off a third-party CDN and keeps the typography intact on networks where
 * fonts.gstatic.com is slow or filtered. This is a build-time check: run the
 * script, rebuild, and the Google tags stop being emitted.
 */
const selfHostedFontCss = resolve(process.cwd(), 'public/assets/fonts/inter.css')
const fontLinks = existsSync(selfHostedFontCss)
  ? [{ rel: 'stylesheet' as const, href: '/assets/fonts/inter.css' }]
  : [
      { rel: 'preconnect' as const, href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect' as const, href: 'https://fonts.gstatic.com', crossorigin: '' as const },
      {
        rel: 'stylesheet' as const,
        href: 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap',
      },
    ]

/**
 * FontAwesome Pro 7.3.0, webfont build. Loading the icon map plus only the two
 * families the templates use, rather than all.min.css, drops the brand icon map
 * and the @font-face declarations for eleven families nothing here references.
 * tests/asset-pipeline.test.ts fails if a template starts using a family that
 * is not listed here — otherwise those icons would silently render as blanks.
 */
const ICON_FAMILIES = ['solid', 'regular']
const iconLinks = ['fontawesome', ...ICON_FAMILIES].map(name => ({
  rel: 'stylesheet' as const,
  href: `/assets/fontawesome/css/${name}.min.css`,
}))

const analyticsRetention = resolveAnalyticsRetentionConfig()
const analyticsDefaultRangeDays = parseAnalyticsInteger('ANALYTICS_DEFAULT_RANGE_DAYS', 30, 1, 366)
const analyticsMaxRangeDays = parseAnalyticsInteger('ANALYTICS_MAX_RANGE_DAYS', 366, 1, 366)
if (analyticsDefaultRangeDays > analyticsMaxRangeDays) {
  throw new Error('ANALYTICS_DEFAULT_RANGE_DAYS must not exceed ANALYTICS_MAX_RANGE_DAYS')
}

export default defineNuxtConfig({
  compatibilityDate: '2026-07-20',
  devtools: { enabled: true },

  modules: ['@nuxtjs/tailwindcss'],

  tailwindcss: {
    cssPath: '~/assets/css/main.css',
    configPath: 'tailwind.config.js',
  },

  /**
   * Bộ nhớ đệm theo tuyến. Mỗi lượt xem trang công khai đang dựng lại HTML từ
   * đầu — cùng một truy vấn CSDL, cùng một kết quả, cho mọi khách.
   *
   * `swr: 60` phục vụ bản đã dựng ngay lập tức và dựng lại nền khi quá 60 giây,
   * nên biên tập viên sửa bài thấy thay đổi trong vòng một phút mà khách không
   * ai phải đợi lượt dựng đó.
   *
   * Chỉ áp cho trang KHÔNG phụ thuộc phiên: đã rà `app/pages/`, không trang công
   * khai nào đọc `useAdminAuth` hay cookie `cdkt_admin`. `/admin/**` và toàn bộ
   * `/api/**` cố ý KHÔNG cache — phục vụ lại một trang quản trị đã đăng nhập là
   * phát nó cho người kế tiếp.
   */
  routeRules: {
    '/': { swr: 60 },
    '/about': { swr: 60 },
    '/contact': { swr: 60 },
    '/news/**': { swr: 60 },
    '/role-models/**': { swr: 60 },
    '/reintegration-models/**': { swr: 60 },
    '/documents/**': { swr: 60 },
    '/legal-qa/**': { swr: 60 },
    // `/tro-ly` is deliberately absent. Its server-rendered output is an empty
    // shell — the conversation list, transcript and quick questions are all
    // fetched or read from localStorage on the client — so an SWR window would
    // cache nothing worth caching. Listing it would also invite the assumption
    // that some visitor state is being served from cache, which is the one thing
    // that must never become true here.
    '/admin/**': { cache: false },
    '/api/**': { cache: false },
    // Tài nguyên có vân tay trong tên tệp: đổi nội dung là đổi tên, nên bản cũ
    // không bao giờ bị phục vụ nhầm.
    '/assets/fonts/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
    '/assets/fontawesome/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
  },

  runtimeConfig: {
    // Private server keys
    aiApiKey: process.env.AI_API_KEY || '',
    aiBaseUrl: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
    aiModel: process.env.AI_MODEL || 'gpt-4o-mini',
    // Addresses of our own reverse proxies. Only these are allowed to speak for
    // a client via x-forwarded-for; see server/utils/client-ip.ts. Empty means
    // loopback only, which is correct for an app with nothing in front of it.
    trustedProxyIps: process.env.TRUSTED_PROXY_IPS || '',
    analytics: {
      hmacSecret: analyticsHmacSecret,
      collectionEnabled: parseAnalyticsBoolean('ANALYTICS_COLLECTION_ENABLED', false),
      rawRetentionDays: parseAnalyticsInteger('ANALYTICS_RAW_RETENTION_DAYS', 14, 1, 30),
      aggregateRetentionDays: parseAnalyticsInteger('ANALYTICS_AGGREGATE_RETENTION_DAYS', 762, 30, 3650),
      defaultRangeDays: analyticsDefaultRangeDays,
      maxRangeDays: analyticsMaxRangeDays,
      freshnessThresholdHours: parseAnalyticsInteger('ANALYTICS_FRESHNESS_THRESHOLD_HOURS', 48, 1, 168),
      liveRetentionHours: analyticsRetention.liveRetentionHours,
      nocRetentionDays: analyticsRetention.nocRetentionDays,
    },

    // Public keys
    public: {}
  },

  app: {
    head: {
      title: 'Con Đường Hướng Thiện - Cổng thông tin hỗ trợ hòa nhập cộng đồng và phát triển bền vững',
      htmlAttrs: {
        lang: 'vi'
      },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'Cổng thông tin điện tử hỗ trợ người hoàn lương tái hòa nhập cộng đồng, đào tạo nghề nghiệp, tư vấn tâm lý, kết nối doanh nghiệp và tuyên truyền pháp luật.' },
        { name: 'format-detection', content: 'telephone=no' }
      ],
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
        ...fontLinks,
        ...iconLinks,
      ]
    }
  },

  vue: {
    compilerOptions: {
      // Suppress hydration mismatch warnings in production caused by browser extensions
    }
  },

  vite: {
    define: {
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
    }
  },
})
