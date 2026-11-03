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
 *
 * The family is DERIVED, not listed (the design of tests/_chat-policy-family.ts): every
 * `.vue` in `components/admin/ai/moderation/` is a panel, read on disk; the named
 * panels below are a subset check, so a panel added later joins every "must appear
 * nowhere" scan without anyone editing this file, and a renamed/moved panel turns the
 * scan red instead of silently shrinking it. `utils/moderation-format.ts` and
 * `types/moderation.ts` are code the split pulled out of the page, so they are in the
 * family too — a fixed list of the original six files left them outside every "absent"
 * check (a copy of `rescanSummaryText` planted there stayed green).
 */
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

/** Where the panels live, relative to `app/`. */
export const MODERATION_PANELS_DIR = 'components/admin/ai/moderation'

/** Panels that carry the page's markup today. A subset check — new panels join the scan automatically. */
export const EXPECTED_MODERATION_PANELS: readonly string[] = [
  'ModerationQueuePanel.vue',
  'ModerationRulesPanel.vue',
  'ModerationSettingsPanel.vue',
  'ModerationWorkerPanel.vue',
]

/** The family files that are not panels (paths relative to `app/`). */
const NON_PANEL_PARTS = {
  page: 'pages/admin/ai/moderation.vue',
  worker: 'composables/useModerationWorker.ts',
  format: 'utils/moderation-format.ts',
  types: 'types/moderation.ts',
} as const

/** Named panels, for "is present" checks that pin what one panel holds. */
const PANEL_PARTS = {
  settingsPanel: `${MODERATION_PANELS_DIR}/ModerationSettingsPanel.vue`,
  queuePanel: `${MODERATION_PANELS_DIR}/ModerationQueuePanel.vue`,
  rulesPanel: `${MODERATION_PANELS_DIR}/ModerationRulesPanel.vue`,
  workerPanel: `${MODERATION_PANELS_DIR}/ModerationWorkerPanel.vue`,
} as const

const PARTS = { ...NON_PANEL_PARTS, ...PANEL_PARTS } as const

export type ModerationPagePart = keyof typeof PARTS

const APP = new URL('../app/', import.meta.url)

/** A family file by its `app/`-relative path (as `moderationPanelFiles()` lists them). */
export function readAppFile(file: string): string {
  return readFileSync(new URL(file, APP), 'utf8').replace(/\r\n/g, '\n')
}

export function readModerationPart(part: ModerationPagePart): string {
  return readAppFile(PARTS[part])
}

/** Is this `app/`-relative path a panel, by the same rule as the on-disk scan? */
export const isModerationPanel = (file: string): boolean =>
  path.posix.dirname(file) === MODERATION_PANELS_DIR && file.endsWith('.vue')

/**
 * `app/`-relative paths of every panel on disk, sorted. Red when the directory is gone or
 * empty, or when an expected panel is missing — a scan over nothing is not a pass.
 */
export function moderationPanelFiles(): string[] {
  const dir = new URL(`${MODERATION_PANELS_DIR}/`, APP)
  assert.ok(existsSync(dir), `app/${MODERATION_PANELS_DIR}/ không tồn tại — panel của trang kiểm duyệt đi đâu? sửa guard, đừng để tập quét rỗng`)
  const found = readdirSync(dir).filter(name => name.endsWith('.vue')).sort()
  assert.ok(found.length > 0, `app/${MODERATION_PANELS_DIR}/ không còn panel .vue nào — tập quét rỗng`)
  for (const expected of EXPECTED_MODERATION_PANELS)
    assert.ok(
      found.includes(expected),
      `${expected} vắng khỏi tập quét ${JSON.stringify(found)} — đổi tên/di chuyển panel phải cập nhật guard, không âm thầm thu hẹp tập quét`,
    )
  return found.map(name => `${MODERATION_PANELS_DIR}/${name}`)
}

/** `app/`-relative paths of the whole family (page, composable, extracted modules, every panel), sorted. */
export function moderationPageFiles(): string[] {
  return [...new Set([...Object.values(NON_PANEL_PARTS), ...moderationPanelFiles()])].sort()
}

/** Every part, concatenated — for "this must appear nowhere" checks. */
export function moderationPageSource(): string {
  return moderationPageSourceWith()
}

/**
 * The family text with some files replaced or added (`{ 'components/admin/ai/moderation/X.vue':
 * source }`, keyed by `app/`-relative path), for in-suite injection proofs. An added path
 * joins only if `isModerationPanel` classifies it — the rule the on-disk scan uses — so a
 * proof cannot hand the guard a file the real scan would never read.
 */
export function moderationPageSourceWith(overrides: Record<string, string> = {}): string {
  const files = [...new Set([...moderationPageFiles(), ...Object.keys(overrides).filter(isModerationPanel)])].sort()
  return files.map(file => overrides[file] ?? readAppFile(file)).join('\n')
}
