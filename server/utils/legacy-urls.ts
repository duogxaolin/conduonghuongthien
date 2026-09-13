/**
 * Chuyển hướng vĩnh viễn cho địa chỉ của cổng cũ (ASP.NET, conduonghuongthien.com.vn).
 *
 * Mọi bài viết trên cổng cũ nằm ở **gốc domain** với đuôi `.html`
 * (`/<tieu-de>.html` — đã đối chiếu href thật trên trang chủ cổng cũ), còn trang
 * danh sách là `/<ten-muc>` không đuôi. Cả hai hình dạng đã vào chỉ mục tìm kiếm
 * và đã được chia sẻ — đổi hệ thống mà thiếu phần này là làm chết mọi liên kết
 * đã phát ra ngoài, kể cả những liên kết đã in ra giấy.
 *
 * Hàm là THUẦN (pathname → đích, không chạm HTTP) nên kiểm được bằng test
 * thường; `server/middleware/legacy-urls.ts` chỉ là lớp bọc mỏng gọi nó.
 *
 * **Chỉ nhận stem đúng `[a-z0-9-]+`** — đúng bộ ký tự của toàn bộ 1142 alias
 * trong `TNews.Alias_Url` (đã đo: 0 dấu tiếng Việt, 0 chữ hoa). URL lạ trả về
 * `null` để đi tiếp tới 404 thay vì chuyển hướng mù: chuyển hướng nhắm đại là
 * chuyển hướng một lượt tấn công.
 *
 * Bài trùng slug cũ (19 stem do 2–3 bài cùng dùng trên CSDL cũ) ra đúng một đích
 * `/news/<stem>` — y hệt hành vi cổng cũ, vốn cũng phục vụ một bài duy nhất cho
 * mỗi địa chỉ đó.
 */

const LEGACY_LIST_PAGES: Record<string, string> = {
  '/gioi-thieu':                     '/about',
  '/lien-he':                        '/contact',
  '/ban-tin':                        '/news',
  '/tin-noi-bat':                    '/news',
  '/thu-vien-anh-video':             '/news',
  '/tam-guong-tieu-bieu':            '/role-models',
  '/mo-hinh-tai-hoa-nhap-cong-dong': '/reintegration-models',
  '/van-ban':                        '/documents',
  '/giai-dap-phap-luat':             '/legal-qa',
}

// Alias cũ chỉ gồm ký tự này (đã đo trên toàn bộ 1142 dòng `TNews.Alias_Url`).
// Tiền tố `news/` tuỳ chọn bắt các địa chỉ đã kèm nhánh mới và chỉ còn đuôi
// `.html` — dọn đuôi rồi đưa về trang chi tiết, thay vì rơi vào 404.
const LEGACY_ARTICLE_RE = /^\/(?:news\/)?([a-z0-9-]+)\.html?$/

export function resolveLegacyUrl(pathname: string): string | null {
  const listHit = LEGACY_LIST_PAGES[pathname]
  if (listHit) return listHit

  const m = LEGACY_ARTICLE_RE.exec(pathname)
  if (!m) return null
  return `/news/${m[1]}`
}
