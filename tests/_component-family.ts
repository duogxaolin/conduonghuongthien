/**
 * A component after its split (wave3 4.2): the parent `.vue`, every `.vue` in its
 * parts directory, and the composables/utils the split pulled out of it — read as ONE
 * source, so a guard that used to grep the 730-line file keeps reading everything the file
 * used to contain.
 *
 * Families today: `ARTICLE_DETAIL_FAMILY`, `ARTICLE_COMMENTS_FAMILY`, and the admin
 * `AI_PROVIDERS_TAB_FAMILY`, `LANGUAGES_PAGE_FAMILY` and `PAGE_BUILDER_FAMILY`. The parts are
 * DERIVED from the directory, not listed (the design of tests/_moderation-page-parts.ts):
 * a part added later joins every "must appear nowhere" scan without anyone editing this
 * file. The named parts are a subset check, so a renamed/moved part turns the scan red
 * instead of silently shrinking it; an empty or missing directory is red too — a scan over
 * nothing is not a pass.
 *
 * `…With(overrides)` replaces or ADDS files (keyed by `app/`-relative path) for in-suite
 * injection proofs: a violation planted in any part must turn the guard red. An added path
 * joins only if it is inside the parts directory or a named non-component part — the rule
 * the on-disk scan uses — so a proof cannot hand the guard a file the real scan never reads.
 */
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from '@vue/compiler-sfc'

const APP = new URL('../app/', import.meta.url)

export type ComponentFamily = {
  /** `app/`-relative path of the component that was split. */
  parent: string
  /** `app/`-relative directory holding its display parts. */
  partsDir: string
  /** Parts that exist today — a subset check on the directory scan. */
  expectedParts: readonly string[]
  /** Composables/utils pulled out of the parent (`app/`-relative). */
  modules: readonly string[]
}

export const ARTICLE_DETAIL_FAMILY: ComponentFamily = {
  parent: 'components/ArticleDetail.vue',
  partsDir: 'components/article',
  expectedParts: ['ArticleBody.vue', 'ArticleMetaHeader.vue', 'ArticleRelatedList.vue', 'ArticleShareBar.vue', 'ArticleToc.vue'],
  modules: ['composables/useArticleDetailLabels.ts', 'composables/useArticleReadTracking.ts', 'composables/useArticleRelated.ts'],
}

export const ARTICLE_COMMENTS_FAMILY: ComponentFamily = {
  parent: 'components/ArticleComments.vue',
  partsDir: 'components/comments',
  expectedParts: ['CommentComposer.vue', 'CommentPendingList.vue', 'CommentThreadItem.vue'],
  modules: ['composables/useCommentAnchor.ts', 'composables/useCommentWrites.ts', 'utils/comment-thread.ts'],
}

/** The "Nhà cung cấp & Models" tab of `/admin/ai` (1018 lines before its split). */
export const AI_PROVIDERS_TAB_FAMILY: ComponentFamily = {
  parent: 'components/admin/ai/AiProvidersTab.vue',
  partsDir: 'components/admin/ai/providers',
  expectedParts: [
    'ModelAddModal.vue', 'ModelEditModal.vue', 'ModelTestCallModal.vue', 'ProviderCardHeader.vue',
    'ProviderCreateModal.vue', 'ProviderEditModal.vue', 'ProviderModelsPanel.vue',
  ],
  modules: ['composables/useAiModelWrites.ts', 'composables/useAiProviderWrites.ts'],
}

/**
 * `/admin/languages` (756 lines before its wave3 4.2 split). The three tabs in
 * `components/admin/languages/` are an older split of the same page with their own suites;
 * this family is the page and what the 4.2 split pulled out of it.
 */
export const LANGUAGES_PAGE_FAMILY: ComponentFamily = {
  parent: 'pages/admin/languages/index.vue',
  partsDir: 'components/admin/languages/page',
  expectedParts: ['LanguagesMoveModal.vue', 'LanguagesPageHeader.vue', 'LanguagesTranslateProgressModal.vue'],
  modules: ['composables/useLanguageBatchTranslate.ts', 'composables/useLanguageWrites.ts'],
}

/** The page builder (`/admin/content/pages/[id]`, 795 lines before its wave3 4.2 split). */
export const PAGE_BUILDER_FAMILY: ComponentFamily = {
  parent: 'pages/admin/content/pages/[id].vue',
  partsDir: 'components/admin/page-builder',
  expectedParts: ['BlockPaletteDrawer.vue', 'PageBuilderTopBar.vue', 'PageMetaModal.vue', 'PageVersionsDrawer.vue'],
  modules: [
    'composables/useBuilderTreeEdits.ts', 'composables/usePageMeta.ts', 'composables/usePageVersions.ts',
    'utils/blocks/builder-tree.ts', 'utils/page-builder/versions.ts',
  ],
}

export const readAppFile = (file: string): string => readFileSync(new URL(file, APP), 'utf8').replace(/\r\n/g, '\n')

const isPart = (family: ComponentFamily, file: string) =>
  path.posix.dirname(file) === family.partsDir && file.endsWith('.vue')

/** `app/`-relative paths of every display part on disk, sorted. */
export function familyParts(family: ComponentFamily): string[] {
  const dir = new URL(`${family.partsDir}/`, APP)
  assert.ok(existsSync(dir), `app/${family.partsDir}/ không tồn tại — phần tách của ${family.parent} đi đâu? sửa guard, đừng để tập quét rỗng`)
  const found = readdirSync(dir).filter(name => name.endsWith('.vue')).sort()
  assert.ok(found.length > 0, `app/${family.partsDir}/ không còn .vue nào — tập quét rỗng`)
  for (const expected of family.expectedParts) {
    assert.ok(found.includes(expected), `${expected} vắng khỏi app/${family.partsDir}/ ${JSON.stringify(found)} — đổi tên/di chuyển phải cập nhật guard, không âm thầm thu hẹp tập quét`)
  }
  return found.map(name => `${family.partsDir}/${name}`)
}

export type FamilyFile = { file: string; source: string }

/** Every file of the family (parent first, then parts, then modules), with overrides applied. */
export function familyFiles(family: ComponentFamily, overrides: Record<string, string> = {}): FamilyFile[] {
  const known = [family.parent, ...familyParts(family), ...family.modules]
  const added = Object.keys(overrides).filter(file => !known.includes(file) && isPart(family, file))
  return [...known, ...added].map(file => ({ file, source: overrides[file] ?? readAppFile(file) }))
}

/** The `.vue` files of the family only. */
export const familyVueFiles = (family: ComponentFamily, overrides?: Record<string, string>) =>
  familyFiles(family, overrides).filter(f => f.file.endsWith('.vue'))

const sfc = (f: FamilyFile) => parse(f.source, { filename: f.file }).descriptor

/** Template content of every `.vue` in the family, concatenated (parent first). */
export const familyTemplate = (family: ComponentFamily, overrides?: Record<string, string>) =>
  familyVueFiles(family, overrides).map(f => sfc(f).template?.content ?? '').join('\n')

/** Script content: `<script setup>`/`<script>` of every `.vue`, plus every module, concatenated. */
export const familyScript = (family: ComponentFamily, overrides?: Record<string, string>) =>
  familyFiles(family, overrides).map((f) => {
    if (!f.file.endsWith('.vue')) return f.source
    const d = sfc(f)
    return d.scriptSetup?.content ?? d.script?.content ?? ''
  }).join('\n')

/** Every `<style>` block of the family, concatenated. */
export const familyStyle = (family: ComponentFamily, overrides?: Record<string, string>) =>
  familyVueFiles(family, overrides).flatMap(f => sfc(f).styles.map(s => `<style${s.scoped ? ' scoped' : ''}>${s.content}</style>`)).join('\n')

/** Whole files, concatenated — for "this must appear nowhere" checks. */
export const familySource = (family: ComponentFamily, overrides?: Record<string, string>) =>
  familyFiles(family, overrides).map(f => f.source).join('\n')
