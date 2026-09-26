#!/bin/sh
set -e
# Bind mount ./backups giữ nguyên owner của host — nếu host tạo bằng root
# thì /app/backups là root:root và user `node` không ghi được → EACCES.
# Entrypoint chạy lúc đầu còn là root nên sửa được, rồi mới hạ quyền xuống `node`.
for d in /app/backups /app/public/uploads /var/lib/cdkt; do
  if [ -d "$d" ]; then
    chown -R node:node "$d" 2>/dev/null || true
  else
    mkdir -p "$d" 2>/dev/null || true
    chown -R node:node "$d" 2>/dev/null || true
  fi
done
exec su-exec node "$@"
