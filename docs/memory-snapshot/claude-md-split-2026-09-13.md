---
name: claude-md-split-2026-09-13
description: CLAUDE.md tách diễn giải vì-sao ra docs/decisions/ để giảm dưới trần 150k ký tự
metadata: 
  node_type: memory
  type: project
  originSessionId: 8a1eee68-5b08-4a88-991f-1e1a726e03f8
  modified: 2026-09-13T11:09:22.455Z
---

CLAUDE.md từng vượt trần 150k ký tự (178,7k → nay 143,6k). Diễn giải chi tiết (lịch sử bug, kiểm chứng âm tính, A/B đo trên máy chủ thật) đã chuyển sang `docs/decisions/` — 4 tệp + README:

- `docs/decisions/data-layer.md` — TDZ, insertId mảng, affectedRows, finitePositive, slugify, audit nguyên tử, openNewTab, validateIdTokenClaims
- `docs/decisions/reader-features.md` — Đăng nhập Google & bình luận, /profile, thông báo trả lời, xoá cascade, two-rail vé người đọc, last_seen_at
- `docs/decisions/chatbot.md` — Hai kho (nghiệp vụ + thường nhật), matcher, typewriter (sàn/trần), vé phiên HMAC, qa-documents, phiên trò chuyện
- `docs/decisions/realm-safety.md` — Favicon (byte-sai, .ico, hai allowlist), upload magic-byte, drift ensureColumn, as-unknown-as, globalThis.useRuntimeConfig, lang="ts" 43 tệp, CI

**Why:** Harness báo lỗi "CLAUDE.md is over the 150.0k-char limit". `/memory` không giúp được đây là tài liệu dự án, không phải memory cá nhân.

**How to apply:** CLAUDE.md giữ **quy tắc hành động** (MAI PHẢI/KHÔNG ĐƯỢC, cờ chặn, vị trí test, thứ tự triển khai, runbook) — kèm con trỏ `docs/decisions/<tệp>.md` (mục "..."). Khi cần hiểu **vì sao** một quy tắc tồn tại hoặc tiền sử bug đã trả giá, đọc `docs/decisions/`. Khi sửa mã, đọc `CLAUDE.md`. Thêm quy tắc mới → vào CLAUDE.md; thêm diễn giải vì-sao dài → vào decisions. Đừng lấp lại diễn giải dài vào CLAUDE.md. Liên kết [[responsive-audit-2026-09-08]].
