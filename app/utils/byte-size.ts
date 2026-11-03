/**
 * A byte count on an admin screen: "0 B", "512 B", "2.0 KB", "1.5 GB".
 *
 * `null` is a size the server could NOT read — the uploads tree on `/admin/media` when its
 * root is unreadable (wrong volume owner, R8-5) — and reads "—", never "0 B": a zero there
 * reads as "the folder is empty", the one thing that is not known.
 */
export function formatByteSize(bytes: number | null): string {
  if (bytes === null) return '—'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}
