/**
 * The `/admin/ai/moderation` page after its split (wave3 4.1): the page plus the files
 * its markup and logic moved into. Source-reading guards that used to grep the one
 * 1155-line page read the part that now holds what they pin — same assertion, right
 * file — in the manner of tests/_layout-parts.ts for the default layout.
 *
 * Kept OUT of the panels on purpose, and pinned on the page itself by
 * tests/admin-error-retry-ui.test.ts and tests/skeleton-loading-ui.test.ts: every error
 * branch with its "Thử lại" — the page load's (`error` → `loadData`) and each tab's
 * (`queueError`/`settingsError`/`rulesError`, handed to the panels as `#error` slots) —
 * and the skeleton.
 */
import { readFileSync } from 'node:fs'

const PARTS = {
  page: 'pages/admin/ai/moderation.vue',
  settingsPanel: 'components/admin/ai/moderation/ModerationSettingsPanel.vue',
  queuePanel: 'components/admin/ai/moderation/ModerationQueuePanel.vue',
  rulesPanel: 'components/admin/ai/moderation/ModerationRulesPanel.vue',
  workerPanel: 'components/admin/ai/moderation/ModerationWorkerPanel.vue',
  worker: 'composables/useModerationWorker.ts',
} as const

export type ModerationPagePart = keyof typeof PARTS

export function readModerationPart(part: ModerationPagePart): string {
  return readFileSync(new URL(`../app/${PARTS[part]}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
}

/** Every part, concatenated — for "this must appear nowhere" checks. */
export function moderationPageSource(): string {
  return (Object.keys(PARTS) as ModerationPagePart[]).map(readModerationPart).join('\n')
}
