import type { TinyMceEditorInstance } from '../types/tinymce'

/** The labelled full-screen toggle, first in the article editor's toolbar. */
export const FULLSCREEN_BUTTON = 'cdktfullscreen'

/**
 * Registers a labelled "Toàn màn hình" toggle: TinyMCE's own `fullscreen` button is an icon alone and sat last in
 * the toolbar, where the sliding toolbar folds it into "…". This one is the first group, so it is never folded, and
 * it shows pressed while the editor is full screen.
 *
 * The pressed state follows the plugin, not a flag of its own: `FullscreenStateChanged` fires whichever way the
 * state changed (this button, View → Fullscreen, Ctrl+Shift+F), and a button drawn while the editor is already full
 * screen starts pressed. The label stays; the tooltip says how to leave.
 *
 * Pure (no auto-imports), like the other `register…` helpers: tests/tinymce-fullscreen-button.test.ts.
 */
export function registerFullscreenButton(editor: TinyMceEditorInstance): void {
  const registry = editor.ui?.registry
  if (!registry) return
  registry.addToggleButton(FULLSCREEN_BUTTON, {
    icon: 'fullscreen',
    text: 'Toàn màn hình',
    tooltip: 'Toàn màn hình — bấm lần nữa để thoát (Ctrl+Shift+F, trên Mac Cmd+Shift+F)',
    onAction: () => editor.execCommand('mceFullScreen'),
    onSetup: (api) => {
      const sync = (event: { state?: boolean }) => api.setActive(event.state === true)
      api.setActive(editor.plugins?.fullscreen?.isFullscreen() === true)
      editor.on('FullscreenStateChanged', sync)
      return () => editor.off('FullscreenStateChanged', sync)
    },
  })
}
