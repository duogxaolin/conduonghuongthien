import { getDb } from '../utils/db'
import { settings } from '../db/schema'

/**
 * Tracking / Marketing tags injector.
 *
 * Reads the marketing settings (stored as key/value rows in the shared
 * `settings` table) and injects the official vendor snippets into the public
 * site's <head> / right after <body>. Admin (/admin) and API (/api) routes get
 * NO injection. All DB access is wrapped in try/catch so a failure here can
 * never break page rendering.
 *
 * No schema change: everything lives under string keys in `settings`.
 */

const TRACKING_KEYS = [
  'tracking_enabled',
  'ga4_measurement_id',
  'gtm_container_id',
  'google_ads_id',
  'google_ads_conversion_label',
  'google_site_verification',
  'facebook_pixel_id',
  'tiktok_pixel_id',
  'clarity_project_id',
  'tracking_custom_head',
  'tracking_custom_body',
] as const

type TrackingSettings = Record<(typeof TRACKING_KEYS)[number], string>

// ─── In-module cache (short TTL so every render doesn't hit the DB) ──────────
const CACHE_TTL_MS = 30_000
let cache: { data: TrackingSettings; expires: number } | null = null

async function loadTrackingSettings(): Promise<TrackingSettings | null> {
  const now = Date.now()
  if (cache && cache.expires > now) return cache.data

  try {
    const db = getDb()
    const rows = await db.select().from(settings)
    const map: Record<string, string> = {}
    for (const r of rows) {
      if (r.key) map[r.key] = r.value == null ? '' : String(r.value)
    }
    const data = {} as TrackingSettings
    for (const k of TRACKING_KEYS) data[k] = map[k] ?? ''
    cache = { data, expires: now + CACHE_TTL_MS }
    return data
  } catch {
    // Any DB error → inject nothing, never throw.
    return null
  }
}

// ─── Strict allow-list validators for structured IDs (anti stored-XSS) ───────
// A malformed id is skipped entirely rather than injected into a JS string.
const RE_GA4 = /^G-[A-Z0-9]+$/
const RE_GTM = /^GTM-[A-Z0-9]+$/
const RE_ADS = /^AW-[A-Z0-9]+$/
const RE_LABEL = /^[A-Za-z0-9_-]+$/
const RE_ID = /^[A-Za-z0-9_-]+$/
const RE_VERIFY = /^[A-Za-z0-9_-]+$/

function ok(value: string, re: RegExp): string | null {
  const v = (value || '').trim()
  return v && re.test(v) ? v : null
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:html', async (html, { event }) => {
    // Skip admin + API routes entirely. Match ONLY the real admin/api
    // surfaces — not public custom pages whose slug merely begins with those
    // strings (e.g. /admin-huong-dan, /api-tin-tuc via the [slug] catch-all).
    const path = event?.path || ''
    if (
      path === '/admin' ||
      path.startsWith('/admin/') ||
      path === '/api' ||
      path.startsWith('/api/')
    )
      return

    const s = await loadTrackingSettings()
    if (!s) return

    // Master switch: when off, inject nothing.
    if (s.tracking_enabled !== '1') return

    const ga4 = ok(s.ga4_measurement_id, RE_GA4)
    const gtm = ok(s.gtm_container_id, RE_GTM)
    const ads = ok(s.google_ads_id, RE_ADS)
    const adsLabel = ok(s.google_ads_conversion_label, RE_LABEL)
    const verify = ok(s.google_site_verification, RE_VERIFY)
    const fb = ok(s.facebook_pixel_id, RE_ID)
    const tt = ok(s.tiktok_pixel_id, RE_ID)
    const clarity = ok(s.clarity_project_id, RE_ID)

    const head: string[] = []
    const body: string[] = []

    // ── Google Search Console verification meta ──────────────────────────
    if (verify) {
      head.push(`<meta name="google-site-verification" content="${verify}">`)
    }

    // ── gtag.js (shared by GA4 + Google Ads) ─────────────────────────────
    // Load the gtag.js library exactly once, then emit a gtag('config', ...)
    // per configured id so we never double-load the library.
    if (ga4 || ads) {
      const loaderId = ga4 || ads // whichever exists — library src just needs one id
      const configs: string[] = []
      if (ga4) configs.push(`gtag('config', '${ga4}');`)
      if (ads) configs.push(`gtag('config', '${ads}');`)
      // Expose the Google Ads conversion send_to string ("AW-XXX/label") as a
      // global so page code (button/form handlers, custom body code) can fire
      // gtag('event','conversion',{send_to: window.__gAdsConversion}). The label
      // is a per-action conversion identifier, not a page-load config.
      if (ads && adsLabel) {
        configs.push(`window.__gAdsConversion='${ads}/${adsLabel}';`)
      }
      head.push(
        `<script async src="https://www.googletagmanager.com/gtag/js?id=${loaderId}"></script>`,
        `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());${configs.join('')}</script>`
      )
    }

    // ── Google Tag Manager ───────────────────────────────────────────────
    if (gtm) {
      head.push(
        `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtm}');</script>`
      )
      body.push(
        `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${gtm}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`
      )
    }

    // ── Meta / Facebook Pixel ────────────────────────────────────────────
    if (fb) {
      head.push(
        `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${fb}');fbq('track','PageView');</script>`
      )
      body.push(
        `<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${fb}&ev=PageView&noscript=1"/></noscript>`
      )
    }

    // ── TikTok Pixel ─────────────────────────────────────────────────────
    if (tt) {
      head.push(
        `<script>!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=document.createElement("script");n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=document.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};ttq.load('${tt}');ttq.page();}(window,document,'ttq');</script>`
      )
    }

    // ── Microsoft Clarity ────────────────────────────────────────────────
    if (clarity) {
      head.push(
        `<script>(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","${clarity}");</script>`
      )
    }

    // ── Custom head / body code (raw, trusted admin input) ───────────────
    // Not sanitized on purpose — sanitizing would break valid scripts. This is
    // gated behind the `settings` admin permission (same trust as nav JSON).
    if (s.tracking_custom_head && s.tracking_custom_head.trim()) {
      head.push(s.tracking_custom_head)
    }
    if (s.tracking_custom_body && s.tracking_custom_body.trim()) {
      body.push(s.tracking_custom_body)
    }

    if (head.length) html.head.push(...head)
    if (body.length) html.bodyPrepend.push(...body)
  })
})
