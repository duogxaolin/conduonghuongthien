<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

/**
 * Address bans, enforced at BOTH sign-in and comment time.
 *
 * Both points matter: enforcing only at comment time means a banned person signs
 * in with a fresh Google account and carries on; enforcing only at sign-in means
 * someone already holding a ticket keeps posting.
 *
 * The server refuses an IPv6 range with a message naming the limitation, and this
 * form shows that message inline rather than as a toast that disappears — an
 * officer who was told "not supported" needs the sentence to still be there while
 * they retype the address.
 */

type Ban = {
  id: number
  value: string
  reason: string | null
  createdAt: string | null
  createdBy: number | null
  createdByName: string | null
}

const toast = useToast()

const loading = ref(true)
const error = ref('')
const busy = ref(false)
const bans = ref<Ban[]>([])

const newValue = ref('')
const newReason = ref('')
/** Inline, persistent — see the module comment. */
const formError = ref('')

function formatMoment(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('vi-VN', { hour12: false })
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await $fetch<any>('/api/admin/ip-bans')
    if (!res?.ok) {
      error.value = 'Không tải được danh sách chặn.'
      return
    }
    bans.value = res.bans || []
  } catch (err: any) {
    error.value = err?.data?.statusMessage || 'Không tải được danh sách chặn.'
  } finally {
    loading.value = false
  }
}

async function addBan() {
  if (!newValue.value.trim() || busy.value) return
  busy.value = true
  formError.value = ''
  try {
    await $fetch('/api/admin/ip-bans', {
      method: 'POST',
      body: { value: newValue.value, reason: newReason.value },
    })
    newValue.value = ''
    newReason.value = ''
    toast.success('Đã thêm vào danh sách chặn.')
    await load()
  } catch (err: any) {
    formError.value = err?.data?.statusMessage || 'Không thêm được mục chặn.'
  } finally {
    busy.value = false
  }
}

async function liftBan(ban: Ban) {
  if (!confirm(`Bỏ chặn ${ban.value}? Địa chỉ này sẽ đăng nhập và bình luận được ngay.`)) return
  busy.value = true
  try {
    await $fetch(`/api/admin/ip-bans/${ban.id}`, { method: 'DELETE' })
    toast.success('Đã bỏ chặn địa chỉ.')
    await load()
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Không bỏ chặn được địa chỉ này.')
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-5">
    <div>
      <h1 class="m-0 text-[1.35rem] font-extrabold text-[#122815]">Chặn địa chỉ IP</h1>
      <p class="m-0 mt-1 text-sm text-[#667768]">
        Áp dụng cho cả lượt đăng nhập Google và lượt gửi bình luận. Chấp nhận một địa chỉ IPv4, một dải IPv4 (ví dụ <code class="rounded bg-[#f0f7f1] px-1">203.0.113.0/24</code>), hoặc một địa chỉ IPv6 đầy đủ.
      </p>
    </div>

    <form class="flex flex-col gap-3 rounded-xl border border-[#e2ece3] bg-white p-4" @submit.prevent="addBan">
      <div class="flex flex-wrap items-end gap-3">
        <label class="flex min-w-[200px] flex-col gap-1.5 text-sm font-bold">
          Địa chỉ hoặc dải
          <input
            v-model="newValue"
            autocomplete="off"
            placeholder="203.0.113.45 hoặc 203.0.113.0/24"
            class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20"
          />
        </label>
        <label class="flex min-w-[240px] flex-1 flex-col gap-1.5 text-sm font-bold">
          Lý do (không bắt buộc)
          <input
            v-model="newReason"
            maxlength="500"
            autocomplete="off"
            class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20"
          />
        </label>
        <button
          type="submit"
          :disabled="busy || !newValue.trim()"
          class="rounded-lg bg-[#1e4620] px-4 py-2.5 font-bold text-white hover:bg-[#2c6e33] disabled:opacity-60"
        >Thêm</button>
      </div>
      <p v-if="formError" role="alert" class="m-0 text-sm text-[#b0403c]">
        <i class="fa-solid fa-circle-exclamation mr-1.5" aria-hidden="true"></i>{{ formError }}
      </p>
    </form>

    <!-- Đang tải -->
    <div v-if="loading" role="status" aria-busy="true" class="rounded-xl border border-[#e2ece3] bg-white p-4">
      <span class="sr-only">Đang tải danh sách chặn</span>
      <div
        v-for="n in 4"
        :key="n"
        aria-hidden="true"
        class="mb-2 h-11 rounded-lg bg-[#eef3ee] animate-pulse motion-reduce:animate-none"
      ></div>
    </div>

    <!-- Lỗi -->
    <div
      v-else-if="error"
      role="alert"
      class="rounded-lg border border-dashed border-[#e0a3a1] bg-white px-5 py-6 text-center text-sm text-[#b0403c]"
    >
      <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
      {{ error }}
      <button type="button" class="ml-1 font-bold text-[#2c6e33] underline" @click="load">Thử lại</button>
    </div>

    <template v-else>
      <!-- Rỗng -->
      <p v-if="!bans.length" class="rounded-xl border border-[#e2ece3] bg-white px-5 py-8 text-center text-sm text-[#667768]">
        Chưa chặn địa chỉ nào.
      </p>

      <div v-else class="overflow-x-auto rounded-xl border border-[#e2ece3] bg-white">
        <table class="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr class="bg-[#f8faf8] text-left text-[0.78rem] uppercase tracking-wide text-[#667768]">
              <th class="px-4 py-3 font-bold">Địa chỉ / dải</th>
              <th class="px-4 py-3 font-bold">Lý do</th>
              <th class="px-4 py-3 font-bold">Người thêm</th>
              <th class="px-4 py-3 font-bold">Thời điểm</th>
              <th class="px-4 py-3 font-bold"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="ban in bans" :key="ban.id" class="border-t border-[#eef3ee]">
              <td class="px-4 py-3 font-mono font-semibold text-[#122815]">{{ ban.value }}</td>
              <td class="px-4 py-3 text-[#3d4f3f]">{{ ban.reason || '—' }}</td>
              <td class="px-4 py-3 text-[#3d4f3f]">{{ ban.createdByName || 'Tài khoản đã xoá' }}</td>
              <td class="px-4 py-3 text-[#3d4f3f]">{{ formatMoment(ban.createdAt) }}</td>
              <td class="px-4 py-3 text-right">
                <button
                  type="button"
                  :disabled="busy"
                  class="font-semibold text-[#b0403c] hover:underline disabled:opacity-60"
                  @click="liftBan(ban)"
                >Bỏ chặn</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
