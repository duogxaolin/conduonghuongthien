import { ref } from 'vue'
import { CHATBOT_CLIENT_LIMITS, type SourceDetailState } from '../../utils/chatbot-storage'

/**
 * The full approved answer behind a citation, read in place. Part of `useChatbot` (see
 * `./state.ts`), which re-exports `sourceDetailOf` / `isSourceExpanded` under their old
 * names.
 *
 * Most knowledge-bank rows are imported from a spreadsheet and carry a source
 * label but no URL ("Tài liệu Hỏi – Đáp"), so there was nothing to click and no
 * way to read the approved answer behind a citation. These expand in place: the
 * widget already runs its own Tab trap, and a modal inside a focus trap is a
 * second trap fighting the first.
 */

export const sourceDetails = ref<Record<number, SourceDetailState>>({})
export const expandedSourceIds = ref<number[]>([])

export function sourceDetailOf(entryId: number | null): SourceDetailState | null {
  return entryId === null ? null : sourceDetails.value[entryId] ?? null
}

export function isSourceExpanded(entryId: number | null): boolean {
  return entryId !== null && expandedSourceIds.value.includes(entryId)
}

async function loadSourceDetail(entryId: number): Promise<void> {
  // A row already read stays read: reopening a citation must not re-query.
  const current = sourceDetails.value[entryId]
  if (current?.status === 'ready' || current?.status === 'loading') return
  sourceDetails.value = { ...sourceDetails.value, [entryId]: { status: 'loading', question: '', answer: '' } }
  try {
    const response = await fetch(`/api/public/chatbot/sources?id=${encodeURIComponent(String(entryId))}`, {
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) throw new Error('SOURCE_UNAVAILABLE')
    const data = await response.json() as { ok?: unknown, source?: Record<string, unknown> }
    const question = typeof data?.source?.question === 'string'
      ? data.source.question.normalize('NFKC').trim().slice(0, CHATBOT_CLIENT_LIMITS.maxMessageChars)
      : ''
    const answer = typeof data?.source?.answer === 'string'
      ? data.source.answer.normalize('NFKC').trim().slice(0, CHATBOT_CLIENT_LIMITS.maxOutputChars)
      : ''
    if (data?.ok !== true || !answer) throw new Error('SOURCE_EMPTY')
    sourceDetails.value = { ...sourceDetails.value, [entryId]: { status: 'ready', question, answer } }
  } catch {
    // An unreachable citation must read as broken, not as an empty document: the
    // visible branch offers a retry of this same request.
    sourceDetails.value = { ...sourceDetails.value, [entryId]: { status: 'error', question: '', answer: '' } }
  }
}

export function toggleSourceDetail(entryId: number | null): void {
  if (entryId === null) return
  if (expandedSourceIds.value.includes(entryId)) {
    expandedSourceIds.value = expandedSourceIds.value.filter(id => id !== entryId)
    return
  }
  expandedSourceIds.value = [...expandedSourceIds.value, entryId]
  void loadSourceDetail(entryId)
}

/** Retries the request that failed, rather than reloading the whole page. */
export function retrySourceDetail(entryId: number | null): void {
  if (entryId === null) return
  const next = { ...sourceDetails.value }
  delete next[entryId]
  sourceDetails.value = next
  void loadSourceDetail(entryId)
}
