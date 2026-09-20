import { createError, type H3Event } from 'h3'

/** Bound actual bytes before concatenation; Content-Length is only an early rejection hint. */
export async function readBoundedUploadBody(event: H3Event, maximum: number): Promise<Buffer> {
  const request = event.node.req
  const oversized = () => {
    request.pause()
    event.node.res.setHeader('Connection', 'close')
    event.node.res.once('finish', () => request.destroy())
    return createError({ statusCode: 413, statusMessage: 'Phần tải lên vượt dung lượng cho phép.' })
  }
  const declared = request.headers['content-length']
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > maximum)) throw oversized()
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0
    const cleanup = () => {
      request.off('data', onData)
      request.off('end', onEnd)
      request.off('error', onError)
      request.off('aborted', onAborted)
    }
    const onError = (error: Error) => { cleanup(); reject(error) }
    const onAborted = () => onError(createError({ statusCode: 400, statusMessage: 'Lượt tải bị ngắt.' }))
    const onData = (value: Buffer) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      bytes += chunk.length
      if (bytes > maximum) { cleanup(); reject(oversized()); return }
      chunks.push(chunk)
    }
    const onEnd = () => { cleanup(); resolve(Buffer.concat(chunks, bytes)) }
    request.on('data', onData)
    request.once('end', onEnd)
    request.once('error', onError)
    request.once('aborted', onAborted)
  })
}
