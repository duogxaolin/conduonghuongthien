export const ANALYTICS_ENDPOINT = '/api/public/analytics/page-view'

const ASSET_PREFIXES = ['/assets/', '/uploads/', '/_nuxt/']
const ASSET_SUFFIX_RE = /\.(?:css|js|mjs|map|json|xml|txt|ico|png|jpe?g|gif|webp|svg|avif|woff2?|ttf|otf|eot|pdf|zip)$/i

export type ClientPageView = {
  path: string
  sourceCategory: 'direct' | 'search' | 'social' | 'referral' | 'email' | 'other'
  deviceClass: 'desktop' | 'mobile' | 'tablet' | 'unknown'
}

export type CollectorTransport = (payload: ClientPageView) => void | Promise<unknown>

export function normalizeCollectorPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const path = value.trim().split(/[?#]/, 1)[0]
  return path && path.startsWith('/') && !path.startsWith('//') && path.length <= 512 ? path : null
}

export function isEligiblePublicAnalyticsPath(value: unknown): boolean {
  const path = normalizeCollectorPath(value)
  if (!path || path === ANALYTICS_ENDPOINT || path === '/admin' || path.startsWith('/admin/') || path === '/api' || path.startsWith('/api/')) return false
  if (ASSET_PREFIXES.some(prefix => path.startsWith(prefix)) || ASSET_SUFFIX_RE.test(path)) return false
  return true
}

export function classifySource(referrer: string, currentHost: string): ClientPageView['sourceCategory'] {
  if (!referrer) return 'direct'
  try {
    const host = new URL(referrer).hostname.toLowerCase()
    if (!host || host === currentHost.toLowerCase()) return 'direct'
    if (/(^|\.)(google|bing|yahoo|duckduckgo|baidu)\./.test(host)) return 'search'
    if (/(^|\.)(facebook|instagram|linkedin|tiktok|youtube|x|twitter)\./.test(host)) return 'social'
    return 'referral'
  } catch {
    return 'direct'
  }
}

export function classifyDevice(userAgent: string): ClientPageView['deviceClass'] {
  if (/ipad|tablet/i.test(userAgent)) return 'tablet'
  if (/android|iphone|mobile/i.test(userAgent)) return 'mobile'
  return userAgent ? 'desktop' : 'unknown'
}

export function isConservativeBot(userAgent: string): boolean {
  return /bot|crawler|spider|slurp|headless|lighthouse/i.test(userAgent)
}

export function createPageViewCollector(options: {
  transport: CollectorTransport
  sourceCategory?: ClientPageView['sourceCategory']
  deviceClass?: ClientPageView['deviceClass']
  isBot?: boolean
}) {
  let lastPath: string | null = null
  return (pathValue: unknown, navigation?: { completed?: boolean; prefetch?: boolean }) => {
    if (options.isBot || navigation?.completed === false || navigation?.prefetch === true) return false
    const path = normalizeCollectorPath(pathValue)
    if (!path || !isEligiblePublicAnalyticsPath(path) || path === lastPath) return false
    lastPath = path
    try {
      void Promise.resolve(options.transport({
        path,
        sourceCategory: options.sourceCategory || 'direct',
        deviceClass: options.deviceClass || 'unknown',
      })).catch(() => undefined)
    } catch {
      // Analytics is best-effort and must never affect navigation.
    }
    return true
  }
}
