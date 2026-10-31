import type { QueueAiVerdict } from '~~/shared/moderation-ai-verdict'

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
