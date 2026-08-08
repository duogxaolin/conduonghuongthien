import { getDb } from '../utils/db'
import { settings } from '../db/schema'
import { escapeHtml } from '../utils/escape-html'
import { DEFAULT_FAVICON_URL, buildFaviconTags, safeFaviconUrl } from '../utils/favicon'

/**
 * Favicon injector.
 *
 * The icon URL is an admin setting (`favicon_url`, edited at
 * `/admin/settings/general`), so the tag cannot be a static entry in
 * `nuxt.config.ts` — that file is read at build time and a favicon change would
 * need a redeploy. This plugin reads the value per render instead, through the
 * same `render:html` hook `plugins/tracking.ts` uses.
 *
 * ⚠️ Two deliberate differences from `plugins/tracking.ts`. Both look like
 * inconsistencies to anybody tidying these two files toward each other, and both
 * are load-bearing:
 *
 *  1. **`/admin/**` is NOT skipped.** That plugin skips it because measuring what
 *     officers do inside the admin panel is a privacy decision. A favicon is the
 *     opposite: an admin panel with no icon is a blank tab an officer has to tell
 *     apart from every other blank tab they have open.
 *
 *  2. **A DB failure injects the DEFAULT tag, not nothing.** That plugin injects
 *     nothing on failure, which is right — no analytics is the safe outcome. Here
 *     "nothing" means every visitor gets a blank tab for as long as the database
 *     is unwell, and the bundled default is already known-good on disk.
 *
 * Never throws. A favicon has no business breaking a citizen's page render.
 */

/** Same TTL as `plugins/tracking.ts`, on purpose — a second number for the same
 *  job is where two values drift apart. */
const CACHE_TTL_MS = 30_000

let cache: { url: string; expires: number } | null = null

/**
 * The configured icon URL, or the bundled default.
 *
 * Returns the default for every unusable outcome — no row, empty string, a value
 * that fails `safeFaviconUrl`, or a database that is down — so callers have one
 * shape to handle and there is no branch that yields "no icon at all".
 */
async function loadFaviconUrl(): Promise<string> {
  const now = Date.now()
  if (cache && cache.expires > now) return cache.url

  try {
    const db = getDb()
    const rows = await db.select({ key: settings.key, value: settings.value }).from(settings)
    const raw = rows.find(row => row.key === 'favicon_url')?.value
    const url = safeFaviconUrl(raw) ?? DEFAULT_FAVICON_URL
    cache = { url, expires: now + CACHE_TTL_MS }
    return url
  } catch {
    // Cache the fallback too: a database that is down would otherwise be retried
    // on every single render, turning one outage into a second one.
    cache = { url: DEFAULT_FAVICON_URL, expires: now + CACHE_TTL_MS }
    return DEFAULT_FAVICON_URL
  }
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:html', async (html, { event }) => {
    // API routes render no document. Match the real `/api` surface only — not a
    // public custom page whose slug merely starts with it (e.g. `/api-tin-tuc`
    // through the `[slug]` catch-all), the same distinction tracking.ts draws.
    const path = event?.path || ''
    if (path === '/api' || path.startsWith('/api/')) return

    const url = await loadFaviconUrl()

    // Two layers, answering two different questions: `safeFaviconUrl` (already
    // applied in the loader) decides whether the value may be used at all, and
    // `escapeHtml` decides how it is embedded once accepted. The second is what
    // keeps a stray quote from ending the attribute.
    for (const tag of buildFaviconTags(url)) {
      const type = tag.type ? ` type="${escapeHtml(tag.type)}"` : ''
      const sizes = tag.sizes ? ` sizes="${escapeHtml(tag.sizes)}"` : ''
      html.head.push(`<link rel="${escapeHtml(tag.rel)}"${type}${sizes} href="${escapeHtml(tag.href)}">`)
    }
  })
})
