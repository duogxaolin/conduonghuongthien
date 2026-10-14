/**
 * Lối thoát cho lớp phủ "Đang tải..." của lượt tải đầu (`app/app.vue`).
 *
 * Lớp phủ là một khối `fixed inset-0` đục, CÓ SẴN trong HTML máy chủ và chỉ
 * được gỡ trong `onMounted` của app.vue. Nếu hydrate không bao giờ xong — tắt
 * JavaScript, bundle tải hỏng, một lỗi ném ra trước mount — thì nó che nội dung
 * SSR vĩnh viễn. Ba lối thoát độc lập với Vue:
 *
 *   1. `<noscript>` CSS ẩn lớp phủ khi trình duyệt không chạy JS;
 *   2. một script inline (chạy ngay khi HTML được phân tích, TRƯỚC và KHÔNG
 *      phụ thuộc bundle) ẩn lớp phủ sau tối đa `BOOT_OVERLAY_FAILSAFE_MS`;
 *   3. plugin `boot-overlay.client.ts` ẩn lớp phủ khi Nuxt/Vue báo lỗi
 *      (`app:error`, `vue:error`).
 *
 * Cả ba chỉ ẨN phần tử (style inline), không bao giờ gỡ nó khỏi DOM: Vue vẫn
 * hydrate đúng nút đó (nút mang `data-allow-mismatch`) rồi tự gỡ khi mount.
 * Gỡ nút trước hydrate sẽ thành lệch hydration ở cấp cha.
 */

export const BOOT_OVERLAY_ID = 'cdkt-boot-overlay'

/**
 * Trần thời gian lớp phủ được phép che trang. Đo trên localhost với CPU chậm 4×:
 * nội dung hiện ở ~2 s; 4 s chừa đủ cho máy yếu mà không bắt khách nhìn màn
 * chờ vô hạn khi có sự cố.
 */
export const BOOT_OVERLAY_FAILSAFE_MS = 4000

type OverlayDocument = { getElementById(id: string): { style: { display: string }, setAttribute(name: string, value: string): void } | null }

/** Ẩn lớp phủ nếu nó còn trong DOM. Trả `true` khi đã ẩn. */
export function hideBootOverlay(doc: OverlayDocument): boolean {
  const el = doc.getElementById(BOOT_OVERLAY_ID)
  if (!el) return false
  el.style.display = 'none'
  el.setAttribute('aria-busy', 'false')
  return true
}

/**
 * Nội dung script inline cho lối thoát (2). Viết tay bằng ES5 vì nó chạy trước
 * mọi bundle, ngoài trình biên dịch; cùng thao tác với `hideBootOverlay` — test
 * chạy cả hai trên cùng một DOM giả để giữ chúng khớp nhau.
 */
export function bootOverlayFailsafeScript(): string {
  return `setTimeout(function(){var e=document.getElementById(${JSON.stringify(BOOT_OVERLAY_ID)});if(e){e.style.display="none";e.setAttribute("aria-busy","false")}},${BOOT_OVERLAY_FAILSAFE_MS})`
}

/** CSS đặt trong `<noscript>` cho lối thoát (1). */
export const BOOT_OVERLAY_NOSCRIPT_CSS = `#${BOOT_OVERLAY_ID}{display:none!important}`
