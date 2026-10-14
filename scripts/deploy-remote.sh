#!/usr/bin/env bash
#
# Chạy TRÊN VPS. Không gọi trực tiếp — `.github/workflows/ci.yml` nạp tệp này
# qua ssh (`bash -s`), nên VPS luôn chạy đúng phiên bản script của commit đang
# được triển khai, chứ không phải bản nào đó nằm sẵn trên máy chủ từ năm ngoái.
#
#   [INCOMING_COMPOSE=<tệp> INCOMING_COMPOSE_SHA256=<hex>] \
#     deploy-remote.sh <app-dir> <image-ref> [container] [health-timeout-seconds]
#
# Việc build đã xong ở CI: ở đây chỉ kéo image, đặt docker-compose.yml của đúng
# commit đó vào chỗ, trỏ compose vào image, và xác nhận container mới thật sự
# khoẻ. Không khoẻ thì lùi về image (và compose) trước đó — một lượt deploy hỏng
# mà vẫn báo thành công là kiểu hỏng tệ nhất, vì không ai đi tìm.
#
# INCOMING_COMPOSE (đường dẫn tương đối với <app-dir>) là docker-compose.yml mà
# CI vừa gửi lên. Không đặt thì giữ nguyên tệp đang có — chỉ dành cho lượt chạy
# tay; CI luôn đặt, kèm SHA-256 để phát hiện tệp bị cụt trên đường truyền.
set -euo pipefail

APP_DIR=${1:?thiếu đường dẫn thư mục ứng dụng}
IMAGE=${2:?thiếu tham chiếu image}
CONTAINER=${3:-cdkt_app}
HEALTH_TIMEOUT=${4:-300}
INCOMING_COMPOSE=${INCOMING_COMPOSE:-}
INCOMING_COMPOSE_SHA256=${INCOMING_COMPOSE_SHA256:-}

# Tên tệp compose mặc định mà mọi lệnh `docker compose` ở đây (và lệnh gõ tay
# của người vận hành) đọc. Không đặt tên biến là COMPOSE_FILE: docker compose
# tự đọc biến môi trường đó.
LIVE_COMPOSE=docker-compose.yml
COMPOSE_BACKUP_DIR=.deploy-compose-backups
COMPOSE_BACKUP_KEEP=10

cd "$APP_DIR"

TMP_ENV=''
TMP_COMPOSE=''
# Bản sao lưu compose của CHÍNH lượt này — rỗng nghĩa là compose không đổi (hoặc
# trước đó chưa có), nên đường lùi không có gì để trả về.
COMPOSE_BACKUP=''
# Không để lệnh cuối của trap quyết định mã thoát của script.
cleanup() {
  if [ -n "$TMP_ENV" ]; then rm -f "$TMP_ENV"; fi
  if [ -n "$TMP_COMPOSE" ]; then rm -f "$TMP_COMPOSE"; fi
  # Tệp CI gửi lên không bao giờ được nằm lại: lượt sau phải nhận bản của nó.
  if [ -n "$INCOMING_COMPOSE" ]; then rm -f "$INCOMING_COMPOSE"; fi
}
trap cleanup EXIT

if [ ! -f .env ]; then
  echo "::error::không tìm thấy .env trong $APP_DIR" >&2
  exit 1
fi

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

sha256_of() { sha256sum "$1" | cut -d' ' -f1; }

# Kiểm tệp compose CI gửi lên TRƯỚC mọi việc khác — chưa kéo image, chưa đụng
# tệp nào. Một phiên SSH đứt giữa chừng để lại tệp cụt, và YAML cắt ở ranh giới
# dòng vẫn có thể hợp lệ (thiếu nửa danh sách biến môi trường): chỉ so SHA-256
# mới phân biệt được "tệp của commit này" với "một phần của nó".
verify_incoming_compose() {
  if [ -z "$INCOMING_COMPOSE" ]; then
    echo "  ::warning::không có INCOMING_COMPOSE — giữ nguyên $LIVE_COMPOSE đang có trên máy chủ (chỉ hợp lệ cho lượt chạy tay)" >&2
    return 0
  fi
  if [ ! -f "$INCOMING_COMPOSE" ]; then
    echo "::error::không tìm thấy tệp compose CI gửi lên: $APP_DIR/$INCOMING_COMPOSE" >&2
    exit 1
  fi
  if [ -z "$INCOMING_COMPOSE_SHA256" ]; then
    echo "::error::thiếu INCOMING_COMPOSE_SHA256 — không xác nhận được tệp compose còn nguyên vẹn" >&2
    exit 1
  fi
  local actual
  actual=$(sha256_of "$INCOMING_COMPOSE")
  if [ "$actual" != "$INCOMING_COMPOSE_SHA256" ]; then
    echo "::error::tệp compose nhận được bị hỏng trên đường truyền (sha256 $actual, mong đợi $INCOMING_COMPOSE_SHA256)" >&2
    exit 1
  fi
}

# Thay nội dung $LIVE_COMPOSE bằng tệp $1 theo kiểu nguyên tử, giữ chủ sở hữu và
# quyền của tệp cũ — cùng cách set_image ghi .env.
write_live_compose() {
  TMP_COMPOSE=$(mktemp ./.docker-compose.deploy.XXXXXX)
  if [ -f "$LIVE_COMPOSE" ]; then
    cp -p "$LIVE_COMPOSE" "$TMP_COMPOSE"
  else
    chmod 644 "$TMP_COMPOSE"
  fi
  cat "$1" > "$TMP_COMPOSE"
  mv "$TMP_COMPOSE" "$LIVE_COMPOSE"
  TMP_COMPOSE=''
}

# Đặt compose của commit đang triển khai vào chỗ và để chính docker compose xác
# nhận nó đọc được với .env của máy chủ này. Kiểm trên tệp THẬT (không phải
# `-f tệp-mới`) vì chỉ như vậy mới gồm cả docker-compose.override.yml nếu máy chủ
# có — tức đúng cấu hình mà `up` sẽ dùng. `config -q` cũng là chỗ bắt một biến
# bắt buộc mới (`${VAR:?…}`) mà .env trên VPS chưa có.
#
# Hỏng thì trả tệp cũ về ngay và dừng: chưa container nào, chưa dòng .env nào
# bị đụng.
install_compose() {
  if [ -z "$INCOMING_COMPOSE" ]; then
    return 0
  fi
  if [ -f "$LIVE_COMPOSE" ] && [ "$(sha256_of "$LIVE_COMPOSE")" = "$INCOMING_COMPOSE_SHA256" ]; then
    echo "▸ $LIVE_COMPOSE đã khớp commit này — không đổi"
    return 0
  fi

  if [ -f "$LIVE_COMPOSE" ]; then
    mkdir -p "$COMPOSE_BACKUP_DIR"
    COMPOSE_BACKUP="$COMPOSE_BACKUP_DIR/docker-compose.$(date -u +%Y%m%dT%H%M%SZ).yml"
    cp -p "$LIVE_COMPOSE" "$COMPOSE_BACKUP"
    echo "▸ Sao lưu $LIVE_COMPOSE cũ → $COMPOSE_BACKUP"
  fi

  echo "▸ Đặt $LIVE_COMPOSE của commit này"
  write_live_compose "$INCOMING_COMPOSE"

  if ! docker compose config -q; then
    echo "::error::$LIVE_COMPOSE mới không qua \`docker compose config\` trên máy chủ này — đã trả bản cũ về, chưa chạm container nào" >&2
    restore_compose
    exit 1
  fi

  prune_compose_backups
  notice_git_checkout
}

restore_compose() {
  if [ -z "$COMPOSE_BACKUP" ]; then
    return 0
  fi
  echo "▸ Trả $LIVE_COMPOSE về bản trước ($COMPOSE_BACKUP)" >&2
  write_live_compose "$COMPOSE_BACKUP"
}

# Giữ COMPOSE_BACKUP_KEEP bản gần nhất. Tên chứa dấu thời gian UTC dạng sắp xếp
# được, nên thứ tự glob (theo chữ cái) cũng là thứ tự thời gian: cũ nhất trước.
prune_compose_backups() {
  local backups excess
  backups=("$COMPOSE_BACKUP_DIR"/docker-compose.*.yml)
  excess=$(( ${#backups[@]} - COMPOSE_BACKUP_KEEP ))
  if [ "$excess" -gt 0 ]; then
    rm -f -- "${backups[@]:0:excess}"
  fi
}

# Thư mục ứng dụng trên VPS thường là một bản clone git (`./manage.sh` → Update
# chạy `git pull`). Ghi đè một tệp được git theo dõi làm cây làm việc "bẩn", và
# `git pull` sẽ từ chối khi lượt kéo đó cũng đổi docker-compose.yml. Tệp vừa đặt
# luôn là bản đã commit của một commit trên `main`, nên bỏ thay đổi cục bộ trước
# khi pull là an toàn. Chỉ nhắc, không tự đụng vào git: script này không có
# quyền quyết định cây làm việc của người vận hành.
notice_git_checkout() {
  if command -v git >/dev/null 2>&1 \
    && git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
    && ! git diff --quiet HEAD -- "$LIVE_COMPOSE" >/dev/null 2>&1; then
    echo "  ℹ $LIVE_COMPOSE khác bản trong git HEAD (CI quản lý tệp này). Trước khi git pull: git checkout -- $LIVE_COMPOSE"
  fi
}

# Khởi động lại CHỈ app. Từ khi compose đi theo mỗi lượt deploy, định nghĩa của
# service mysql cũng có thể đổi — và `docker compose up -d app` trơn sẽ tạo lại
# cả mysql (phụ thuộc của app) khi cấu hình của nó lệch, tức là mỗi lượt merge
# có thể khởi động lại CSDL. `--no-recreate mysql` giữ đúng phần việc cũ còn
# đáng giữ (bật mysql nếu nó đang dừng) mà không bao giờ tạo lại nó; thay đổi ở
# service mysql là việc người vận hành chủ động làm (`docker compose up -d`).
#
# `|| return 1` tường minh vì hàm được gọi trong điều kiện `if` — ở đó `set -e`
# không có hiệu lực, và một lệnh `up` hỏng phải đi vào đường lùi chứ không được
# để lệnh sau che mất. (Trước đây `up` hỏng làm script thoát ngay dưới `set -e`,
# bỏ qua đường lùi, để .env trỏ vào image mới.)
start_app() {
  docker compose up -d --no-recreate mysql || return 1
  docker compose up -d --no-deps app || return 1
}

# Không có gì ở đây chạm vào máy chủ trước khi tệp compose được xác nhận nguyên vẹn.
verify_incoming_compose

# Kéo image TRƯỚC khi đụng vào .env hay docker-compose.yml: registry hỏng, tag
# sai, hay mất mạng thì deployment đang chạy không bị sứt mẻ gì.
echo "▸ Kéo $IMAGE"
docker pull "$IMAGE"

install_compose

migrate_trusted_proxy_ips

PREVIOUS=$(current_image)
echo "▸ Image hiện tại: ${PREVIOUS:-(chưa đặt)}"

set_image "$IMAGE"

echo "▸ Khởi động lại app"
if start_app && wait_healthy; then
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

# Lùi CẢ compose lẫn image: image trước chạy trên compose trước — đúng cặp đã
# từng khoẻ — chứ không phải trên tệp compose vừa thất bại cùng image mới.
restore_compose
set_image "$PREVIOUS"
if start_app && wait_healthy; then
  echo "::error::deploy thất bại, đã lùi về $PREVIOUS và dịch vụ đã khoẻ trở lại" >&2
else
  echo "::error::deploy thất bại VÀ lượt lùi về $PREVIOUS cũng không khoẻ — cần vào máy chủ xử lý" >&2
fi
exit 1
