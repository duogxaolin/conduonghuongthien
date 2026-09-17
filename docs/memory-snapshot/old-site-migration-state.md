---
name: old-site-migration-state
description: "Trạng thái migrate data cổng cũ conduonghuongthien.com.vn (ASP.NET → Nuxt 4 CDKT) — đã import xong, còn việc rollout lên production"
metadata: 
  node_type: memory
  type: project
  originSessionId: 37829743-3845-41bd-9707-d4f783ec3314
  modified: 2026-09-03T09:37:56.269Z
---

Migration dữ liệu cổng cũ ASP.NET (`old-data/`, backup SQL Server qua container `cdkt-mssql-migrate` port 14333, DB `cdkt_old`) sang Nuxt 4. **Đã xong bản local ngày 2026-09-03**:

- 1132 bài (1121 published + 11 draft, loại 10 bài test/lorem ID 10468–10498), lượt xem đúng 159.825 (một hàng `article_view_daily` ngày migrate, source `direct`), ID bài giữ nguyên NewsID cũ.
- Ảnh: 3212 file ~638 MB trong `public/uploads/migrated/` (thumbnails theo YYYY/MM + ảnh nội dung trong `media/`, key theo basename).
- Slug cũ giữ nguyên (bỏ `/` đầu + `.html`); **19 stem bị 2–3 bài dùng chung** → suffix `-2/-3` theo thứ tự import.
- **54 bài video có Alias_Url là link YouTube/Facebook** (không có URL nội bộ) — ban đầu import lấy nguyên URL làm slug (51 bài published hỏng slug), đã sửa bằng `node .migrate/fix-ext-slugs.mjs` sinh slug từ tiêu đề.
- Chuyển hướng 301 cổng cũ: `server/utils/legacy-urls.ts` (hàm thuần) + `server/middleware/legacy-urls.ts`, test `tests/legacy-urls.test.ts` (15 test). Bảng đích: `/gioi-thieu→/about`, `/lien-he→/contact`, `/ban-tin|/tin-noi-bat|/thu-vien-anh-video→/news`, `/tam-guong-tieu-bieu→/role-models`, `/mo-hinh-tai-hoa-nhap-cong-dong→/reintegration-models`, `/van-ban→/documents`, `/giai-dap-phap-luat→/legal-qa`, bài `/<stem>.html→/news/<stem>`.
- Script migrate nằm trong `.migrate/` (export-old, import-new, fix-ext-slugs, make-env...). Local build chạy: `set -a && source .env && set +a && node .output/server/index.mjs`.

- **Đã hoàn thành 2026-09-15**:
  - Script copy ảnh lên Docker volume: `scripts/copy-migrated-uploads-to-docker.sh` (hướng dẫn trong `DEPLOY.md` Bước 4c).
  - Xuất báo cáo chi tiết 366 bài viết thiếu file ảnh nguồn: `docs/migration-unresolved-images-report.csv` và `docs/migration-unresolved-images-report.md` (tạo bởi `scripts/export-missing-userfile-articles.mjs`).

