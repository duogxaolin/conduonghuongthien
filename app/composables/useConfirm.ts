import { reactive } from 'vue'

export interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** Nhãn nút xác nhận — alias cũ của `confirmLabel`, nhiều trang vẫn dùng. */
  confirmText?: string
  /** Tông màu nút xác nhận — alias cũ của `danger`, nhiều trang vẫn dùng. */
  tone?: 'primary' | 'danger'
  danger?: boolean
}

export interface PromptOptions extends ConfirmOptions {
  /** Nhãn của ô nhập — tên truy cập của nó; trống thì dùng `message`. */
  label?: string
  placeholder?: string
  defaultValue?: string
}

export interface ConfirmInput {
  label: string
  placeholder: string
  value: string
}

interface ConfirmState {
  visible: boolean
  options: ConfirmOptions
  /** Có giá trị khi hộp đang hỏi một dòng chữ (`prompt`), `null` với hộp xác nhận thường. */
  input: ConfirmInput | null
  settle: ((accepted: boolean) => void) | null
  /** Tăng mỗi lần mở — để modal nhận ra hộp MỚI cả khi `visible` không kịp về false (hộp nối hộp). */
  seq: number
}

/**
 * Gộp alias cũ về đúng trường mà `ConfirmModal` đọc. Trước đây `tone`/`confirmText`
 * được khai trong kiểu nhưng không ai đọc: hộp "Khởi động lại Website" hiện màu
 * vàng câu hỏi thường với nhãn "Xác nhận" chung chung.
 */
export function normalizeConfirmOptions(options: ConfirmOptions | string): ConfirmOptions {
  const opts: ConfirmOptions = typeof options === 'string' ? { message: options } : options
  return {
    ...opts,
    confirmLabel: opts.confirmLabel ?? opts.confirmText,
    danger: opts.danger === true || opts.tone === 'danger',
  }
}

const state = reactive<ConfirmState>({
  visible: false,
  options: { message: '' },
  input: null,
  settle: null,
  seq: 0,
})

function open(options: ConfirmOptions, input: ConfirmInput | null, settle: (accepted: boolean) => void) {
  // Hộp đang chờ mà bị mở đè thì kết thúc nó là "Hủy" — để nguyên thì promise của
  // nơi gọi trước treo mãi, handler của nó không bao giờ chạy tới `finally`.
  const pending = state.settle
  state.settle = null
  pending?.(false)
  state.options = options
  state.input = input
  state.settle = settle
  state.seq++
  state.visible = true
}

function close(accepted: boolean) {
  const settle = state.settle
  state.visible = false
  state.settle = null
  settle?.(accepted)
}

export function useConfirm() {
  function confirm(options: ConfirmOptions | string): Promise<boolean> {
    return new Promise((resolve) => {
      open(normalizeConfirmOptions(options), null, resolve)
    })
  }

  /** Hỏi một dòng chữ. `null` nghĩa là bấm Hủy — khác chuỗi rỗng ("đồng ý, không ghi gì"). */
  function prompt(options: PromptOptions): Promise<string | null> {
    const input: ConfirmInput = {
      label: options.label || options.message,
      placeholder: options.placeholder ?? '',
      value: options.defaultValue ?? '',
    }
    return new Promise((resolve) => {
      // `v-model` ghi qua proxy reactive xuống đúng đối tượng này, nên đọc `input.value` là đọc chữ đã gõ.
      open(normalizeConfirmOptions(options), input, accepted => resolve(accepted ? input.value : null))
    })
  }

  function accept() {
    close(true)
  }

  function cancel() {
    close(false)
  }

  return { confirmState: state, confirm, prompt, accept, cancel }
}
