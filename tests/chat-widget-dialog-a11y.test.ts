import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { TABBABLE_SELECTOR, visibleTabbables, type TabbableLike } from '../app/utils/focus-return'

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

const source = readFileSync(new URL('../app/components/ChatWidget.vue', import.meta.url), 'utf8')
const script = source.slice(source.indexOf('<script setup'))
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
const template = source.slice(0, source.indexOf('<script setup'))

test('opening focuses the first VISIBLE control, not a hard-coded desktop button', () => {
  const open = script.slice(script.indexOf('const openChatbot'), script.indexOf('const closeChatbot'))
  assert.match(open, /visibleTabbables(?:<\w+>)?\(chatbotDialog\.value\)\[0\]\?\.focus\(\)/)
  assert.doesNotMatch(open, /chatCloseButton\.value\?\.focus\(\)/, 'the desktop-only close button cannot take focus on a phone')
  assert.match(open, /focusReturn\.remember\(/, 'the opener (bottom-nav button on phones) is not remembered')
})

test('opening does not transition visibility, so the first control can take focus at once', () => {
  // Found by tests/e2e/chat-widget-focus.spec.ts: with `visibility` in the open
  // transition the dialog is still hidden when focus() runs, and the browser
  // ignores focus() on a hidden tree. Same rule as DefaultMobileDrawer.vue.
  const dialog = template.match(/id="public-chatbot-dialog"[\s\S]*?\n\s*>/)?.[0] ?? ''
  const staticClass = /\sclass="([^"]*)"/.exec(dialog)?.[1] ?? ''
  const boundClass = /:class="([^"]*)"/.exec(dialog)?.[1] ?? ''
  assert.doesNotMatch(staticClass, /transition-\[[^\]]*visibility/, 'visibility must not transition in every state')
  const openBranch = /isChatbotOpen \? '([^']*)'/.exec(boundClass)?.[1] ?? ''
  assert.match(openBranch, /!visible/)
  assert.doesNotMatch(openBranch, /visibility|transition-all/, 'opening transitions visibility')
  assert.match(boundClass, /: '[^']*transition-\[opacity,transform,visibility\]/, 'closing should still hide after the fade')
  // Header controls (the first focus targets) must not transition inherited visibility.
  const header = template.slice(template.indexOf('<!-- Header -->'), template.indexOf('<!-- Conversation list'))
  assert.doesNotMatch(header, /transition-all/)
})

test('the page behind is inert while the dialog is open, and released before focus returns', () => {
  assert.match(script, /import \{[^}]*createFocusReturn[^}]*\} from '~\/utils\/focus-return'/)
  assert.match(script, /inertOutside\(chatbotDialog\.value\)/)
  const close = script.slice(script.indexOf('const closeChatbot'), script.indexOf('const toggleChatbot'))
  assert.ok(close.indexOf('releasePage()') !== -1 && close.indexOf('releasePage()') < close.indexOf('focusReturn.restore('),
    'focus cannot land on an opener that is still inert')
  assert.match(script, /onUnmounted\([\s\S]*releasePage\(\)/)
})

test('Escape closes from anywhere while open, through a window listener that exists only while open', () => {
  assert.match(script, /window\.addEventListener\('keydown', onWindowKeydown\)/)
  assert.match(script, /window\.removeEventListener\('keydown', onWindowKeydown\)/)
  const handler = script.slice(script.indexOf('const onWindowKeydown'), script.indexOf('const openChatbot'))
  assert.match(handler, /event\.key === 'Escape'/)
  assert.match(handler, /trapTabTarget\(/, 'Tab from outside (e.g. the launcher) must land inside the dialog')
  // The old element-level handler only heard keys while focus was inside.
  assert.doesNotMatch(template, /@keydown="handleChatbotDialogKeydown"/)
})

test('opening the full page closes through the same path, so focus and inert are restored', () => {
  const full = script.slice(script.indexOf('const openFullPage'), script.indexOf('const onWindowKeydown') > script.indexOf('const openFullPage') ? script.indexOf('const onWindowKeydown') : undefined)
  assert.match(full, /await closeChatbot\(\)/)
  assert.match(full, /navigateTo\('\/assistant'\)/)
})
