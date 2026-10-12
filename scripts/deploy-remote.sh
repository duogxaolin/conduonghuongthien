#!/usr/bin/env bash
#
# Chạy TRÊN VPS. Không gọi trực tiếp — `.github/workflows/ci.yml` nạp tệp này
# qua ssh (`bash -s`), nên VPS luôn chạy đúng phiên bản script của commit đang
# được triển khai, chứ không phải bản nào đó nằm sẵn trên máy chủ từ năm ngoái.
#
#   deploy-remote.sh <app-dir> <image-ref> [container] [health-timeout-seconds]
#
# Việc build đã xong ở CI: ở đây chỉ kéo image, trỏ compose vào nó, và xác nhận
# container mới thật sự khoẻ. Không khoẻ thì lùi về image trước đó — một lượt
# deploy hỏng mà vẫn báo thành công là kiểu hỏng tệ nhất, vì không ai đi tìm.
set -euo pipefail

APP_DIR=${1:?thiếu đường dẫn thư mục ứng dụng}
IMAGE=${2:?thiếu tham chiếu image}
CONTAINER=${3:-cdkt_app}
HEALTH_TIMEOUT=${4:-300}

cd "$APP_DIR"

if [ ! -f .env ]; then
  echo "::error::không tìm thấy .env trong $APP_DIR" >&2
  exit 1
fi

TMP_ENV=''
# Không để lệnh cuối của trap quyết định mã thoát của script.
cleanup() { if [ -n "$TMP_ENV" ]; then rm -f "$TMP_ENV"; fi; }
trap cleanup EXIT

current_image() {
  # Dòng cuối thắng, đúng như cách docker compose đọc .env.
  sed -n 's/^CDKT_IMAGE=//p' .env | tail -n 1
}

set_image() {
  # .env giữ toàn bộ bí mật của ứng dụng, nên ghi vào một tệp tạm rồi `mv`
  # nguyên tử: một lần deploy đứt giữa chừng không được để lại .env cụt.
  # `cp -p` để tệp mới thừa hưởng đúng chủ sở hữu và quyền của tệp cũ — một lượt
  # deploy nới quyền .env là một lượt deploy làm lộ bí mật.
  TMP_ENV=$(mktemp ./.env.deploy.XXXXXX)
  cp -p .env "$TMP_ENV"
  { grep -v '^CDKT_IMAGE=' .env || true; } > "$TMP_ENV"
  printf 'CDKT_IMAGE=%s\n' "$1" >> "$TMP_ENV"
  mv "$TMP_ENV" .env
  TMP_ENV=''
}

wait_healthy() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT)) status
  while [ "$SECONDS" -lt "$deadline" ]; do
    status=$(docker inspect \
      --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
      "$CONTAINER" 2>/dev/null || echo missing)
    case "$status" in
      healthy)
        return 0
        ;;
      none)
        # Image của dự án luôn khai HEALTHCHECK, nên "không có" nghĩa là đang
        # chạy nhầm image. Không xác nhận được thì không báo thành công.
        echo "::error::$CONTAINER không khai HEALTHCHECK — không xác nhận được lượt deploy" >&2
        return 1
        ;;
      *)
        sleep 5
        ;;
    esac
  done
  echo "::error::$CONTAINER chưa healthy sau ${HEALTH_TIMEOUT}s (trạng thái cuối: ${status:-unknown})" >&2
  return 1
}

# Volume `uploads_data` được tạo từ image root-cũ thì giữ quyền root, trong khi
# container app chạy bằng user `node` (USER node trong Dockerfile) → ghi file
# upload bị từ chối → 500. Chạy lệnh này bằng root MỘT LẦN để chuyển quyền về node.
# Đặt TẠI ĐÂY trong deploy script chứ không phải hướng dẫn thủ công: CI/CD luồng
# main tự lo việc này mỗi lượt deploy, nên deploy mới không phải chạy tay `chown`
# trên VPS. Idempotent: đã là node thì chown-node giữ nguyên, không lỗi.
# Lệnh KHÔNG nằm trong luồng healthy-check: một lần chown thất bại (volume lạ,
# partition read-only...) không được phép làm hỏng hoặc lùi lượt deploy — file
# cũ vẫn phục vụ được, chỉ upload mới tạm nghẽn cho tới khi admin xử lý.
fix_uploads_ownership() {
  echo "▸ Chuẩn bị quyền ghi thư mục uploads cho user node"
  # `|| true` ngoài: lượt chown thất bại không được làm hỏng hay lùi lượt deploy —
  # file cũ vẫn phục vụ được, chỉ upload mới tạm nghẽn cho tới khi admin xử lý.
  docker compose run --rm --no-deps --user root --entrypoint sh \
    app -c 'chown -R node:node /app/public/uploads' >/dev/null 2>&1 \
    && echo "  ✓ Đã chuyển quyền uploads" \
    || echo "  ::warning::chown uploads thất bại — upload local có thể bị 500 nếu volume vẫn thuộc root" >&2
}

# Migration: TRUSTED_PROXY_IPS cũ dùng IP cố định (172.17.0.1, 172.18.0.1,
# 172.21.0.1...) — Docker gateway IP thay đổi theo network name, nên đặt sai
# là lỗi IM LẶNG: mọi visitor ghi cùng IP gateway, rate limit gộp 1 bucket,
# IP ban không trúng ai. Đổi sang CIDR 172.16.0.0/12 cover toàn dải Docker
# private. Idempotent: đã là CIDR hoặc rỗng thì không đụng.
migrate_trusted_proxy_ips() {
  local current trusted_cidr='172.16.0.0/12'
  current=$(sed -n 's/^TRUSTED_PROXY_IPS=//p' .env | tail -n 1 | tr -d "'\"")
  # Rỗng hoặc đã là CIDR (có dấu /) → bỏ qua
  [ -z "$current" ] && return 0
  case "$current" in
    */*) return 0 ;;  # đã là CIDR, không đụng
  esac
  echo "▸ Nâng cấp TRUSTED_PROXY_IPS: '$current' → '$trusted_cidr' (CIDR)"
  TMP_ENV=$(mktemp ./.env.deploy.XXXXXX)
  cp -p .env "$TMP_ENV"
  { grep -v '^TRUSTED_PROXY_IPS=' .env || true; } > "$TMP_ENV"
  printf 'TRUSTED_PROXY_IPS=%s\n' "$trusted_cidr" >> "$TMP_ENV"
  mv "$TMP_ENV" .env
  TMP_ENV=''
}

# Kéo image TRƯỚC khi đụng vào .env: registry hỏng, tag sai, hay mất mạng thì
# deployment đang chạy không bị sứt mẻ gì.
echo "▸ Kéo $IMAGE"
migrate_trusted_proxy_ips

docker pull "$IMAGE"

PREVIOUS=$(current_image)
echo "▸ Image hiện tại: ${PREVIOUS:-(chưa đặt)}"

set_image "$IMAGE"

echo "▸ Khởi động lại app"
docker compose up -d app

if wait_healthy; then
  echo "✅ $CONTAINER healthy trên $IMAGE"
  # Volume uploads_data tạo từ image root-cũ giữ quyền root; container app chạy
  # bằng node nên ghi upload bị 500. Chạy một lượt chown tự động để không phải
  # SSH vào máy sửa tay sau mỗi lần kéo image mới.
  fix_uploads_ownership
  # Giữ lịch sử một tuần để còn lùi được; dọn phần cũ hơn cho khỏi đầy đĩa.
  docker image prune -f --filter 'until=168h' >/dev/null 2>&1 || true
  exit 0
fi

echo "▸ Lùi lại image trước đó" >&2
docker logs --tail 60 "$CONTAINER" 2>&1 | sed 's/^/    /' >&2 || true

if [ -z "$PREVIOUS" ]; then
  # Lượt deploy đầu tiên: không có gì để lùi về. Nói thẳng ra thay vì im lặng.
  echo "::error::không có image trước đó để lùi về — container đang ở trạng thái lỗi" >&2
  exit 1
fi

set_image "$PREVIOUS"
docker compose up -d app
if wait_healthy; then
  echo "::error::deploy thất bại, đã lùi về $PREVIOUS và dịch vụ đã khoẻ trở lại" >&2
else
  echo "::error::deploy thất bại VÀ lượt lùi về $PREVIOUS cũng không khoẻ — cần vào máy chủ xử lý" >&2
fi
exit 1
