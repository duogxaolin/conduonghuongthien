import { createError, defineEventHandler, getRouterParam } from 'h3'
import { getActiveLivestream } from '../../../../../services/livestream'
import { serveHlsAsset } from '../../../../../services/livestream-hls'

export default defineEventHandler(async event => {
  const id = getRouterParam(event, 'id')
  const asset = getRouterParam(event, 'path')
  const session = await getActiveLivestream()
  if (!id || !asset || !/^[1-9]\d*$/.test(id) || !session || String(session.id) !== id || session.source !== 'upload') {
    throw createError({ statusCode: 404, statusMessage: 'Buổi phát không còn hoạt động.' })
  }
  return serveHlsAsset(event, session, asset)
})
