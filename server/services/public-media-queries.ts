/**
 * The database side of the public media item routes, moved out of the handlers verbatim:
 *
 *  - `media/[shortId].get.ts` — the legacy-slug lookup that turns an old `/media/<slug>` link
 *    into a 301 to `/media/<short_id>`;
 *  - `media/[shortId]/stream.get.ts`, `media/[shortId]/[...path].get.ts`,
 *    `media/[shortId]/thumb.get.ts` — the media configuration (environment overridden by the
 *    database, R2 credentials included) every one of them resolves first.
 *
 * The handlers keep everything else: the router params, the one-404-for-every-reason rule, the
 * `nosniff` header set before any branch, byte ranges, the stream/target resolution
 * (`resolveStreamTarget` / `resolveThumbnailTarget`), the R2 proxying, the upstream thumbnail
 * fetch, the serve-time frame extraction through `onDemandThumbnails` (never FFmpeg directly),
 * the redirect and its query string, and the 500 that a failed lookup must stay.
 */
import { and, eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { mediaItems } from '../db/schema'
import { PUBLISHED_MEDIA_STATUS } from './media-portal'
import { resolveMediaConfigWithDb } from './media-config-service'

/**
 * The `short_id` of the PUBLISHED item whose (old) slug is `slug`, or undefined — a link
 * handed out before short ids existed. A draft or archived item answers like an unknown slug.
 */
export async function findPublishedMediaShortIdBySlug(slug: string) {
  const [legacy] = await getDb()
    .select({ shortId: mediaItems.shortId })
    .from(mediaItems)
    .where(and(eq(mediaItems.slug, slug), eq(mediaItems.status, PUBLISHED_MEDIA_STATUS)))
    .limit(1)

  return legacy
}

/** The media configuration the serving routes resolve their targets with, read through the shared handle. */
export async function resolvePublicMediaConfig() {
  return resolveMediaConfigWithDb(getDb())
}
