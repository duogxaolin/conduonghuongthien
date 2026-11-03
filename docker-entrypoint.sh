#!/bin/sh
set -e
# Bind mount ./backups giữ nguyên owner của host — nếu host tạo bằng root
# thì /app/backups là root:root và user `node` không ghi được → EACCES.
# Entrypoint chạy lúc đầu còn là root nên sửa được, rồi mới hạ quyền xuống `node`.
#
# Chỉ `chown -R` một cây khi GỐC của nó chưa thuộc node: uploads/media có thể hàng
# chục GB, và đi hết cây đó ở MỖI lần khởi động (mỗi deploy, mỗi restart) là việc
# vô ích khi nó đã đúng. /var/lib/cdkt/media nêu riêng vì nó là điểm gắn volume
# `media_work`, nằm dưới /var/lib/cdkt (thư mục của image, luôn thuộc node) — chỉ
# xét thư mục cha thì volume không bao giờ được sửa.
for d in /app/backups /app/public/uploads /var/lib/cdkt /var/lib/cdkt/media; do
  mkdir -p "$d" 2>/dev/null || true
  if [ "$(stat -c %U "$d" 2>/dev/null)" != node ]; then
    chown -R node:node "$d" 2>/dev/null || true
  fi
done
exec su-exec node "$@"
