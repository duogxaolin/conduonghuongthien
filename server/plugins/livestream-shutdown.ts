/** Await bounded, concurrent final delivery before Nitro finishes shutdown. */
import { beginShutdown, SSE_EVENT_SHUTDOWN } from '../utils/sse-manager'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('close', async () => {
    await beginShutdown({
      event: SSE_EVENT_SHUTDOWN,
      data: 'Máy chủ đang khởi động lại. Vui lòng tải lại trang sau ít giây.',
    })
  })
})
