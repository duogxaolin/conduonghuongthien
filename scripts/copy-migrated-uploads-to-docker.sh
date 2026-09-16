#!/usr/bin/env bash
# Script copy ảnh migrated (3.212 file ~638MB) vào Docker container/volume
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -d "public/uploads/migrated" ]; then
  echo "❌ Thư mục public/uploads/migrated không tồn tại trên máy chủ."
  exit 1
fi

CONTAINER_ID=$(docker compose ps -q app 2>/dev/null || true)
if [ -z "$CONTAINER_ID" ]; then
  echo "⚠️ Container 'app' chưa chạy. Khởi động dịch vụ trước:"
  echo "    docker compose up -d"
  exit 1
fi

echo "📦 Đang copy public/uploads/migrated vào container app (/app/public/uploads/migrated/)..."
docker compose exec -T app mkdir -p /app/public/uploads/migrated
docker cp public/uploads/migrated/. "$CONTAINER_ID":/app/public/uploads/migrated/

echo "🔒 Đặt quyền sở hữu cho node user bên trong container..."
docker compose exec -T app chown -R node:node /app/public/uploads/migrated || true

echo "✅ Hoàn tất copy ảnh migrated vào Docker volume! Kiểm tra danh mục:"
docker compose exec -T app ls -la /app/public/uploads/migrated
