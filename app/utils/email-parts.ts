/**
 * Tách địa chỉ email thành phần trước và sau `@` để vẽ `@` trong phần tử riêng.
 *
 * Vì sao: Cloudflare "Email Address Obfuscation" quét HTML của máy chủ, thấy `ten@tenmien.vn` liền mạch thì thay
 * bằng `<a class="__cf_email__" data-cfemail=…>[email protected]</a>`. Trình duyệt hydrate lại thấy DOM khác với
 * cái Vue dựng → "Hydration completed but contains mismatches" ở MỌI trang có chân trang (đã tái hiện: HTML
 * máy chủ của prod chứa `data-cfemail`, bản local không có CF thì sạch). Khi `@` nằm giữa hai thẻ, không còn
 * chuỗi email liền mạch để CF khớp — và DOM của SSR/client giống hệt nhau.
 */
export function splitEmail(email: unknown): { local: string; domain: string } | null {
  if (typeof email !== 'string') return null
  const value = email.trim()
  const at = value.indexOf('@')
  if (at <= 0 || at !== value.lastIndexOf('@') || at === value.length - 1) return null
  return { local: value.slice(0, at), domain: value.slice(at + 1) }
}
