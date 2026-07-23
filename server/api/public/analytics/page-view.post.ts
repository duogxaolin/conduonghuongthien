import { createError, defineEventHandler, readRawBody, setResponseStatus } from 'h3'
import { ingestAnalyticsPageView } from '../../../services/analytics-ingestion'

const MAX_BODY_BYTES = 1024

export default defineEventHandler(async (event) => {
  const config = (useRuntimeConfig(event) as unknown as { analytics: { collectionEnabled?: boolean; hmacSecret?: string } }).analytics
  if (config.collectionEnabled !== true) {
    setResponseStatus(event, 202)
    return { accepted: false }
  }

  const contentLength = Number(event.node.req.headers['content-length'] || 0)
  if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > MAX_BODY_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Analytics payload too large' })
  }

  let payload: unknown
  try {
    const rawBody = await readRawBody(event, 'utf8')
    if (!rawBody || Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
      throw createError({ statusCode: rawBody ? 413 : 400, statusMessage: rawBody ? 'Analytics payload too large' : 'Invalid analytics payload' })
    }
    payload = JSON.parse(rawBody)
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    throw createError({ statusCode: 400, statusMessage: 'Invalid analytics payload' })
  }

  try {
    const result = await ingestAnalyticsPageView({ event, payload, config })
    setResponseStatus(event, 202)
    return { accepted: result === 'accepted' }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('secret is unavailable')) {
      throw createError({ statusCode: 503, statusMessage: 'Analytics collection unavailable' })
    }
    if (message.startsWith('invalid ') || message.startsWith('unknown ') || message.includes('trusted infrastructure')) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid analytics payload' })
    }
    throw error
  }
})
