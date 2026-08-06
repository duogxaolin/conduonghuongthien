<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

/**
 * Google sign-in configuration.
 *
 * The redirect URI is the reason this page is shaped the way it is. Google
 * compares it byte for byte — scheme, case, trailing slash — against what is
 * registered in the Cloud console, and a mismatch produces `redirect_uri_mismatch`
 * on Google's own error page, where nothing this codebase writes can explain it.
 * So the value is DERIVED by the server (the same function the two OAuth
 * endpoints call), shown here as selectable text with a copy button, and there is
 * no field to type it into. An officer copies; they never transcribe.
 *
 * The client secret is write-only from the browser's point of view: the form
 * shows `••••1234` and a replace box, exactly like the chatbot provider key.
 */

type Settings = {
  clientId: string
  hasClientSecret: boolean
  clientSecretMasked: string | null
  clientSecretStatus: 'not_configured' | 'configured' | 'secret_unreadable'
  isEnabled: boolean
  defaultCommentsEnabled: boolean
  redirectUri: string
  redirectUriSource: 'config' | 'request'
  missing: string[]
  updatedAt: string | null
}

const toast = useToast()

const loading = ref(true)
const error = ref('')
const saving = ref(false)
const clearing = ref(false)
const copied = ref(false)
const secretVisible = ref(false)
const newSecret = ref('')

const settings = ref<Settings | null>(null)
const form = reactive({
  clientId: '',
  isEnabled: false,
  defaultCommentsEnabled: false,
})

/** What still has to happen before a reader can sign in. Computed server-side
 *  and rendered here; deriving it twice would let the two disagree. */
const MISSING_LABELS: Record<string, string> = {
  clientId: 'Chưa nhập Client ID.',
  clientSecret: 'Chưa lưu Client secret.',
  clientSecretUnreadable: 'Client secret đã lưu nhưng không giải mã được.',
  enabled: 'Công tắc đăng nhập Google đang tắt.',
}

const missingItems = computed(() => (settings.value?.missing || []).map(key => MISSING_LABELS[key] || key))
const secretUnreadable = computed(() => settings.value?.clientSecretStatus === 'secret_unreadable')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await $fetch<{ ok: boolean, settings: Settings }>('/api/admin/settings/google-oauth')
    if (!res?.ok) {
      error.value = 'Không tải được cấu hình đăng nhập Google.'
      return
    }
    settings.value = res.settings
    form.clientId = res.settings.clientId
    form.isEnabled = res.settings.isEnabled
    form.defaultCommentsEnabled = res.settings.defaultCommentsEnabled
  } catch (err: unknown) {
    error.value = errorMessage(err, 'Không tải được cấu hình đăng nhập Google.')
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    const body: Record<string, unknown> = {
      clientId: form.clientId,
      isEnabled: form.isEnabled,
      defaultCommentsEnabled: form.defaultCommentsEnabled,
    }
    // Only sent when the officer typed one: an empty box means "keep what is
    // stored", never "replace it with nothing".
    const secret = newSecret.value.trim()
    if (secret) body.clientSecret = secret

    const res = await $fetch<{ ok: boolean, settings: Settings }>('/api/admin/settings/google-oauth', {
      method: 'PATCH',
      body,
    })
    settings.value = res.settings
    newSecret.value = ''
    secretVisible.value = false
    toast.success('Đã lưu cấu hình đăng nhập Google.')
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không lưu được cấu hình.'))
  } finally {
    saving.value = false
  }
}

async function clearSecret() {
  if (!confirm('Xoá Client secret đã lưu? Đăng nhập Google sẽ tắt cho tới khi bạn nhập lại secret mới.')) return
  clearing.value = true
  try {
    const res = await $fetch<{ ok: boolean, settings: Settings }>('/api/admin/settings/google-oauth/clear-secret', { method: 'POST' })
    settings.value = res.settings
    form.isEnabled = res.settings.isEnabled
    toast.success('Đã xoá Client secret.')
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không xoá được Client secret.'))
  } finally {
    clearing.value = false
  }
}

async function copyRedirectUri() {
  const value = settings.value?.redirectUri
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    toast.error('Trình duyệt không cho phép sao chép tự động. Hãy bôi đen và sao chép thủ công.')
  }
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-5">
    <div>
      <h1 class="m-0 text-[1.35rem] font-extrabold text-[#122815]">Đăng nhập Google cho người đọc</h1>
      <p class="m-0 mt-1 text-sm text-[#667768]">
        Cho phép khách đăng nhập bằng tài khoản Google để bình luận. Cổng thông tin không lưu mật khẩu của họ.
      </p>
    </div>

    <!-- Đang tải -->
    <div v-if="loading" role="status" aria-busy="true" class="flex flex-col gap-3">
      <span class="sr-only">Đang tải cấu hình đăng nhập Google</span>
      <div
        v-for="n in 5"
        :key="n"
        aria-hidden="true"
        class="h-12 rounded-lg bg-[#eef3ee] animate-pulse motion-reduce:animate-none"
      ></div>
    </div>

    <!-- Lỗi: nút thử lại gọi lại chính lượt fetch đã hỏng -->
    <div
      v-else-if="error"
      role="alert"
      class="rounded-lg border border-dashed border-[#e0a3a1] bg-white px-5 py-6 text-center text-sm text-[#b0403c]"
    >
      <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
      {{ error }}
      <button type="button" class="ml-1 font-bold text-[#2c6e33] underline" @click="load">Thử lại</button>
    </div>

    <template v-else-if="settings">
      <!-- Secret không giải mã được: nêu cả triệu chứng lẫn cách xử lý. Báo là
           "chưa cấu hình" sẽ đẩy cán bộ đi nhập lại một secret họ đã nhập rồi. -->
      <div v-if="secretUnreadable" role="alert" class="rounded-lg border border-[#e0a3a1] bg-[#fff6f5] px-4 py-3 text-sm text-[#b0403c]">
        <p class="m-0 font-bold">Client secret đã lưu nhưng không giải mã được.</p>
        <p class="m-0 mt-1">
          Nguyên nhân gần như luôn là <code class="rounded bg-white px-1">CHATBOT_ENCRYPTION_SECRET</code> đã bị đổi — khoá này bảo vệ cả API key chatbot lẫn Client secret Google.
          Khôi phục lại khoá cũ, hoặc bấm “Xoá Client secret” rồi nhập lại secret mới từ Google Cloud Console.
        </p>
      </div>

      <div v-if="missingItems.length" class="rounded-lg border border-[#e6d9a8] bg-[#fdfaf0] px-4 py-3 text-sm text-[#7a6420]">
        <p class="m-0 font-bold">Đăng nhập Google chưa hoạt động vì:</p>
        <ul class="m-0 mt-1 list-disc pl-5">
          <li v-for="item in missingItems" :key="item">{{ item }}</li>
        </ul>
      </div>

      <!-- Redirect URI: chỉ đọc, có nút sao chép -->
      <section class="rounded-xl border border-[#e2ece3] bg-white p-5">
        <h2 class="m-0 text-[1rem] font-extrabold text-[#122815]">Redirect URI</h2>
        <p class="m-0 mt-1 text-sm text-[#667768]">
          Dán đúng chuỗi này vào mục “Authorized redirect URIs” của OAuth client trong Google Cloud Console. Google so khớp từng ký tự, kể cả dấu gạch chéo cuối.
        </p>
        <div class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <code class="min-w-0 flex-1 select-all break-all rounded-lg border border-[#c8d6c9] bg-[#f8faf8] px-3 py-2.5 text-sm text-[#122815]">{{ settings.redirectUri }}</code>
          <button
            type="button"
            class="rounded-lg border border-[#c8d6c9] bg-white px-3 py-2.5 text-sm font-semibold hover:bg-[#f0f7f1] focus:outline-none focus:ring-2 focus:ring-[#2c6e33]/30"
            @click="copyRedirectUri"
          >{{ copied ? 'Đã sao chép' : 'Sao chép' }}</button>
        </div>
        <p v-if="settings.redirectUriSource === 'request'" class="m-0 mt-2 text-xs text-[#8a7320]">
          <i class="fa-solid fa-circle-info mr-1" aria-hidden="true"></i>
          Chưa đặt <code class="rounded bg-[#f8faf8] px-1">PUBLIC_BASE_URL</code>, nên giá trị trên lấy theo tên miền của chính yêu cầu này. Sau reverse proxy hoặc khi đổi tên miền, chuỗi có thể khác đi và Google sẽ từ chối. Hãy đặt biến đó ở môi trường sản xuất.
        </p>
      </section>

      <form class="flex flex-col gap-4 rounded-xl border border-[#e2ece3] bg-white p-5" @submit.prevent="save">
        <h2 class="m-0 text-[1rem] font-extrabold text-[#122815]">Thông tin OAuth client</h2>

        <label class="flex flex-col gap-1.5 text-sm font-bold">
          Client ID
          <input
            v-model="form.clientId"
            autocomplete="off"
            placeholder="123456789-abcdef.apps.googleusercontent.com"
            class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20"
          />
        </label>

        <div class="flex flex-col gap-1.5">
          <label for="google-client-secret" class="text-sm font-bold">Client secret mới</label>
          <span class="text-sm text-[#667768]">
            {{ settings.hasClientSecret ? `Đang cấu hình ${settings.clientSecretMasked || '••••'}` : 'Chưa cấu hình' }}. Để trống để giữ nguyên.
          </span>
          <div class="flex flex-col gap-2 sm:flex-row">
            <input
              id="google-client-secret"
              v-model="newSecret"
              :type="secretVisible ? 'text' : 'password'"
              autocomplete="new-password"
              placeholder="Nhập secret mới khi cần thay thế"
              class="min-w-0 flex-1 rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20"
            />
            <button
              type="button"
              class="rounded-lg border border-[#c8d6c9] bg-white px-3 py-2.5 text-sm font-semibold hover:bg-[#f0f7f1] focus:outline-none focus:ring-2 focus:ring-[#2c6e33]/30"
              :aria-label="secretVisible ? 'Ẩn client secret mới' : 'Hiện client secret mới'"
              @click="secretVisible = !secretVisible"
            >{{ secretVisible ? 'Ẩn' : 'Hiện' }}</button>
          </div>
        </div>

        <button
          v-if="settings.hasClientSecret || secretUnreadable"
          type="button"
          :disabled="clearing || saving"
          class="self-start rounded-lg border border-[#d12420] px-3 py-2 text-sm font-bold text-[#d12420] hover:bg-[#fff4f3] focus:outline-none focus:ring-2 focus:ring-[#d12420]/30 disabled:cursor-not-allowed disabled:opacity-60"
          @click="clearSecret"
        >{{ clearing ? 'Đang xoá…' : 'Xoá Client secret' }}</button>

        <label class="flex items-start gap-3 border-t border-[#e2ece3] pt-4 text-sm font-semibold">
          <input v-model="form.isEnabled" type="checkbox" class="mt-0.5 h-4 w-4 accent-[#2c6e33]" />
          <span>
            Bật đăng nhập Google<br />
            <span class="font-normal text-[#667768]">Tắt công tắc này dừng cả đăng nhập lẫn việc gửi bình luận mới, nhưng không xoá tài khoản hay bình luận nào — bật lại thì mọi thứ trở về như cũ.</span>
          </span>
        </label>

        <label class="flex items-start gap-3 text-sm font-semibold">
          <input v-model="form.defaultCommentsEnabled" type="checkbox" class="mt-0.5 h-4 w-4 accent-[#2c6e33]" />
          <span>
            Bài viết mới mặc định mở bình luận<br />
            <span class="font-normal text-[#667768]">Chỉ áp dụng cho bài tạo về sau. Bài viết đã có vẫn đang đóng và được bật riêng tại danh sách bài viết.</span>
          </span>
        </label>

        <div class="flex flex-wrap gap-3 border-t border-[#e2ece3] pt-4">
          <button
            type="submit"
            :disabled="saving || clearing"
            class="rounded-lg bg-[#1e4620] px-5 py-2.5 font-bold text-white hover:bg-[#2c6e33] focus:outline-none focus:ring-2 focus:ring-[#2c6e33]/40 disabled:cursor-not-allowed disabled:opacity-60"
          >{{ saving ? 'Đang lưu…' : 'Lưu cấu hình' }}</button>
        </div>
      </form>

      <section class="rounded-xl border border-[#e2ece3] bg-[#f8faf8] p-5 text-sm text-[#3d4f3f]">
        <h2 class="m-0 text-[1rem] font-extrabold text-[#122815]">Thứ tự thiết lập</h2>
        <ol class="m-0 mt-2 list-decimal pl-5 flex flex-col gap-1">
          <li>Cấp quyền <strong>readers</strong> và <strong>comments</strong> cho vai trò kiểm duyệt tại <nuxt-link to="/admin/users/roles" class="font-semibold text-[#2c6e33] underline">Phân quyền</nuxt-link> — hai tài nguyên này mặc định chưa cấp cho vai trò nào.</li>
          <li>Dán Redirect URI ở trên vào Google Cloud Console.</li>
          <li>Lưu Client ID và Client secret tại trang này.</li>
          <li>Bật công tắc đăng nhập Google.</li>
          <li>Mở bình luận cho từng bài viết tại <nuxt-link to="/admin/content/articles" class="font-semibold text-[#2c6e33] underline">Quản lý bài viết</nuxt-link>.</li>
        </ol>
      </section>
    </template>
  </div>
</template>
