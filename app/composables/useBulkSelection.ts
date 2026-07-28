/**
 * Row selection for an admin list.
 *
 * Unlike useConfirm/useToast, the state here is created per call rather than
 * shared at module scope: two lists must never see each other's selection, and a
 * singleton would leak ids across route changes.
 *
 * Scope note: selection covers the rows currently on screen. "Select all 3,400
 * matching the filter" is a different and far more dangerous feature — it would
 * have to travel to the server as a filter rather than a list of ids.
 */
export function useBulkSelection() {
  const selected = ref<Set<number>>(new Set())

  const count = computed(() => selected.value.size)
  const ids = computed(() => [...selected.value])
  const hasSelection = computed(() => selected.value.size > 0)

  function isSelected(id: number) {
    return selected.value.has(id)
  }

  /** Reassigns the Set: Vue does not track Set mutation for template reads. */
  function toggle(id: number) {
    const next = new Set(selected.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selected.value = next
  }

  /** True only when every visible row is selected (and there is at least one). */
  function allSelected(visibleIds: number[]) {
    return visibleIds.length > 0 && visibleIds.every(id => selected.value.has(id))
  }

  function someSelected(visibleIds: number[]) {
    return visibleIds.some(id => selected.value.has(id)) && !allSelected(visibleIds)
  }

  /** Header checkbox: select every visible row, or clear them if all are already on. */
  function toggleAll(visibleIds: number[]) {
    selected.value = allSelected(visibleIds) ? new Set() : new Set(visibleIds)
  }

  function clear() {
    selected.value = new Set()
  }

  /**
   * Drop the ids a bulk action consumed, keeping the ones it could not process
   * so the operator can still see and retry exactly those.
   */
  function remove(doneIds: number[]) {
    const next = new Set(selected.value)
    for (const id of doneIds) next.delete(id)
    selected.value = next
  }

  /**
   * Narrow the selection to the rows now on screen. Called after a list reload:
   * a row the operator ticked on page 1 is not on page 2, and acting on an id
   * that is no longer visible is exactly the surprise this feature must avoid.
   * Blocked rows still present after a partial failure stay ticked.
   */
  function keepOnly(visibleIds: number[]) {
    if (selected.value.size === 0) return
    const visible = new Set(visibleIds)
    const next = new Set<number>()
    for (const id of selected.value) if (visible.has(id)) next.add(id)
    selected.value = next
  }

  return { selected, ids, count, hasSelection, isSelected, toggle, toggleAll, allSelected, someSelected, clear, remove, keepOnly }
}

export type BulkResult = {
  requested?: number
  succeeded?: number
  succeededIds?: number[]
  failed?: Array<{ id: number; message: string }>
}

/**
 * Turn a bulk response into one operator-facing sentence.
 *
 * A partial result must not be reported as success — that is the case where
 * something was actually blocked and the operator has to know which rows still
 * need attention.
 */
export function bulkResultMessage(result: BulkResult, noun: string): { tone: 'success' | 'warning' | 'error'; text: string } {
  const succeeded = result.succeeded ?? 0
  const failed = result.failed ?? []

  if (failed.length === 0) return { tone: 'success', text: `Đã xử lý ${succeeded} ${noun}.` }
  if (succeeded === 0) return { tone: 'error', text: `Không xử lý được ${failed.length} ${noun}.` }
  return { tone: 'warning', text: `Đã xử lý ${succeeded} ${noun}, bỏ qua ${failed.length} mục.` }
}

/**
 * Confirm → POST → report → reload, for a bulk action on the current selection.
 *
 * Eight lists need this exact sequence, so it lives here rather than being
 * pasted into each page. Two behaviours are deliberate:
 *
 *   - only the ids the server accepted leave the selection. A blocked row stays
 *     ticked, so the operator can see precisely what still needs attention
 *     instead of hunting for it again in a reloaded list.
 *   - a partial result is reported as a warning listing each reason, never as
 *     success. "Đã xoá 19" on a lot of 20 hides the one that matters.
 */
export function useBulkAction(selection: ReturnType<typeof useBulkSelection>) {
  const toast = useToast()
  const { confirm } = useConfirm()
  const busy = ref(false)

  async function run(options: {
    url: string
    /** Extra body fields alongside `ids`, e.g. `{ status: 'archived' }`. */
    body?: Record<string, unknown>
    confirm: ConfirmOptions
    /** Plural noun for the report, e.g. 'bài viết'. */
    noun: string
    /** Called after the request, usually the page's list reload. */
    reload: () => unknown | Promise<unknown>
  }): Promise<void> {
    const ids = selection.ids.value
    if (ids.length === 0) return
    if (!await confirm(options.confirm)) return

    busy.value = true
    try {
      const result = await $fetch<BulkResult>(options.url, {
        method: 'POST',
        body: { ...options.body, ids },
      })

      selection.remove(result.succeededIds ?? [])

      const { tone, text } = bulkResultMessage(result, options.noun)
      const reasons = (result.failed ?? []).map(item => item.message)
      // Distinct reasons only: twenty rows blocked for the same cause should read
      // as one sentence, not twenty identical lines.
      const detail = [...new Set(reasons)].slice(0, 5).join(' ')
      toast[tone](detail ? `${text} ${detail}` : text)

      await options.reload()
    } catch (err: any) {
      toast.error(err?.data?.statusMessage || 'Không thể thực hiện thao tác hàng loạt.')
    } finally {
      busy.value = false
    }
  }

  return { busy, run }
}
