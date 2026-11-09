import type { TinyMceEditorInstance } from '../types/tinymce'

/** The labelled full-screen toggle, first in the toolbar of the admin's rich-text editors. */
export const FULLSCREEN_BUTTON = 'cdktfullscreen'
/** "Lưu" inside full screen: the host's own save, for an editor whose page's Save button is covered by it. */
export const SAVE_BUTTON = 'cdktsave'
/**
 * What the toggle shows. Short on purpose: "Toàn màn hình" took ~96 px and pushed Bold/Italic/Underline and the
 * colour buttons into "…" on a ~1280 px window (CHANGELOG § 105/106). The tooltip — the button's accessible name —
 * still begins with the full words and contains this label (WCAG 2.5.3 label in name).
 */
export const FULLSCREEN_LABEL = 'Phóng to'
export const FULLSCREEN_TOOLTIP = 'Phóng to toàn màn hình — bấm lần nữa để thoát (Ctrl+Shift+F, trên Mac Cmd+Shift+F)'
export const SAVE_LABEL = 'Lưu'
/**
 * The save button's tooltip. `app/assets/css/main.css` hides the button outside full screen by this prefix
 * (`.tox-tbtn[aria-label^="Lưu ngay"]`): TinyMCE has no "hidden" state for a toolbar button, and `data-mce-name` is not
 * rendered by 6.8. tests/tinymce-fullscreen-button.test.ts ties the two together.
 */
export const SAVE_TOOLTIP = 'Lưu ngay — không cần thoát toàn màn hình'

/** The toolbar's first group. The save button is in it only when the host registers one, so a host without it adds no gap. */
export function fullscreenToolbarGroup(withSave: boolean): string {
  return withSave ? `${FULLSCREEN_BUTTON} ${SAVE_BUTTON}` : FULLSCREEN_BUTTON
}

/**
 * Registers a labelled "Phóng to" toggle: TinyMCE's own `fullscreen` button is an icon alone and sat last in
 * the toolbar, where the sliding toolbar folds it into "…". This one is the first group, so it is never folded, and
 * it shows pressed while the editor is full screen.
 *
 * The pressed state follows the plugin, not a flag of its own: `FullscreenStateChanged` fires whichever way the
 * state changed (this button, View → Fullscreen, Ctrl+Shift+F), and a button drawn while the editor is already full
 * screen starts pressed. The label stays; the tooltip says how to leave.
 *
 * `onSave` (opt-in) also registers "Lưu": full screen covers the page's own Save button, so the host's save runs from
 * here. It is visible only in full screen (CSS in main.css) and so costs the toolbar no width otherwise.
 *
 * Pure (no auto-imports), like the other `register…` helpers: tests/tinymce-fullscreen-button.test.ts.
 */
export function registerFullscreenButton(editor: TinyMceEditorInstance, onSave?: () => void): void {
  const registry = editor.ui?.registry
  if (!registry) return
  registry.addToggleButton(FULLSCREEN_BUTTON, {
    icon: 'fullscreen',
    text: FULLSCREEN_LABEL,
    tooltip: FULLSCREEN_TOOLTIP,
    onAction: () => editor.execCommand('mceFullScreen'),
    onSetup: (api) => {
      const sync = (event: { state?: boolean }) => api.setActive(event.state === true)
      api.setActive(editor.plugins?.fullscreen?.isFullscreen() === true)
      editor.on('FullscreenStateChanged', sync)
      return () => editor.off('FullscreenStateChanged', sync)
    },
  })
  if (onSave) {
    registry.addButton(SAVE_BUTTON, { icon: 'save', text: SAVE_LABEL, tooltip: SAVE_TOOLTIP, onAction: () => onSave() })
  }
}
