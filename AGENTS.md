# AGENTS.md — Hướng Dẫn Cho AI Agent (CDKT)

Tài liệu này định hướng cho mọi AI agent làm việc trên repo **Con Đường Hướng Thiện (CDKT)**.
Đọc kèm `CLAUDE.md` (tài liệu hệ thống đầy đủ) và `openspec/ui-dna.md` (DNA thiết kế) trước khi thao tác.

---

## 🗣️ Quy Tắc Giao Tiếp

- **Xưng hô**: luôn gọi người dùng là **"anh yêu"** trong mọi câu trả lời.
- **Ngôn ngữ**: luôn **suy luận/tư duy bằng tiếng Anh**, nhưng luôn **trả lời bằng tiếng Việt**.
- Ngắn gọn, trực tiếp, đúng trọng tâm. Không rào đón thừa.

## 🔍 Truy Xuất Codebase

- Ưu tiên **MCP context-engine (`codebase-retrieval`)** để tìm/hiểu code. **KHÔNG** dùng gitnexus hay grep cho việc khám phá codebase.
- Cần đọc file nhưng chưa biết dòng nào: dùng **file-retrieval MCP** để lấy snippet + số dòng, rồi Read đúng khoảng đó.

## 🛠️ Tech Stack (tóm tắt)

- **Frontend**: Nuxt 4 (Vue 3 SFC, TS, Composition API), **Tailwind CSS v3** (`@nuxtjs/tailwindcss`), FontAwesome 6 Pro (self-hosted).
- **Backend**: Nitro / H3, Drizzle ORM, MySQL 8.0, JWT Auth (cookie `cdkt_admin`).
- **DB init/seed**: `server/db/init.ts` (auto DDL) + `server/db/seed.ts` (auto seed, idempotent).
- **Deploy**: Docker Compose (service `app` + `mysql`), aaPanel/PM2.

## 📐 Quy Tắc Code

- **CSS**: code mới **chỉ dùng Tailwind v3 utility classes**. Không viết `<style scoped>` mới — ngoại lệ duy nhất: pseudo-element (`::before`), keyframes, `:deep()` rich-text. CSS cũ giữ nguyên, không xóa.
- **Đặt tên**: thư mục/file trong `app/pages/` dùng **tiếng Anh**.
- **UI/UX**: mọi thay đổi giao diện phải đọc `openspec/ui-dna.md` trước. Giữ tông xanh lá (theme bocongan.gov.vn).
- **Verify**: sau khi sửa code, chạy build (`npm run build`) trước khi báo xong. Build cần secret tạm thời — không ghi ra file, không in ra:
  ```bash
  ANALYTICS_HMAC_SECRET=$(openssl rand -hex 32) CHATBOT_ENCRYPTION_SECRET=$(openssl rand -hex 32) npm run build
  ```

## 🔒 Phạm Vi & An Toàn

- **Chỉ sửa file trong phạm vi task.** File lạ/không quen = việc đang làm dở của session khác (navigation, analytics, chatbot, category tree...) — KHÔNG đụng vào.
- **DB**: chỉ migration cộng thêm (additive). KHÔNG `DROP`, KHÔNG xóa dữ liệu. Seed phải idempotent (guard trên trạng thái rỗng).
- **Auth/RBAC**: không làm yếu phân quyền. API public là read-only, không lộ draft/unpublished/block ẩn.
- **Git**: chỉ commit/stage khi được yêu cầu rõ ràng. Stage đúng file theo phạm vi, không `git add .` bừa. Cảnh báo file nghi chứa secret (`.env`, credentials) trước khi commit.

## 🧱 Kiến Trúc Page Builder (Block System)

- **Registry** `app/utils/blocks/registry.ts` là nguồn chân lý duy nhất cho block (dùng chung bởi builder UI, server validation, seed).
- **Renderer** `app/components/PageRenderer.vue` map `blockType` → `app/components/blocks/*.vue`.
- **Bảng**: `pages` + `page_blocks` (giữ `home_sections` cũ; seed migrate 1 lần).
- **API**: admin `server/api/admin/pages/**` (gated resource `pages`); public `server/api/public/pages/[slug].get.ts` (chỉ block `isVisible`).
- **Trang hệ thống** (`home`/`about`/`contact`): `isSystem=true` — khóa slug, không xóa được.
- Thêm block mới: khai báo trong registry → tạo component trong `blocks/` → đăng ký vào MAP của `PageRenderer.vue`.

## 🚀 Tài Khoản & Chạy Thử

- Admin URL: `/admin` — tài khoản `admin` / mật khẩu `Admin@123456`.
- Login API: `POST /api/admin/auth/login` (body `{username, password}`), set cookie `cdkt_admin`.
- Docker: `docker compose up -d --build` (service tên `app`, không phải `cdkt_app`); log boot chạy init + seed tự động.
