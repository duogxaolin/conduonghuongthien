/**
 * Chuyển hướng địa chỉ cổng cũ (ASP.NET) sang cổng mới.
 *
 * Toàn bộ 1132 bài viết đã migrate giữ nguyên lượt xem và nội dung, nhưng địa
 * chỉ của chúng trên cổng cũ là `/<tieu-de>.html` ở **gốc domain** (đã đối chiếu
 * href thật trên trang chủ cổng cũ), còn trang danh mục là `/<ten-muc>` không
 * đuôi. Cả hai hình dạng đã vào chỉ mục tìm kiếm và đã được chia sẻ — thiếu
 * chuyển hướng là làm chết mọi liên kết đã phát ra ngoài, kể cả những liên kết
 * đã in ra giấy hay nằm trong tin nhắn. 301 chứ không 302 để công cụ tìm kiếm
 * chuyển hẳn thứ hạng sang địa chỉ mới.
 *
 * Đây là test kiểm **hành vi của hàm thuần** `resolveLegacyUrl`, không phải soi
 * văn bản mã nguồn: mỗi dòng ở bảng dưới là một địa chỉ thật — mẫu đầu tiên của
 * mỗi nhóm lấy thẳng từ CSDL cũ (`TNews.Alias_Url`), nhóm còn lại lấy từ href
 * trên trang chủ cổng cũ.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { resolveLegacyUrl } from '../server/utils/legacy-urls.ts'

describe('resolveLegacyUrl — bài viết cổng cũ (/<tieu-de>.html)', () => {
  it('đổi một địa chỉ bài thật thành /news/<slug>', () => {
    assert.equal(
      resolveLegacyUrl('/tp-hue-phat-huy-hieu-qua-quyet-dinh-22-ho-tro-nguoi-chap-hanh-xong-an-phat-tu-tai-hoa-nhap-cong-dong.html'),
      '/news/tp-hue-phat-huy-hieu-qua-quyet-dinh-22-ho-tro-nguoi-chap-hanh-xong-an-phat-tu-tai-hoa-nhap-cong-dong',
    )
  })

  it('chấp nhận đuôi .htm (phòng khi có liên kết gõ thiếu e)', () => {
    assert.equal(resolveLegacyUrl('/tieu-de.htm'), '/news/tieu-de')
  })

  it('dọn đuôi .html cho địa chỉ đã kèm nhánh /news/', () => {
    assert.equal(resolveLegacyUrl('/news/tieu-de.html'), '/news/tieu-de')
  })

  it('MỌI stem alias nội bộ trong CSDL cũ đều ra đích /news/<stem> — không bài nào chết', () => {
    // 10 bài test/lorem đã bị loại khỏi migrate, nên không nằm trong DB mới —
    // nhưng chuyển hướng vẫn đưa về /news/<stem> rồi trang đó tự trả 404. Đó là
    // hành vi đúng: middleware không được biết (và không cần biết) bài nào tồn tại.
    const TEST_IDS = new Set(['10468', '10469', '10471', '10473', '10474', '10475', '10476', '10477', '10478', '10498'])
    const kept = JSON.parse(readFileSync(new URL('../.migrate/import-articles.json', import.meta.url), 'utf8'))
      .filter((r: { id: string }) => !TEST_IDS.has(String(r.id)))
    assert.ok(kept.length > 1000, 'file xuất migrate phải còn đó — thiếu là test này đang đối chiếu dữ liệu rỗng')

    // 54 bài video trên cổng cũ có Alias_Url là link YouTube/Facebook — tức là
    // KHÔNG hề có URL nội bộ để giữ (trên cổng cũ, link bài trỏ thẳng ra video).
    // Chúng không qua bộ chuyển hướng này; slug mới được sinh từ tiêu đề.
    let checked = 0
    for (const rec of kept as Array<{ id: string; oldUrl: string }>) {
      if (!String(rec.oldUrl).startsWith('/')) continue
      const stem = String(rec.oldUrl).replace(/^\/(.*)\.html$/, '$1')
      assert.match(stem, /^[a-z0-9-]+$/, `alias cũ ngoài bộ ký tự đã đo: ${stem}`)
      assert.equal(resolveLegacyUrl(rec.oldUrl), `/news/${stem}`, `bài cũ ${rec.id} (${rec.oldUrl}) phải còn đến được`)
      checked++
    }
    assert.ok(checked > 1000, `phải đối chiếu hơn 1000 alias nội bộ, thực tế ${checked}`)
  })

  it('từ chối những hình dạng không phải địa chỉ bài cũ', () => {
    assert.equal(resolveLegacyUrl('/uploads/migrated/2025/01/x.jpg'), null)
    assert.equal(resolveLegacyUrl('/news/khong-co-duoi-html'), null)
    assert.equal(resolveLegacyUrl('/tieu-de.html/extra'), null)
    assert.equal(resolveLegacyUrl('/.html'), null)
    assert.equal(resolveLegacyUrl('/Tieu-De.HTML'), null) // alias cũ toàn chữ thường — chữ hoa là URL lạ
    assert.equal(resolveLegacyUrl('//evil.com/tieu-de.html'), null)
    assert.equal(resolveLegacyUrl('/tieu%20de.html'), null)
  })
})

describe('resolveLegacyUrl — trang danh sách cổng cũ', () => {
  const CASES: Array<[string, string]> = [
    ['/gioi-thieu', '/about'],
    ['/lien-he', '/contact'],
    ['/ban-tin', '/news'],
    ['/tin-noi-bat', '/news'],
    ['/thu-vien-anh-video', '/news'],
    ['/tam-guong-tieu-bieu', '/role-models'],
    ['/mo-hinh-tai-hoa-nhap-cong-dong', '/reintegration-models'],
    ['/van-ban', '/documents'],
    ['/giai-dap-phap-luat', '/legal-qa'],
  ]
  for (const [from, to] of CASES) {
    it(`${from} → ${to}`, () => {
      assert.equal(resolveLegacyUrl(from), to)
    })
  }

  it('không đụng tới các tuyến của cổng mới', () => {
    for (const p of ['/', '/about', '/news', '/documents', '/legal-qa', '/profile', '/assistant', '/admin', '/qa-documents']) {
      assert.equal(resolveLegacyUrl(p), null, `${p} là tuyến mới — không được chuyển hướng`)
    }
  })
})
