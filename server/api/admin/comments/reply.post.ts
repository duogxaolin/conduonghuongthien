/**
 * The portal replies to a comment, in public, under the "Ban quản trị" label.
 *
 * Plain text through the same validator readers use (design.md D12) — an official
 * reply is rendered by the same component with `{{ }}`, so HTML would appear as
 * literal characters rather than markup, and letting it through the sanitiser
 * instead would mean two different notions of what a comment body is.
 *
 * Allowed on a closed thread: closing comments stops the public from posting, not
 * the portal from answering.
 */
import { requireResourcePermission } from '../../../utils/permissions'
import { createAdminReply, validateBody } from '../../../services/comments'
import { getClientIp } from '../../../utils/client-ip'

export default defineEventHandler(async (event) => {
  const actor = event.context.adminUser
  requireResourcePermission(actor, 'comments', 'create')

  const body = await readBody(event).catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu không hợp lệ.' })
  }

  const { parentId, body: rawBody } = body as Record<string, unknown>

  const parent = Number(parentId)
  if (!Number.isFinite(parent) || parent <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bình luận gốc không hợp lệ.' })
  }

  const validation = validateBody(rawBody)
  if (!validation.ok) throw createError({ statusCode: 400, statusMessage: validation.message })

  const result = await createAdminReply({
    parentId:  Math.floor(parent),
    body:      validation.body,
    actorId:   actor.id,
    ip:        getClientIp(event),
    userAgent: getRequestHeader(event, 'user-agent') || null,
  })

  if (!result.ok) throw createError({ statusCode: result.statusCode, statusMessage: result.message })

  setResponseStatus(event, 201)
  return { ok: true, id: result.id }
})
