import { reactive, ref, type Ref } from 'vue'

// Relative paths, not `~/`: tests import this file directly, and the test loader
// (scripts/ts-resolver.mjs) only knows `~~/`.
import { adminFetch } from './adminFetch'
import { errorMessage } from '../utils/errorMessage'
import { getFlagEmoji } from '../utils/language-flags'
import { missingTranslations } from '../utils/translation-keys'
import type { LanguageItem, TranslateLogLine, TranslateProgress, TranslationList } from '../types/admin-languages'
import type { useConfirm } from './useConfirm'
import type { useToast } from './useToast'

/**
 * "Dịch AI còn thiếu" of `/admin/languages` (`pages/admin/languages/index.vue`): one language
 * (`startBatchTranslateWithProgress` — the page calls it from a card's "Dịch AI (n)" and from
 * the table's "Dịch AI"), or every active language with gaps ("Dịch tất cả còn thiếu"), shown
 * in the "Tiến trình Dịch AI" dialog. Moved out of the page when it was split (wave3 4.2); the
 * page keeps the lists and their load/error/retry.
 *
 * `toast`/`confirm` are the page's own, and `reload` is its `loadData` — handed in, so this
 * file needs no Nuxt auto-import and runs as is under the tests.
 *
 * The missing keys are sent ten at a time; "Dừng lại" takes effect before the next chunk.
 */
export interface LanguageBatchTranslateDeps {
  toast: Pick<ReturnType<typeof useToast>, 'success' | 'error' | 'warning' | 'info'>
  confirm: ReturnType<typeof useConfirm>['confirm']
  /** "Dịch tất cả còn thiếu" picks its targets here (active, not default, with gaps). */
  languages: Ref<LanguageItem[]>
  /** `group::key` → Vietnamese text, for every vi key: the source each key is translated from. */
  viTranslationsMap: Ref<Map<string, string>>
  /** Re-read the languages, the table and the vi source (the page's `loadData`). */
  reload: () => Promise<void>
}

export function useLanguageBatchTranslate({ toast, confirm, languages, viTranslationsMap, reload }: LanguageBatchTranslateDeps) {
  const showTranslateProgressModal = ref(false)
  const progressModalTitle = ref('')
  const progressStats = ref<TranslateProgress>({
    done: 0,
    total: 0,
    percent: 0,
    currentKey: '',
    finished: false,
    stopped: false,
  })
  const progressLog = ref<TranslateLogLine[]>([])
  let stopTranslateSignal = false

  // `translatingCards` disable nút "Dịch AI" trên từng card language khi đang
  // chạy batch cho ngôn ngữ đó; LanguagesListTab nhận prop.
  const translatingCards = reactive<Record<string, boolean>>({})
  const translatingAll = ref(false)

  function stopTranslate() {
    stopTranslateSignal = true
    progressStats.value.stopped = true
  }

  /**
   * The language being translated while a run is on — a single language, or the whole of
   * "Dịch tất cả còn thiếu" (held between its languages too); `null` when nothing runs.
   * The dialog, its progress, its log and the stop flag exist once: a second batch started
   * while one ran (the dialog closed with "Đóng cửa sổ" leaves the other languages' buttons
   * enabled) used to reset them under the first — mixed progress, "Hoàn tất" while one still
   * ran, and a "Dừng lại" the first never saw (FINDING-L2, wave3 4.2). One run at a time: a
   * second start shows the running batch's dialog and says which language it is on.
   */
  let runningLangName: string | null = null

  /** True (and the officer told) when a run is already on. */
  function refuseWhileRunning(): boolean {
    if (runningLangName === null) return false
    showTranslateProgressModal.value = true
    toast.info(`Đang dịch AI cho ${runningLangName} — chờ xong hoặc bấm "Dừng lại" rồi chạy tiếp.`)
    return true
  }

  /**
   * One language: a card's "Dịch AI (n)" or the table's "Dịch AI". The run ends with its last
   * chunk: the lock (and the card's "Đang dịch...") end there, BEFORE the reload that follows —
   * held through it, the dialog said "Hoàn tất" while the next language was refused (verification
   * V2 of the split).
   */
  async function startBatchTranslateWithProgress(langCode: string, langName: string) {
    if (refuseWhileRunning()) return
    try {
      await translateLanguage(langCode, langName)
    } finally {
      runningLangName = null
    }
    await reload()
  }

  /** The run itself, without the reload after it (each caller reloads). */
  async function translateLanguage(langCode: string, langName: string) {
    runningLangName = langName
    stopTranslateSignal = false
    progressModalTitle.value = `Tiến trình Dịch AI: ${getFlagEmoji(langCode)} ${langName} (${langCode})`
    progressLog.value = []
    progressStats.value = {
      done: 0,
      total: 0,
      percent: 0,
      currentKey: 'Đang kiểm tra các key còn thiếu...',
      finished: false,
      stopped: false,
    }
    showTranslateProgressModal.value = true
    translatingCards[langCode] = true

    try {
      const res = await adminFetch<TranslationList>(`/api/admin/languages/${langCode}/translations`)
      const missing = missingTranslations(res.items || [], viTranslationsMap.value)

      if (missing.length === 0) {
        progressStats.value.currentKey = 'Tất cả các key đã có bản dịch!'
        progressStats.value.finished = true
        toast.info(`Ngôn ngữ ${langName} đã có bản dịch đầy đủ 100%!`)
        return
      }

      progressStats.value.total = missing.length

      const CHUNK_SIZE = 10
      let processed = 0

      for (let i = 0; i < missing.length; i += CHUNK_SIZE) {
        if (stopTranslateSignal) {
          progressStats.value.stopped = true
          toast.warning('Đã dừng tiến trình dịch AI.')
          break
        }

        const chunk = missing.slice(i, i + CHUNK_SIZE)
        progressStats.value.currentKey = `Đang dịch: ${chunk.map((c) => c.key).slice(0, 3).join(', ')}...`

        try {
          const chunkRes = await adminFetch<{ ok: true; translated: Array<{ group: string; key: string; value: string }> }>(`/api/admin/languages/ai-translate-chunk`, {
            method: 'POST',
            body: {
              langCode,
              langName,
              items: chunk,
            },
          })

          if (chunkRes.ok && Array.isArray(chunkRes.translated)) {
            for (const item of chunkRes.translated) {
              progressLog.value.unshift({ key: item.key, value: item.value, success: true })
            }
          }
        } catch {
          for (const item of chunk) {
            progressLog.value.unshift({ key: item.key, value: 'Lỗi dịch', success: false })
          }
        }

        processed = Math.min(i + CHUNK_SIZE, missing.length)
        progressStats.value.done = processed
        progressStats.value.percent = Math.round((processed / missing.length) * 100)
      }

      if (!stopTranslateSignal) {
        progressStats.value.finished = true
        progressStats.value.currentKey = 'Hoàn tất dịch thành công!'
        toast.success(`Đã hoàn tất dịch ${progressStats.value.done}/${progressStats.value.total} key cho ${langName}!`)
      }
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Lỗi trong quá trình dịch AI.'))
    } finally {
      translatingCards[langCode] = false
    }
  }

  async function translateAllLanguagesMissing() {
    if (refuseWhileRunning()) return
    const targets = languages.value.filter((l) => l.isActive && !l.isDefault && (l.stats?.missingKeys || 0) > 0)
    if (targets.length === 0) {
      toast.info('Tất cả ngôn ngữ đang hoạt động đã được dịch đầy đủ 100%!')
      return
    }
    const names = targets.map((l) => l.name).join(', ')
    if (!await confirm({
      message: `Dịch AI tất cả các key còn thiếu cho ${targets.length} ngôn ngữ (${names})?`,
      confirmLabel: 'Dịch bằng AI',
    })) return

    translatingAll.value = true
    try {
      for (const lang of targets) {
        await translateLanguage(lang.code, lang.name)
        // The lock stays through the reload BETWEEN two languages: the run is not over.
        await reload()
        if (stopTranslateSignal) break
      }
    } finally {
      runningLangName = null
    }
    translatingAll.value = false
    await reload()
  }

  return {
    showTranslateProgressModal, progressModalTitle, progressStats, progressLog,
    translatingCards, translatingAll,
    stopTranslate, startBatchTranslateWithProgress, translateAllLanguagesMissing,
  }
}
