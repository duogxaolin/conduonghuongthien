/**
 * Ba lỗi hiển thị phát hiện khi test prod (cdht.delify.vn):
 *   1. ~1/3 bài viết có ảnh trong thân bài bị 404 (ảnh từ trang cũ) → ẩn thay vì hiện khung vỡ.
 *   2. Chân trang hiện "© 2026 © 2026 Bản quyền …" (mẫu ghép cứng + chuỗi CSDL đã có ©).
 *   3. "Hydration completed but contains mismatches" ở mọi trang: Cloudflare Email Obfuscation thay email
 *      liền mạch trong HTML máy chủ bằng `[email protected]`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { hideBrokenImage, hideFailedImagesIn, isFailedImage, watchBrokenImages, type ContainerLike, type EventRootLike, type ImageLike } from '../app/utils/broken-image'
import { withCopyrightPrefix } from '../app/utils/copyright'
import { splitEmail } from '../app/utils/email-parts'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

// ── DOM giả tối thiểu ────────────────────────────────────────────────────────
function img(init: Partial<ImageLike> & { complete?: boolean; naturalWidth?: number } = {}, parent: ContainerLike | null = null): ImageLike & { attrs: Record<string, string> } {
  const attrs: Record<string, string> = {}
  return {
    tagName: 'IMG', complete: init.complete ?? true, naturalWidth: init.naturalWidth ?? 0, style: { display: '' },
    setAttribute: (n: string, v: string) => { attrs[n] = v }, getAttribute: (n: string) => (n in attrs ? attrs[n]! : null),
    parentElement: parent, attrs,
  }
}
function box(tagName: string, text: string, children: ImageLike[] = [], parent: ContainerLike | null = null): ContainerLike {
  const el: ContainerLike = { tagName, textContent: text, style: { display: '' }, parentElement: parent, querySelectorAll: () => children }
  for (const c of children) c.parentElement = el
  return el
}

test('isFailedImage: đã tải xong mà không có điểm ảnh = lỗi; đang tải hoặc có ảnh thì không', () => {
  assert.equal(isFailedImage({ complete: true, naturalWidth: 0 }), true)
  assert.equal(isFailedImage({ complete: false, naturalWidth: 0 }), false)
  assert.equal(isFailedImage({ complete: true, naturalWidth: 640 }), false)
})

test('ảnh lỗi bị ẩn và đánh dấu; bọc ngoài chỉ có ảnh đó cũng bị ẩn, bọc có chữ thì giữ', () => {
  const lone = img()
  const p1 = box('P', '  ', [lone])
  hideBrokenImage(lone)
  assert.equal(lone.style.display, 'none')
  assert.equal(lone.attrs['data-broken-img'], '')
  assert.equal(p1.style.display, 'none', '<p> chỉ chứa ảnh hỏng không để lại đoạn trống')

  const withText = img()
  const p2 = box('P', 'Chú thích ảnh', [withText])
  hideBrokenImage(withText)
  assert.equal(withText.style.display, 'none')
  assert.equal(p2.style.display, '', '<p> còn chữ thì giữ nguyên')

  const bad = img(), good = img({ naturalWidth: 300 })
  const p3 = box('P', '', [bad, good])
  hideBrokenImage(bad)
  assert.equal(p3.style.display, '', 'còn ảnh khác hiển thị được thì không ẩn bọc ngoài')
})

test('quét một lượt: chỉ ẩn ảnh đã lỗi, bỏ qua ảnh tốt/đang tải, không xử lý hai lần', () => {
  const broken = img(), loading = img({ complete: false }), good = img({ naturalWidth: 100 })
  const root = box('DIV', 'bài viết', [broken, loading, good])
  assert.equal(hideFailedImagesIn(root), 1)
  assert.equal(broken.style.display, 'none')
  assert.equal(loading.style.display, '')
  assert.equal(good.style.display, '')
  assert.equal(hideFailedImagesIn(root), 0, 'ảnh đã đánh dấu không bị xử lý lại')
})

test('watchBrokenImages nghe `error` ở pha capture, chỉ xử lý <img>, và huỷ được', () => {
  const listeners: Array<{ type: string; fn: (e: { target: unknown }) => void; capture: boolean }> = []
  const root = { ...box('DIV', 'x', []), addEventListener: (type: string, fn: (e: { target: unknown }) => void, capture: boolean) => { listeners.push({ type, fn, capture }) }, removeEventListener: (type: string, fn: unknown) => { const i = listeners.findIndex(l => l.type === type && l.fn === fn); if (i >= 0) listeners.splice(i, 1) } } as EventRootLike
  const stop = watchBrokenImages(root)
  assert.equal(listeners.length, 1)
  assert.equal(listeners[0]!.type, 'error')
  assert.equal(listeners[0]!.capture, true, '`error` của ảnh không nổi bọt — phải nghe ở pha capture')
  const lazy = img({ complete: false })
  listeners[0]!.fn({ target: lazy })
  assert.equal(lazy.style.display, 'none')
  const notImg = { tagName: 'SCRIPT', style: { display: '' }, setAttribute() {} }
  listeners[0]!.fn({ target: notImg })
  assert.equal(notImg.style.display, '', 'phần tử khác ảnh không bị ẩn')
  stop()
  assert.equal(listeners.length, 0)
})

test('withCopyrightPrefix: chỉ thêm "© 2026" khi chuỗi dịch chưa có', () => {
  assert.equal(withCopyrightPrefix('Bản quyền thuộc về Cổng thông tin'), '© 2026 Bản quyền thuộc về Cổng thông tin')
  assert.equal(withCopyrightPrefix('© 2026 Bản quyền thuộc về Cổng thông tin'), '© 2026 Bản quyền thuộc về Cổng thông tin')
  assert.equal(withCopyrightPrefix('Copyright © 2026 Path of Redemption Portal'), 'Copyright © 2026 Path of Redemption Portal')
  assert.equal(withCopyrightPrefix('  &copy; 2026 Foo '), '&copy; 2026 Foo')
  assert.equal(withCopyrightPrefix('版权所有 © 2026 越南'), '© 2026 版权所有 © 2026 越南', 'chỉ nhận © ở ĐẦU chuỗi')
  assert.equal(withCopyrightPrefix('x', 2030), '© 2030 x')
})

test('splitEmail: tách quanh @ để CF không khớp; chuỗi không phải email thì trả null', () => {
  assert.deepEqual(splitEmail('contact@conduonghuongthien.com.vn'), { local: 'contact', domain: 'conduonghuongthien.com.vn' })
  assert.deepEqual(splitEmail('  a.b+c@x.vn '), { local: 'a.b+c', domain: 'x.vn' })
  for (const bad of ['', 'khong-co-at', '@x.vn', 'a@', 'a@b@c', null, undefined, 42]) assert.equal(splitEmail(bad), null, String(bad))
})

test('mọi nơi công khai vẽ email đều qua <PublicEmail>, chân trang dùng withCopyrightPrefix', () => {
  assert.match(read('../app/components/layout/DefaultFooter.vue'), /<PublicEmail :email="siteEmail" \/>/)
  assert.doesNotMatch(read('../app/components/layout/DefaultFooter.vue'), /\{\{ siteEmail \}\}/)
  assert.match(read('../app/components/layout/DefaultFooter.vue'), /withCopyrightPrefix\(t\('footer_copyright'\)\)/)
  assert.doesNotMatch(read('../app/components/layout/DefaultFooter.vue'), /&copy; 2026/)
  assert.match(read('../app/components/blocks/SupportFormBlock.vue'), /<PublicEmail /)
  assert.doesNotMatch(read('../app/components/blocks/SupportFormBlock.vue'), /\{\{ d\.email/)
  assert.match(read('../app/pages/in-bai/[slug].vue'), /<PublicEmail :email="siteEmail" \/>/)
  const component = read('../app/components/PublicEmail.vue')
  assert.match(component, /<span>@<\/span>/, '`@` phải nằm trong phần tử riêng')
})

test('mọi khối v-html nội dung bài viết đều bật ẩn ảnh lỗi', () => {
  // Thân bài của trang chi tiết là `article/ArticleBody.vue` từ wave3 4.2 (trước đó nằm
  // trong ArticleDetail.vue). Mỗi tệp trong danh sách phải CHÍNH LÀ nơi có `v-html` — một
  // mục trỏ vào tệp đã chuyển `v-html` đi nơi khác thì kiểm một tệp không còn gì để ẩn.
  for (const file of ['../app/components/article/ArticleBody.vue', '../app/components/blocks/RichTextBlock.vue', '../app/components/blocks/ContentAsideBlock.vue', '../app/pages/in-bai/[slug].vue']) {
    assert.match(read(file), /v-html=/, `${file} không còn v-html — danh sách trỏ sai tệp`)
    assert.match(read(file), /useBrokenImageFallback\(/, file)
  }
})
