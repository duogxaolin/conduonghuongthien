export interface Toast {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title?: string
  message: string
  duration?: number
  createdAt: number
}

const toasts = ref<Toast[]>([])

export function useToast() {
  const addToast = (
    type: 'success' | 'error' | 'warning' | 'info',
    message: string,
    title?: string,
    duration = 4000
  ) => {
    const id = Math.random().toString(36).substring(2, 9)
    const toast: Toast = {
      id,
      type,
      title: title || (type === 'success' ? 'Thành công' : type === 'error' ? 'Có lỗi xảy ra' : type === 'warning' ? 'Cảnh báo' : 'Thông báo'),
      message,
      duration,
      createdAt: Date.now()
    }

    toasts.value.push(toast)

    if (duration > 0) {
      setTimeout(() => {
        remove(id)
      }, duration)
    }

    return id
  }

  const remove = (id: string) => {
    const idx = toasts.value.findIndex(t => t.id === id)
    if (idx !== -1) {
      toasts.value.splice(idx, 1)
    }
  }

  const clear = () => {
    toasts.value = []
  }

  return {
    toasts,
    addToast,
    success: (message: string, title?: string, duration?: number) => addToast('success', message, title, duration),
    error: (message: string, title?: string, duration?: number) => addToast('error', message, title, duration),
    warning: (message: string, title?: string, duration?: number) => addToast('warning', message, title, duration),
    info: (message: string, title?: string, duration?: number) => addToast('info', message, title, duration),
    remove,
    clear
  }
}
