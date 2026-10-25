import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveAnalyticsRetentionConfig } from './server/utils/analytics-config'
import { CONTENT_SECURITY_POLICY, CONTENT_SECURITY_POLICY_REPORT_ONLY } from './shared/csp-policy'
import { IMAGE_PROXY_DOMAINS } from './shared/media-hosts'

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
 *
 * `font-display: swap` (FOUT) đã được patch trực tiếp vào 3 file `*.min.css`
 * (solid/regular/brands) — mặc định FA 7.x dùng `block` (FOIT 3s), làm text icon
 * biến mất trong 3s đầu trên mạng chậm. Patch file thay vì regenerate để giữ
 * tập tin gốc từ gói FA; nếu nâng cấp FA, chỉ cần chạy lại sed (xem CHANGELOG).
 */
const ICON_FAMILIES = ['solid', 'regular', 'brands']
const iconLinks = ['fontawesome', ...ICON_FAMILIES].map(name => ({
  rel: 'stylesheet' as const,
  href: `/assets/fontawesome/css/${name}.min.css`,
}))

/**
 * Preload 3 woff2 icon font để font sẵn sàng khi CSS parse xong, đưa woff2 ra
 * khỏi critical path (Lighthouse "Hiển thị phông chữ" 620ms → ~90ms). Không
 * preload fontawesome.min.css (154KB class map) vì không phải font, chỉ preload
 * woff2. `crossorigin` bắt buộc cho `as="font"`.
 */
const iconFontPreloads = [
  { family: 'solid', weight: '900', file: 'fa-solid-900.woff2' },
  { family: 'regular', weight: '400', file: 'fa-regular-400.woff2' },
  { family: 'brands', weight: '400', file: 'fa-brands-400.woff2' },
].map(f => ({
  rel: 'preload' as const,
  as: 'font' as const,
  type: 'font/woff2',
  crossorigin: 'anonymous' as const,
  href: `/assets/fontawesome/webfonts/${f.file}`,
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
 
  experimental: {
    payloadExtraction: false,
  },

   modules: ['@nuxtjs/tailwindcss', '@nuxt/image'],

  /**
   * @nuxt/image — resize/WebP server-side qua IPX (provider mặc định, tái dùng
   * `sharp` 0.35.4 đã có trong deps). Chỉ áp cho ảnh Page Builder block + thumbnail
   * tìm kiếm; ảnh rich-text TinyMCE render HTML thô nên giữ <img> thường.
   * `quality:75` cân bằng giữa size và nhìn; `format:['webp','jpg','png']` cho
   * browser hiện đại WebP, fallback jpg/png tự động cho client cũ.
   */
  image: {
    quality: 75,
    format: ['webp', 'jpg', 'png'],
    // IPX provider mặc định đọc ảnh từ `public/` (uploads serve qua
    // server/routes/uploads). Ảnh R2 có public URL riêng — `cdn1.delify.vn`
    // cho phép NuxtImg resize/WebP hóa ảnh R2 (logo Bộ Công an, ảnh bài viết).
    // Chỉ khai báo domain IPX có quyền đọc — tránh open proxy. Danh sách ở
    // `shared/media-hosts.ts` (cùng nguồn với CSP `img-src` và phép kiểm đổi domain R2).
    domains: [...IMAGE_PROXY_DOMAINS],
  },

  /**
   * Component auto-import. Mặc định Nuxt thêm prefix là tên thư mục cha: một
   * component ở `app/components/layout/DefaultHeader.vue` được đăng ký thành
   * `LayoutDefaultHeader`, không phải `DefaultHeader`. Template `default.vue`
   * dùng tên CÓ prefix (`<LayoutDefaultHeader>`) theo quy ước mặc định — không
   * cần `pathPrefix: false`, giữ lazy-loading optimization của Nuxt untouched.
   */
  components: {
    dirs: [
      { path: '~/components' },
    ],
  },

  nitro: {
    /**
     * Thứ tự plugin là RÀNG BUỘC, không phải cách sắp cho đẹp. `runtime-config-global`
     * gắn `globalThis.useRuntimeConfig` — hàm mà `tryRuntimeConfig()` dò — và phải chạy
     * TRƯỚC mọi plugin đọc config lúc boot. Không khai này thì thứ tự là bảng chữ cái
     * tên tệp: hôm nay nó xếp sau các scheduler (đều hoãn tick 60–90 giây nên chưa va),
     * và một plugin mới tên vần "a…r" đọc config lúc boot sẽ âm thầm nhận `undefined`
     * — đúng lớp hỏng im lặng mà chính plugin này ra đời để dứt điểm.
     */
    plugins: [
      '~~/server/plugins/runtime-config-global',
    ],
    /**
     * Esbuild target cho server bundle. Mặc định Nitro hardcode `es2019`, nhưng
     * code CIDR/IPv6 check (`server/utils/chatbot/outbound.ts`, `short-media-id.ts`)
     * dùng `bigint` literal (`0n`, `32n`, `0xffffffffn`) — ES2020. Node 22+
     * (yêu cầu repo) hỗ trợ sẵn; `es2020` tắt warning "Big integer literals are
     * not available in the configured target environment".
     *
     * Nitro spread `nitro.options.esbuild.options` SAU `target: "es2019"` mặc
     * định (xem `nitropack/dist/rollup/index.mjs`), nên phải đặt trong `options`,
     * không phải `esbuild` trực tiếp.
     */
    esbuild: {
      options: {
        target: 'es2020',
      },
    },
  },

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
    /**
     * Chuyển hướng vĩnh viễn từ ba tuyến tiếng Việt cũ.
     *
     * `/nguoi-doc`, `/tai-lieu-hoi-dap` và `/tro-ly` đã chạy trên production, đã
     * được chia sẻ và đã vào chỉ mục tìm kiếm. Đổi tên mà không có mấy dòng này là
     * **làm chết mọi liên kết đã phát ra ngoài** — kể cả tham chiếu mà chính trợ lý
     * ảo đã dẫn cho khách. 301 (không phải 302) để công cụ tìm kiếm chuyển hẳn thứ
     * hạng sang địa chỉ mới thay vì giữ cả hai.
     *
     * **Đừng xoá theo kiểu dọn dẹp.** Một liên kết đã in ra giấy hay đã lưu trong
     * tin nhắn không có hạn sử dụng, và cái giá để giữ là ba dòng cấu hình.
     */
    '/nguoi-doc':        { redirect: { to: '/profile', statusCode: 301 } },
    '/tai-lieu-hoi-dap': { redirect: { to: '/qa-documents', statusCode: 301 } },
    '/tro-ly':           { redirect: { to: '/assistant', statusCode: 301 } },

    '/': { swr: 60 },
    '/about': { swr: 60 },
    '/contact': { swr: 60 },
    '/news/**': { swr: 60 },
    '/role-models/**': { swr: 60 },
    '/reintegration-models/**': { swr: 60 },
    '/documents/**': { swr: 60 },
    '/legal-qa/**': { swr: 60 },
    // Đọc kho câu trả lời đã duyệt — nội dung chỉ đổi khi cán bộ xuất bản một
    // mục mới, và mọi khách thấy cùng một danh sách nên không có gì riêng tư để
    // rò rỉ qua bộ nhớ đệm.
    '/qa-documents': { swr: 60 },

    // Sitemap + robots — route động (server/routes/*.ts). Không đệm ở CDN:
    // nội dung chỉ đổi khi admin lưu lại qua /admin/settings/sitemap, nhưng khi
    // đã đổi thì khách phải thấy ngay (Cloudflare cache hit che bản mới và không
    // revalidate theo s-maxage của Nitro). `no-cache, must-revalidate` bắt CDN
    // hỏi origin mỗi lần; origin tự đệm trong bộ nhớ tiến trình.
    '/sitemap.xml': { headers: { 'Cache-Control': 'no-cache, must-revalidate' } },
    '/robots.txt': { headers: { 'Cache-Control': 'no-cache, must-revalidate' } },
    // Thư viện video công khai. Cùng lý do như `/qa-documents`: mọi khách thấy
    // cùng một danh sách, và nội dung chỉ đổi khi cán bộ xuất bản một mục mới.
    //
    // **Đây là ràng buộc an toàn, không phải một lựa chọn hiệu năng.** Cửa sổ 60
    // giây này là lý do mọi thứ mang danh tính người đọc trên `/media/**` phải
    // nạp **sau khi mount** từ trình duyệt — luồng bình luận, và cờ `canDelete`
    // nói bình luận nào là của người đang xem. Một khối dựng phía máy chủ sẽ được
    // phát lại cho người kế tiếp ghé vào trong cùng cửa sổ đó, kèm nút xoá của
    // người này trên bình luận của người khác. Trạng thái "đang phát trực tiếp"
    // cũng đi cùng đường: nó do trình duyệt hỏi sau mount.
    '/media': { swr: 60 },
    '/media/**': { swr: 60 },
    // `/assistant` is deliberately absent. Its server-rendered output is an empty
    // shell — the conversation list, transcript and quick questions are all
    // fetched or read from localStorage on the client — so an SWR window would
    // cache nothing worth caching. Listing it would also invite the assumption
    // that some visitor state is being served from cache, which is the one thing
    // that must never become true here.
    '/admin/**': { cache: false },
    // Trang in bài — bản báo giấy, mở từ nút "In bài" của ArticleDetail. Không
    // cache: nội dung bài có thể vừa được biên tập sửa, và trang in phải phản ánh
    // bản mới nhất ngay (SWR 60s sẽ phát bản cũ trong cửa sổ đó).
    '/in-bai/**': { cache: false },
    '/api/**': { cache: false },
    '/api/public/social-links': { swr: 60 },
    // Tài nguyên có vân tay trong tên tệp: đổi nội dung là đổi tên, nên bản cũ
    // không bao giờ bị phục vụ nhầm.
    '/assets/fonts/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
    '/assets/fontawesome/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
    // Ảnh tĩnh trong `public/assets/` (hero_banner.webp, default_cover_light.png,
    // news_danang.jpg…) — cố định, đổi nội dung là đổi tên file. Cache 1 năm immutable
    // để khách quay lại không re-fetch 155 KiB hero banner mỗi lần (giảm LCP + băng thông).
    '/assets/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
    // IPX (NuxtImg) sinh ảnh WebP/resize. IPX tự set `cache-control: max-age=300,
    // s-maxage=300` cho response 200 (qua `sendResponseHeaderIfNotSet`, srvx/API
    // riêng với `event.node.res` nên routeRules KHÔNG ghi đè lên IPX 200). routeRules
    // ở đây CHỈ áp dụng cho error response (404/500 qua Nitro errorHandler — IPX
    // throw HTTPError → h3 onError → errorHandler render JSON). Set `no-store` để
    // Cloudflare KHÔNG cache IPX error (R2 fetch tạm lỗi lúc cold-start/deploy) —
    // nếu cache error 1 năm (immutable) thì ảnh vỡ vĩnh viễn trên prod
    // (đã trả giá 2026-10-07: cdht.delify.vn ảnh vỡ hàng loạt, `cf-cache-status: HIT`
    // trên response 500 immutable). IPX 200 vẫn cache 300s do IPX tự set.
    '/_ipx/**': { headers: { 'cache-control': 'no-store' } },

    /**
     * Security headers cho mọi response 200 (trang HTML SSR + tài nguyên).
     *
     * Trước đây chỉ `/api/**` và trang lỗi 404/4xx có CSP/XFO/nosniff (do Nitro
     * error handler tự gắn), còn trang công khai `/`, `/news`, `/admin/login` —
     * đúng những trang người dùng thật truy cập — lại không có. Bốn báo cáo
     * OWASP black-box đều hội tụ về điểm này: không có `frame-ancestors`/XFO
     * → clickjacking khả thi trên trang login; không có CSP → mất lớp phòng
     * cuối nếu XSS lọt qua Vue auto-escape hay sanitizeHtml.
     *
     * CSP cho `*.delify.vn` + `*.conduonghuongthien.vn` (R2 CDN + domain cổng
     * + subdomain sau này) thay cho `https:` rộng — đổi `r2_public_url` sang
     * domain ngoài hai nhánh này thì **phải** cập nhật CSP, đó là ràng buộc cố
     * ý: CSP tồn tại để chặn domain lạ. `'unsafe-inline'` cho script/style vì
     * Nuxt hydration + Tailwind dùng inline; `'unsafe-eval'` không có.
     *
     * Hai chuỗi CSP dựng ở `shared/csp-policy.ts`: header thực thi (không đổi) và
     * header Report-Only mang chính sách đích không `'unsafe-inline'` cho script
     * (wave3 D-CSP giai đoạn 1 — trình duyệt chỉ báo về `/api/csp-report`, không
     * chặn). Header đặt ở đây là tĩnh theo bản build và được Nitro gắn lại cho TỪNG
     * request (kể cả bản phát lại từ bộ nhớ đệm `swr`), nên không bao giờ lệch hay
     * nhân đôi.
     */
    '/**': {
      headers: {
        // SAMEORIGIN thay DENY: Page Builder `/admin/content/pages/[id]` nhúng
        // iframe preview trang con cùng origin — DENY/`frame-ancestors 'none'`
        // chặn luôn. SAMEORIGIN + `frame-ancestors 'self'` vẫn chống clickjacking
        // cross-site (OWASP khuyến nghị), chỉ cho phép chính CDKT nhúng CDKT.
        'X-Frame-Options': 'SAMEORIGIN',
        'X-Content-Type-Options': 'nosniff',
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
        // Cross-origin isolation — pentest RedAmon 2026-10-06 báo COOP/CORP/COEP
        // missing. COOP `same-origin` cô lập window handle (chống Spectre
        // side-channel + cross-origin window interaction), an toàn không chặn
        // resource nào. CORP `same-origin` chặn site KHÁC nhúng tài nguyên CDKT
        // (defensive, không phá site mình).
        //
        // COEP cố ý KHÔNG bật: `require-corp` sẽ chặn mọi cross-origin resource
        // không kèm CORP header — ảnh R2 cdn1.delify.vn, YouTube embed,
        // Cloudflare insights đều KHÔNG gửi CORP và em không control header
        // các endpoint đó → bật COEP = phá vỡ site. `credentialless` (Chrome
        // 96+) an toàn hơn nhưng Firefox/Safari support chậm + vẫn rủi ro với
        // YouTube iframe. Đợi browser support rộng + R2 gửi CORP rồi mới bật.
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Resource-Policy': 'same-origin',
        // Host ảnh ở `shared/media-hosts.ts` — lượt đổi domain R2 từ chối host ngoài danh sách đó.
        'Content-Security-Policy': CONTENT_SECURITY_POLICY,
        'Content-Security-Policy-Report-Only': CONTENT_SECURITY_POLICY_REPORT_ONLY,
      },
    },
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
    // Public address of this deployment, used to build the Google OAuth redirect
    // URI. Read through runtimeConfig rather than process.env alone for the same
    // reason trustedProxyIps is: Nitro resolves NUXT_-prefixed variables at
    // runtime, and a bare name set only in the container env would be invisible
    // here. Empty falls back to the request host with a warning on the settings
    // page (server/utils/google-oauth/config.ts).
    publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
    // Hosts (comma-separated) whose Host header may become the base of a link in
    // an email; anything else falls back to PUBLIC_BASE_URL. Read at runtime with
    // a process.env fallback (server/utils/public-link-base.ts), since the image is
    // built without it.
    publicHostAllowlist: process.env.PUBLIC_HOST_ALLOWLIST || '',
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
    // Tắt page transition - chuyển trang tức thì, skeleton lo phần loading
    pageTransition: false,
    // Tắt View Transitions API để tránh flash
    viewTransition: false,
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
        // ⚠️ Cố ý KHÔNG có thẻ `rel="icon"` ở đây. Favicon do quản trị viên cấu
        // hình (`favicon_url`, sửa tại `/admin/settings/general`), nên nó được
        // chèn lúc chạy bởi `server/plugins/favicon.ts` — tệp này chỉ đọc lúc
        // build, và một favicon nằm ở đây thì đổi được bằng cách deploy lại.
        //
        // Thêm lại một thẻ tĩnh ở đây là để **mỗi trang có hai thẻ `rel="icon"`**,
        // và thẻ nào thắng do trình duyệt quyết định — tức là cán bộ đổi favicon
        // rồi thấy nó đổi trên Chrome mà không đổi trên Safari. Có test chặn.
        ...fontLinks,
        // Preconnect R2 CDN sớm — ảnh logo + thumbnail bài viết phục vụ từ
        // cdn1.delify.vn. PageSpeed gợi ý "không có điểm gốc nào được kết nối
        // trước"; 1 preconnect (R2), không quá 4.
        { rel: 'preconnect' as const, href: 'https://cdn1.delify.vn' },
        // Preload hero banner đã chuyển vào `HeroBlock.vue` (useHead) — chỉ preload
        // khi HeroBlock render (trang chủ недорог). Ở `app.head` toàn cục, preload
        // `/assets/hero_banner.webp` lãng phí 155 KiB trên mọi trang admin/không
        // có hero. Lighthouse flag "preloaded but not used" trên trang /admin/*.
        // Preload woff2 TRƯỚC stylesheet FA để font sẵn sàng khi CSS parse xong —
        // đưa woff2 ra khỏi critical path (Lighthouse "Hiển thị phông chữ").
        ...iconFontPreloads,
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
