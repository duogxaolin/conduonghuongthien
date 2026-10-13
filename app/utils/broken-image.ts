/**
 * Ảnh trong nội dung bài viết bị 404 thì ẨN, không để khung ảnh vỡ.
 *
 * Bối cảnh (đo trên prod): ~1/3 bài viết chuyển từ trang cũ có ảnh dạng `/UserFile/editor/images/….jpg`; các
 * tệp đó không còn ở đâu (404 trên mọi tên miền cũ). Plugin `image-fallback.client.ts` thay chúng bằng ảnh bìa
 * mặc định (hợp với thumbnail/thẻ bài, nhưng là một tấm ảnh 1200px vô nghĩa giữa đoạn văn). Trong THÂN bài thì ẩn
 * hẳn gọn hơn. Nội dung là HTML đã lưu (`v-html`), không thể gắn `@error` từng ảnh — nên nghe sự kiện `error` ở phần tử gốc (pha
 * capture, vì `error` của ảnh không nổi bọt) và quét một lượt các ảnh đã lỗi trước khi nghe kịp.
 *
 * Chỉ ẩn bằng style nội tuyến + `data-broken-img`; không xoá phần tử (HTML do Vue/`v-html` quản lý, xoá sẽ lệch
 * DOM ở lần patch sau). Bọc ngoài (`<p>`, `<a>`, `<figure>`) chỉ bị ẩn khi không còn chữ hay ảnh nào hiển thị.
 */

export interface ImageLike {
  tagName?: string
  complete?: boolean
  naturalWidth?: number
  style: { display: string }
  setAttribute(name: string, value: string): void
  getAttribute?(name: string): string | null
  parentElement?: ContainerLike | null
}

export interface ContainerLike {
  tagName?: string
  textContent?: string | null
  style: { display: string }
  parentElement?: ContainerLike | null
  querySelectorAll?(selector: string): ArrayLike<ImageLike>
}

const WRAPPERS = new Set(['P', 'A', 'FIGURE', 'SPAN', 'DIV', 'CENTER'])

/** Ảnh đã tải xong mà không có điểm ảnh nào = tải lỗi. (`complete` cũng true với ảnh lỗi.) */
export function isFailedImage(img: Pick<ImageLike, 'complete' | 'naturalWidth'>): boolean {
  return img.complete === true && (img.naturalWidth ?? 0) === 0
}

export function hideBrokenImage(img: ImageLike): void {
  img.style.display = 'none'
  img.setAttribute('data-broken-img', '')
  let parent = img.parentElement ?? null
  for (let depth = 0; parent && depth < 3; depth += 1) {
    if (!WRAPPERS.has(parent.tagName ?? '')) break
    if ((parent.textContent ?? '').trim() !== '') break
    const remaining = Array.from(parent.querySelectorAll?.('img') ?? []).some(other => other !== img && other.getAttribute?.('data-broken-img') == null)
    if (remaining) break
    parent.style.display = 'none'
    parent = parent.parentElement ?? null
  }
}

/** Quét một lượt các ảnh đã lỗi trước khi nghe kịp sự kiện (ảnh lỗi trong lúc trang đang hydrate). */
export function hideFailedImagesIn(root: ContainerLike): number {
  let hidden = 0
  for (const img of Array.from(root.querySelectorAll?.('img') ?? [])) {
    if (img.getAttribute?.('data-broken-img') != null) continue
    if (isFailedImage(img)) { hideBrokenImage(img); hidden += 1 }
  }
  return hidden
}

export interface EventRootLike extends ContainerLike {
  addEventListener(type: string, listener: (event: { target: unknown }) => void, capture: boolean): void
  removeEventListener(type: string, listener: (event: { target: unknown }) => void, capture: boolean): void
}

/** Nghe `error` của mọi ảnh dưới `root` và quét ảnh đã lỗi sẵn. Trả hàm huỷ. */
export function watchBrokenImages(root: EventRootLike): () => void {
  const onError = (event: { target: unknown }) => {
    const target = event.target as ImageLike | null
    if (target && target.tagName === 'IMG') hideBrokenImage(target)
  }
  root.addEventListener('error', onError, true)
  hideFailedImagesIn(root)
  return () => root.removeEventListener('error', onError, true)
}
