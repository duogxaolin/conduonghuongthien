<script setup lang="ts">
/**
 * "Lưu buổi phát thành mục media" for the broadcast the livestream page just stopped
 * (`POST /api/admin/livestream/:id/recording`, no body → 201 `{ ok, mediaItemId, slug }`).
 *
 * ## When the button is offered — the route's own rules, nothing guessed
 *
 * `saveSessionAsRecording` (server/services/livestream.ts) refuses:
 *   - a broadcast still running (409) — this card is only shown for one the page has
 *     just stopped successfully;
 *   - one already saved (409) — a second save would orphan the first draft. Another
 *     officer may have saved it meanwhile: the route's sentence then shows in the alert;
 *   - an HLS broadcast (`source: 'upload'`, 409 `recording_required`): a rotating live
 *     playlist is not a recording. Always refused, so no button — the card says what
 *     to do instead (the route's own advice).
 * The route checks TWO permissions — `livestream/update` (it links the session) and
 * `media_portal/create` (it creates the media item); both gate the button here. The
 * link to the new item needs `media_portal/read` (the editor page reads it).
 *
 * The livestream page itself must not gate on `media_portal`
 * (tests/admin-media-portal-ui.test.ts): that check lives here, in the one place the
 * page touches the media library.
 *
 * ## Known limit
 *
 * No route lists ended broadcasts, so a session stopped elsewhere, or before this page
 * was opened, cannot reach this card.
 */
import type { LivestreamRecordingResponse } from '~/types/admin-livestream-api'

const props = defineProps<{
  session: { id: number, title: string, source: string }
}>()

const { hasPermission } = useAdminAuth()
const canSave = computed(() => hasPermission('livestream', 'update') && hasPermission('media_portal', 'create'))
const canOpenMedia = computed(() => hasPermission('media_portal', 'read'))
const isHls = computed(() => props.session.source === 'upload')

const saving = ref(false)
const error = ref('')
const savedMediaId = ref<number | null>(null)

async function saveRecording() {
  // One request per broadcast: a double click must not reach the route twice.
  if (!canSave.value || isHls.value || saving.value || savedMediaId.value !== null) return
  saving.value = true
  error.value = ''
  try {
    const res = await adminFetch<LivestreamRecordingResponse>(`/api/admin/livestream/${props.session.id}/recording`, { method: 'POST' })
    savedMediaId.value = res.mediaItemId
  } catch (err: unknown) {
    error.value = errorMessage(err, 'Không thể lưu buổi phát thành mục media.')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="bg-white rounded-xl border border-line p-5 md:p-6 shadow-sm" aria-labelledby="ls-ended-title">
    <div class="flex items-center gap-2.5 mb-4">
      <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-line text-brand-700">
        <i class="fa-solid fa-film text-sm" aria-hidden="true"></i>
      </div>
      <div class="min-w-0">
        <h2 id="ls-ended-title" class="text-lg font-bold text-brand-950 leading-tight">Buổi phát vừa kết thúc</h2>
        <p class="text-xs text-ink-muted mt-0.5 break-words">{{ session.title }}</p>
      </div>
    </div>

    <p v-if="isHls" class="text-sm text-ink-muted">
      <i class="fa-solid fa-circle-info mr-1 text-[0.75rem]" aria-hidden="true"></i>Luồng HLS trực tiếp không phải bản ghi nên không lưu được thành mục media. Hãy xuất tệp ghi hình từ bộ mã hóa rồi tải lên Thư viện Media.
    </p>

    <p v-else-if="!canSave" class="text-sm text-ink-muted">
      <i class="fa-solid fa-lock mr-1 text-[0.75rem]" aria-hidden="true"></i>Lưu buổi phát thành mục media cần quyền sửa buổi phát trực tiếp và quyền thêm mục vào Thư viện Media.
    </p>

    <div v-else-if="savedMediaId !== null" role="status" class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-surface-tint p-3 text-sm text-brand-900">
      <span><i class="fa-solid fa-circle-check mr-1 text-brand-700" aria-hidden="true"></i>Đã lưu thành mục media ở trạng thái bản nháp.</span>
      <NuxtLink
        v-if="canOpenMedia"
        :to="`/admin/media-portal/${savedMediaId}`"
        class="font-semibold text-brand-700 underline hover:no-underline"
      >
        Mở mục media
      </NuxtLink>
    </div>

    <div v-else>
      <p class="text-sm text-ink-muted mb-3">Lưu video YouTube của buổi phát này vào Thư viện Media dưới dạng bản nháp để biên tập và đăng lại sau.</p>
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-800 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-700 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
        :disabled="saving"
        @click="saveRecording()"
      >
        <i :class="saving ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-floppy-disk'" class="text-xs" aria-hidden="true"></i>
        {{ saving ? 'Đang lưu…' : 'Lưu thành mục media' }}
      </button>
      <p v-if="error" role="alert" class="mt-3 text-sm text-danger-soft">
        <i class="fa-solid fa-circle-exclamation mr-1" aria-hidden="true"></i>{{ error }}
      </p>
    </div>
  </section>
</template>
