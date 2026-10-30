<script setup lang="ts">
/**
 * Cột "Cấu hình xuất bản" của trình soạn bài viết (`pages/admin/content/articles/[id].vue`, tách
 * wave3): thể loại, danh mục (chỉ khi thể loại có danh mục), trạng thái, ảnh đại diện. Chỉ hiển
 * thị: bốn trường là `v-model` của trang (đổi thể loại thì trang tải lại danh mục và xoá danh mục
 * đang chọn); chọn ảnh từ thư viện / tải ảnh lên là sự kiện — `useArticleEditorMedia` làm.
 */
import type { AdminCategoryRow, AdminContentTypeRow } from '~/types/admin-api'

defineProps<{
  contentTypes: AdminContentTypeRow[]
  availableCategories: AdminCategoryRow[]
  /** The thumbnail upload is running (`useUpload().uploading`). */
  uploading: boolean
}>()

const emit = defineEmits<{
  'pick-thumbnail': []
  'upload-thumbnail': [event: Event]
}>()

const articleType = defineModel<string>('articleType', { required: true })
const categoryId = defineModel<number | null>('categoryId', { required: true })
const status = defineModel<string>('status', { required: true })
const thumbnailUrl = defineModel<string>('thumbnailUrl', { required: true })
</script>

<template>
  <div class="bg-white rounded-xl border border-line p-6 flex flex-col gap-4 self-start">
    <h3 class="text-[1rem] font-bold text-brand-950 m-0">Cấu hình xuất bản</h3>

    <div class="flex flex-col gap-1.5">
      <label class="text-[0.82rem] font-bold text-ink-admin">Thể loại bài viết (*)</label>
      <select v-model="articleType" class="w-full px-3 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 box-border">
        <option v-for="ct in contentTypes" :key="ct.id" :value="ct.slug">
          {{ ct.icon ? ct.icon.replace('fa-solid ', '').replace('fa-regular ', '') : '' }} {{ ct.name }}
        </option>
      </select>
    </div>

    <!-- Dynamic category select — populated from DB by type -->
    <div v-if="availableCategories.length > 0" class="flex flex-col gap-1.5">
      <label class="text-[0.82rem] font-bold text-ink-admin">
        Danh mục
        <span class="font-normal text-ink-muted">— tùy chọn</span>
      </label>
      <select v-model="categoryId" class="w-full px-3 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 box-border">
        <option :value="null">— Không có danh mục —</option>
        <template v-for="cat in availableCategories" :key="cat.id">
          <option v-if="!cat.parentId" :value="cat.id" class="font-bold">{{ cat.name }}</option>
          <option v-else :value="cat.id">&nbsp;&nbsp;↳ {{ cat.name }}</option>
        </template>
      </select>
    </div>

    <div class="flex flex-col gap-1.5">
      <label class="text-[0.82rem] font-bold text-ink-admin">Trạng thái (*)</label>
      <select v-model="status" class="w-full px-3 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 box-border">
        <option value="published">🟢 Xuất Bản Ngay</option>
        <option value="draft">🟡 Bản Nháp (Draft)</option>
        <option value="archived">⚪ Lưu Trữ</option>
      </select>
    </div>

    <div class="flex flex-col gap-2">
      <label class="text-[0.82rem] font-bold text-ink-admin">Ảnh đại diện (Thumbnail)</label>
      <div v-if="thumbnailUrl" class="relative w-full h-40 rounded-lg overflow-hidden border border-line">
        <img :src="thumbnailUrl" class="w-full h-full object-cover" />
        <button type="button" aria-label="Xóa ảnh đại diện" class="absolute top-2 right-2 bg-black/70 text-white border-0 w-6 h-6 rounded-full cursor-pointer flex items-center justify-center text-xs" @click="thumbnailUrl = ''">
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </div>
      <button
        class="w-full flex items-center justify-center gap-2 bg-surface-tint border border-brand-300 text-brand-700 px-3 py-2.5 rounded-lg font-bold cursor-pointer text-sm hover:bg-[#e4f2e5] transition-colors"
        @click="emit('pick-thumbnail')"
      >
        <i class="fa-regular fa-images"></i> {{ thumbnailUrl ? 'Đổi từ thư viện' : 'Chọn từ thư viện' }}
      </button>
      <label
        class="w-full flex items-center justify-center gap-2 bg-brand-900 hover:bg-brand-700 text-white px-3 py-2.5 rounded-lg font-bold cursor-pointer text-sm transition-colors"
        :class="{ 'opacity-60 cursor-not-allowed pointer-events-none': uploading }"
      >
        <i class="fa-regular" :class="uploading ? 'fa-spinner animate-spin' : 'fa-cloud-arrow-up'"></i>
        {{ uploading ? 'Đang tải...' : 'Upload ảnh' }}
        <input type="file" accept="image/*" class="sr-only" :disabled="uploading" @change="emit('upload-thumbnail', $event)" />
      </label>
    </div>
  </div>
</template>
