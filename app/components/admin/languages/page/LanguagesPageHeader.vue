<script setup lang="ts">
/**
 * Đầu trang `/admin/languages` — tiêu đề, ba nút "Đồng bộ key" / "Dịch tất cả còn thiếu" /
 * "Nạp mặc định" và dải lưu ý kèm "Làm mới CSDL". Tách khỏi `pages/admin/languages/index.vue`
 * (wave3 4.2): chỉ hiển thị — trạng thái đang chạy vào qua props, bấm nút phát sự kiện, trang
 * gọi API.
 */
defineProps<{
  syncing: boolean
  translatingAll: boolean
  seedingDefault: boolean
  /** Danh sách ngôn ngữ đang tải: biểu tượng của "Làm mới CSDL" quay. */
  loading: boolean
}>()

const emit = defineEmits<{ 'sync': [], 'translate-all': [], 'seed': [], 'refresh': [] }>()
</script>

<template>
  <!-- Page Header -->
  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
    <div>
      <h1 class="text-[1.3rem] font-extrabold text-brand-950 m-0">Quản lý Ngôn ngữ</h1>
      <p class="text-[0.85rem] text-ink-muted mt-1 mb-0">Quản lý ngôn ngữ và bản dịch giao diện</p>
    </div>
    <div class="flex items-center gap-2 flex-wrap">
      <button
        type="button"
        class="px-3 py-2 rounded-lg border border-line-strong bg-white text-brand-900 hover:bg-surface-tint text-xs font-bold cursor-pointer flex items-center gap-1.5 transition-colors disabled:opacity-50"
        :disabled="syncing"
        title="Đồng bộ tất cả các key từ ngôn ngữ mặc định sang các ngôn ngữ khác"
        @click="emit('sync')"
      >
        <i class="fa-solid fa-arrows-rotate text-xs" :class="syncing ? 'animate-spin' : ''"></i>
        <span>{{ syncing ? 'Đang đồng bộ...' : 'Đồng bộ key' }}</span>
      </button>

      <button
        type="button"
        class="px-3 py-2 rounded-lg bg-brand-900 hover:bg-[#153317] text-white text-xs font-bold cursor-pointer flex items-center gap-1.5 transition-colors border-none disabled:opacity-50 shadow-xs"
        :disabled="translatingAll"
        title="Dịch AI tất cả các key còn thiếu cho mọi ngôn ngữ đang hoạt động"
        @click="emit('translate-all')"
      >
        <i class="fa-solid fa-globe text-xs" :class="translatingAll ? 'animate-spin' : ''"></i>
        <span>{{ translatingAll ? 'Đang dịch tất cả...' : 'Dịch tất cả còn thiếu' }}</span>
      </button>

      <button
        type="button"
        class="px-3 py-2 rounded-lg border border-line-strong bg-white text-ink-muted hover:bg-surface-tint text-xs font-bold cursor-pointer flex items-center gap-1.5 transition-colors disabled:opacity-50"
        :disabled="seedingDefault"
        title="Khôi phục hoặc nạp lại bản dịch mặc định ban đầu"
        @click="emit('seed')"
      >
        <i class="fa-solid fa-cloud-arrow-down text-xs" :class="seedingDefault ? 'animate-spin' : ''"></i>
        <span>{{ seedingDefault ? 'Đang nạp...' : 'Nạp mặc định' }}</span>
      </button>
    </div>
  </div>

  <!-- Info Banner -->
  <div class="rounded-xl border border-[#c8dcc9] bg-surface-tint p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-brand-900">
    <div class="flex items-center gap-2">
      <i class="fa-solid fa-circle-info text-base text-brand-700 shrink-0"></i>
      <span><strong>Lưu ý:</strong> Sửa hoặc nạp bản dịch xong sẽ lưu ngay vào CSDL. Phía trang công khai sẽ tự động cập nhật khi người đọc tải lại trang hoặc chuyển ngôn ngữ.</span>
    </div>
    <button
      type="button"
      class="px-3 py-1.5 rounded-lg border border-[#a2cca4] bg-white text-xs font-bold text-brand-900 hover:bg-line transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 shadow-2xs"
      @click="emit('refresh')"
    >
      <i class="fa-solid fa-arrows-rotate text-[0.7rem]" :class="loading ? 'animate-spin' : ''"></i>
      <span>Làm mới CSDL</span>
    </button>
  </div>
</template>
