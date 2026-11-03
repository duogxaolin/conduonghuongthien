/**
 * `/profile` — the "email me when someone replies" switch and its write (split out of
 * app/pages/profile.vue in wave3 4.2; the page keeps the request and hands it in as
 * `save`).
 *
 * Imports are relative (no `~/`): the page's behaviour suite loads this module natively.
 */
import { computed, ref, type Ref } from 'vue'
import { errorMessage, errorStatus } from '../utils/errorMessage'

export function useReaderEmailPreference(options: {
  reader: Readonly<Ref<{ email: string | null; emailNotifications?: boolean } | null>>
  /** `PUT /api/public/reader/profile/email-notifications` with `{ enabled }`. */
  save: (enabled: boolean) => Promise<unknown>
  applyEmailPreference: (enabled: boolean) => void
  forgetReader: () => void
}) {
  const savingEmailPref = ref(false)
  const emailPrefError = ref('')

  /** Mặc định bật khi máy chủ chưa nói gì — cùng mặc định với cột trong CSDL. */
  const emailNotificationsOn = computed(() => options.reader.value?.emailNotifications !== false)

  async function toggleEmailNotifications() {
    if (savingEmailPref.value || !options.reader.value?.email) return

    const next = !emailNotificationsOn.value
    savingEmailPref.value = true
    emailPrefError.value = ''
    try {
      await options.save(next)
      // State ở cấp module, nên mọi bề mặt đọc nó đổi theo cùng lúc.
      options.applyEmailPreference(next)
    } catch (err) {
      emailPrefError.value = errorMessage(err, 'Không thể lưu thiết lập. Vui lòng thử lại.')
      // 401: vé hết hiệu lực giữa lúc trang mở — bỏ danh tính để trang đổi sang
      // khối mời đăng nhập. 403 thì KHÔNG: đó là lệnh chặn, người đọc vẫn đang
      // đăng nhập và mời họ đăng nhập lại là mời một lượt không đổi được gì.
      if (errorStatus(err) === 401) options.forgetReader()
    } finally {
      savingEmailPref.value = false
    }
  }

  return { savingEmailPref, emailPrefError, emailNotificationsOn, toggleEmailNotifications }
}
