import { computed, ref, type Ref } from 'vue'

// Relative paths, not `~/`: tests import this file directly, and the test loader
// (scripts/ts-resolver.mjs) only knows `~~/`.
import { adminFetch } from './adminFetch'
import { errorMessage } from '../utils/errorMessage'
import { VERSION_KIND_META } from '../utils/page-builder/versions'
import type { BlockNode } from '../utils/blocks/types'
import type { PageVersionRow } from '../types/admin-api'
import type { PageVersionCreateResponse, PageVersionDeleteResponse, PageVersionRestoreResponse } from '../types/admin-pages-api'
import type { useConfirm } from './useConfirm'
import type { useToast } from './useToast'

/**
 * The versions drawer of the page builder (`pages/admin/content/pages/[id].vue`): 1 origin, up
 * to 4 manual backups, 5 rolling automatic versions (made by publish). Save the working copy as
 * a backup or as the origin, restore a version into the draft, delete one. Moved out of the page
 * when it was split (wave3 4.2), unchanged; the page keeps the list and its load
 * (`loadVersions`, handed in), and loads a restored version into its working copy
 * (`loadWorkingCopy`, handed in — it owns the draft lifecycle).
 *
 * `toast`/`confirm` are the page's own, handed in, so this file needs no Nuxt auto-import and
 * runs as is under the tests.
 */
export interface PageVersionsDeps {
  toast: Pick<ReturnType<typeof useToast>, 'success' | 'error'>
  confirm: ReturnType<typeof useConfirm>['confirm']
  pageId: Ref<number>
  /** The page is loaded (the builder's positive flag): before that the working copy is empty (FINDING-B2). */
  loaded: Ref<boolean>
  /** The list the page loaded. */
  versions: Ref<PageVersionRow[]>
  /** Read the list again (the page's `loadVersions`). */
  loadVersions: () => Promise<void>
  /** The working copy, serialized (the page's `draftPayload`). */
  draftPayload: () => BlockNode[]
  /** Make a restored version the working copy — a draft, not saved back. */
  loadWorkingCopy: (blocks: unknown) => void
}

export function usePageVersions({ toast, confirm, pageId, loaded, versions, loadVersions, draftPayload, loadWorkingCopy }: PageVersionsDeps) {
  const showVersions = ref(false)
  const savingBackup = ref(false)
  const backupLabel = ref('')

  const kindMeta = VERSION_KIND_META
  const manualCount = computed(() => versions.value.filter(v => v.kind === 'manual').length)
  const hasOrigin = computed(() => versions.value.some(v => v.kind === 'origin'))

  const openVersions = async () => {
    // Before the page is loaded the working copy is empty: a backup/origin made from it would
    // save — or overwrite the origin with — an empty page.
    if (!loaded.value) return
    showVersions.value = true
    await loadVersions()
  }

  // Load a version into the working copy (draft) — user must Publish to go live.
  const restoreVersion = async (v: PageVersionRow) => {
    const ok = await confirm({ title: 'Khôi phục phiên bản', message: `Nạp "${v.label || kindMeta[v.kind]?.label}" vào bản nháp? Bản đang chạy trên site không đổi cho tới khi bạn Xuất bản.`, confirmLabel: 'Khôi phục' })
    if (!ok) return
    try {
      const res = await adminFetch<PageVersionRestoreResponse>(`/api/admin/pages/${pageId.value}/versions/${v.id}/restore`, { method: 'POST' })
      if (res.ok) {
        loadWorkingCopy(res.blocks)
        showVersions.value = false
        toast.success('Đã nạp vào bản nháp. Xem trước rồi bấm Xuất bản.')
      }
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Không khôi phục được.'))
    }
  }

  const deleteVersion = async (v: PageVersionRow) => {
    const ok = await confirm({ title: 'Xóa phiên bản', message: `Xóa "${v.label || kindMeta[v.kind]?.label}"?`, danger: true, confirmLabel: 'Xóa' })
    if (!ok) return
    try {
      await adminFetch<PageVersionDeleteResponse>(`/api/admin/pages/${pageId.value}/versions/${v.id}`, { method: 'DELETE' })
      await loadVersions()
      toast.success('Đã xóa phiên bản.')
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Không xóa được phiên bản.'))
    }
  }

  // Save current working copy as a named manual backup (max 4).
  const saveBackup = async () => {
    savingBackup.value = true
    try {
      const res = await adminFetch<PageVersionCreateResponse>(`/api/admin/pages/${pageId.value}/versions`, { method: 'POST', body: { kind: 'manual', label: backupLabel.value, blocks: draftPayload() } })
      if (res.ok) {
        backupLabel.value = ''
        await loadVersions()
        toast.success('Đã lưu bản sao lưu.')
      }
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Không lưu được bản sao lưu.'))
    } finally {
      savingBackup.value = false
    }
  }

  // Designate the current working copy as the locked origin baseline.
  const setOrigin = async () => {
    const ok = await confirm({ title: 'Chỉ định bản gốc', message: hasOrigin.value ? 'Ghi đè bản gốc hiện tại bằng nội dung đang dựng?' : 'Đặt nội dung đang dựng làm bản gốc (khóa, dùng để khôi phục sau này)?', confirmLabel: 'Chỉ định' })
    if (!ok) return
    try {
      const res = await adminFetch<PageVersionCreateResponse>(`/api/admin/pages/${pageId.value}/versions`, { method: 'POST', body: { kind: 'origin', blocks: draftPayload() } })
      if (res.ok) {
        await loadVersions()
        toast.success('Đã chỉ định bản gốc.')
      }
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Không chỉ định được bản gốc.'))
    }
  }

  return {
    showVersions, savingBackup, backupLabel, manualCount, hasOrigin,
    openVersions, restoreVersion, deleteVersion, saveBackup, setOrigin,
  }
}
