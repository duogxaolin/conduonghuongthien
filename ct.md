# Context Hội Thoại — Phiên Page Builder (2026-07-23)

Bản ghi bối cảnh phiên làm việc triển khai tính năng **Page Builder (Block System)** cho CDKT.

---

## 🎯 Mục Tiêu

Trước phiên này, admin editor "Gutenberg" tại `/admin/content/home` ghi config `home_sections` nhưng
trang public (`app/pages/index.vue`) hardcode hoàn toàn → chỉnh sửa của editor **không có tác dụng** với
người xem. Mục tiêu: dựng page builder kiểu WordPress thật — thêm/xóa/sắp xếp/sửa/ẩn-hiện block bằng
kéo-thả, áp dụng cho trang chủ + các trang khác (giới thiệu, liên hệ, trang tùy biến), và trang public
render thật từ dữ liệu block. Giữ nguyên thiết kế.

## ✅ Đã Hoàn Thành

### Nền tảng (từ phiên trước, xác nhận lại)
- **Registry** `app/utils/blocks/registry.ts` — nguồn chân lý duy nhất, 14 block type, `{label, icon, category, defaultData, fields}`; helper `isValidBlockType`, `getDefaultData`, `blocksByCategory`.
- **Bảng DB** `pages` + `page_blocks` trong `server/db/schema.ts`; DDL trong `server/db/init.ts`.
- **Slug util** `uniquePageSlug` trong `server/utils/slug.ts`.
- **Seed** `server/db/seed.ts`: tạo 3 trang hệ thống (home/about/contact), migrate `home_sections` → block trang home (guard zero-block), seed block mặc định cho about/contact; thêm resource `pages`.
- **API admin** `server/api/admin/pages/**`: list/create/get/put/delete + blocks (append/update/delete/reorder), tất cả gated bằng `checkPermission(..., 'pages', ...)`.
- **API public** `server/api/public/pages/[slug].get.ts`: read-only, chỉ trả block `isVisible=true`, slug lạ → `{ok:false}` 2xx.
- **14 block component** `app/components/blocks/*.vue` + **PageRenderer** `app/components/PageRenderer.vue` (map blockType → component).
- **Rewire** `index.vue`, `about.vue`, `contact.vue` → dùng `useAsyncData` + `PageRenderer`.
- **Pages manager** `app/pages/admin/content/pages/index.vue` — list/create/delete.

### Hoàn thành trong phiên này
- **Trình dựng trang** `app/pages/admin/content/pages/[id].vue` — block list với HTML5 drag-and-drop + nút `▲/▼`, toggle ẩn/hiện, edit drawer sinh từ registry `fields` (text/number/textarea/richtext/select/image + image picker), palette thêm block nhóm theo category, drawer meta/SEO. Trang hệ thống khóa slug.
- **Catch-all route** `app/pages/[slug].vue` — mảnh còn thiếu: render trang tùy biến tại slug của nó qua `PageRenderer`, throw 404 thật khi slug không tồn tại (không che 404 thật).
- **Sidebar admin** `app/layouts/admin.vue` — thêm link "Quản lý Trang" gated `pages:read` (1 dòng).
- **Build** sạch; **Docker** rebuild + recreate; seed boot log xác nhận migrate home_sections + seed about/contact.

## 🧪 Kiểm Thử Live (đã pass)

- `GET /api/public/pages/home` → ok, có block; `about` → 2 block; `contact` → 3 block; slug lạ → `{ok:false}`.
- HTTP: `/` `200`, `/about` `200`, `/contact` `200`, slug lạ `404`.
- Lifecycle: login (`POST /api/admin/auth/login`) → tạo trang tùy biến (auto slug) → thêm block → public render `200` + block hiển thị → xóa trang hệ thống chặn `400` → xóa trang tùy biến `200` → route `404` sau xóa.

## 📦 Git

- Commit `20073b4` — `feat: WordPress-style page builder with block system` (36 file, đúng phạm vi; `content-types.vue` để lại cho session khác).
- Push nhánh `feat/category-navigation-system`.
- **Merge vào `main`** bằng fast-forward (`4d8a7c3..20073b4`), gồm 3 commit: page builder, content-types, navigation editors. Local + remote `main` đồng bộ tại `20073b4`.
- Checkout về `main`; working tree còn `content-types.vue` sửa dở (của session khác, không đụng).

## ⚠️ Ràng Buộc Đã Tuân Thủ

- Không thao tác DB phá hủy; migration cộng thêm; seed idempotent.
- Không sửa file ngoài phạm vi (navigation/analytics/chatbot/category = session khác).
- Build secret tạm thời (ephemeral), không ghi file/in ra.
- UI mới dùng Tailwind v3 utility, `<style scoped>` chỉ cho pseudo-element/keyframes/`:deep()`.
- API public read-only, không lộ block ẩn/draft.
- Không tự commit/stage khi chưa được yêu cầu.

## 📝 Cập Nhật Tài Liệu (cuối phiên)

- `CLAUDE.md`: sửa Tailwind v4 → v3, thêm mục Page Builder (kiến trúc + tính năng), bổ sung resource RBAC (`pages`, `categories`, `analytics`, `chatbot_*`), thêm `[slug].vue` + `content/pages/` vào cây thư mục.
- `AGENTS.md`: tạo mới — hướng dẫn cô đọng cho AI agent (giao tiếp, truy xuất codebase, quy tắc code, phạm vi/an toàn, kiến trúc block, chạy thử).
- `ct.md`: file này.
