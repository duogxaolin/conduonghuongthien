import { escapeHtml } from '../utils/escape-html'
import { buildFaviconTags } from '../utils/favicon'
import { loadFaviconSetting } from '../utils/favicon-setting'

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

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:html', async (html, { event }) => {
    // API routes render no document. Match the real `/api` surface only — not a
    // public custom page whose slug merely starts with it (e.g. `/api-tin-tuc`
    // through the `[slug]` catch-all), the same distinction tracking.ts draws.
    const path = event?.path || ''
    if (path === '/api' || path.startsWith('/api/')) return

    // Read through the shared loader, which also backs `routes/favicon.ico.ts`.
    // A second cache here would expire on its own schedule, so for up to 30
    // seconds the `<link>` tag and `/favicon.ico` could point at two different
    // icons — and browsers cache favicons for a long time, so one skewed read
    // lingers well past the window that produced it.
    const { iconUrl } = await loadFaviconSetting()

    // Two layers, answering two different questions: `safeFaviconUrl` (already
    // applied in the loader) decides whether the value may be used at all, and
    // `escapeHtml` decides how it is embedded once accepted. The second is what
    // keeps a stray quote from ending the attribute.
    for (const tag of buildFaviconTags(iconUrl)) {
      const type = tag.type ? ` type="${escapeHtml(tag.type)}"` : ''
      const sizes = tag.sizes ? ` sizes="${escapeHtml(tag.sizes)}"` : ''
      html.head.push(`<link rel="${escapeHtml(tag.rel)}"${type}${sizes} href="${escapeHtml(tag.href)}">`)
    }
  })
})
