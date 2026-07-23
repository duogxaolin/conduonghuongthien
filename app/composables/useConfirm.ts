export interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

interface ConfirmState {
  visible: boolean
  options: ConfirmOptions
  resolve: ((value: boolean) => void) | null
}

const state = reactive<ConfirmState>({
  visible: false,
  options: { message: '' },
  resolve: null,
})

export function useConfirm() {
  function confirm(options: ConfirmOptions | string): Promise<boolean> {
    const opts: ConfirmOptions = typeof options === 'string' ? { message: options } : options
    return new Promise((resolve) => {
      state.options = opts
      state.resolve = resolve
      state.visible = true
    })
  }

  function accept() {
    state.visible = false
    state.resolve?.(true)
    state.resolve = null
  }

  function cancel() {
    state.visible = false
    state.resolve?.(false)
    state.resolve = null
  }

  return { confirmState: state, confirm, accept, cancel }
}
