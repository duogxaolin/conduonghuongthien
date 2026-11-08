import { normalizeBlocks } from '../../../../utils/page-versions'
import { requireResourcePermission } from '../../../../utils/permissions'
import { purgePublicPageCacheAfterWrite } from '../../../../utils/public-page-cache'
import { findPageById, listPageBlockRows } from '../../../../services/admin-pages-queries'
import { publishPageWithAudit } from '../../../../services/admin-page-publish'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'pages', 'update')

  const pageId = Number(getRouterParam(event, 'id'))
  if (!pageId) throw createError({ statusCode: 400, statusMessage: 'Invalid page ID' })

  const page = await findPageById(pageId)
  if (!page) throw createError({ statusCode: 404, statusMessage: 'Trang không tồn tại.' })

  // Prefer explicit body blocks (latest client state); fall back to saved draft.
  const body = await readBody(event).catch(() => ({}))
  const incoming = Array.isArray(body?.blocks) ? body.blocks : page.draftBlocks
  const nextBlocks = normalizeBlocks(incoming)

  // A tree payload = any node carries `children`. Tree pages persist the whole
  // node tree as JSON in pages.published_blocks and skip the flat page_blocks
  // upsert; legacy flat payloads keep the historical page_blocks upsert path.
  const isTree = nextBlocks.some((n) => Array.isArray(n.children))

  // Snapshot the live state, write the new one, audit — one transaction (services/admin-page-publish.ts).
  await publishPageWithAudit(adminUser, pageId, page, nextBlocks, isTree)

  // After the commit: the published blocks of `/`, `/about`, `/contact` are in their
  // `swr`-cached HTML — without this a publish showed up ≥ 60 s later (public-page-cache.ts).
  await purgePublicPageCacheAfterWrite('pages.publish')

  // Return the freshly-published state so the client can re-key.
  // Tree pages return the normalized tree (tmp ids preserved — the builder always
  // reads/writes the whole page); flat pages return the real-id rows.
  if (isTree) {
    return { ok: true, blocks: nextBlocks, tree: true }
  }
  const blocks = await listPageBlockRows(pageId)

  return { ok: true, blocks, tree: false }
})
