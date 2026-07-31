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

# Kéo image TRƯỚC khi đụng vào .env: registry hỏng, tag sai, hay mất mạng thì
# deployment đang chạy không bị sứt mẻ gì.
echo "▸ Kéo $IMAGE"
docker pull "$IMAGE"

PREVIOUS=$(current_image)
echo "▸ Image hiện tại: ${PREVIOUS:-(chưa đặt)}"

set_image "$IMAGE"

echo "▸ Khởi động lại app"
docker compose up -d app

if wait_healthy; then
  echo "✅ $CONTAINER healthy trên $IMAGE"
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
