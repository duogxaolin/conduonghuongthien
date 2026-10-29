/**
 * `/profile` — rename form state and its write (split out of app/pages/profile.vue in
 * wave3 4.2; the page keeps the request itself and hands it in as `save`, with the two
 * identity hooks of `useReaderAuth` the page holds).
 *
 * Imports are relative (no `~/`): the page's behaviour suite loads this module natively.
 */
import { ref, watch, type Ref } from 'vue'
import { errorMessage, errorStatus } from '../utils/errorMessage'

export type SavedReaderName = { displayName?: string | null; customDisplayName?: string | null }

export function useReaderNameEdit(options: {
  reader: Readonly<Ref<{ displayName: string } | null>>
  /** `PUT /api/public/reader/profile` with `{ displayName }`. */
  save: (displayName: string) => Promise<{ ok: boolean; reader?: SavedReaderName }>
  applyDisplayName: (next: { displayName: string; initials: string }) => void
  forgetReader: () => void
}) {
  const nameDraft = ref('')
  const savingName = ref(false)
  const nameError = ref('')
  const nameSaved = ref(false)

  async function saveName() {
    const value = nameDraft.value.trim()
    if (!value || savingName.value) return

    savingName.value = true
    nameError.value = ''
    nameSaved.value = false
    try {
      const response = await options.save(value)
      // State ở cấp module, nên header đổi tên ngay — không đợi tải lại trang.
      if (response?.reader) options.applyDisplayName(response.reader as { displayName: string; initials: string })
      nameSaved.value = true
    } catch (err) {
      /**
       * 401 nghĩa là vé đã hết hiệu lực trong lúc trang đang mở (hết 30 ngày, hoặc
       * `tokenVersion` bị tăng). Bỏ danh tính đã cache để trang đổi sang khối mời
       * đăng nhập — giữ nguyên thì form vẫn còn đó kèm một dòng lỗi, và không có nút
       * đăng nhập nào: một ngõ cụt mà đường ra duy nhất là tự tải lại trang.
       *
       * 403 thì KHÔNG xử lý như vậy: đó là lệnh chặn, người đọc **vẫn** đang đăng
       * nhập, và mời họ đăng nhập lại là mời một lượt sẽ thành công mà không đổi gì.
       */
      nameError.value = errorMessage(err, 'Không thể lưu tên hiển thị. Vui lòng thử lại.')
      if (errorStatus(err) === 401) options.forgetReader()
    } finally {
      savingName.value = false
    }
  }

  // Đồng bộ ô nhập với tên đang có hiệu lực. `immediate` không dùng được vì danh
  // tính về sau mount; watch bắt đúng lúc nó về, và cũng bắt lượt lưu thành công.
  watch(options.reader, value => {
    if (value && !nameDraft.value) nameDraft.value = value.displayName
  })

  // Xoá thông báo "đã lưu" ngay khi người đọc gõ tiếp: để nó ở lại thì lần sửa sau
  // trông như đã được lưu trong khi chưa.
  watch(nameDraft, () => { nameSaved.value = false })

  return { nameDraft, savingName, nameError, nameSaved, saveName }
}
