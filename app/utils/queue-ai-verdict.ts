import type { QueueAiVerdict } from '~~/shared/moderation-ai-verdict'
import { formatTimeDayVN } from './formatDate'

/**
 * The words an officer reads for a stored AI verdict (`AdminQueueAiVerdictNote`): the verdict and
 * its severity, in the same severity words as the queue table's "Mức độ" column. The model's
 * reason is shown after it as it came from the server (already cleaned and cut there).
 */
const VERDICT_WORDS: Record<QueueAiVerdict['verdict'], string> = {
  violation: 'Vi phạm',
  spam: 'Spam',
}

const SEVERITY_WORDS: Record<QueueAiVerdict['severity'], string> = {
  low: 'Thấp',
  medium: 'Trung bình',
  high: 'Cao',
  critical: 'Nguy hiểm',
}

export function queueAiVerdictSummary(verdict: QueueAiVerdict): string {
  return `${VERDICT_WORDS[verdict.verdict]}, mức độ ${SEVERITY_WORDS[verdict.severity]}`
}

/**
 * The note's label, with WHEN the AI judged (Vietnam time) when the verdict carries it: the column
 * keeps the verdict of the last AI pass that hid the content through a pending row, and nothing
 * clears it — an officer showing the content again, a later pass that says safe, a later hide by
 * the keyword fallback (KNOWN W-1/W-2). The time is how an officer tells an old verdict from the
 * hide in front of them. Verdicts noted before the field have none: the label as before.
 */
export function queueAiVerdictLabel(verdict: QueueAiVerdict): string {
  const when = formatTimeDayVN(verdict.at)
  return when ? `AI kiểm duyệt tự động đánh giá lúc ${when}:` : 'AI kiểm duyệt tự động đánh giá:'
}
