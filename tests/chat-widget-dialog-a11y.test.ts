import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse } from '@vue/compiler-sfc'
import { TABBABLE_SELECTOR, visibleTabbables, type TabbableLike } from '../app/utils/focus-return'
import { CHAT_WIDGET_FAMILY, familyTemplate, readAppFile } from './_component-family.ts'

/**
 * The chat dialog keeps focus inside while open (spec public-accessibility,
 * design D24).
 *
 * The widget already had `role="dialog"`, `aria-modal`, a Tab wrap and focus
 * return to the launcher. Three gaps remained:
 *   1. On open it focused the desktop close button — `hidden md:flex`, so on a
 *      phone `focus()` did nothing and focus stayed behind the dialog.
 *   2. `aria-modal` promised a modal, but the page behind stayed reachable by Tab
 *      and by a screen reader's swipe.
 *   3. Escape only worked while focus was inside the dialog (a keydown on the
 *      dialog element), and focus returned to the launcher — hidden on phones —
 *      instead of the control that opened it (the bottom-nav button).
 * Now the widget uses the same `focus-return.ts` helpers as `ConfirmModal`.
 */

// ─── The shared tabbable rule ────────────────────────────────────────────────

test('the shared tabbable selector covers select, summary and positive tabindex', () => {
  for (const part of ['a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])', 'textarea:not([disabled])', 'summary', '[tabindex]:not([tabindex="-1"])']) {
    assert.ok(TABBABLE_SELECTOR.split(', ').includes(part), `missing ${part}`)
  }
})

function el(name: string, options: { visible?: boolean, fixed?: boolean, tabIndex?: number, disabled?: boolean } = {}): TabbableLike & { name: string } {
  const visible = options.visible ?? true
  return {
    name,
    tabIndex: options.tabIndex ?? 0,
    // A `position: fixed` element has no offsetParent even when it is shown.
    offsetParent: visible && !options.fixed ? {} : null,
    getClientRects: () => ({ length: visible ? 1 : 0 }),
    hasAttribute: (attr: string) => attr === 'disabled' && options.disabled === true,
  }
}

test('only controls that are actually shown count — the first one gets focus on a phone', () => {
  const root = {
    querySelectorAll: (selector: string) => {
      assert.equal(selector, TABBABLE_SELECTOR)
      return [
        el('desktop-close (hidden md:flex)', { visible: false }),
        el('honeypot', { tabIndex: -1 }),
        el('mobile-back'),
        el('history'),
        el('pinned', { fixed: true }),
        el('disabled', { disabled: true }),
      ]
    },
  }
  assert.deepEqual(visibleTabbables(root).map(item => item.name), ['mobile-back', 'history', 'pinned'])
})

// ─── ChatWidget wires it ─────────────────────────────────────────────────────
//
// Since the wave3 split the dialog ELEMENT stays in `ChatWidget.vue`, the open/close
// mechanics are `composables/useChatWidgetDialog.ts`, and the header buttons (the first
// focus targets) are `components/chat-widget/ChatWidgetHeader.vue`. Each rule reads the
// file that carries it; every slice must be found (an index of -1 would make an empty
// slice and a vacuous pass), and the proofs at the end break each rule in its file.

const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
const source = readFileSync(new URL('../app/components/ChatWidget.vue', import.meta.url), 'utf8')
const script = stripComments(source.slice(source.indexOf('<script setup')))
const template = source.slice(0, source.indexOf('<script setup'))
const DIALOG_MODULE = 'composables/useChatWidgetDialog.ts'
const HEADER_PART = 'components/chat-widget/ChatWidgetHeader.vue'
const dialogModule = (code = readAppFile(DIALOG_MODULE)) => stripComments(code)
const headerTemplate = (code = readAppFile(HEADER_PART)) => parse(code, { filename: HEADER_PART }).descriptor.template?.content ?? ''

/** `code` from the first `from` up to the first `to` after it; throws when either is missing. */
function between(code: string, from: string, to: string): string {
  const start = code.indexOf(from)
  const end = code.indexOf(to, start + from.length)
  if (start === -1 || end === -1) throw new Error(`slice ${from} … ${to} not found`)
  return code.slice(start, end)
}

/** The open/close/keyboard rules, read from the dialog module. */
function dialogProblems(code: string): string[] {
  const problems: string[] = []
  const open = between(code, 'const openChatbot', 'const closeChatbot')
  if (!/visibleTabbables(?:<\w+>)?\(chatbotDialog\.value\)\[0\]\?\.focus\(\)/.test(open)) problems.push('opening focuses the first visible control')
  if (/chatCloseButton\.value\?\.focus\(\)/.test(open)) problems.push('the desktop-only close button cannot take focus on a phone')
  if (!/focusReturn\.remember\(/.test(open)) problems.push('the opener (bottom-nav button on phones) is remembered')
  if (!/import \{[^}]*createFocusReturn[^}]*\} from '(?:~|\.\.)\/utils\/focus-return'/.test(code)) problems.push('uses the shared focus-return helpers')
  if (!/inertOutside\(chatbotDialog\.value\)/.test(code)) problems.push('the page behind goes inert')
  const close = between(code, 'const closeChatbot', 'const toggleChatbot')
  if (!(close.indexOf('releasePage()') !== -1 && close.indexOf('releasePage()') < close.indexOf('focusReturn.restore('))) problems.push('focus cannot land on an opener that is still inert')
  if (!/onUnmounted\([\s\S]*releasePage\(\)/.test(code)) problems.push('unmount releases the page')
  if (!/window\.addEventListener\('keydown', onWindowKeydown\)/.test(code)) problems.push('a window keydown listener while open')
  if (!/window\.removeEventListener\('keydown', onWindowKeydown\)/.test(code)) problems.push('the listener is removed')
  const handler = between(code, 'const onWindowKeydown', 'const openChatbot')
  if (!/event\.key === 'Escape'/.test(handler)) problems.push('Escape closes from anywhere')
  if (!/trapTabTarget\(/.test(handler)) problems.push('Tab from outside (e.g. the launcher) must land inside the dialog')
  return problems
}

test('opening focuses the first VISIBLE control; the page behind is inert and released before focus returns; Escape from anywhere', () => {
  assert.deepEqual(dialogProblems(dialogModule()), [])
})

test('the widget hands the dialog module its dialog element and its launcher', () => {
  assert.match(template, /id="public-chatbot-dialog"\s+ref="chatbotDialog"/)
  assert.match(script, /useChatWidgetDialog\(\{[\s\S]*?chatbotDialog[\s\S]*?chatToggleButton[\s\S]*?\}\)/)
  assert.match(template, /<ChatWidgetLauncher[^>]*ref="chatToggleButton"/)
  // The launcher part hands focus to its own button.
  const launcher = readAppFile('components/chat-widget/ChatWidgetLauncher.vue')
  assert.match(launcher, /ref="toggleButton"[\s\S]*?class="chatbot-toggle-btn/)
  assert.match(launcher, /defineExpose\(\{ focus: \(\) => toggleButton\.value\?\.focus\(\) \}\)/)
  // The old element-level handler only heard keys while focus was inside.
  assert.doesNotMatch(familyTemplate(CHAT_WIDGET_FAMILY), /@keydown="handleChatbotDialogKeydown"/)
})

test('opening does not transition visibility, so the first control can take focus at once', () => {
  // Found by tests/e2e/chat-widget-focus.spec.ts: with `visibility` in the open
  // transition the dialog is still hidden when focus() runs, and the browser
  // ignores focus() on a hidden tree. Same rule as DefaultMobileDrawer.vue.
  const dialog = template.match(/id="public-chatbot-dialog"[\s\S]*?\n\s*>/)?.[0] ?? ''
  assert.ok(dialog, 'the dialog element is in ChatWidget.vue')
  const staticClass = /\sclass="([^"]*)"/.exec(dialog)?.[1] ?? ''
  const boundClass = /:class="([^"]*)"/.exec(dialog)?.[1] ?? ''
  assert.doesNotMatch(staticClass, /transition-\[[^\]]*visibility/, 'visibility must not transition in every state')
  const openBranch = /isChatbotOpen \? '([^']*)'/.exec(boundClass)?.[1] ?? ''
  assert.match(openBranch, /!visible/)
  assert.doesNotMatch(openBranch, /visibility|transition-all/, 'opening transitions visibility')
  assert.match(boundClass, /: '[^']*transition-\[opacity,transform,visibility\]/, 'closing should still hide after the fade')
  // Header controls (the first focus targets) must not transition inherited visibility.
  const header = headerTemplate()
  assert.match(header, /t\('cw_back'\)/, 'the header part holds the first focus target')
  assert.doesNotMatch(header, /transition-all/)
})

test('opening the full page closes through the same path, so focus and inert are restored', () => {
  const full = between(script, 'const openFullPage', '}')
  assert.match(full, /await closeChatbot\(\)/)
  assert.match(full, /navigateTo\('\/assistant'\)/)
})

test('injection proof: each rule breaks in the file that carries it', () => {
  const code = readAppFile(DIALOG_MODULE)
  const broken = (from: string, to: string) => {
    assert.ok(code.includes(from), `${DIALOG_MODULE} no longer contains ${from}`)
    return dialogProblems(dialogModule(code.replace(from, to)))
  }
  // Restore focus first, release the page after: the order the rule exists for.
  assert.deepEqual(
    broken('    releasePage()\n    await nextTick()\n    // No remembered opener (opened programmatically): the launcher, where shown.\n    if (!focusReturn.restore(shouldRestore) && shouldRestore) chatToggleButton.value?.focus()',
      '    await nextTick()\n    if (!focusReturn.restore(shouldRestore) && shouldRestore) chatToggleButton.value?.focus()\n    releasePage()'),
    ['focus cannot land on an opener that is still inert'],
  )
  assert.deepEqual(broken("if (event.key === 'Escape') {", "if (event.key === 'Esc') {"), ['Escape closes from anywhere'])
  assert.deepEqual(broken('visibleTabbables<HTMLElement>(chatbotDialog.value)[0]?.focus()', 'chatToggleButton.value?.focus()'), ['opening focuses the first visible control'])
  assert.deepEqual(broken("    window.addEventListener('keydown', onWindowKeydown)\n", ''), ['a window keydown listener while open'])
  assert.throws(() => dialogProblems(dialogModule(code.replace('const closeChatbot', 'const shutChatbot'))), /not found/, 'a renamed function is red, not an empty slice')
  // A header that transitions everything again is caught in the header part.
  const header = readAppFile(HEADER_PART)
  assert.match(headerTemplate(header.replace('transition-[background-color,transform]', 'transition-all')), /transition-all/)
})
