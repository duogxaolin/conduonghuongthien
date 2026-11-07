/**
 * The HTML the editor inserts for a video of the video library (`media_items`), and whether the
 * item can be inserted at all.
 *
 * Two shapes, both of which the HTML filter (`server/utils/sanitize-html.ts`) lets through — and nothing
 * else survives it, so this is the whole menu:
 *  - an external YouTube item → the privacy-friendly YouTube embed (`youtube-nocookie.com`);
 *  - an uploaded item → the portal's own player frame, `/media/embed/<short_id>`
 *    (`app/pages/media/embed/[shortId].vue`), a RELATIVE path on purpose (see `SAFE_OWN_EMBED_SRC`).
 *
 * Pure (no auto-imports) so the node suite runs it: tests/video-embed-html.test.ts.
 */
export interface EmbeddableVideoInput {
  shortId: string
  title: string
  source: string
  youtubeVideoId: string | null
  status: string
  processingStatus: string
}

/** Same character class the filter and the schema use: 6–16 base64url characters. */
const SHORT_ID = /^[A-Za-z0-9_-]{6,16}$/
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/

/**
 * Can this item be put in an article today? Only a PUBLISHED item has a public player page (the public
 * endpoint answers 404 for a draft or an archived one), and an uploaded one must have finished processing.
 */
export function isEmbeddableVideo(video: EmbeddableVideoInput): boolean {
  if (video.status !== 'published') return false
  if (video.source === 'youtube') return YOUTUBE_ID.test(video.youtubeVideoId ?? '')
  return video.processingStatus === 'ready' && SHORT_ID.test(video.shortId)
}

const escapeAttribute = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The iframe to insert, or `null` when the item cannot be embedded (`isEmbeddableVideo`). */
export function videoEmbedHtml(video: EmbeddableVideoInput): string | null {
  if (!isEmbeddableVideo(video)) return null
  const src = video.source === 'youtube'
    ? `https://www.youtube-nocookie.com/embed/${video.youtubeVideoId}`
    : `/media/embed/${video.shortId}`
  return `<iframe src="${src}" title="${escapeAttribute(video.title)}" width="640" height="360" loading="lazy" allowfullscreen></iframe>`
}
