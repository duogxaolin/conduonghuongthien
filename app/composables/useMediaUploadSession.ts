import { reactive } from 'vue'

type Descriptor = { uploadId: string, filename: string, size: number, lastModified: number, fingerprint: string }
type Session = { uploadId: string, filename: string, declaredSize: number, chunkSize: number, totalChunks: number, receivedParts: number[], status: string, mediaItemId: number | null }
type UploadFetch = <T>(url: string, options?: { method?: 'POST' | 'PUT', body?: unknown, headers?: Record<string, string>, signal?: AbortSignal, retry?: number }) => Promise<T>
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Hash every byte in bounded blocks: changed middle sections must also reject a resume. */
export async function mediaFileFingerprint(file: File, active: () => boolean = () => true): Promise<string> {
  const blockSize = 4 * 1024 * 1024
  const blockHashes = new Uint8Array(Math.ceil(file.size / blockSize) * 32)
  for (let offset = 0; offset < file.size; offset += blockSize) {
    if (!active()) throw new Error('cancelled')
    const bytes = await file.slice(offset, Math.min(offset + blockSize, file.size)).arrayBuffer()
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
    blockHashes.set(new Uint8Array(digest), (offset / blockSize) * 32)
  }
  const hash = await globalThis.crypto.subtle.digest('SHA-256', blockHashes)
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('')
}

/** This controller is shared by the UI and behavior tests; server status is authoritative. */
export function useMediaUploadSession(options: { actorId: number, storage: Storage, request: UploadFetch, maxUploadSize: number, waitForAssembly?: (signal: AbortSignal) => Promise<void>, replaceItemId?: number }) {
  const key = `cdkt:media-upload:${options.actorId}`
  const state = reactive({
    phase: 'idle' as 'idle' | 'working' | 'paused' | 'failed' | 'done',
    descriptor: null as Descriptor | null, received: 0, total: 0,
    fileName: '', error: '', storageWarning: '', completing: false,
    result: null as { mediaItemId: number, slug: string } | null,
    // ── Tracking cho % byte và ETA ────────────────────────────────────────────
    // `received`/`total` tính theo số phần (chunk), nhưng phần cuối có thể nhỏ
    // hơn phần đầu, nên % theo byte chính xác hơn % theo phần. ETA suy từ tốc độ
    // trung bình (byte / giây) từ lúc bắt đầu upload.
    uploadedBytes: 0, totalBytes: 0, startedAt: 0,
  })
  let selected: File | null = null
  let fingerprint = ''
  let controller: AbortController | undefined
  let generation = 0
  let discarded = 0

  try {
    const raw = options.storage.getItem(key)
    if (raw) {
      const saved = JSON.parse(raw) as Descriptor
      if (/^[a-f\d-]{36}$/i.test(saved.uploadId) && typeof saved.filename === 'string'
        && Number.isSafeInteger(saved.size) && saved.size > 0 && Number.isFinite(saved.lastModified)
        && /^[a-f\d]{64}$/i.test(saved.fingerprint)) {
        state.descriptor = saved
        state.phase = 'paused'
      } else state.storageWarning = 'Thông tin lượt tải đã lưu không hợp lệ. Hãy chọn tệp để bắt đầu lượt tải mới.'
    }
  } catch { state.storageWarning = 'Trình duyệt không đọc được phiên đã lưu. Chức năng tiếp tục sau khi tải lại trang có thể không khả dụng.' }

  function remember() {
    try {
      if (state.descriptor) options.storage.setItem(key, JSON.stringify(state.descriptor))
      else options.storage.removeItem(key)
    } catch { state.storageWarning = 'Trình duyệt không lưu được phiên tải. Giữ trang này mở để có thể tiếp tục nếu mạng gián đoạn.' }
  }

  async function select(file: File) {
    if (state.phase === 'working') return
    state.error = ''
    selected = null
    state.fileName = ''
    if (!file.size || file.size > options.maxUploadSize) {
      state.error = 'Tệp trống hoặc vượt quá dung lượng tải lên cho phép.'
      return
    }
    const current = ++generation
    const sample = await mediaFileFingerprint(file, () => current === generation)
    if (current !== generation) return
    const saved = state.descriptor
    if (saved && (saved.filename !== file.name || saved.size !== file.size || saved.lastModified !== file.lastModified || saved.fingerprint !== sample)) {
      state.error = 'Tệp này không khớp lượt tải đang dở. Hãy chọn lại đúng tệp ban đầu hoặc bỏ phiên cũ.'
      return
    }
    selected = file
    fingerprint = sample
    state.fileName = file.name
  }

  function pause() {
    generation++
    controller?.abort()
    if (state.phase === 'working') state.phase = 'paused'
  }
  function discard() {
    discarded++
    pause()
    state.descriptor = null
    state.fileName = ''
    selected = null
    state.error = ''
    state.received = 0
    state.total = 0
    state.uploadedBytes = 0
    state.totalBytes = 0
    state.startedAt = 0
    state.phase = 'idle'
    state.result = null
    state.completing = false
    remember()
  }

  async function run() {
    if (state.phase === 'working') return
    if (!state.descriptor && !selected) { state.error = 'Hãy chọn một tệp video trước khi tải lên.'; return }
    const current = ++generation
    const discardVersion = discarded
    const file = selected
    controller = new AbortController()
    const signal = controller.signal
    state.phase = 'working'
    state.error = ''
    state.completing = false
    const request: UploadFetch = (url, init) => options.request(url, { ...init, retry: 0, signal })
    const wait = options.waitForAssembly ?? ((signal: AbortSignal) => new Promise<void>((resolve, reject) => {
      const aborted = () => { clearTimeout(timer); reject(new Error('aborted')) }
      const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve() }, 5000)
      if (signal.aborted) aborted()
      else signal.addEventListener('abort', aborted, { once: true })
    }))
    async function complete(base: string): Promise<{ mediaItemId: number, slug: string }> {
      state.completing = true
      const body = options.replaceItemId ? { replaceMediaItemId: options.replaceItemId } : undefined
      while (true) {
        try { return await request(`${base}/complete`, { method: 'POST', body }) }
        catch (error) {
          const status = (error as { statusCode?: number, status?: number }).statusCode ?? (error as { status?: number }).status
          if (status !== 409) throw error
          // Another request owns assembly. Retry complete to also recover an expired lease.
          await wait(signal)
          if (signal.aborted) throw new Error('aborted')
          const response = await request<{ session: Session }>(`${base}/status`)
          if (response.session.status === 'completed' && response.session.mediaItemId) return { mediaItemId: response.session.mediaItemId, slug: '' }
          if (response.session.status === 'failed') throw new Error('session-failed')
        }
      }
    }
    try {
      if (!state.descriptor) {
        const init = await request<{ uploadId: string }>('/api/admin/media-portal/upload/init', {
          method: 'POST', body: { filename: file!.name, declaredSize: file!.size },
        })
        // Persist even if the user paused while the successful init was arriving.
        if (discardVersion !== discarded) return
        state.descriptor = { uploadId: init.uploadId, filename: file!.name, size: file!.size, lastModified: file!.lastModified, fingerprint }
        remember()
      }
      if (current !== generation) return
      const base = `/api/admin/media-portal/upload/${state.descriptor.uploadId}`
      const response = await request<{ session: Session, missing: number[] }>(`${base}/status`)
      if (current !== generation) return
      const session = response.session
      state.received = session.receivedParts.length
      state.total = session.totalChunks
      // Tổng byte = kích thước tệp; byte đã tải = (số phần đã nhận) × chunkSize,
      // trừ phần cuối (nhỏ hơn). Khi còn missing thì tính theo receivedParts.
      state.totalBytes = session.declaredSize
      if (!state.startedAt) state.startedAt = Date.now()
      state.uploadedBytes = Math.min(session.declaredSize,
        session.receivedParts.length * session.chunkSize)
      if (session.status === 'completed' && session.mediaItemId) {
        state.result = { mediaItemId: session.mediaItemId, slug: '' }
      } else if (session.status === 'assembling') {
        state.result = await complete(base)
      } else {
        if (session.status === 'failed') throw new Error('session-failed')
        if (session.uploadId !== state.descriptor.uploadId || session.declaredSize !== state.descriptor.size
          || !Number.isSafeInteger(session.chunkSize) || session.chunkSize < 1) throw new Error('session-mismatch')
        if (response.missing.length && !selected) {
          state.phase = 'paused'
          state.error = 'Hãy chọn lại đúng tệp ban đầu để tiếp tục phần còn thiếu.'
          return
        }
        for (const index of response.missing) {
          if (current !== generation) return
          const chunk = selected!.slice(index * session.chunkSize, Math.min((index + 1) * session.chunkSize, selected!.size))
          const received = await request<{ receivedParts: number[] }>(`${base}/chunk?index=${index}`, {
            method: 'PUT', body: await chunk.arrayBuffer(), headers: { 'Content-Type': 'application/octet-stream' },
          })
          if (current !== generation) return
          state.received = received.receivedParts.length
          state.uploadedBytes = Math.min(state.totalBytes,
            received.receivedParts.length * session.chunkSize)
        }
        if (current !== generation) return
        state.result = await complete(base)
      }
      if (current !== generation) return
      state.phase = 'done'
      state.descriptor = null
      remember()
    } catch (error) {
      if (current !== generation) return
      state.phase = 'failed'
      const status = (error as { statusCode?: number, status?: number })?.statusCode ?? (error as { status?: number })?.status
      state.error = status === 404 ? 'Lượt tải không còn khả dụng. Bỏ phiên cũ để bắt đầu lượt tải mới.'
        : error instanceof Error && error.message === 'session-failed' ? 'Lượt tải này đã lỗi. Bỏ phiên cũ, kiểm tra tệp và bắt đầu lại.'
        : status === 401 || status === 403 ? 'Phiên đăng nhập hoặc quyền tải lên đã thay đổi. Đăng nhập lại rồi tiếp tục.'
        : 'Tải lên không thành công. Thử lại để kiểm tra phần đã nhận và tiếp tục cùng lượt tải.'
    }
  }
  return { state, select, run, pause, discard }
}
