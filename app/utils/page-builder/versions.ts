/**
 * The versions drawer of the page builder (`pages/admin/content/pages/[id].vue`): how each kind
 * of version is shown, and its date. Moved out of the page when it was split (wave3 4.2) — the
 * drawer (`components/admin/page-builder/PageVersionsDrawer.vue`) draws them and the version
 * prompts (`usePageVersions`) name them.
 */
export const VERSION_KIND_META: Record<string, { label: string; icon: string; color: string }> = {
  origin: { label: 'Bản gốc', icon: 'fa-solid fa-anchor', color: 'text-blue-600' },
  manual: { label: 'Bản sao lưu', icon: 'fa-solid fa-bookmark', color: 'text-green-700' },
  auto: { label: 'Tự động', icon: 'fa-solid fa-clock-rotate-left', color: 'text-gray-500' },
}

/** `dd/mm/yyyy, hh:mm` in vi-VN; the input unchanged when it cannot be read. */
export const formatVersionDate = (d: string) => {
  if (!d) return ''
  try { return new Date(d).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }) } catch { return d }
}
