<script setup lang="ts">
import RepairUrlsPanel from '~/components/admin/media/scan/RepairUrlsPanel.vue'
import RepointDomainPanel from '~/components/admin/media/scan/RepointDomainPanel.vue'
import ScanFolderPanel from '~/components/admin/media/scan/ScanFolderPanel.vue'
import SelfHealPanel from '~/components/admin/media/scan/SelfHealPanel.vue'
import StorageSyncPanel from '~/components/admin/media/scan/StorageSyncPanel.vue'
import { useMediaScanJob, useMediaSyncJob } from '~/composables/useMediaStorageJobs'
import type {
  MediaCounts,
  MediaCountsResponse,
  RepairResponse,
  RepairSummary,
  RepointResponse,
  RepointSummary,
  SelfHealReport,
  SelfHealResponse,
} from '~/types/media-scan'
import { errorMessage } from '~/utils/errorMessage'
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

// Trang thao tác hàng loạt lên thư viện ảnh. Mỗi khối là một panel trình bày
// (`components/admin/media/scan/*`, không tự fetch); state + mọi request ở đây,
// hai job nền (quét thư mục, đồng bộ local ↔ R2) ở `useMediaStorageJobs`. Không có
// danh sách tải nên không có nhánh lỗi/thử lại: nút là thử lại, kết quả vào toast
// (tests/admin-error-retry-ui.test.ts NO_CONTRACT_NEEDED).
const toast = useToast()
const { confirm } = useConfirm()

const counts = ref<MediaCounts>({ local: 0, r2: 0 })

const loadCounts = async () => {
  try {
    const res = await adminFetch<MediaCountsResponse>('/api/admin/media/counts')
    counts.value = { local: res.local ?? 0, r2: res.r2 ?? 0 }
  } catch { /* không chặn trang */ }
}

const {
  scanning, scanResult, autoRepointToR2, scanJob, forceResettingScan,
  scanFolder, cancelScan, forceResetScan, resumeScan,
} = useMediaScanJob({ toast, confirm, onFinished: loadCounts })

const {
  syncing, syncDirection, syncResult, jobStatus, forceResettingSync,
  syncStorage, cancelSync, forceResetSync, resumeSync,
} = useMediaSyncJob({ toast, confirm, onFinished: loadCounts })

onMounted(() => {
  loadCounts()
  // Kiểm tra job đang chạy từ session trước (restart container giữa sync/scan).
  resumeSync()
  resumeScan()
})

// ─── Đổi domain URL R2 ─────────────────────────────────────────────────────────
// Đổi domain CDN R2 (cùng account + bucket) — chỉ update URL trong DB, không
// tải file: `media.url` + mọi cột nội dung nhúng URL ảnh, đúng ranh giới URL, một
// transaction. Sao lưu SQL trước là bắt buộc (hỏng → không đổi gì).
const repointing = ref(false)
const oldDomain = ref('')
const newDomain = ref('')
const repointResult = ref<RepointSummary | null>(null)

const repointUrls = async () => {
  if (!oldDomain.value.trim() || !newDomain.value.trim()) {
    toast.error('Cần nhập cả domain cũ và domain mới.')
    return
  }
  if (oldDomain.value.trim() === newDomain.value.trim()) {
    toast.error('Domain cũ và domain mới giống nhau.')
    return
  }
  if (!await confirm({
    message: `Đổi URL R2 từ "${oldDomain.value}" sang "${newDomain.value}"?\n\nSẽ đổi URL ảnh trong thư viện và mọi nội dung đang nhúng ảnh (bài viết, trang, cài đặt, chatbot…). Hệ thống sao lưu CSDL trước; sao lưu hỏng thì không đổi gì.`,
    confirmLabel: 'Đổi URL',
    danger: true,
  })) return
  repointing.value = true
  repointResult.value = null
  try {
    const res = await adminFetch<RepointResponse>('/api/admin/media/repoint-r2-urls', {
      method: 'POST',
      body: { oldDomain: oldDomain.value.trim(), newDomain: newDomain.value.trim() },
    })
    repointResult.value = { mediaUpdated: res.mediaUpdated, contentRowsUpdated: res.contentRowsUpdated, backupStamp: res.backupStamp }
    toast.success(res.message)
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi đổi domain URL'))
  } finally {
    repointing.value = false
  }
}

// ─── Vá URL ảnh hỏng hàng loạt (all bài) ─────────────────────────────────
// Sync trước đó treo ở backup nên phase rewrite chưa chạy: all bài vẫn
// `http://localhost:3000/uploads/migrated/YYYY/MM/*.jpeg` trong khi file local đã
// bị xoá (Local 0 / R2 3212). Kèm `media.url` thiếu scheme `cdn1...` → grid
// thành `http://localhost:3000/cdn1...`. Nút này vá cả `media.url` +
// `articles.content` + `articles.thumbnail_url` trong 1 transaction,
// tự backup SQL trước, idempotent (< vài giây).
const repairing = ref(false)
const repairResult = ref<RepairSummary | null>(null)

const repairUrls = async () => {
  if (!await confirm({
    message: 'Vá URL ảnh hỏng hàng loạt?\n\nSẽ:\n• Bóc prefix localhost khỏi media.url + thêm https:// nếu thiếu scheme\n• Thay /uploads/migrated/YYYY/MM/<filename> trong ALL bài viết (content + thumbnail_url) bằng URL R2 đúng\n\nTự backup SQL trước (snapshot recover thủ công). Chạy < vài giây, bấm lại an toàn.',
    confirmLabel: 'Vá URL',
    danger: true,
  })) return
  repairing.value = true
  repairResult.value = null
  try {
    const res = await adminFetch<RepairResponse>('/api/admin/media/repair-urls', { method: 'POST' })
    repairResult.value = { mediaFixed: res.mediaFixed, articlesFixed: res.articlesFixed, thumbnailsFixed: res.thumbnailsFixed, backupStamp: res.backupStamp }
    toast.success(res.message)
    await loadCounts()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi vá URL'))
  } finally {
    repairing.value = false
  }
}

// ─── Check chéo local↔R2 + tự vá (self-heal) ───────────────────────────────
// Phát hiện hàng `media` (provider='r2') mà R2 thực sự không có object
// (HeadObject 404) — upload lại từ file local gốc. Sau đó repoint
// `articles.thumbnail_url` /uploads/migrated/... sang R2 URL khớp qua basename.
// Hai nút: "Xem trước" (dryRun, không đổi gì) + "Chạy sửa" (thực sự).
const selfHealing = ref(false)
const selfHealPreviewing = ref(false)
const selfHealReport = ref<SelfHealReport | null>(null)

const runSelfHeal = async (dryRun: boolean) => {
  if (!dryRun && !await confirm({
    message: 'Tự vá ảnh R2 thiếu + repoint thumbnail?\n\nSẽ:\n• Tìm media R2 mà object thực sự không tồn tại → upload lại từ file local\n• Repoint articles.thumbnail_url /uploads/migrated/... sang R2 URL khớp\n• Với ảnh R2 mất gốc (file local cũng không còn) → đổi thumbnail + URL media sang ảnh mặc định để IPX hết 404\n\nTự backup SQL trước. Bấm lại an toàn (idempotent).',
    confirmLabel: 'Tự vá ảnh',
    danger: true,
  })) return
  if (dryRun) selfHealPreviewing.value = true
  else selfHealing.value = true
  selfHealReport.value = null
  try {
    const res = await adminFetch<SelfHealResponse>('/api/admin/media/self-heal', {
      method: 'POST',
      body: { dryRun },
    })
    selfHealReport.value = {
      r2Checked: res.r2Checked,
      r2Ok: res.r2Ok,
      r2Missing: res.r2Missing,
      r2Reuploaded: res.r2Reuploaded,
      r2Lost: res.r2Lost,
      thumbnailsRepointed: res.thumbnailsRepointed,
      thumbnailsDefaulted: res.thumbnailsDefaulted ?? 0,
      mediaUrlsDefaulted: res.mediaUrlsDefaulted ?? 0,
      missingSamples: res.missingSamples ?? [],
      backupStamp: res.backupStamp,
    }
    toast.success(res.message)
    if (!dryRun) await loadCounts()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi tự vá ảnh'))
  } finally {
    selfHealing.value = false
    selfHealPreviewing.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Page Header -->
    <div>
      <h1 class="text-[1.3rem] font-extrabold text-brand-950 m-0">Quét & Đồng bộ Media</h1>
      <p class="text-[0.85rem] text-ink-muted mt-1 mb-0">Thao tác hàng loạt lên thư viện ảnh — quét tệp mồ côi và chuyển storage giữa local / R2.</p>
    </div>

    <!-- Nút quay lại -->
    <NuxtLink to="/admin/media" class="inline-flex w-fit items-center gap-2 text-sm font-semibold text-brand-700 no-underline hover:underline">
      <i class="fa-regular fa-arrow-left" aria-hidden="true"></i> Về Thư viện Media
    </NuxtLink>

    <!-- Section 1: Quét thư mục -->
    <ScanFolderPanel
      v-model:auto-repoint-to-r2="autoRepointToR2"
      :scanning="scanning"
      :scan-job="scanJob"
      :scan-result="scanResult"
      :force-resetting-scan="forceResettingScan"
      @start="scanFolder"
      @cancel="cancelScan"
      @force-reset="forceResetScan"
    />

    <!-- Section 2: Đồng bộ storage -->
    <StorageSyncPanel
      :counts="counts"
      :syncing="syncing"
      :sync-direction="syncDirection"
      :job-status="jobStatus"
      :sync-result="syncResult"
      :force-resetting-sync="forceResettingSync"
      @sync="syncStorage"
      @cancel="cancelSync"
      @force-reset="forceResetSync"
    />

    <!-- Section 0: Vá URL ảnh hỏng hàng loạt (all bài) -->
    <RepairUrlsPanel :repairing="repairing" :repair-result="repairResult" @repair="repairUrls" />

    <!-- Section 3: Đổi domain URL R2 -->
    <RepointDomainPanel
      v-model:old-domain="oldDomain"
      v-model:new-domain="newDomain"
      :repointing="repointing"
      :repoint-result="repointResult"
      @repoint="repointUrls"
    />

    <!-- Section 6: Check chéo local ↔ R2 + tự vá (self-heal) -->
    <SelfHealPanel
      :self-healing="selfHealing"
      :self-heal-previewing="selfHealPreviewing"
      :self-heal-report="selfHealReport"
      @run="runSelfHeal"
    />
  </div>
</template>
