import { fullscreenToolbarGroup } from './tinymce-fullscreen-button'

/**
 * The toolbar of `components/admin/TinyMceEditor.vue` — the Page Builder's rich-text fields and the translation panel's
 * body. Same order as the article editor's (CHANGELOG § 105, § 106): the labelled full-screen toggle FIRST (the sliding
 * toolbar never folds the first group), then history, blocks, inline format, colour, alignment, the insert group
 * (link, image, video, table), and only after it the list buttons. `withSave` adds "Lưu", visible only in full screen,
 * for a host whose own Save button the full screen covers. Names nothing registered (`cdktvideo` without the
 * `media_portal` permission, `cdktsave` without `withSave`) are left out by TinyMCE.
 *
 * Pure: tests/tinymce-compact-toolbar.test.ts.
 */
export function compactEditorToolbar(withSave: boolean): string {
  return `${fullscreenToolbarGroup(withSave)} | undo redo | blocks | bold italic underline | forecolor backcolor | ` +
    'alignleft aligncenter alignright | link cdktimage cdktimageedit cdktvideo table | removeformat | ' +
    'bullist numlist outdent indent | code'
}
