<script setup lang="ts">
/**
 * Timeline 7 bước xử lý video + tiến độ rendition.
 *
 * Đọc trạng thái từ item (do parent poll cung cấp) — không tự fetch. Suy ra
 * "bước hiện hành" từ `processingStatus` + `resolutionsReady` + `durationSeconds`
 * + `thumbnailUrl`, không cần cột CSDL riêng: pipeline công bố rendition theo
 * thứ tự nhỏ trước (`resolutionsReady` cập nhật dần), và mỗi giai đoạn để lại
 * dấu vết trên hàng `media_items` (probe ghi `durationSeconds/width/height`,
 * thumbnail ghi `thumbnailUrl`, ready ghi `processingStatus='ready'`).
 *
 * 7 bước khớp pipeline thật trong `server/services/video-processing.ts`:
 *   1. Nhận lượt xử lý (claim)  — `processingStatus === 'processing'`
 *   2. Kiểm tra tệp gốc (sniff)  — không có signal riêng, ✓ ngay khi bước 3 có data
 *   3. Đọc metadata (ffprobe)   — `durationSeconds`/`width`/`height` ≠ null
 *   4. Chuyển mã rendition       — `resolutionsReady` thay đổi
 *   5. Ảnh đại diện              — `thumbnailUrl` ≠ null
 *   6. Danh sách phát (m3u8)     — `resolutionsReady` đầy đủ (khớp `selectRenditions`)
 *   7. Đồng bộ & dọn dẹp         — `processingStatus === 'ready'`
 */
import type { AdminMediaItem } from '~/types/admin-api'

const props = defineProps<{ item: AdminMediaItem }>()

/** Tiến trình FFmpeg thật — % của bản đang nén, đọc từ 3 cột pipeline ghi. */
const liveProgress = computed(() => {
  // Chỉ vẽ thanh khi pipeline đang ở giai đoạn transcode và có rendition + %.
  // Các giai đoạn khác (probe/thumbnail/sync) không có % thật — vẽ thanh 0% hay
  // 100% ở đó đều nói sai về trạng thái.
  if (props.item.processingPhase !== 'transcode') return null
  const rendition = props.item.processingRendition
  const percent = props.item.processingPercent
  if (!rendition || typeof percent !== 'number') return null
  return { rendition, percent: Math.min(100, Math.max(0, Math.round(percent))) }
})

// Ba rendition theo `RENDITIONS` ở `server/services/video-processing.ts:99-102`.
// Hardcode ở UI vì không import được từ `server/`; nếu server đổi, đổi cả hai.
const ALL_RENDITIONS = [
  { name: '360p', height: 360 },
  { name: '720p', height: 720 },
  { name: '1080p', height: 1080 },
] as const

/** Rendition dự kiến cho video này — lọc theo chiều cao nguồn (selectRenditions). */
const plannedRenditions = computed(() => {
  const h = props.item.height
  if (!h || h <= 0) return ALL_RENDITIONS.map(r => ({ ...r }))
  return ALL_RENDITIONS.filter(r => r.height <= h)
})

/** Tập rendition đã xong, đọc từ `resolutionsReady`. */
const readySet = computed(() => new Set(props.item.resolutionsReady ?? []))

type Stage = 'pending' | 'active' | 'done' | 'failed'

/** Trạng thái từng bước — suy ra từ dữ liệu có sẵn. */
const stages = computed<{ label: string, key: string, status: Stage }[]>(() => {
  const status = props.item.processingStatus
  const ready = readySet.value
  const hasProbe = props.item.durationSeconds != null || props.item.width != null || props.item.height != null
  const hasThumb = !!props.item.thumbnailUrl
  const allRenditionsReady = plannedRenditions.value.length > 0 && plannedRenditions.value.every(r => ready.has(r.name))
  const isReady = status === 'ready'
  const isFailed = status === 'failed'
  const isProcessing = status === 'processing'
  const isPending = status === 'pending'

  // Bước 1: claim
  const s1: Stage = isReady ? 'done' : isProcessing ? 'done' : isFailed ? 'failed' : isPending ? 'active' : 'done'
  // Bước 2: sniff — ✓ khi bước 3 đã có data (probe xong nghĩa là sniff đã qua)
  const s2: Stage = isReady ? 'done' : hasProbe ? 'done' : isProcessing ? 'active' : isFailed ? 'failed' : 'pending'
  // Bước 3: probe
  const s3: Stage = isReady ? 'done' : hasProbe ? 'done' : isProcessing ? 'active' : isFailed ? 'failed' : 'pending'
  // Bước 4: transcode renditions
  const s4: Stage = isReady ? 'done' : allRenditionsReady ? 'done' : (isProcessing && ready.size > 0) ? 'active' : isProcessing ? 'active' : isFailed ? 'failed' : isPending ? 'pending' : 'pending'
  // Bước 5: thumbnail
  const s5: Stage = isReady ? 'done' : hasThumb ? 'done' : (s4 === 'active' && allRenditionsReady) ? 'active' : isFailed ? 'failed' : 'pending'
  // Bước 6: master.m3u8 — khớp khi tất cả rendition ready
  const s6: Stage = isReady ? 'done' : allRenditionsReady ? 'done' : (s5 === 'done') ? 'active' : isFailed ? 'failed' : 'pending'
  // Bước 7: sync + cleanup
  const s7: Stage = isReady ? 'done' : isFailed ? 'failed' : 'pending'

  return [
    { label: 'Nhận lượt xử lý', key: 'claim', status: isFailed ? (s1 === 'done' ? 'failed' : 'failed') : s1 },
    { label: 'Kiểm tra tệp gốc', key: 'sniff', status: s2 },
    { label: 'Đọc metadata', key: 'probe', status: s3 },
    { label: 'Nén chất lượng các bản', key: 'transcode', status: s4 },
    { label: 'Ảnh đại diện', key: 'thumbnail', status: s5 },
    { label: 'Danh sách phát', key: 'playlist', status: s6 },
    { label: 'Đồng bộ & dọn dẹp', key: 'sync', status: s7 },
  ]
})

const failedMessage = computed(() => {
  if (props.item.processingStatus !== 'failed') return ''
  return props.item.processingError || 'Lượt xử lý đã lỗi.'
})

const isPending = computed(() => props.item.processingStatus === 'pending' || props.item.processingStatus === 'processing')
</script>

<template>
  <div class="space-y-4">
    <ol class="space-y-1">
      <li
        v-for="stage in stages"
        :key="stage.key"
        class="flex items-start gap-3"
        :class="{
          'opacity-40': stage.status === 'pending',
        }"
      >
        <span
          class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold"
          :class="{
            'bg-[#2c6e33] text-white': stage.status === 'done',
            'bg-amber-100 text-amber-700 ring-2 ring-amber-300': stage.status === 'active',
            'bg-red-100 text-red-700': stage.status === 'failed',
            'bg-gray-100 text-gray-400': stage.status === 'pending',
          }"
        >
          <i v-if="stage.status === 'done'" class="fa-solid fa-check" aria-hidden="true"></i>
          <i v-else-if="stage.status === 'failed'" class="fa-solid fa-xmark" aria-hidden="true"></i>
          <i v-else-if="stage.status === 'active'" class="fa-solid fa-circle-notch animate-spin motion-reduce:animate-none" aria-hidden="true"></i>
          <span v-else>{{ stages.indexOf(stage) + 1 }}</span>
        </span>
        <div class="flex-1 min-w-0 pt-0.5">
          <p
            class="text-sm font-medium"
            :class="{
              'text-[#1e251c]': stage.status === 'done' || stage.status === 'active',
              'text-red-700': stage.status === 'failed',
              'text-[#8a9a8d]': stage.status === 'pending',
            }"
          >
            {{ stage.label }}
          </p>
          <!-- Rendition chips ở bước 4 -->
          <div v-if="stage.key === 'transcode' && plannedRenditions.length" class="mt-1.5 flex flex-wrap gap-1.5">
            <span
              v-for="rendition in plannedRenditions"
              :key="rendition.name"
              class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
              :class="readySet.has(rendition.name)
                ? 'bg-[#e8f0e8] text-[#2c6e33]'
                : liveProgress?.rendition === rendition.name
                  ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
                  : isPending ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500'"
            >
              <i v-if="readySet.has(rendition.name)" class="fa-solid fa-check text-[0.6rem]" aria-hidden="true"></i>
              <i v-else-if="liveProgress?.rendition === rendition.name" class="fa-solid fa-circle-notch animate-spin motion-reduce:animate-none text-[0.6rem]" aria-hidden="true"></i>
              <i v-else-if="isPending" class="fa-solid fa-circle-notch animate-spin motion-reduce:animate-none text-[0.6rem]" aria-hidden="true"></i>
              {{ rendition.name }}
            </span>
          </div>
          <!-- Thanh % FFmpeg thật — chỉ hiện khi pipeline đang nén một bản cụ thể -->
          <div v-if="stage.key === 'transcode' && liveProgress" class="mt-2" role="status" aria-live="polite">
            <div class="flex items-center justify-between text-xs font-medium text-[#1e251c]">
              <span>Đang nén <strong class="font-semibold">{{ liveProgress.rendition }}</strong></span>
              <span class="tabular-nums">{{ liveProgress.percent }}%</span>
            </div>
            <div class="mt-1 h-2 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                class="h-full rounded-full bg-[#2c6e33] transition-[width] duration-300 ease-out motion-reduce:transition-none"
                :style="{ width: `${liveProgress.percent}%` }"
              ></div>
            </div>
          </div>
        </div>
      </li>
    </ol>
    <p v-if="failedMessage" role="alert" class="rounded-lg bg-red-50 p-3 text-sm text-red-800">
      <i class="fa-solid fa-circle-exclamation mr-1.5" aria-hidden="true"></i>{{ failedMessage }}
    </p>
  </div>
</template>
