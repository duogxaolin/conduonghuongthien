<script setup lang="ts">
import type { ModerationRule } from '~/types/moderation'

/**
 * Tab "Quy tắc & Từ khóa an ninh" of `/admin/ai/moderation` — presentational. The page
 * owns the rules and the new-rule form (each field is a `v-model`) and runs add, toggle
 * and delete on the events below. A failed re-read of the list arrives as the page's
 * `#error` slot and takes the table's place; the add form stays usable.
 */
const category = defineModel<string>('category', { required: true })
const pattern = defineModel<string>('pattern', { required: true })
const action = defineModel<string>('action', { required: true })

defineProps<{ rules: ModerationRule[] }>()

const emit = defineEmits<{
  add: []
  toggle: [rule: ModerationRule]
  delete: [rule: ModerationRule]
}>()

const RULE_CATEGORY_LABELS: Record<string, string> = {
  hostile_forces: 'Thế lực thù địch / Phản động',
  anti_state: 'Chống phá / Xuyên tạc chính sách',
  defamation: 'Bôi nhọ / Xúc phạm uy tín',
  spam_fraud: 'Spam / Cờ bạc / Lừa đảo',
  profanity: 'Từ ngữ thô tục',
  custom: 'Tùy biến',
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Add Rule Form -->
    <div class="rounded-xl border border-line-strong bg-surface-tint p-4 flex flex-col gap-3 shadow-xs">
      <h3 class="m-0 text-sm font-extrabold text-brand-950 flex items-center gap-2">
        <i class="fa-solid fa-plus-circle text-brand-700"></i>
        Thêm quy tắc / Từ khóa kiểm duyệt an ninh mới
      </h3>
      <form class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end" @submit.prevent="emit('add')">
        <label class="flex flex-col gap-1 text-xs font-bold text-brand-950">
          Nhóm vi phạm
          <select v-model="category" class="rounded-lg border border-line-strong px-2.5 py-2 text-xs bg-white">
            <option value="hostile_forces">Thế lực thù địch / Phản động</option>
            <option value="anti_state">Chống phá / Xuyên tạc chính sách</option>
            <option value="defamation">Bôi nhọ / Xúc phạm uy tín</option>
            <option value="spam_fraud">Spam / Cờ bạc / Lừa đảo</option>
            <option value="profanity">Từ ngữ thô tục</option>
            <option value="custom">Tùy biến</option>
          </select>
        </label>

        <label class="flex flex-col gap-1 text-xs font-bold text-brand-950 lg:col-span-2">
          Từ khóa / Mẫu nhận diện (Pattern)
          <input
            v-model="pattern"
            type="text"
            placeholder="Nhập từ khóa hoặc cụm từ vi phạm..."
            class="rounded-lg border border-line-strong px-3 py-2 text-xs bg-white outline-none focus:border-brand-700"
            required
          />
        </label>

        <label class="flex flex-col gap-1 text-xs font-bold text-brand-950">
          Hành động xử lý
          <select v-model="action" class="rounded-lg border border-line-strong px-2.5 py-2 text-xs bg-white">
            <option value="auto_hide">Tự động ẩn ngay lập tức</option>
            <option value="flag_only">Chỉ gắn cờ cảnh báo</option>
          </select>
        </label>

        <button
          type="submit"
          class="px-4 py-2 rounded-lg bg-brand-700 hover:bg-brand-900 text-white text-xs font-bold cursor-pointer border-none shadow-xs"
        >
          + Thêm quy tắc
        </button>
      </form>
    </div>

    <!-- Đọc lại danh sách hỏng sau lần tải đầu: nhánh lỗi do TRANG cấp (slot), thay cho bảng cũ. -->
    <slot v-if="$slots.error" name="error" />

    <!-- Rules List Table -->
    <div v-else class="rounded-xl border border-line bg-white overflow-x-auto shadow-xs">
      <table class="w-full text-xs">
        <thead class="bg-[#f7faf7] text-left">
          <tr>
            <th class="px-3.5 py-3 font-bold text-brand-950">Nhóm danh mục</th>
            <th class="px-3.5 py-3 font-bold text-brand-950">Từ khóa / Mẫu nhận diện</th>
            <th class="px-3.5 py-3 font-bold text-brand-950">Hành động</th>
            <th class="px-3.5 py-3 font-bold text-brand-950">Mức độ</th>
            <th class="px-3.5 py-3 font-bold text-brand-950">Trạng thái</th>
            <th class="px-3.5 py-3 font-bold text-brand-950 text-right">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rules" :key="r.id" class="border-t border-line hover:bg-[#fcfdfc]">
            <td class="px-3.5 py-2.5 font-bold text-brand-950">
              {{ RULE_CATEGORY_LABELS[r.category] || r.category }}
            </td>
            <td class="px-3.5 py-2.5 font-mono text-[#b42318] font-bold">
              "{{ r.pattern }}"
            </td>
            <td class="px-3.5 py-2.5">
              <span class="px-2 py-0.5 rounded text-[0.68rem] font-bold" :class="r.action === 'auto_hide' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'">
                {{ r.action === 'auto_hide' ? 'Tự động ẩn ngay' : 'Chỉ cảnh báo' }}
              </span>
            </td>
            <td class="px-3.5 py-2.5">
              <span class="px-2 py-0.5 rounded-full text-[0.65rem] font-bold uppercase" :class="r.severity === 'critical' ? 'bg-red-600 text-white' : r.severity === 'high' ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-800'">
                {{ r.severity }}
              </span>
            </td>
            <td class="px-3.5 py-2.5">
              <button
                type="button"
                class="px-2.5 py-1 rounded text-xs font-semibold cursor-pointer border"
                :class="r.isEnabled ? 'bg-green-100 text-green-800 border-green-300' : 'bg-gray-100 text-gray-500 border-gray-300'"
                @click="emit('toggle', r)"
              >
                {{ r.isEnabled ? 'Đang bật' : 'Đã tắt' }}
              </button>
            </td>
            <td class="px-3.5 py-2.5 text-right">
              <button
                type="button"
                class="text-xs text-[#b42318] hover:underline cursor-pointer border-none bg-transparent"
                @click="emit('delete', r)"
              >
                Xóa
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
