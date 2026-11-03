/**
 * Source guards for the admin shell after its wave3 D-SPLIT split (`app/layouts/admin.vue` →
 * `app/components/admin/layout/*` + `useAdminLayout*` + `app/utils/admin-layout-menu.ts`).
 * Behaviour is mounted in tests/admin-layout.test.ts; these pin what a mount on the minimal
 * DOM of tests/_sfc-mount.ts cannot see.
 *
 *   1. The parts render only: no request, toast, confirm, session, route or `document` in
 *      them. A part that fetched would join the directory walks of
 *      tests/admin-error-retry-ui.test.ts and tests/skeleton-loading-ui.test.ts with no error
 *      branch to declare.
 *   2. The sidebar's CSS. `.sidebar` (hidden below `lg` until `.is-open`, 260/70 px wide) is
 *      in the LAYOUT's `<style scoped>`, and reaches `<aside>` in `AdminSidebar.vue` only
 *      because Vue puts the parent's scope id on a child's ROOT element. So the part must
 *      have exactly one root, that `<aside class="sidebar …">` — a second root, a wrapper,
 *      or even a root-level comment (kept in dev builds, where it makes a fragment) and the
 *      sidebar silently loses its CSS. The mount test renders no scope ids, so it cannot
 *      see this.
 *   3. Focus: the collapsed rail's search button expands the sidebar, then focuses the box —
 *      `focus()` does nothing on the test DOM, so the ref and the call are pinned here, in
 *      the file that renders the box.
 *   4. No file of the family renders HTML.
 * Every guard has an injection proof: a violation planted in a part, a new part or a module
 * turns it red.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parse } from '@vue/compiler-sfc'

import { ADMIN_LAYOUT_FAMILY, familyFiles, familyStyle, familyVueFiles, readAppFile } from './_component-family.ts'

const SIDEBAR = 'components/admin/layout/AdminSidebar.vue'

/** A request, a toast/confirm, the session or the route, the page's `document`. */
const SIDE_EFFECT = /\$fetch\b|\badminFetch\b|\buseAdminList\b|\buseFetch\b|\buseAsyncData\b|\buseToast\b|\buseConfirm\b|\btoast\.|\bconfirm\(|\buseAdminAuth\(|\bnavigateTo\(|\buseRoute\(|\buseRouter\(|\buseState\(|\bdocument\./

const offenders = (overrides?: Record<string, string>) =>
  familyVueFiles(ADMIN_LAYOUT_FAMILY, overrides)
    .filter(f => f.file !== ADMIN_LAYOUT_FAMILY.parent && SIDE_EFFECT.test(f.source))
    .map(f => f.file)

describe('the admin layout parts render only', () => {
  it('no part requests, toasts, confirms, reads the session or the route, or touches document', () => {
    assert.deepEqual(offenders(), [])
  })

  it('proof: each kind planted in a part — or in a new part — is caught', () => {
    for (const planted of [
      "await adminFetch<{ ok: true }>('/api/admin/cache-clear', { method: 'POST' })",
      "const r = await $fetch('/api/admin/auth/logout')",
      'const toast = useToast()',
      'const { logout } = useAdminAuth()',
      'const route = useRoute()',
      "navigateTo('/admin/login')",
      "document.body.style.overflow = 'hidden'",
    ]) {
      for (const part of ['components/admin/layout/AdminTopBar.vue', SIDEBAR]) {
        const source = readAppFile(part).replace('</script>', `${planted}\n</script>`)
        assert.deepEqual(offenders({ [part]: source }), [part], `${planted} in ${part}`)
      }
    }
    const added = 'components/admin/layout/AdminExtra.vue'
    assert.deepEqual(offenders({ [added]: '<script setup lang="ts">\nconst toast = useToast()\n</script>' }), [added])
  })
})

/** The element children of the template root, and whether a comment sits beside them. */
function templateRoots(source: string) {
  const { descriptor } = parse(source, { filename: 'part.vue', templateParseOptions: { comments: true } })
  const children = descriptor.template?.ast?.children ?? []
  const elements = children.filter(c => c.type === 1) as Array<{ tag: string, props: Array<{ type: number, name: string, value?: { content: string } }> }>
  const comments = children.filter(c => c.type === 3)
  return { elements, comments: comments.length }
}

function sidebarRootProblems(source: string): string[] {
  const { elements, comments } = templateRoots(source)
  const problems: string[] = []
  if (comments) problems.push(`${comments} comment(s) at the template root`)
  if (elements.length !== 1) problems.push(`${elements.length} root elements`)
  const root = elements[0]
  if (root && root.tag !== 'aside') problems.push(`root is <${root.tag}>`)
  const cls = root?.props.find(p => p.type === 6 && p.name === 'class')?.value?.content ?? ''
  if (root && !cls.split(/\s+/).includes('sidebar')) problems.push('root has no static class "sidebar"')
  return problems
}

describe('the sidebar keeps the layout\'s scoped CSS', () => {
  it('AdminSidebar.vue has exactly one root, <aside class="sidebar …">, and no comment beside it', () => {
    assert.deepEqual(sidebarRootProblems(readAppFile(SIDEBAR)), [])
    // The classes the layout's CSS keys on are bound on that root.
    assert.match(readAppFile(SIDEBAR), /<aside\s+class="sidebar [^"]*"\s+:class="\{ 'is-open': isMobileMenuOpen, 'collapsed': isSidebarCollapsed \}"/)
  })

  it('the rules stay in the layout, next to `.main-content`, and no part carries its own <style>', () => {
    const style = familyStyle(ADMIN_LAYOUT_FAMILY)
    const parentStyle = parse(readAppFile(ADMIN_LAYOUT_FAMILY.parent)).descriptor.styles
    assert.equal(parentStyle.length, 1)
    assert.equal(parentStyle[0]!.scoped, true)
    assert.equal(style, `<style scoped>${parentStyle[0]!.content}</style>`, 'a part grew a <style> block')
    for (const rule of [/\.sidebar \{\s*display: none;\s*width: 260px;/, /\.sidebar\.collapsed \{ width: 70px; \}/, /\.sidebar\.is-open \{ display: flex; \}/,
      /\.main-content \{ margin-left: 260px; \}/, /\.main-content\.sidebar-collapsed \{ margin-left: 70px; \}/, /\.fade-enter-from, \.fade-leave-to \{ opacity: 0; \}/]) {
      assert.match(style, rule)
    }
    assert.match(readAppFile(ADMIN_LAYOUT_FAMILY.parent), /<div class="main-content [^"]*" :class="\{ 'sidebar-collapsed': isSidebarCollapsed \}">/)
  })

  it('proof: a root comment, a wrapper, a second root or a lost class is caught', () => {
    const source = readAppFile(SIDEBAR)
    assert.deepEqual(sidebarRootProblems(source.replace('<template>\n  <aside', '<template>\n  <!-- Sidebar -->\n  <aside')), ['1 comment(s) at the template root'])
    assert.deepEqual(sidebarRootProblems(source.replace('<template>\n  <aside', '<template>\n  <div>\n  <aside').replace('</aside>\n</template>', '</aside>\n  </div>\n</template>')), ['root is <div>', 'root has no static class "sidebar"'])
    assert.deepEqual(sidebarRootProblems(source.replace('</aside>\n</template>', '</aside>\n  <span />\n</template>')), ['2 root elements'])
    assert.deepEqual(sidebarRootProblems(source.replace('class="sidebar fixed', 'class="fixed')), ['root has no static class "sidebar"'])
    const styled = readAppFile(SIDEBAR) + '\n<style scoped>\n.sidebar { width: 300px; }\n</style>\n'
    assert.notEqual(familyStyle(ADMIN_LAYOUT_FAMILY, { [SIDEBAR]: styled }), familyStyle(ADMIN_LAYOUT_FAMILY))
  })
})

describe('the collapsed rail\'s search button focuses the box it reveals', () => {
  const focusProblems = (source: string) => {
    const problems: string[] = []
    if (!/<input\s+ref="searchInputRef"/.test(source)) problems.push('the box has no ref')
    if (!/function focusSearch\(\) \{\s*emit\('expandSidebar'\)\s*nextTick\(\(\) => \{\s*searchInputRef\.value\?\.focus\(\)/.test(source)) problems.push('focusSearch does not expand then focus on the next tick')
    if (!/@click="focusSearch"/.test(source)) problems.push('no button calls focusSearch')
    return problems
  }

  it('the box, its ref and the expand-then-focus are in the same file', () => {
    assert.deepEqual(focusProblems(readAppFile(SIDEBAR)), [])
  })

  it('proof: the focus call, the ref or the button dropped is caught', () => {
    const source = readAppFile(SIDEBAR)
    assert.deepEqual(focusProblems(source.replace('searchInputRef.value?.focus()', '')), ['focusSearch does not expand then focus on the next tick'])
    assert.deepEqual(focusProblems(source.replace('ref="searchInputRef"\n', '')), ['the box has no ref'])
    assert.deepEqual(focusProblems(source.replace('@click="focusSearch"', '@click="emit(\'expandSidebar\')"')), ['no button calls focusSearch'])
  })
})

describe('no file of the admin layout family renders HTML', () => {
  const vHtml = (overrides?: Record<string, string>) => familyFiles(ADMIN_LAYOUT_FAMILY, overrides).filter(f => /\bv-html\b|innerHTML/.test(f.source)).map(f => f.file)

  it('no v-html, no innerHTML', () => {
    assert.deepEqual(vHtml(), [])
  })

  it('proof: v-html in a part or the layout, innerHTML in a composable, is caught', () => {
    const part = 'components/admin/layout/AdminTopBar.vue'
    assert.deepEqual(vHtml({ [part]: readAppFile(part).replace('<span class="text-brand-950 font-bold">{{ currentAdminPageTitle }}</span>', '<span class="text-brand-950 font-bold" v-html="currentAdminPageTitle"></span>') }), [part])
    assert.deepEqual(vHtml({ [ADMIN_LAYOUT_FAMILY.parent]: readAppFile(ADMIN_LAYOUT_FAMILY.parent).replace('<AdminMfaEnrollmentBanner />', '<div v-html="containerStyleVar" />') }), [ADMIN_LAYOUT_FAMILY.parent])
    const composable = 'composables/useAdminLayoutSidebar.ts'
    assert.deepEqual(vHtml({ [composable]: `${readAppFile(composable)}\nexport const leak = (el: HTMLElement) => { el.innerHTML = '' }\n` }), [composable])
  })
})
