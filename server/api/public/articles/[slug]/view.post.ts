/**
 * Records one article view. Called from the browser after the article renders,
 * never from SSR.
 *
 * The reason is `nuxt.config.ts`: `/news/**`, `/role-models/**`,
 * `/reintegration-models/**`, `/documents/**` and `/legal-qa/**` are served with
 * `swr: 60`, so the second through Nth reader inside a 60-second window never
 * reaches server code at all. An SSR-side increment would undercount by exactly
 * the amount the cache is working — and would look entirely plausible while
 * doing it.
 *
 * Every path answers 202. A view counter has no standing to put a red line in a
 * visitor's console or to trip client error handling on a page that is
 * otherwise fine, and a varying status would leak whether a slug exists.
 */
import { defineEventHandler, getRouterParam, readBody, setResponseStatus } from 'h3'
import { and, eq } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { articles } from '../../../../db/schema'
import { getClientIp } from '../../../../utils/client-ip'
import { deriveDailyVisitorToken } from '../../../../utils/analytics-collection'
import { recordRateLimitHit, type RateLimitRule } from '../../../../utils/rate-limit-store'
import { logWarn, logError } from '../../../../utils/logger'
import {
  buildViewDedupeKey,
  normalizeViewSource,
  recordArticleView,
  viewDay,
  VIEW_DEDUPE_WINDOW_SECONDS,
} from '../../../../services/article-views'
import { rateLimitDeps } from '../../../../utils/rate-limit-deps'
import { analyticsConfig } from '../../../../utils/runtime-config'
import { ipBucket } from '../../../../utils/ip-bucket'

/**
 * `limit: 1` makes the store's own counter the dedupe decision: `count === 1`
 * is the first request in this window, anything higher is a reload. The store's
 * upsert is a single statement, so two concurrent first-hits cannot both read 1.
 */
const DEDUPE_RULE: RateLimitRule = { limit: 1, windowSeconds: VIEW_DEDUPE_WINDOW_SECONDS }

/**
 * Per-source ceiling across ALL articles (spec rate-limiting, design D17): at
 * most 60 counted views per address per 10 minutes, IPv6 grouped by /64
 * (`ipBucket`). The dedupe above keys on an HMAC of IP + User-Agent, so rotating
 * the User-Agent from one address used to mint a new "visitor" per request.
 * Generous on purpose — an office behind one NAT shares an address. Checked
 * BEFORE the dedupe, so a flood never reaches the per-article buckets; over the
 * ceiling the answer is the same 202 and nothing is counted.
 */
const VIEW_IP_CEILING_RULE: RateLimitRule = { limit: 60, windowSeconds: 600 }

/** One log line per cause, not one per request — see `secretWarned`. */
let secretWarned = false

export default defineEventHandler(async (event) => {
  setResponseStatus(event, 202)

  try {
    const slug = getRouterParam(event, 'slug')
    if (!slug) return { accepted: false }

    // A malformed or absent body is not an error here: the source category is
    // the only field, and an unrecognised one is already defined to mean `other`.
    const body = await readBody(event).catch(() => null)
    const sourceCategory = normalizeViewSource((body as { sourceCategory?: unknown } | null)?.sourceCategory)

    const db = getDb()
    const [article] = await db
      .select({ id: articles.id })
      .from(articles)
      .where(and(eq(articles.slug, slug), eq(articles.status, 'published')))
      .limit(1)
    // Same status, same shape: an unknown slug must not be distinguishable from
    // a known one.
    if (!article) return { accepted: false }

    // Deliberately NOT gated on `analytics.collectionEnabled`. That switch is a
    // privacy decision about measuring visitors; this figure is the portal's own
    // editorial statistic about its own content. A deployment that turned
    // collection off and then found every article reporting zero forever, with
    // nothing on screen saying why, is a silent dead end.
    const config = analyticsConfig(event)
    const day = viewDay()
    const clientIp = getClientIp(event)

    let visitorToken: string
    try {
      visitorToken = deriveDailyVisitorToken(config?.hmacSecret, {
        ip: clientIp,
        userAgent: String(event.node.req.headers['user-agent'] || ''),
        day,
      })
    } catch (error) {
      // Without the secret there is no visitor token and therefore no
      // deduplication, so counting would mean counting every reload. Refusing is
      // right; refusing silently is not — this is the only trace an operator
      // would ever get.
      if (!secretWarned) {
        secretWarned = true
        logWarn({
          event: 'article_view.secret_unavailable',
          message: error instanceof Error ? error.message : String(error),
          cause: 'ANALYTICS_HMAC_SECRET is missing or shorter than 32 characters',
        })
      }
      return { accepted: false }
    }
    const deps = rateLimitDeps()
    // `count > limit`, not `blocked`: the store reports `blocked` AT the limit,
    // and the 60th view is still one to count.
    const ceiling = await recordRateLimitHit(`avip:${ipBucket(clientIp)}`, VIEW_IP_CEILING_RULE, deps)
    if (ceiling.count > VIEW_IP_CEILING_RULE.limit) return { accepted: false }

    const state = await recordRateLimitHit(buildViewDedupeKey(article.id, visitorToken), DEDUPE_RULE, deps)
    if (state.count !== 1) return { accepted: false }

    await recordArticleView({ articleId: article.id, sourceCategory, day })
    return { accepted: true }
  } catch (error) {
    // The contract is 202 in every case, including one this handler did not
    // anticipate. The failure still has to be discoverable, so it goes to the log
    // rather than to the visitor.
    logError({
      event: 'article_view.record_failed',
      message: error instanceof Error ? error.message : String(error),
    })
    return { accepted: false }
  }
})
