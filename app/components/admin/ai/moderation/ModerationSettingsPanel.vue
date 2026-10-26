<script setup lang="ts">
import { computed } from 'vue'
import type { ModerationMode, ModerationModelOption, ModerationProviderOption } from '~/types/moderation'

/**
 * Tab "Cài đặt Kiểm duyệt AI" of `/admin/ai/moderation` — presentational. The page owns
 * the settings (each field is a `v-model`), loads them and saves them on `save`. A failed
 * re-read after a save arrives as the page's `#error` slot, above the fields.
 */
const enabled = defineModel<boolean>('enabled', { required: true })
const mode = defineModel<ModerationMode>('mode', { required: true })
const provider = defineModel<string>('provider', { required: true })
const model = defineModel<string>('model', { required: true })
const systemPrompt = defineModel<string>('systemPrompt', { required: true })

const props = defineProps<{
  defaultSystemPrompt: string
  activeProviders: ModerationProviderOption[]
  activeModels: ModerationModelOption[]
  saving: boolean
}>()

const emit = defineEmits<{ save: [] }>()

const activeModelsForCurrentProvider = computed(() => {
  return props.activeModels.filter(m => m.provider === provider.value)
})

function restoreDefaultPrompt() {
  systemPrompt.value = props.defaultSystemPrompt
}
</script>

<template>
  <form class="flex flex-col gap-5" @submit.prevent="emit('save')">
    <!-- Đọc lại cấu hình hỏng sau khi lưu: nhánh lỗi do TRANG cấp (slot); các ô giữ nguyên. -->
    <slot name="error" />

    <!-- Chế độ kiểm duyệt -->
    <section class="flex flex-col gap-4 rounded-xl border border-line bg-white p-4 sm:p-5">
      <div>
        <h2 class="m-0 text-base font-extrabold text-brand-950">Chế độ kiểm duyệt an ninh</h2>
        <p class="m-0 mt-1 text-sm text-ink-muted">Lựa chọn phương thức bảo vệ an ninh và rà soát nội dung trên Cổng thông tin.</p>
      </div>

      <label class="flex items-center gap-3 text-sm font-semibold">
        <input v-model="enabled" type="checkbox" class="h-4 w-4 accent-brand-700 focus:ring-2 focus:ring-brand-700/30" />
        <span>Kích hoạt tính năng Kiểm duyệt an ninh tự động</span>
      </label>

      <div class="grid gap-3 sm:grid-cols-2">
        <label
          class="flex cursor-pointer flex-col gap-1 rounded-xl border p-3.5 transition-all"
          :class="mode === 'keyword_only' ? 'border-brand-700 bg-surface-tint shadow-xs' : 'border-line-strong hover:bg-[#f8faf8]'"
        >
          <span class="flex items-center gap-2 text-sm font-bold text-brand-950">
            <input v-model="mode" type="radio" value="keyword_only" class="h-4 w-4 accent-brand-700" />
            Chỉ dùng bộ lọc từ khóa (Không AI)
          </span>
          <span class="pl-6 text-xs text-ink-muted leading-relaxed">
            Quét nhanh các từ khóa cấm theo danh mục. Phản hồi tức thì, hoàn toàn không tốn chi phí gọi AI, nhưng có thể bị lách chữ hoặc khóa nhầm câu lành tính.
          </span>
        </label>

        <label
          class="flex cursor-pointer flex-col gap-1 rounded-xl border p-3.5 transition-all"
          :class="mode === 'ai' ? 'border-brand-700 bg-surface-tint shadow-xs' : 'border-line-strong hover:bg-[#f8faf8]'"
        >
          <span class="flex items-center gap-2 text-sm font-bold text-brand-950">
            <input v-model="mode" type="radio" value="ai" class="h-4 w-4 accent-brand-700" />
            Kết hợp AI đọc hiểu ngữ cảnh (Khuyên dùng)
          </span>
          <span class="pl-6 text-xs text-ink-muted leading-relaxed">
            AI phân tích ý đồ ngữ cảnh câu văn để phân biệt giữa tuyên truyền chống phá (vi phạm -> ẩn ngay) và người dân cảnh giác/phản bác (an toàn -> cho phép hiển thị).
          </span>
        </label>
      </div>
    </section>

    <!-- Cấu hình AI & Prompt cho Kiểm duyệt -->
    <section v-if="mode === 'ai'" class="flex flex-col gap-4 rounded-xl border border-line bg-white p-4 sm:p-5">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
        <div>
          <h2 class="m-0 text-base font-extrabold text-brand-950">Cấu hình AI & Prompt cho Trợ lý Kiểm duyệt</h2>
          <p class="m-0 mt-0.5 text-xs text-ink-muted">
            Đồng bộ với <nuxt-link to="/admin/ai" class="font-bold text-brand-700 underline">AI Panel</nuxt-link>. Bạn sửa ở đây hoặc sửa trong AI Panel đều có hiệu lực ngay lập tức.
          </p>
        </div>
        <button
          type="button"
          class="px-3 py-1.5 rounded-lg border border-line-strong bg-white text-xs font-semibold text-brand-950 hover:bg-surface-tint transition-colors cursor-pointer"
          @click="restoreDefaultPrompt"
        >
          <i class="fa-solid fa-rotate-left mr-1" aria-hidden="true"></i> Khôi phục prompt kiểm duyệt mặc định C11
        </button>
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label class="flex flex-col gap-1.5 text-sm font-bold">
          Nhà cung cấp (Provider)
          <select v-model="provider" class="rounded-lg border border-line-strong px-3 py-2.5 font-normal outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/20 bg-white">
            <option v-for="p in activeProviders" :key="p.provider" :value="p.provider">{{ p.label }} ({{ p.provider }})</option>
            <option v-if="!activeProviders.some(p => p.provider === provider)" :value="provider">{{ provider }}</option>
          </select>
        </label>

        <label class="flex flex-col gap-1.5 text-sm font-bold">
          Model sử dụng
          <select v-if="activeModelsForCurrentProvider.length > 0" v-model="model" class="rounded-lg border border-line-strong px-3 py-2.5 font-normal outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/20 bg-white">
            <option v-for="m in activeModelsForCurrentProvider" :key="m.model" :value="m.model">
              {{ m.model }} {{ m.label ? `(${m.label})` : '' }} — ${{ m.promptCostPerMillion }} in / ${{ m.completionCostPerMillion }} out
            </option>
          </select>
          <input
            v-else
            v-model="model"
            type="text"
            placeholder="delify-5.5, flash..."
            class="rounded-lg border border-line-strong px-3 py-2.5 font-normal outline-none focus:border-brand-700"
          />
        </label>
      </div>

      <!-- System Prompt Textarea -->
      <label class="flex flex-col gap-1.5 text-sm font-bold">
        <div class="flex items-center justify-between">
          <span>Chỉ dẫn hệ thống (System Prompt) cho AI Kiểm duyệt</span>
          <span class="text-xs font-normal text-ink-muted">{{ systemPrompt.length }} ký tự</span>
        </div>
        <textarea
          v-model="systemPrompt"
          rows="9"
          placeholder="Nhập prompt chỉ dẫn cho sĩ quan an ninh mạng kiểm duyệt..."
          class="rounded-lg border border-line-strong px-3.5 py-2.5 font-normal font-sans text-xs leading-relaxed outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/20"
        ></textarea>
      </label>
    </section>

    <!-- Save button -->
    <div class="flex items-center justify-end gap-3 bg-white p-4 rounded-xl border border-line">
      <button
        type="submit"
        :disabled="saving"
        class="px-6 py-2.5 rounded-lg bg-brand-700 hover:bg-brand-900 text-white text-sm font-bold transition-all border-none cursor-pointer shadow-sm disabled:opacity-50"
      >
        {{ saving ? 'Đang lưu...' : 'Lưu cấu hình kiểm duyệt' }}
      </button>
    </div>
  </form>
</template>
