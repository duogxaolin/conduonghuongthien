/**
 * Máy trạng thái của ô tìm kiếm nhanh ở header (gõ ≥ 2 ký tự → gợi ý sau 250 ms).
 *
 * Lỗi đã gặp: lượt gọi `/api/public/search` hỏng (503 khi CSDL hỏng, mạng đứt) bị
 * `catch` nuốt thành `items = []`, nên khung gợi ý báo "Không tìm thấy kết quả phù
 * hợp" — người đọc tin là cổng không có bài nào khớp, trong khi chỉ là máy chủ đang
 * lỗi. Giờ có trạng thái `error` riêng (giao diện hiện `role="alert"` + "Thử lại").
 *
 * Cùng lúc khép hai khe vòng đời: (1) xoá ô / gõ lùi dưới 2 ký tự trong lúc một lượt
 * đang chờ debounce hay đang bay thì lượt đó vẫn trả kết quả về và hiện lại khung
 * gợi ý; (2) hai lượt gọi chồng nhau thì lượt về SAU (có thể là lượt cũ, chậm hơn)
 * thắng. Lượt cũ giờ bị huỷ (`AbortController`) và kết quả của nó bị bỏ qua.
 *
 * Thuần — đồng hồ, lượt gọi mạng và nơi nhận trạng thái đều tiêm vào, nên kiểm được
 * không cần trình duyệt (`tests/live-search.test.ts`).
 */

export type LiveSearchStatus = 'idle' | 'loading' | 'success' | 'error'

export interface LiveSearchState<T> {
  status: LiveSearchStatus
  items: T[]
  /** Khung gợi ý có nên mở không (từ khoá đủ dài). */
  visible: boolean
}

export interface LiveSearchDeps<T> {
  /** Gọi API; ném lỗi (vd. 503) hoặc trả `{ ok: false }` đều là LỖI, không phải "không có kết quả". */
  fetch: (query: string, signal: AbortSignal) => Promise<{ ok?: boolean; items?: T[] } | null | undefined>
  onChange: (state: LiveSearchState<T>) => void
  schedule?: (run: () => void, ms: number) => unknown
  cancel?: (handle: unknown) => void
  debounceMs?: number
  minLength?: number
}

export interface LiveSearch {
  /** Người đọc gõ: đủ dài thì chờ debounce rồi gọi; quá ngắn thì đóng và huỷ mọi lượt đang chờ. */
  input: (raw: string) => void
  /** Thử lại ngay từ khoá vừa hỏng (không chờ debounce). */
  retry: () => void
  /** Xoá ô / rời đi: huỷ lượt đang chờ hoặc đang bay, về `idle`. */
  reset: () => void
}

export function createLiveSearch<T>(deps: LiveSearchDeps<T>): LiveSearch {
  const schedule = deps.schedule ?? ((run: () => void, ms: number) => setTimeout(run, ms))
  const cancel = deps.cancel ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const debounceMs = deps.debounceMs ?? 250
  const minLength = deps.minLength ?? 2

  let timer: unknown = null
  let controller: AbortController | null = null
  let seq = 0
  let lastQuery = ''
  // Gợi ý đang hiện được GIỮ trong lúc chờ lượt mới (như trước): xoá ngay mỗi lần gõ
  // làm danh sách nhấp nháy theo từng phím.
  let shown: T[] = []

  const emit = (status: LiveSearchStatus, items: T[], visible: boolean) => {
    shown = items
    deps.onChange({ status, items, visible })
  }

  const stopPending = () => {
    if (timer !== null) cancel(timer)
    timer = null
    controller?.abort()
    controller = null
    seq += 1 // mọi lượt đang bay trở thành lượt cũ — kết quả của chúng bị bỏ qua
  }

  const run = async (query: string) => {
    timer = null
    controller?.abort()
    const own = new AbortController()
    controller = own
    const id = ++seq
    try {
      const res = await deps.fetch(query, own.signal)
      if (id !== seq) return
      controller = null
      if (res?.ok && Array.isArray(res.items)) emit('success', res.items, true)
      else emit('error', [], true)
    } catch {
      if (id !== seq) return // bị huỷ hoặc đã có lượt mới hơn
      controller = null
      emit('error', [], true)
    }
  }

  return {
    input(raw) {
      const query = raw.trim()
      lastQuery = query
      stopPending()
      if (query.length < minLength) {
        emit('idle', [], false)
        return
      }
      emit('loading', shown, true)
      timer = schedule(() => { void run(query) }, debounceMs)
    },
    retry() {
      if (lastQuery.length < minLength) return
      stopPending()
      emit('loading', [], true)
      void run(lastQuery)
    },
    reset() {
      lastQuery = ''
      stopPending()
      emit('idle', [], false)
    },
  }
}
