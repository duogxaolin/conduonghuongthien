/**
 * Format a date string to Vietnamese format (dd/MM/yyyy).
 * Uses manual parsing to avoid timezone/locale mismatch between SSR and client.
 */
export const formatDateVN = (dateStr: string | null | undefined): string => {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return ''
  const day = String(d.getUTCDate()).padStart(2, '0')
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const year = d.getUTCFullYear()
  return `${day}/${month}/${year}`
}
