#!/usr/bin/env bash
#
# Chạy TRÊN VPS. Không gọi trực tiếp — `.github/workflows/ci.yml` nạp tệp này
# qua ssh (`bash -s`), nên VPS luôn chạy đúng phiên bản script của commit đang
# được triển khai, chứ không phải bản nào đó nằm sẵn trên máy chủ từ năm ngoái.
#
#   [INCOMING_COMPOSE=<tệp> INCOMING_COMPOSE_SHA256=<hex>] \
#   [INCOMING_BACKUP_SCRIPT=<tệp> INCOMING_BACKUP_SCRIPT_SHA256=<hex>] \
#     deploy-remote.sh <app-dir> <image-ref> [container] [health-timeout-seconds]
#
# Việc build đã xong ở CI: ở đây chỉ kéo image, sao lưu CSDL, đặt
# docker-compose.yml của đúng commit đó vào chỗ, trỏ compose vào image, và xác nhận
# container mới thật sự khoẻ. Không khoẻ thì lùi về image (và compose) trước đó —
# một lượt deploy hỏng mà vẫn báo thành công là kiểu hỏng tệ nhất, vì không ai đi tìm.
#
# INCOMING_COMPOSE (đường dẫn tương đối với <app-dir>) là docker-compose.yml mà
# CI vừa gửi lên. Không đặt thì giữ nguyên tệp đang có — chỉ dành cho lượt chạy
# tay; CI luôn đặt, kèm SHA-256 để phát hiện tệp bị cụt trên đường truyền.
#
# INCOMING_BACKUP_SCRIPT là scripts/backup-db.sh của CHÍNH commit này, CI gửi vào
# .deploy-incoming/ (một cấp dưới <app-dir>, nên script tự tìm đúng .env). Bản
# trong bản clone git trên VPS chỉ mới khi có người `git pull` — có thể là bản
# chưa biết `--prefix`. Không đặt (lượt chạy tay) thì dùng scripts/backup-db.sh.
set -euo pipefail

APP_DIR=${1:?thiếu đường dẫn thư mục ứng dụng}
IMAGE=${2:?thiếu tham chiếu image}
CONTAINER=${3:-cdkt_app}
HEALTH_TIMEOUT=${4:-300}
INCOMING_COMPOSE=${INCOMING_COMPOSE:-}
INCOMING_COMPOSE_SHA256=${INCOMING_COMPOSE_SHA256:-}
INCOMING_BACKUP_SCRIPT=${INCOMING_BACKUP_SCRIPT:-}
INCOMING_BACKUP_SCRIPT_SHA256=${INCOMING_BACKUP_SCRIPT_SHA256:-}
# Nhịp hỏi trạng thái container (giây). Chỉ test rút ngắn — cùng tên biến với
# manage.sh.
HEALTH_INTERVAL=${CDKT_HEALTH_INTERVAL:-5}

# Tên tệp compose mặc định mà mọi lệnh `docker compose` ở đây (và lệnh gõ tay
# của người vận hành) đọc. Không đặt tên biến là COMPOSE_FILE: docker compose
# tự đọc biến môi trường đó.
LIVE_COMPOSE=docker-compose.yml
COMPOSE_BACKUP_DIR=.deploy-compose-backups
COMPOSE_BACKUP_KEEP=10
# Bản dump CSDL trước mỗi lượt đổi image. Cạnh .deploy-compose-backups/ chứ không
# trong ./backups: ./backups là bind mount mà entrypoint của container giao cho
# user `node` (uid 1000) mỗi lần khởi động, nên user deploy của CI (root, hoặc một
# user thuộc group docker) không chắc ghi được vào đó; thư mục ứng dụng thì lượt
# deploy vốn đã phải ghi được (.env, compose). backup-db.sh giữ PREFIX_KEEP=5 bản.
PREDEPLOY_DIR=.deploy-db-backups
PREDEPLOY_PREFIX=cdkt-predeploy
# Container khởi động lại quá số lần này trong lúc chờ healthy = crash loop.
MAX_RESTARTS=2
# Sau một lượt khoẻ: giữ image đang chạy + IMAGE_KEEP bản sha-* mới nhất khác.
IMAGE_KEEP=5
DISK_WARN_PCT=80

cd "$APP_DIR"

TMP_ENV=''
TMP_COMPOSE=''
# Tệp tạm của override log dự phòng giữa `mktemp` và `mv` (ensure_log_driver).
LOG_FALLBACK_TMP=''
# Bản sao lưu compose của CHÍNH lượt này — rỗng nghĩa là compose không đổi (hoặc
# trước đó chưa có), nên đường lùi không có gì để trả về.
COMPOSE_BACKUP=''
# Đã in log container rồi (wait_healthy gặp crash loop) — đường lùi khỏi in lại.
LOGS_SHOWN=''
# Không để lệnh cuối của trap quyết định mã thoát của script.
cleanup() {
  if [ -n "$TMP_ENV" ]; then rm -f "$TMP_ENV"; fi
  if [ -n "$TMP_COMPOSE" ]; then rm -f "$TMP_COMPOSE"; fi
  if [ -n "$LOG_FALLBACK_TMP" ]; then rm -f "$LOG_FALLBACK_TMP"; fi
  # Tệp CI gửi lên không bao giờ được nằm lại: lượt sau phải nhận bản của nó.
  if [ -n "$INCOMING_COMPOSE" ]; then rm -f "$INCOMING_COMPOSE"; fi
  if [ -n "$INCOMING_BACKUP_SCRIPT" ]; then
    rm -f "$INCOMING_BACKUP_SCRIPT"
    rmdir "$(dirname "$INCOMING_BACKUP_SCRIPT")" 2>/dev/null || true
  fi
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

show_container_logs() {
  { docker logs --tail 60 "$CONTAINER" 2>&1 | sed 's/^/    /' >&2; } || true
  LOGS_SHOWN=1
}

# Số lần Docker đã khởi động lại container (chính sách `restart: always`). Không
# đọc được / không phải số → 0: một lần inspect hỏng không được biến thành
# "crash loop" và kéo theo một lượt lùi oan.
restart_count() {
  local n
  n=$(docker inspect --format '{{.RestartCount}}' "$CONTAINER" 2>/dev/null || true)
  case "$n" in ''|*[!0-9]*) n=0 ;; esac
  echo "$n"
}

wait_healthy() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT)) status base restarts
  # Mốc tính từ LẦN CHỜ NÀY: compose không tạo lại một container không đổi gì, nên
  # con số tuyệt đối có thể đã cao từ nhiều ngày trước.
  base=$(restart_count)
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
        # Container chết ngay khi khởi động (thiếu biến, migration hỏng…) được
        # Docker dựng lại liên tục và không bao giờ "unhealthy" đủ lâu: chờ hết
        # HEALTH_TIMEOUT là 5 phút vô ích trước khi lùi. Quá MAX_RESTARTS lần thì
        # dừng chờ ngay, in log, để đường lùi sẵn có chạy.
        restarts=$(( $(restart_count) - base ))
        if [ "$restarts" -gt "$MAX_RESTARTS" ]; then
          echo "::error::$CONTAINER đã khởi động lại $restarts lần trong lúc chờ healthy — crash loop, không chờ hết ${HEALTH_TIMEOUT}s" >&2
          show_container_logs
          return 1
        fi
        sleep "$HEALTH_INTERVAL"
        ;;
    esac
  done
  echo "::error::$CONTAINER chưa healthy sau ${HEALTH_TIMEOUT}s (trạng thái cuối: ${status:-unknown})" >&2
  return 1
}

# Volume `uploads_data` được tạo từ image root-cũ thì giữ quyền root, trong khi
# tiến trình app chạy bằng user `node` (entrypoint hạ quyền bằng su-exec) → ghi file
# upload bị từ chối → 500. Entrypoint đã tự sửa lúc khởi động; đây là lưới thứ hai,
# chạy sau mỗi lượt deploy khoẻ để không ai phải SSH vào sửa tay.
#
# Chỉ `chown -R` khi GỐC cây chưa thuộc node: cây uploads có thể hàng chục GB, và đi
# hết nó mỗi lượt deploy là việc vô ích. Hỏi qua `docker exec` vào container vừa
# khoẻ — không dựng một container một-lần chỉ để đọc tên chủ sở hữu.
# KHÔNG nằm trong luồng healthy-check: một lần chown thất bại (volume lạ, partition
# read-only...) không được phép làm hỏng hoặc lùi lượt deploy — file cũ vẫn phục vụ
# được, chỉ upload mới tạm nghẽn cho tới khi admin xử lý.
fix_uploads_ownership() {
  local owner
  owner=$(docker exec "$CONTAINER" stat -c %U /app/public/uploads 2>/dev/null || true)
  if [ "$owner" = node ]; then
    return 0
  fi
  echo "▸ uploads thuộc '${owner:-?}' — chuyển quyền cho user node"
  if docker exec -u root "$CONTAINER" chown -R node:node /app/public/uploads >/dev/null 2>&1; then
    echo "  ✓ Đã chuyển quyền uploads"
  else
    echo "  ::warning::chown uploads thất bại — upload local có thể bị 500 nếu volume vẫn thuộc root" >&2
  fi
}

# Sau một lượt deploy khoẻ: gỡ image app cũ THEO THẺ. `docker image prune` chỉ dọn
# layer lơ lửng, không bao giờ gỡ image còn thẻ — mỗi lượt deploy để lại một image
# sha-* nguyên vẹn, và đĩa VPS đầy dần. Giữ image đang chạy + IMAGE_KEEP bản sha-*
# mới nhất khác (đích lùi tay), xét theo thời điểm tạo; chỉ xét thẻ `sha-*` của
# CHÍNH repo image này, nên thẻ lùi `cdkt-rollback/app:*` của manage.sh không bao giờ
# lọt vào. `docker image rm` không `-f`: image còn container dùng thì Docker từ chối,
# và lời từ chối đó đúng. Cùng hàm với production/manage.sh (Update).
#
# Không lệnh nào ở đây được làm hỏng một lượt deploy đã thành công: hàm được gọi
# với `|| true`, mọi lỗi chỉ thành cảnh báo.
prune_app_images() {
  local repo="${1%:*}" running_id tag line
  local -a rows=() sorted=()
  running_id=$(docker image inspect --format '{{.Id}}' "$1" 2>/dev/null || true)
  if [ -z "$running_id" ]; then
    echo "  ::warning::không đọc được ID của $1 — bỏ qua bước dọn image" >&2
    return 0
  fi
  while IFS= read -r tag; do
    case "$tag" in
      sha-*) ;;
      *) continue ;;
    esac
    line=$(docker image inspect --format '{{.Created}} {{.Id}}' "$repo:$tag" 2>/dev/null || true)
    if [ -z "$line" ] || [ "${line##* }" = "$running_id" ]; then
      continue
    fi
    rows+=("${line%% *} $tag")
  done < <(docker image ls --format '{{.Tag}}' "$repo" 2>/dev/null || true)
  if [ "${#rows[@]}" -gt "$IMAGE_KEEP" ]; then
    # Thời điểm tạo dạng RFC 3339 UTC: so chữ là so thời gian. Mới nhất trước.
    mapfile -t sorted < <(printf '%s\n' "${rows[@]}" | sort -r)
    for line in "${sorted[@]:IMAGE_KEEP}"; do
      tag=${line##* }
      if docker image rm "$repo:$tag" >/dev/null 2>&1; then
        echo "  ✓ Gỡ image cũ $repo:$tag"
      else
        echo "  ::warning::không gỡ được $repo:$tag (còn container dùng?) — để lại" >&2
      fi
    done
  fi
  docker image prune -f >/dev/null 2>&1 || true
}

# Cảnh báo (không chặn) khi đĩa chứa dữ liệu Docker sắp đầy: image, volume
# uploads/media và log container đều nằm trên đó.
warn_disk_usage() {
  local root pct
  root=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)
  root=${root:-/var/lib/docker}
  pct=$(df --output=pcent "$root" 2>/dev/null | tail -n 1 | tr -dc '0-9' || true)
  if [ -n "$pct" ] && [ "$pct" -gt "$DISK_WARN_PCT" ]; then
    echo "::warning::đĩa chứa dữ liệu Docker ($root) đã dùng ${pct}% (ngưỡng ${DISK_WARN_PCT}%) — dọn image/backup cũ trước khi đầy"
  fi
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

# Cùng phép kiểm cho scripts/backup-db.sh mà CI gửi kèm: một tệp cụt vẫn có thể là
# bash chạy được (đứt ở ranh giới dòng), và một bước sao lưu chạy nửa vời thì tệ
# hơn không chạy.
verify_incoming_backup_script() {
  if [ -z "$INCOMING_BACKUP_SCRIPT" ]; then
    echo "  ::warning::không có INCOMING_BACKUP_SCRIPT — dùng scripts/backup-db.sh của bản clone trên máy chủ (chỉ hợp lệ cho lượt chạy tay)" >&2
    return 0
  fi
  if [ ! -f "$INCOMING_BACKUP_SCRIPT" ]; then
    echo "::error::không tìm thấy script sao lưu CI gửi lên: $APP_DIR/$INCOMING_BACKUP_SCRIPT" >&2
    exit 1
  fi
  if [ -z "$INCOMING_BACKUP_SCRIPT_SHA256" ]; then
    echo "::error::thiếu INCOMING_BACKUP_SCRIPT_SHA256 — không xác nhận được script sao lưu còn nguyên vẹn" >&2
    exit 1
  fi
  local actual
  actual=$(sha256_of "$INCOMING_BACKUP_SCRIPT")
  if [ "$actual" != "$INCOMING_BACKUP_SCRIPT_SHA256" ]; then
    echo "::error::script sao lưu nhận được bị hỏng trên đường truyền (sha256 $actual, mong đợi $INCOMING_BACKUP_SCRIPT_SHA256)" >&2
    exit 1
  fi
}

# Dump CSDL TRƯỚC khi đổi bất cứ thứ gì trên máy chủ (compose, .env, container),
# bằng chính backup-db.sh — cùng phép kiểm (gzip, dấu "Dump completed", ≥ 20 bảng,
# kích thước), tên riêng `cdkt-predeploy-<db>-<thời-điểm>-<pid>.sql.gz`, giữ 5 bản.
# Đây là điểm lùi dữ liệu của lượt này: một image mới chạy migration hỏng vẫn còn
# bản CSDL của image trước. Dump hỏng (đĩa đầy, mysql dừng…) thì DỪNG — triển khai
# mà không có điểm lùi là đúng ca bản sao lưu này tồn tại để chặn. Chưa chạm gì,
# nên dừng ở đây để lại máy chủ y như trước lượt này.
predeploy_dump() {
  local script="${INCOMING_BACKUP_SCRIPT:-scripts/backup-db.sh}"
  echo "▸ Sao lưu CSDL trước khi đổi image (image đang chạy: ${PREVIOUS:-chưa đặt}) → $PREDEPLOY_DIR/"
  if [ ! -f "$script" ]; then
    echo "::error::không có $script để sao lưu CSDL trước deploy — dừng, chưa chạm container hay .env nào" >&2
    exit 1
  fi
  if ! bash "$script" --prefix "$PREDEPLOY_PREFIX" "$PWD/$PREDEPLOY_DIR"; then
    echo "::error::sao lưu CSDL trước deploy thất bại (đĩa đầy? mysql không chạy?) — dừng, chưa chạm container hay .env nào. Sửa nguyên nhân rồi chạy lại job; cần gấp thì ./manage.sh → Update (hỏi riêng bước sao lưu)" >&2
    exit 1
  fi
}

# ── Log của app: journald, hoặc json-file dự phòng (wave2 D-LOG) ──────────────
# docker-compose.yml cho app ghi log vào journald (tag cdkt-app) để log còn sau khi
# container bị tạo lại. Máy chủ không có systemd-journald thì `up` hỏng ("journald is
# not enabled on this host") và MỌI lượt deploy lùi lại — nên lượt deploy tự đặt một
# docker-compose.override.yml có dấu (json-file xoay vòng 3 × 10 MB; compose tự đọc
# tệp này), và tự gỡ CHÍNH tệp đó khi journald đã có. Tệp override không mang dấu
# (người vận hành tự viết) không bao giờ bị đụng — nhưng nếu cấu hình compose HIỆU LỰC
# vẫn để app ghi vào journald thì dừng trước khi chạm container (`ensure_log_driver`
# trả 1). Ba hàm dưới giống HỆT bản trong production/manage.sh (tests/ops-scripts.test.ts
# so từng chữ). Tệp tạm của bản override (LOG_FALLBACK_TMP) được dọn ở `cleanup`.
LOG_FALLBACK_MARKER='# cdkt-log-fallback — sinh bởi production/manage.sh / scripts/deploy-remote.sh; đừng sửa tay'
LOG_WARN_PREFIX='::warning::'
LOG_ERROR_PREFIX='::error::'

# $1 (tuỳ chọn): image đã có trên máy để thử bằng một container chạy-rồi-xoá.
journald_available() {
  local socket="${CDKT_JOURNALD_SOCKET:-/run/systemd/journal/socket}" image="${1:-}" plugins
  # Driver journald của Docker ghi vào socket này; journalctl là cách đọc lại.
  [ -S "$socket" ] || return 1
  command -v journalctl >/dev/null 2>&1 || return 1
  # Chính daemon phải có driver đó (daemon rootless / chạy trong VM không thấy journal của máy).
  # Có trần thời gian: một daemon kẹt không được treo cả lượt deploy.
  plugins=$(timeout 20 docker info --format '{{json .Plugins.Log}}' 2>/dev/null || true)
  case "$plugins" in *'"journald"'*) ;; *) return 1 ;; esac
  # …và DÙNG được: một container thử trên image đã có sẵn (chưa có image thì bỏ bước
  # này). `--pull=never`: không bao giờ kéo gì qua mạng chỉ để thử.
  if [ -n "$image" ] && docker image inspect "$image" >/dev/null 2>&1; then
    timeout 60 docker run --rm --pull=never --network none --log-driver journald --log-opt tag=cdkt-journald-probe --entrypoint true "$image" >/dev/null 2>&1 || return 1
  fi
  return 0
}

# Driver log mà compose SẼ dùng cho app (docker-compose.yml + mọi override), đọc từ
# `docker compose config`. Rỗng = không đọc được. awk đọc HẾT đầu vào (không `exit`
# sớm: SIGPIPE dưới pipefail trong `$(…)` + `set -e` giết cả script).
effective_app_log_driver() {
  docker compose config 2>/dev/null | awk '
    /^[^ ]/ { top = $0; app = 0; logging = 0 }
    top == "services:" && /^  [^ ]/ { app = ($0 == "  app:"); logging = 0 }
    app && /^    [^ ]/ { logging = ($0 == "    logging:") }
    app && logging && /^      driver:/ && driver == "" { driver = $2; gsub(/"/, "", driver) }
    END { print driver }
  ' || true
}

# $1 (tuỳ chọn): image để thử journald (xem journald_available). Trả 1 = cấu hình
# log không chạy được trên máy này → người gọi dừng trước khi chạm container.
ensure_log_driver() {
  local override=docker-compose.override.yml ours=0 driver
  if [ -f "$override" ] && [ "$(head -n 1 "$override")" = "$LOG_FALLBACK_MARKER" ]; then
    ours=1
  fi
  if journald_available "${1:-}"; then
    if [ "$ours" = 1 ]; then
      rm -f "$override"
      echo "▸ Máy chủ đã có systemd-journald — gỡ $override (log json-file dự phòng); log app vào journald: journalctl CONTAINER_TAG=cdkt-app"
    fi
    return 0
  fi
  if [ -f "$override" ] && [ "$ours" = 0 ]; then
    # Override của người vận hành: không sửa; hỏi compose driver THẬT của app.
    driver=$(effective_app_log_driver)
    case "$driver" in
      journald)
        echo "${LOG_ERROR_PREFIX}Máy chủ không có systemd-journald dùng được, mà $override (không do script này sinh) vẫn để app ghi log vào journald — dừng trước khi chạm container. Thêm vào $override: services.app.logging = { driver: json-file, options: { max-size: \"10m\", max-file: \"3\" } }, hoặc cài systemd-journald." >&2
        return 1 ;;
      '')
        echo "${LOG_WARN_PREFIX}Máy chủ không có systemd-journald, đã có $override không do script này sinh, và không đọc được driver log hiệu lực (docker compose config) — nếu app vẫn ghi vào journald, lượt khởi động sẽ hỏng." >&2 ;;
      *)
        echo "▸ Máy chủ không có systemd-journald; $override (không do script này sinh) đặt log app = $driver — giữ nguyên." ;;
    esac
    return 0
  fi
  LOG_FALLBACK_TMP=$(mktemp ./.docker-compose.override.XXXXXX)
  {
    echo "$LOG_FALLBACK_MARKER"
    echo '# Máy chủ này không có systemd-journald, nên log của app dùng json-file (xoay vòng'
    echo '# 3 × 10 MB) thay vì journald như docker-compose.yml khai. Log json-file MẤT khi'
    echo '# container bị tạo lại (mỗi lượt deploy). Cài/bật systemd-journald rồi chạy lại'
    echo '# deploy (CI hoặc ./manage.sh Update): tệp này tự được gỡ.'
    echo 'services:'
    echo '  app:'
    echo '    logging:'
    echo '      driver: json-file'
    echo '      options:'
    echo '        max-size: "10m"'
    echo '        max-file: "3"'
  } > "$LOG_FALLBACK_TMP"
  chmod 644 "$LOG_FALLBACK_TMP"
  mv "$LOG_FALLBACK_TMP" "$override"
  LOG_FALLBACK_TMP=''
  echo "${LOG_WARN_PREFIX}Máy chủ không có systemd-journald — log app dùng json-file (đã ghi $override). Log json-file mất khi container bị tạo lại; cài systemd-journald để giữ log qua các lượt deploy." >&2
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

# Không có gì ở đây chạm vào máy chủ trước khi các tệp CI gửi lên được xác nhận
# nguyên vẹn.
verify_incoming_compose
verify_incoming_backup_script

# Kéo image TRƯỚC khi đụng vào .env hay docker-compose.yml: registry hỏng, tag
# sai, hay mất mạng thì deployment đang chạy không bị sứt mẻ gì.
echo "▸ Kéo $IMAGE"
docker pull "$IMAGE"

PREVIOUS=$(current_image)
echo "▸ Image hiện tại: ${PREVIOUS:-(chưa đặt)}"

# Sau khi image chắc chắn có, trước MỌI thay đổi: install_compose và
# migrate_trusted_proxy_ips đều ghi tệp — dump hỏng sau chúng sẽ để lại compose
# mới cạnh container cũ.
predeploy_dump

install_compose

# Sau install_compose: driver hiệu lực phải tính trên compose SẼ dùng (của commit này).
# Cấu hình log không chạy được trên máy này → trả compose cũ về và dừng: chưa dòng
# .env nào, chưa container nào bị đụng.
if ! ensure_log_driver "$IMAGE"; then
  restore_compose
  exit 1
fi

migrate_trusted_proxy_ips

set_image "$IMAGE"

echo "▸ Khởi động lại app"
if start_app && wait_healthy; then
  echo "✅ $CONTAINER healthy trên $IMAGE"
  # Việc dọn dẹp sau một lượt đã khoẻ: không bước nào được làm hỏng lượt deploy.
  fix_uploads_ownership || true
  echo "▸ Dọn image app cũ (giữ image đang chạy + $IMAGE_KEEP bản sha-* mới nhất)"
  prune_app_images "$IMAGE" || true
  warn_disk_usage || true
  exit 0
fi

echo "▸ Lùi lại image trước đó" >&2
if [ -z "$LOGS_SHOWN" ]; then show_container_logs; fi

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
