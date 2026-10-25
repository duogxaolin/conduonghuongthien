#!/usr/bin/env bash
#
# production/manage.sh — Công cụ quản trị VPS CDKT
#
# Một cửa vào: deploy mới / update / import data migration.
# Chạy:  cd production && ./manage.sh
#
# Không tự ý commit hay push. Mọi thay đổi .env đều có xác nhận trước.
# Xem README.md trong thư mục này để biết luồng đầy đủ.
#
set -euo pipefail

# ── Thư mục & helpers ──────────────────────────────────────────────────────
# Đường dẫn gốc repo (cha của production/) — tất cả lệnh docker compose chạy ở đó.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROD="$ROOT/production"
MIG_DIR="$PROD/migrations"

# Màu + prompt
# shellcheck disable=SC2034  # bảng màu đủ bộ; C_BLUE hiện chưa dùng
if [ -t 1 ]; then
  C_RESET='\033[0m'; C_BOLD='\033[1m'; C_GREEN='\033[32m'; C_RED='\033[31m'
  C_YELLOW='\033[33m'; C_BLUE='\033[34m'; C_CYAN='\033[36m'; C_DIM='\033[2m'
else
  C_RESET=''; C_BOLD=''; C_GREEN=''; C_RED=''; C_YELLOW=''; C_BLUE=''; C_CYAN=''; C_DIM=''
fi

# Đọc một giá trị có gợi ý:  prompt "Nhập DB name" DEFAULT_VALUE → gõ enter giữ default
# Dùng biến global PROMPT_RESULT thay vì echo + \$(...) để tránh subshell —
# subshell + set -e + read có thể ăn input sai trên terminal web aaPanel.
prompt() {
  local label="$1" default="${2:-}" var
  if [ -n "$default" ]; then
    printf "${C_DIM}%s${C_RESET} ${C_BOLD}[%s]${C_RESET}: " "$label" "$default"
  else
    printf "${C_DIM}%s${C_RESET}: " "$label"
  fi
  read -r var || true
  # Strip mọi ký tự trắng thừa (\r, \n, space đầu/cuối)
  var="${var//$'\r'/}"
  var="${var//$'\n'/}"
  var="${var#"${var%%[![:space:]]*}"}"
  var="${var%"${var##*[![:space:]]}"}"
  PROMPT_RESULT="${var:-$default}"
}

# Yes/No mặc định Yes
confirm() {
  local label="$1" default="${2:-y}" ans
  if [ "$default" = "y" ]; then printf "${C_BOLD}%s (Y/n)${C_RESET}: " "$label"
  else printf "${C_BOLD}%s (y/N)${C_RESET}: " "$label"; fi
  read -r ans || true
  ans="${ans//$'\r'/}"
  ans="${ans//$'\n'/}"
  ans="${ans#"${ans%%[![:space:]]*}"}"
  ans="${ans%"${ans##*[![:space:]]}"}"
  ans="${ans:-$default}"
  [ "$ans" = "y" ] || [ "$ans" = "Y" ] || [ "$ans" = "yes" ] || [ "$ans" = "YES" ]
}

# Sinh password ngẫu nhiên an toàn (không dấu '/' '+' để hợp base64-in-env)
gen_secret() {
  openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p 2>/dev/null || echo "CHANGE_ME_$(date +%s)"
}
gen_b64() {
  # base64 của 32 byte, BỎ padding '=' ở cuối — docker compose .env cắt giá trị
  # tại dấu '=' thứ 2, làm secret mất ký tự. Code `secret-envelope.ts` dùng
  # `replace(/=+$/u,'')` nên bỏ padding vẫn decode đúng 32 byte.
  openssl rand -base64 32 2>/dev/null | tr -d '=' || echo "CHANGE_ME_BASE64_NO_PADDING"
}
gen_password() {
  # 18 ký tự base64, đủ mạnh cho MySQL (đã dùng cho ADMIN_PASSWORD)
  openssl rand -base64 18 2>/dev/null | tr -d '/+\n' || echo "ChangeMePwd$(date +%s)"
}

# Đọc giá trị từ .env hiện có (nếu có) — dùng cho update
env_get() {
  local key="$1" val
  val=$(grep -E "^${key}=" "$ROOT/.env" 2>/dev/null | tail -n1 | sed "s/^${key}=//")
  echo "$val"
}

# Ghi một khoá vào .env: sửa tại chỗ nếu đã có, thêm dòng mới nếu chưa.
# Cùng khuôn `sed -i` mà cmd_update đã dùng cho PORT / PUBLIC_BASE_URL.
# Idempotent: chạy hai lần cho ra đúng một dòng.
# `sed` không có cờ `g` vẫn thay **mọi** dòng khớp, nên nếu .env lỡ mang hai dòng
# cùng khoá thì cả hai nhận cùng một giá trị — không có chuyện "dòng nào thắng"
# phụ thuộc thứ tự đọc của compose.
set_env() {
  local key="$1" value="$2" file="${3:-$ROOT/.env}"
  if grep -qE "^${key}=" "$file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

# .env giữ JWT_SECRET, mật khẩu root MySQL… nên chỉ chủ tệp được đọc (600). Bản cũ
# tạo nó bằng `cat >` theo umask mặc định (644 — mọi user trên máy đọc được), làm
# vô nghĩa việc giấu mật khẩu khỏi `ps`. In ra quyền cũ nếu đã phải siết lại.
# Chạy bằng root mà thư mục repo thuộc user khác (user CI deploy qua SSH, ghi .env
# mỗi lượt deploy): trao .env cho chủ thư mục — tệp 600 của root thì lượt CI kế
# tiếp không đọc được .env và deploy hỏng.
secure_env_file() {
  local f="$ROOT/.env" old_mode dir_owner
  [ -f "$f" ] || return 0
  old_mode=$(stat -c '%a' "$f" 2>/dev/null || echo '?')
  # Không siết được (user chạy Update không sở hữu .env) thì CẢNH BÁO rồi đi tiếp —
  # Update vẫn làm được việc của nó; chặn nó vì quyền tệp là chặn sai chỗ.
  if ! chmod 600 "$f" 2>/dev/null; then
    echo -e "${C_YELLOW}⚠  Không đặt được quyền 600 cho .env (chủ tệp: $(stat -c '%U' "$f" 2>/dev/null || echo '?'), quyền hiện tại: ${old_mode}).${C_RESET}"
    echo -e "${C_YELLOW}   Chạy bằng chủ tệp hoặc root: chmod 600 $f${C_RESET}"
    return 0
  fi
  if [ "$(id -u)" = 0 ]; then
    dir_owner=$(stat -c '%u:%g' "$ROOT" 2>/dev/null || true)
    if [ -n "$dir_owner" ] && [ "$(stat -c '%u:%g' "$f" 2>/dev/null || true)" != "$dir_owner" ]; then
      chown "$dir_owner" "$f"
    fi
  fi
  if [ "$old_mode" != "600" ]; then
    echo -e "${C_YELLOW}⚠  .env có quyền ${old_mode} (user khác trên máy đọc được bí mật) — đã đặt lại 600.${C_RESET}"
  fi
}

# ── Helper docker / MySQL / image (Deploy, Update, Migrate dùng chung) ───────
# Tên container do docker-compose.yml cố định (`container_name:`).
APP_CONTAINER="cdkt_app"
MYSQL_CONTAINER="cdkt_mysql"
# Image CI đẩy lên GHCR; dùng làm gợi ý khi CDKT_IMAGE đang ghim/chưa đặt.
DEFAULT_IMAGE_REPO="ghcr.io/duogxaolin/conduonghuongthien"
# Cùng thư mục và cùng khuôn tên mà scripts/deploy-remote.sh dùng cho bản sao
# lưu docker-compose.yml, để hai bên dọn/sắp xếp chung được.
COMPOSE_BACKUP_DIR="$ROOT/.deploy-compose-backups"
COMPOSE_BACKUP_KEEP=10
# Bản sao lưu compose của lượt Update đang chạy (rỗng = không có).
UPDATE_COMPOSE_BACKUP=""
# Bản dump CSDL trước khi đổi image: cùng thư mục, cùng tên `cdkt-predeploy-…` với
# lượt CI deploy (scripts/deploy-remote.sh), nên hai đường dùng chung một vòng xoay
# 5 bản (backup-db.sh PREFIX_KEEP).
PREDEPLOY_DIR="$ROOT/.deploy-db-backups"
# Sau một lượt Update khoẻ: giữ image đang chạy + IMAGE_KEEP bản sha-* mới nhất khác,
# cảnh báo khi đĩa Docker dùng quá DISK_WARN_PCT %. Cùng số với deploy-remote.sh.
IMAGE_KEEP=5
DISK_WARN_PCT=80

# Tên database của deploy NÀY: .env là nguồn chân lý (Deploy bước 2 cho đặt tên
# tuỳ ý). Đúng quy tắc của compose — `${MYSQL_DATABASE:-cdkt_admin}` cho cả container
# mysql lẫn `DB_NAME` của app — và của backup-db.sh / verify-restore.sh. KHÔNG lùi về
# DB_NAME trong .env: compose không đọc dòng đó, nên lùi về nó là nhập vào một
# database app không dùng. Hai giá trị lệch nhau thì nói ra (stderr).
db_name() {
  local n legacy
  n=$(env_get MYSQL_DATABASE)
  n="${n:-cdkt_admin}"
  legacy=$(env_get DB_NAME)
  if [ -n "$legacy" ] && [ "$legacy" != "$n" ]; then
    echo -e "${C_YELLOW}⚠  .env: DB_NAME=$legacy khác database app thật sự dùng ($n, từ MYSQL_DATABASE) — dùng $n.${C_RESET}" >&2
  fi
  echo "$n"
}

# Chạy `mysql` bằng root trong container mysql:  mysql_exec <mật-khẩu> [đối số mysql…]
# stdin được chuyển tiếp (import SQL). Mật khẩu đi qua BIẾN MÔI TRƯỜNG của tiến
# trình docker CLI (`-e MYSQL_PWD` không kèm giá trị = lấy từ môi trường gọi), KHÔNG
# phải `-p<mật-khẩu>` và cũng không phải `-e MYSQL_PWD=<mật-khẩu>`: hai dạng đó đều
# nằm trong argv của tiến trình, mà `ps` cho mọi người dùng trên máy chủ đọc.
mysql_exec() {
  local pw="$1"
  shift
  MYSQL_PWD="$pw" docker exec -i -e MYSQL_PWD "$MYSQL_CONTAINER" mysql -uroot "$@"
}

# RAM máy chủ (MB) ra stdout; trả 1 nếu không đọc được. `CDKT_MEMINFO_FILE` chỉ là
# đường vào cho test.
read_host_ram_mb() {
  local meminfo="${CDKT_MEMINFO_FILE:-/proc/meminfo}"
  # Đọc /proc/meminfo như scripts/check-resources.sh, không `free`: nhãn cột của
  # `free` khác nhau giữa các bản procps, còn /proc/meminfo thì không.
  if [ -r "$meminfo" ]; then
    echo $(( $(awk '/^MemTotal:/ {print $2}' "$meminfo") / 1024 ))
  elif [ "$(uname -s)" = "Darwin" ]; then
    echo $(( $(sysctl -n hw.memsize) / 1024 / 1024 ))
  else
    return 1
  fi
}

# Đợi cdkt_app healthy. Trả 0 khi healthy, 1 khi hết giờ hoặc container không có
# HEALTHCHECK. So sánh NGUYÊN CHUỖI: `grep -q healthy` khớp cả `unhealthy`, nên
# bản cũ báo "healthy" cho đúng container đang hỏng. Cùng ngữ nghĩa với
# wait_healthy của scripts/deploy-remote.sh. `CDKT_HEALTH_TIMEOUT` /
# `CDKT_HEALTH_INTERVAL` (giây) chỉ để test rút ngắn.
wait_app_healthy() {
  local timeout="${CDKT_HEALTH_TIMEOUT:-300}" interval="${CDKT_HEALTH_INTERVAL:-5}"
  local deadline=$((SECONDS + timeout)) status="missing"
  while [ "$SECONDS" -lt "$deadline" ]; do
    status=$(docker inspect \
      --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
      "$APP_CONTAINER" 2>/dev/null || echo missing)
    case "$status" in
      healthy)
        echo -e "${C_GREEN}✓ $APP_CONTAINER healthy${C_RESET}"
        return 0 ;;
      none)
        # Image của dự án luôn khai HEALTHCHECK; "không có" nghĩa là đang chạy nhầm
        # image. Không xác nhận được thì không báo thành công.
        echo -e "${C_RED}✗ $APP_CONTAINER không khai HEALTHCHECK — không xác nhận được.${C_RESET}"
        return 1 ;;
      *) sleep "$interval" ;;
    esac
  done
  echo -e "${C_RED}✗ $APP_CONTAINER chưa healthy sau ${timeout}s (trạng thái cuối: ${status:-unknown}).${C_RESET}"
  return 1
}

show_app_logs() {
  echo -e "${C_DIM}── 60 dòng log cuối của $APP_CONTAINER ──${C_RESET}"
  { docker logs --tail 60 "$APP_CONTAINER" 2>&1 | sed 's/^/    /'; } || true
}

# Khởi động lại CHỈ app, đúng như CI (scripts/deploy-remote.sh `start_app`): một
# `docker compose up -d app` trơn tạo lại cả mysql (phụ thuộc của app) mỗi khi cấu
# hình mysql trong compose lệch — tức khởi động lại CSDL của cổng đang phục vụ.
# `--no-recreate mysql` chỉ bật nó nếu đang dừng. Gọi trong điều kiện `if` nên mọi
# lệnh có `|| return 1` tường minh (ở đó `set -e` không có hiệu lực).
start_app() {
  docker compose up -d --no-recreate mysql || return 1
  docker compose up -d --no-deps app || return 1
}

# Dump CSDL ở bước ĐẦU của Update, trước git pull / compose / .env / image, bằng
# scripts/backup-db.sh (cùng phép kiểm: gzip, dấu "Dump completed", ≥ 20 bảng; tệp
# 600, thư mục 700). Dump chạy TRƯỚC `git pull`, nên dùng backup-db.sh của CHÍNH bản
# checkout chứa manage.sh đang chạy — cùng commit, luôn hiểu `--prefix`. Trả khác 0
# khi dump hỏng; nơi gọi dừng Update.
update_predeploy_dump() {
  local owner
  bash "$ROOT/scripts/backup-db.sh" --prefix cdkt-predeploy "$ROOT/.deploy-db-backups" || return 1
  # Chạy bằng root mà thư mục repo thuộc user khác (user CI deploy): trao thư mục
  # dump cho chủ thư mục repo — thư mục của root thì lượt CI deploy kế tiếp không
  # ghi được vào đó và dừng ngay ở bước sao lưu. Cùng quy tắc với secure_env_file.
  if [ "$(id -u)" = 0 ]; then
    owner=$(stat -c '%u:%g' "$ROOT" 2>/dev/null || true)
    if [ -n "$owner" ]; then chown -R "$owner" "$PREDEPLOY_DIR" 2>/dev/null || true; fi
  fi
}

# Gỡ image app cũ THEO THẺ sau một lượt Update khoẻ — cùng hàm, cùng quy tắc với
# scripts/deploy-remote.sh: giữ image đang chạy + IMAGE_KEEP bản sha-* mới nhất khác
# của CÙNG repo (thẻ lùi cdkt-rollback/app:* không thuộc repo đó nên không bao giờ
# bị xét), `docker image rm` không `-f`, rồi `image prune -f` cho layer lơ lửng.
# Không bao giờ làm hỏng lượt Update: mọi lỗi chỉ là cảnh báo.
prune_app_images() {
  local repo="${1%:*}" running_id tag line
  local -a rows=() sorted=()
  running_id=$(docker image inspect --format '{{.Id}}' "$1" 2>/dev/null || true)
  if [ -z "$running_id" ]; then
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
    mapfile -t sorted < <(printf '%s\n' "${rows[@]}" | sort -r)
    for line in "${sorted[@]:IMAGE_KEEP}"; do
      tag=${line##* }
      if docker image rm "$repo:$tag" >/dev/null 2>&1; then
        echo -e "${C_DIM}  Gỡ image cũ $repo:$tag${C_RESET}"
      else
        echo -e "${C_YELLOW}⚠  Không gỡ được $repo:$tag (còn container dùng?) — để lại.${C_RESET}"
      fi
    done
  fi
  docker image prune -f >/dev/null 2>&1 || true
}

warn_disk_usage() {
  local root pct
  root=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)
  root=${root:-/var/lib/docker}
  pct=$(df --output=pcent "$root" 2>/dev/null | tail -n 1 | tr -dc '0-9' || true)
  if [ -n "$pct" ] && [ "$pct" -gt "$DISK_WARN_PCT" ]; then
    echo -e "${C_YELLOW}⚠  Đĩa chứa dữ liệu Docker ($root) đã dùng ${pct}% (ngưỡng ${DISK_WARN_PCT}%) — dọn image/backup cũ trước khi đầy.${C_RESET}"
  fi
}

# ── Log của app: journald, hoặc json-file dự phòng (wave2 D-LOG) ──────────────
# docker-compose.yml cho app ghi log vào journald (tag cdkt-app) để log còn sau khi
# container bị tạo lại. Máy chủ không có systemd-journald thì `up` hỏng ("journald is
# not enabled on this host") — nên Deploy/Update tự đặt một docker-compose.override.yml
# có dấu (json-file xoay vòng 3 × 10 MB; compose tự đọc tệp này) và tự gỡ CHÍNH tệp đó
# khi journald đã có. Tệp override không mang dấu (người vận hành tự viết) không bao giờ
# bị đụng — nhưng nếu cấu hình compose HIỆU LỰC vẫn để app ghi vào journald thì dừng
# trước khi chạm container (`ensure_log_driver` trả 1). Ba hàm dưới giống HỆT bản
# trong scripts/deploy-remote.sh (lượt CI deploy — tests/ops-scripts.test.ts so từng
# chữ). Gọi sau `cd "$ROOT"`. Tệp tạm của bản override (LOG_FALLBACK_TMP) được dọn ở
# trap EXIT bên dưới.
LOG_FALLBACK_MARKER='# cdkt-log-fallback — sinh bởi production/manage.sh / scripts/deploy-remote.sh; đừng sửa tay'
LOG_WARN_PREFIX='⚠  '
LOG_ERROR_PREFIX='✗ '
LOG_FALLBACK_TMP=''
trap 'if [ -n "$LOG_FALLBACK_TMP" ]; then rm -f "$LOG_FALLBACK_TMP"; fi' EXIT

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

# URL ping của dịch vụ giám sát (healthchecks.io…) cho cron sao lưu. Chỉ dạng mà
# scripts/backup-db.sh dùng được: http(s), không query/fragment (script nối `/fail`
# vào cuối), không ký tự mà `.env` (được `source`) hay `sed` của set_env hiểu khác đi.
valid_ping_url() {
  local re='^https?://[A-Za-z0-9._~:/%+=@-]+$'
  [[ "$1" =~ $re ]]
}

# OPS_ALERT_EMAIL (wave2 D-ALERT): một hoặc nhiều địa chỉ, phẩy ngăn cách, không dấu
# cách. Chỉ ký tự thường gặp trong địa chỉ — giá trị đi qua `sed` của set_env và được
# compose đọc từ .env, nên `|`, `&`, `\`, dấu nháy hay xuống dòng đều bị từ chối.
valid_alert_emails() {
  local re='^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' part
  local -a parts
  case "$1" in ''|,*|*,|*,,*) return 1 ;; esac
  IFS=',' read -ra parts <<< "$1"
  for part in "${parts[@]}"; do
    [[ "$part" =~ $re ]] || return 1
  done
}

# Sao lưu docker-compose.yml hiện tại vào .deploy-compose-backups/ (khuôn tên của
# CI) và in đường dẫn ra stdout. Không có tệp → in rỗng.
backup_compose_file() {
  [ -f "$ROOT/docker-compose.yml" ] || return 0
  mkdir -p "$COMPOSE_BACKUP_DIR"
  local dest backups excess
  dest="$COMPOSE_BACKUP_DIR/docker-compose.$(date -u +%Y%m%dT%H%M%SZ).yml"
  cp -p "$ROOT/docker-compose.yml" "$dest"
  # Giữ COMPOSE_BACKUP_KEEP bản gần nhất (tên sắp xếp được theo thời gian).
  backups=("$COMPOSE_BACKUP_DIR"/docker-compose.*.yml)
  excess=$(( ${#backups[@]} - COMPOSE_BACKUP_KEEP ))
  if [ "$excess" -gt 0 ]; then rm -f -- "${backups[@]:0:excess}"; fi
  echo "$dest"
}

# Bước "pull code" của Update. docker-compose.yml trên VPS do CI ghi đè mỗi lượt
# deploy (scripts/deploy-remote.sh), nên cây git thấy nó "đã sửa" và `git pull` TỪ
# CHỐI mỗi khi lượt kéo đó cũng đổi tệp này. Tệp CI đặt luôn là bản đã commit nên bỏ
# thay đổi cục bộ là an toàn — nhưng một bản sửa tay của người vận hành cũng bị bỏ
# cùng lúc, nên: sao lưu trước, hiện chênh lệch, nói rõ chỗ lấy lại.
update_pull_code() {
  UPDATE_COMPOSE_BACKUP=""
  if ! confirm "Pull code mới từ git (git pull)?" "y"; then
    return 0
  fi
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo -e "${C_RED}$ROOT không phải bản clone git — không pull được.${C_RESET}"
    exit 1
  fi
  UPDATE_COMPOSE_BACKUP=$(backup_compose_file)
  local reverted=0
  if ! git diff --quiet HEAD -- docker-compose.yml 2>/dev/null; then
    echo -e "${C_YELLOW}⚠  docker-compose.yml khác bản trong git HEAD (CI ghi đè tệp này mỗi lượt deploy).${C_RESET}"
    git diff --stat HEAD -- docker-compose.yml | sed 's/^/    /' || true
    echo -e "${C_DIM}   Bỏ thay đổi cục bộ để git pull không từ chối. Bản hiện tại đã sao lưu ở:${C_RESET}"
    echo -e "${C_DIM}   ${UPDATE_COMPOSE_BACKUP:-(không sao lưu được)}${C_RESET}"
    echo -e "${C_DIM}   Nếu anh từng sửa tay tệp này NGOÀI bản CI đặt, lấy phần sửa lại từ bản sao lưu đó.${C_RESET}"
    git checkout -- docker-compose.yml
    reverted=1
  fi
  if ! git pull origin main; then
    # Tệp vừa bị trả về bản HEAD CŨ để pull không bị từ chối; pull hỏng thì phải đặt
    # lại đúng bản đang chạy (bản CI đã ghi), nếu không lượt `docker compose` kế tiếp
    # — kể cả của CI — chạy trên một compose khác với container hiện tại.
    if [ "$reverted" = 1 ] && [ -n "$UPDATE_COMPOSE_BACKUP" ] && [ -f "$UPDATE_COMPOSE_BACKUP" ]; then
      cp -p "$UPDATE_COMPOSE_BACKUP" "$ROOT/docker-compose.yml"
      echo -e "${C_YELLOW}docker-compose.yml đã được đặt lại như trước lượt Update (từ $UPDATE_COMPOSE_BACKUP).${C_RESET}"
    fi
    echo -e "${C_RED}git pull thất bại — dừng. Container đang chạy không bị đụng tới.${C_RESET}"
    exit 1
  fi
}

# Kéo + áp dụng image mới cho Update, có đường lùi. Trả 0 khi app healthy (kể cả khi
# không có gì để áp), 1 khi thất bại (đã in lý do; đã lùi nếu có thể).
update_app_image() {
  local cur_img new_img prev_id rollback_ref="" img_after reason="" latest_ref repo
  cur_img=$(env_get CDKT_IMAGE)
  new_img="$cur_img"

  # Image đang chạy THẬT (theo ID, không theo tên thẻ): sau `docker pull` thẻ
  # `:latest` đã trỏ sang bản mới, nên "thẻ trước đó" của nó không còn là bản trước.
  prev_id=$(docker inspect --format '{{.Image}}' "$APP_CONTAINER" 2>/dev/null || true)

  # CI ghim CDKT_IMAGE vào `:sha-<commit>` sau lượt deploy đầu tiên. Kéo lại đúng
  # tên đó chỉ ra cùng một image — Update trông như chạy mà không đổi gì.
  case "$cur_img" in
    '') reason="CDKT_IMAGE chưa đặt — compose dùng cdkt/app:local (chỉ build tại chỗ, không kéo được)." ;;
    *:sha-*) reason="CDKT_IMAGE đang ghim vào một bản CI cụ thể ($cur_img): kéo lại sẽ chỉ ra đúng bản đó." ;;
    cdkt-rollback/*|cdkt/app:*) reason="CDKT_IMAGE là image cục bộ ($cur_img), không có trên registry để kéo." ;;
  esac
  if [ -n "$reason" ]; then
    case "$cur_img" in ghcr.io/*) repo="${cur_img%:*}" ;; *) repo="$DEFAULT_IMAGE_REPO" ;; esac
    latest_ref="$repo:latest"
    echo -e "${C_YELLOW}⚠  $reason${C_RESET}"
    echo -e "${C_DIM}   Lượt CI deploy kế tiếp sẽ ghim lại vào bản của nó.${C_RESET}"
    if confirm "Trỏ CDKT_IMAGE về $latest_ref để kéo bản mới nhất?" "y"; then
      new_img="$latest_ref"
    fi
  fi

  # Thẻ an toàn cho image đang chạy — đích của đường lùi, độc lập với việc thẻ
  # `:latest` / `:sha-…` có bị kéo/đè hay không.
  if [ -n "$prev_id" ]; then
    rollback_ref="cdkt-rollback/app:$(date -u +%Y%m%dT%H%M%SZ)"
    if docker image tag "$prev_id" "$rollback_ref"; then
      echo -e "${C_DIM}Image đang chạy được giữ làm đích lùi: $rollback_ref${C_RESET}"
    else
      echo -e "${C_YELLOW}⚠  Không gắn được thẻ lùi — nếu bản mới hỏng sẽ KHÔNG tự lùi được.${C_RESET}"
      rollback_ref=""
    fi
  fi

  echo -e "${C_BOLD}Pull image $new_img ...${C_RESET}"
  if [ -z "$new_img" ] || ! docker pull "$new_img"; then
    echo -e "${C_YELLOW}⚠  Không kéo được image (registry, thẻ, hoặc chưa 'docker login ghcr.io' — package GHCR là private).${C_RESET}"
    echo -e "${C_YELLOW}   Build ngay trên VPS có thể bị OOM giữa chừng — đúng lúc container cũ vẫn đang phục vụ${C_RESET}"
    echo -e "${C_YELLOW}   (docker-compose.yml, service app: 'build ở nơi khác thì một lần build hỏng không chạm được trang đang chạy').${C_RESET}"
    if confirm "Vẫn build image trên VPS này (docker compose build app)?" "n"; then
      if ! CDKT_IMAGE="${new_img:-cdkt/app:local}" docker compose build app; then
        echo -e "${C_RED}✗ Build thất bại. Container đang chạy không bị đụng tới.${C_RESET}"
        return 1
      fi
      [ -n "$new_img" ] || new_img="cdkt/app:local"
    else
      echo -e "${C_RED}✗ Không có image mới. Container đang chạy không bị đụng tới.${C_RESET}"
      echo -e "${C_DIM}   Đăng nhập GHCR (docker login ghcr.io) hoặc chờ CI đẩy image, rồi chạy lại Update.${C_RESET}"
      return 1
    fi
  fi

  if [ "$new_img" != "$cur_img" ]; then
    set_env CDKT_IMAGE "$new_img"
    echo -e "${C_GREEN}✓ .env: CDKT_IMAGE=$new_img${C_RESET}"
  fi

  img_after=$(docker image inspect --format '{{.Id}}' "$new_img" 2>/dev/null || true)
  if [ -n "$prev_id" ] && [ "$img_after" = "$prev_id" ]; then
    echo -e "${C_DIM}Image kéo về trùng image đang chạy — không có bản mới hơn.${C_RESET}"
    if ! confirm "Vẫn khởi động lại app?" "n"; then
      return 0
    fi
  fi

  echo -e "${C_BOLD}Khởi động lại app ...${C_RESET}"
  if start_app && wait_app_healthy; then
    # Chỉ giữ thẻ lùi của lượt này; thẻ của các lượt trước dọn đi cho khỏi đầy đĩa.
    if [ -n "$rollback_ref" ]; then
      { docker image ls --format '{{.Repository}}:{{.Tag}}' cdkt-rollback/app 2>/dev/null \
          | grep -vxF "$rollback_ref" \
          | while IFS= read -r old_tag; do docker image rm "$old_tag" >/dev/null 2>&1 || true; done; } || true
    fi
    # Image sha-* cũ của CI: giữ image đang chạy + IMAGE_KEEP bản mới nhất.
    prune_app_images "$new_img" || true
    warn_disk_usage || true
    return 0
  fi

  echo -e "${C_RED}✗ Bản mới không khoẻ.${C_RESET}"
  show_app_logs
  if [ -z "$rollback_ref" ]; then
    echo -e "${C_RED}✗ Không có image trước để lùi về (chưa có container chạy, hoặc không gắn được thẻ) — cần xử lý tay.${C_RESET}"
    return 1
  fi
  echo -e "${C_BOLD}Lùi về image trước ($rollback_ref) ...${C_RESET}"
  # compose đã bị git pull thay mới: lùi cả nó, vì image trước chạy trên compose trước.
  if [ -n "$UPDATE_COMPOSE_BACKUP" ] && [ -f "$UPDATE_COMPOSE_BACKUP" ] \
     && ! cmp -s "$UPDATE_COMPOSE_BACKUP" "$ROOT/docker-compose.yml"; then
    cp "$UPDATE_COMPOSE_BACKUP" "$ROOT/docker-compose.yml"
    echo -e "${C_DIM}docker-compose.yml đã trả về bản trước lượt pull ($UPDATE_COMPOSE_BACKUP).${C_RESET}"
  fi
  set_env CDKT_IMAGE "$rollback_ref"
  if start_app && wait_app_healthy; then
    echo -e "${C_RED}✗ UPDATE THẤT BẠI — đã lùi về $rollback_ref và dịch vụ đã khoẻ trở lại.${C_RESET}"
    echo -e "${C_DIM}   .env đang đặt CDKT_IMAGE=$rollback_ref (image cục bộ). Lượt CI deploy kế tiếp, hoặc Update${C_RESET}"
    echo -e "${C_DIM}   lần sau, sẽ đề nghị trỏ lại về bản trên GHCR.${C_RESET}"
  else
    echo -e "${C_RED}✗ UPDATE THẤT BẠI VÀ lượt lùi về $rollback_ref cũng không khoẻ — cần vào máy chủ xử lý ngay.${C_RESET}"
  fi
  return 1
}

# Quét một file SQL tìm câu lệnh phá/ghi đè dữ liệu. In "số-dòng:câu-lệnh" (dòng nơi
# câu lệnh BẮT ĐẦU, cắt 110 ký tự) cho từng câu lệnh bị gắn cờ; không in gì nếu sạch.
# Chủ đích bắt THỪA hơn thiếu — gắn cờ chỉ đòi gõ lại tên file, bỏ sót thì mất bảng.
#
# Bản cũ dò từng dòng bằng grep nên lọt: `DROP` và `TABLE` trên hai dòng, `DROP/**/TABLE`,
# `TRUNCATE`a`` (không có dấu cách), DROP trong thân thủ tục (`BEGIN DROP TABLE …`),
# SQL động (PREPARE/EXECUTE), và BOM UTF-8 ở dòng 1. Nay đọc như trình phân tích của
# MySQL ở mức token:
#   - bỏ BOM; bỏ chú thích `-- `, `#`, `/* … */` — NHƯNG giữ phần trong `/*!NNNNN … */`
#     và `/*M!NNNNNN … */` (MySQL/MariaDB VẪN chạy) như mã;
#   - nhận chuỗi '…' "…" (có `\` và nháy đôi) và `định danh`, nên `--`, `/*`, `;` nằm
#     TRONG chuỗi không bị hiểu nhầm là chú thích/kết thúc câu (`VALUES ('--'); DROP …`
#     không lọt). Nội dung chuỗi không được đem dò (bài viết có chữ "drop" không bị gắn
#     cờ) — trừ khi file đổi cách MySQL đọc chuỗi (NO_BACKSLASH_ESCAPES, hoặc SET NAMES
#     big5/cp932/gbk/gb18030/sjis — byte 0x5C nằm trong ký tự nhiều byte): khi đó máy
#     quét không chắc mình tách chuỗi giống MySQL, nên dò thêm cả văn bản thô từng dòng;
#   - gộp mọi khoảng trắng (kể cả xuống dòng) rồi tách câu theo `;` (thân thủ tục sau
#     `DELIMITER` cũng bị tách — vẫn dò được), so không phân biệt hoa thường.
# Gắn cờ: mọi token DROP / TRUNCATE (cả `ALTER … DROP`, `TRUNCATE t` không có TABLE),
# PREPARE / EXECUTE (SQL động — nội dung nằm trong chuỗi, không đọc được trước), mọi
# DELETE (trừ mệnh đề khoá ngoại `ON DELETE`), và UPDATE không có WHERE. Chuỗi/chú thích
# chưa đóng tới cuối file cũng bị gắn cờ (phần sau đó không quét được).
sql_destructive_lines() {
  local file="$1" raw=0
  if LC_ALL=C grep -aqiE "no_backslash_escapes|(names|character_set_client|charset|character[[:space:]]+set)[[:space:]=]*['\"]?(big5|cp932|gbk|gb18030|sjis)" "$file" 2>/dev/null; then
    raw=1
  fi
  { LC_ALL=C awk -v raw="$raw" "$(sql_scan_awk)" "$file" 2>/dev/null | cut -c1-110; } || true
}
sql_scan_awk() {
  cat <<'AWK'
# Theo byte (LC_ALL=C), awk POSIX: cùng kết quả dưới gawk, mawk (awk mặc định của
# Ubuntu) và BusyBox. Tuyến tính theo kích thước file: một dòng extended-INSERT 1 MB
# được đọc qua một cửa sổ nhỏ (`more`), không bị chép lại cả dòng cho mỗi token, và
# câu lệnh không bị gom lại — mỗi đoạn mã được dò từng từ ngay khi đi qua.
BEGIN { st = "N"; W = (window > 0) ? window : 512; NB = "[^a-z0-9_$]"; reset() }
function reset() { flag = 0; firstw = ""; prevw = ""; sawwhere = 0; disp = ""; sline = 0 }
function more() {
  if (lpos > llen) return 0
  s = s substr(line, lpos, W); lpos += W
  return 1
}
function show(t) {
  if (sline == 0 && t ~ /[^ \t\r\f\v]/) sline = NR
  if (length(disp) < 200) disp = disp substr(t, 1, 200)
}
function word(w) {
  if (w == "drop" || w == "truncate" || w == "prepare" || w == "execute") flag = 1
  else if (w == "delete" && prevw != "on") flag = 1
  else if (w == "where") sawwhere = 1
  if (firstw == "") firstw = w
  prevw = w
}
function code(t,   lt) {
  if (t == "") return
  show(t)
  lt = tolower(t)
  while (match(lt, /[a-z0-9_$]+/)) {
    word(substr(lt, RSTART, RLENGTH))
    lt = substr(lt, RSTART + RLENGTH)
  }
}
function has(str, w) { return str ~ ("(^|" NB ")(" w ")(" NB "|$)") }
function flush(   d) {
  if (sline && (flag || (firstw == "update" && !sawwhere))) {
    d = disp; gsub(/[ \t\r\f\v]+/, " ", d); sub(/^ /, "", d)
    printf "%d:%s\n", sline, d
  }
  reset()
}
{
  line = $0
  if (NR == 1) sub(/^\357\273\277/, "", line)
  if (raw && has(tolower(line), "drop|truncate|prepare|execute|delete|update")) rawhits = rawhits NR ":" substr(line, 1, 200) "\n"
  llen = length(line); lpos = 1; s = ""
  while (1) {
    if (s == "" && !more()) break
    eol = (lpos > llen)
    if (st == "N" || st == "X") {
      p = match(s, /['"`\/#;*-]/)
      if (p == 0) {
        # Không có ký tự đặc biệt trong cửa sổ: giữ lại từ cuối, nó có thể còn tiếp.
        if (!eol && match(s, /[A-Za-z0-9_$]+$/)) {
          if (RSTART == 1) { more(); continue }
          hold = RSTART   # code() runs match() too, which overwrites RSTART
          code(substr(s, 1, hold - 1)); s = substr(s, hold); more(); continue
        }
        code(s); s = ""; more(); continue
      }
      # Các quyết định dưới đây nhìn tới 3 ký tự sau ký tự đặc biệt.
      if (!eol && p + 3 > length(s)) { more(); continue }
      code(substr(s, 1, p - 1))
      c = substr(s, p, 1); s = substr(s, p + 1)
      if (c == ";") { flush(); continue }
      if (c == "'" || c == "\"") { q = c; ret = st; st = "S"; show(c); continue }
      if (c == "`") { ret = st; st = "B"; show(c); continue }
      if (c == "/" && substr(s, 1, 1) == "*" && st == "N") {
        # Số phiên bản sau `/*!` / `/*M!` có thể vắt qua cửa sổ: đọc thêm tới hết số.
        if (substr(s, 2, 1) == "!") { s = substr(s, 3); while (s ~ /^[0-9]*$/ && more()) {}; sub(/^[0-9]*/, "", s); st = "X"; code(" "); continue }
        if (substr(s, 2, 2) == "M!") { s = substr(s, 4); while (s ~ /^[0-9]*$/ && more()) {}; sub(/^[0-9]*/, "", s); st = "X"; code(" "); continue }
        st = "C"; s = substr(s, 2); code(" "); continue
      }
      if (c == "*" && st == "X" && substr(s, 1, 1) == "/") { st = "N"; s = substr(s, 2); code(" "); continue }
      if (c == "#" && st == "N") { s = ""; lpos = llen + 1; continue }
      if (c == "-" && st == "N" && substr(s, 1, 1) == "-" && (length(s) == 1 || substr(s, 2, 1) <= " ")) { s = ""; lpos = llen + 1; continue }
      code(c); continue
    }
    if (st == "S") {
      pq = index(s, q); pb = index(s, "\\")
      if (pq == 0 && pb == 0) { show(s); s = ""; more(); continue }
      p = (pb > 0 && (pq == 0 || pb < pq)) ? pb : pq
      # `\` hoặc nháy ở cuối cửa sổ: cần ký tự kế tiếp (ký tự bị thoát / nháy đôi).
      if (!eol && p == length(s)) { more(); continue }
      if (p == pb) { show(substr(s, 1, pb + 1)); s = substr(s, pb + 2); continue }
      show(substr(s, 1, pq)); s = substr(s, pq + 1)
      if (substr(s, 1, 1) == q) { show(q); s = substr(s, 2); continue }
      st = ret; continue
    }
    if (st == "B") {
      pq = index(s, "`")
      if (pq == 0) { show(s); s = ""; more(); continue }
      if (!eol && pq == length(s)) { more(); continue }
      show(substr(s, 1, pq)); s = substr(s, pq + 1)
      if (substr(s, 1, 1) == "`") { show("`"); s = substr(s, 2); continue }
      st = ret; continue
    }
    # st == "C": chú thích thường, tới */ (giữ `*` cuối cửa sổ cho lượt sau)
    p = index(s, "*/")
    if (p == 0) {
      if (eol) { s = ""; continue }
      s = substr(s, length(s)); more(); continue
    }
    s = substr(s, p + 2); st = "N"
  }
  if (st == "S") show(" "); else code(" ")
}
END {
  if (st != "N") {
    flag = 1
    if (sline == 0) sline = NR
    disp = substr(disp, 1, 100) " … (chuỗi/chú thích chưa đóng tới cuối file — phần sau không quét được)"
  }
  flush()
  printf "%s", rawhits
}
AWK
}

# ── Menu chính ─────────────────────────────────────────────────────────────
banner() {
  echo -e "${C_BOLD}${C_GREEN}"
  cat <<'BANNER'
   ╔═══════════════════════════════════════════════════╗
   ║   CDKT — Production Manager                        ║
   ║   Con Đường Hướng Thiện · C11 Bộ Công an          ║
   ╚═══════════════════════════════════════════════════╝
BANNER
  echo -e "${C_RESET}"
}

main_menu() {
  banner
  echo -e "  ${C_BOLD}1)${C_RESET} Deploy   — thiết lập mới (chạy lần đầu)"
  echo -e "  ${C_BOLD}2)${C_RESET} Update   — cập nhật VPS (pull + restart)"
  echo -e "  ${C_BOLD}3)${C_RESET} Migrate  — nhập data SQL mới"
  echo -e "  ${C_BOLD}4)${C_RESET} Media    — bật/tắt tải video, đặt trần RAM"
  echo -e "  ${C_BOLD}5)${C_RESET} Cài cron sao lưu — sao lưu đêm + kiểm chứng khôi phục hằng tháng"
  echo -e "  ${C_BOLD}6)${C_RESET} Xuất .env đã mã hoá — giữ bí mật ngoài VPS"
  echo -e "  ${C_BOLD}q)${C_RESET} Thoát"
  echo
  prompt "Chọn" ""
  local choice="$PROMPT_RESULT"
  case "$choice" in
    1) cmd_deploy ;;
    2) cmd_update ;;
    3) cmd_migrate ;;
    4) cmd_media_tuning ;;
    5) cmd_backup_cron ;;
    6) cmd_export_env ;;
    q|Q|quit|exit) echo "Tạm biệt."; exit 0 ;;
    *) echo -e "${C_RED}Lựa chọn không hợp lệ.${C_RESET}"; main_menu ;;
  esac
}

# ════════════════════════════════════════════════════════════════════════════
# 1. DEPLOY — thiết lập mới (chạy lần đầu)
# ════════════════════════════════════════════════════════════════════════════
cmd_deploy() {
  echo -e "\n${C_BOLD}${C_CYAN}═══ DEPLOY — Thiết lập mới ═══${C_RESET}\n"

  cd "$ROOT"

  # Kiểm tra .env đã có → cảnh báo
  if [ -f "$ROOT/.env" ]; then
    echo -e "${C_YELLOW}⚠  Đã có .env ở $ROOT/.env${C_RESET}"
    if ! confirm "Ghi đè .env cũ? (mất cấu hình hiện tại)" "n"; then
      echo "Huyỷ. Dùng 'Update' nếu chỉ muốn đổi vài giá trị."
      exit 0
    fi
  fi

  # ── Bước 1: Nguồn cơ sở dữ liệu ─────────────────────────────────────────
  # Chỉ còn MySQL đi kèm docker compose. Lựa chọn "Existing DB" từng có ở đây là
  # lựa chọn chết: docker-compose.yml cố định `DB_HOST: mysql` / `DB_PORT: 3306`
  # cho container app (không đọc DB_HOST/DB_PORT từ .env), nên app luôn nối tới
  # MySQL rỗng đi kèm dù .env khai gì — Deploy báo thành công, mà dữ liệu thật nằm
  # ở một DB không ai dùng. Hỗ trợ MySQL ngoài cần compose cho DB_HOST/DB_PORT đi
  # qua; muốn nạp dữ liệu cũ thì dùng Migrate (3) vào MySQL đi kèm.
  echo -e "\n${C_BOLD}Bước 1/6 — Nguồn cơ sở dữ liệu${C_RESET}"
  echo -e "  MySQL đi kèm docker compose (container ${MYSQL_CONTAINER}) — tạo mới, volume riêng."
  echo -e "${C_DIM}  Dùng MySQL ngoài docker chưa được hỗ trợ: compose cố định DB_HOST=mysql cho app.${C_RESET}"
  echo -e "${C_DIM}  Có dữ liệu cũ? Deploy xong rồi chạy Migrate (3) để nhập file .sql.${C_RESET}"

  # ── Bước 2: DB / user / password / port (gợi ý, bấm enter giữ default) ──
  echo -e "\n${C_BOLD}Bước 2/6 — Cơ sở dữ liệu${C_RESET}"
  echo -e "${C_DIM}Gõ enter để giữ giá trị gợi ý, hoặc sửa rồi enter.${C_RESET}\n"

  local DB_NAME DB_USER DB_PASSWORD MYSQL_ROOT_PASSWORD DB_HOST DB_PORT MYSQL_EXTERNAL_PORT
  MYSQL_ROOT_PASSWORD=$(gen_password)
  prompt "  Tên database" "cdkt_admin"; DB_NAME="$PROMPT_RESULT"
  prompt "  DB user (app dùng)" "cdkt_user"; DB_USER="$PROMPT_RESULT"
  prompt "  DB password (app)" "$(gen_password)"; DB_PASSWORD="$PROMPT_RESULT"
  prompt "  MySQL root password" "$MYSQL_ROOT_PASSWORD"; MYSQL_ROOT_PASSWORD="$PROMPT_RESULT"

  # Port publish ra host (loopback; tránh đụng 3306 nếu máy có MySQL sẵn)
  prompt "  Port publish ra máy chủ" "33069"; MYSQL_EXTERNAL_PORT="$PROMPT_RESULT"
  # DB_HOST/DB_PORT trong .env chỉ phục vụ lệnh chạy TRÊN HOST (npm run db:*,
  # script bảo trì) — qua cổng loopback ở trên. Container app dùng giá trị cố
  # định trong docker-compose.yml, không đọc hai dòng này.
  DB_HOST="127.0.0.1"
  DB_PORT="$MYSQL_EXTERNAL_PORT"

  # ── Bước 2b: Tự chủ webfont (khuyến nghị, làm 1 lần) ───────────────────────
  # Mặc định trang tải font Inter từ fonts.googleapis.com. Với cổng thông tin
  # của Bộ Công an, điều đó có nghĩa là IP của mọi người truy cập đều đi qua một
  # bên thứ ba, và chữ sẽ vỡ bố cục khi mạng chặn hoặc chậm tới CDN đó.
  #
  # Chạy một lần trên máy có Internet (trước khi build):
  #   node scripts/fetch-fonts.mjs
  # Script tải các tệp .woff2 về public/assets/fonts/ và sinh inter.css.
  # nuxt.config.ts tự phát hiện tệp này lúc build và ngừng phát ra thẻ <link>
  # tới Google — không cần sửa cấu hình. Muốn quay lại CDN thì xóa thư mục
  # public/assets/fonts/ rồi build lại.
  if [ ! -f "$ROOT/public/assets/fonts/inter.css" ]; then
    echo -e "\n${C_BOLD}Bước 2b — Tự chủ webfont (Inter)${C_RESET}"
    echo -e "${C_DIM}Font Inter chưa self-host — build sẽ tải từ Google CDN.${C_RESET}"
    echo -e "${C_DIM}Ảnh hưởng quyền riêng tư (IP visitor qua bên thứ 3) + vỡ layout khi CDN chậm/chặn.${C_RESET}"
    if command -v node >/dev/null 2>&1 && confirm "Tự host font Inter ngay (node scripts/fetch-fonts.mjs)?" "y"; then
      echo -e "${C_BOLD}Đang tải Inter về public/assets/fonts/ ...${C_RESET}"
      if (cd "$ROOT" && node scripts/fetch-fonts.mjs); then
        echo -e "${C_GREEN}✓ Font Inter đã self-host. Lần build tới Google <link> sẽ biến mất.${C_RESET}"
      else
        echo -e "${C_YELLOW}⚠  Tải font thất bại (không có Internet?). Build tiếp tục với Google CDN.${C_RESET}"
        echo -e "${C_DIM}    Anh có thể chạy lại sau: node scripts/fetch-fonts.mjs${C_RESET}"
      fi
    else
      echo -e "${C_YELLOW}⚠  Bỏ qua — font sẽ tải từ Google CDN. Chạy 'node scripts/fetch-fonts.mjs' khi có Internet.${C_RESET}"
    fi
  else
    echo -e "${C_GREEN}✓ Font Inter đã self-host (public/assets/fonts/inter.css)${C_RESET}"
  fi

  # ── Bước 3: Các trường app .env cần thiết ─────────────────────────────────
  echo -e "\n${C_BOLD}Bước 3/6 — Cấu hình ứng dụng${C_RESET}"
  echo -e "${C_DIM}Ba bí mật BẮT BUỘC, tự sinh. Gõ enter giữ giá trị ngẫu nhiên, hoặc dán của mình.${C_RESET}\n"

  local JWT_SECRET CHATBOT_ENCRYPTION_SECRET ANALYTICS_HMAC_SECRET
  prompt "  JWT_SECRET (hex 64)" "$(gen_secret)"; JWT_SECRET="$PROMPT_RESULT"
  prompt "  CHATBOT_ENCRYPTION_SECRET (base64 32)" "$(gen_b64)"; CHATBOT_ENCRYPTION_SECRET="$PROMPT_RESULT"
  prompt "  ANALYTICS_HMAC_SECRET (hex 64)" "$(gen_secret)"; ANALYTICS_HMAC_SECRET="$PROMPT_RESULT"

  echo
  local APP_PORT NODE_ENV
  prompt "  App port (publish ra host)" "3000"; APP_PORT="$PROMPT_RESULT"
  NODE_ENV="production"

  # ── Bước 4: Tên miền (public URL) ─────────────────────────────────────────
  echo -e "\n${C_BOLD}Bước 4/6 — Tên miền (PUBLIC_BASE_URL)${C_RESET}"
  echo -e "${C_DIM}Dùng cho redirect OAuth, email link, canonical URL.${C_RESET}"
  echo -e "${C_DIM}Anh tự cấu hình nginx/aaPanel proxy về 127.0.0.1:\$APP_PORT.${C_RESET}\n"
  local PUBLIC_BASE_URL
  prompt "  Domain (https://...)" "https://conduonghuongthien.com.vn"; PUBLIC_BASE_URL="$PROMPT_RESULT"
  # Host được làm gốc liên kết trong email (chống Host giả) — mọi tên miền thật, phẩy ngăn cách.
  local PUBLIC_HOST_ALLOWLIST _base_host
  _base_host="${PUBLIC_BASE_URL#*://}"; _base_host="${_base_host%%/*}"
  prompt "  PUBLIC_HOST_ALLOWLIST (tên miền thật, phẩy ngăn cách)" "$_base_host"; PUBLIC_HOST_ALLOWLIST="$PROMPT_RESULT"

  # ── Bước 5: ADMIN_PASSWORD + ghi .env ────────────────────────────────────
  echo -e "\n${C_BOLD}Bước 5/6 — Tài khoản SuperAdmin (chỉ lần đầu)${C_RESET}"
  local ADMIN_PASSWORD ADMIN_EMAIL
  prompt "  ADMIN_PASSWORD (≥12 ký tự, đủ 3/4 nhóm)" "$(gen_password)"; ADMIN_PASSWORD="$PROMPT_RESULT"
  prompt "  ADMIN_EMAIL" "admin@conduonghuongthien.com.vn"; ADMIN_EMAIL="$PROMPT_RESULT"

  # Proxy tin cậy — mặc định docker bridge gateway, anh có thể sửa
  local TRUSTED_PROXY_IPS
  prompt "  TRUSTED_PROXY_IPS (dải CIDR docker)" "172.16.0.0/12"; TRUSTED_PROXY_IPS="$PROMPT_RESULT"

  # Giám sát cron sao lưu (tuỳ chọn): scripts/backup-db.sh và verify-restore.sh gọi
  # URL này khi xong (…/fail khi hỏng). Chỉ script trên host đọc — không vào compose.
  local HEALTHCHECK_PING_URL
  prompt "  HEALTHCHECK_PING_URL (tuỳ chọn, vd. https://hc-ping.com/<uuid> — enter = bỏ qua)" ""; HEALTHCHECK_PING_URL="$PROMPT_RESULT"
  if [ -n "$HEALTHCHECK_PING_URL" ] && ! valid_ping_url "$HEALTHCHECK_PING_URL"; then
    echo -e "${C_YELLOW}⚠  HEALTHCHECK_PING_URL không hợp lệ (chỉ http(s), không ?/&/#) — để trống; đặt lại sau bằng Update.${C_RESET}"
    HEALTHCHECK_PING_URL=""
  fi

  # Thư cảnh báo vận hành (tuỳ chọn): app gửi qua SMTP đã cấu hình trong admin khi
  # khôi phục hỏng, khoá MFA, Host giả… — tối đa 1 thư mỗi sự kiện mỗi 15 phút.
  local OPS_ALERT_EMAIL
  prompt "  OPS_ALERT_EMAIL (tuỳ chọn — địa chỉ nhận cảnh báo vận hành, phẩy ngăn cách; enter = bỏ qua)" ""; OPS_ALERT_EMAIL="${PROMPT_RESULT//[[:space:]]/}"
  if [ -n "$OPS_ALERT_EMAIL" ] && ! valid_alert_emails "$OPS_ALERT_EMAIL"; then
    echo -e "${C_YELLOW}⚠  OPS_ALERT_EMAIL không hợp lệ (vd. ops@donvi.gov.vn, nhiều địa chỉ thì phẩy ngăn cách) — để trống; đặt lại sau bằng Update.${C_RESET}"
    OPS_ALERT_EMAIL=""
  fi

  # Tải video lên máy chủ: tôn trọng ngưỡng RAM. docker-compose.yml nói rõ chỉ
  # `manage.sh media-tuning` — sau khi ĐO RAM máy chủ — mới được bật
  # MEDIA_UPLOAD_ENABLED, vì FFmpeg chạy 3 bản transcode song song và trên VPS nhỏ
  # lượt xử lý đầu tiên khiến OOM-killer hạ MỘT CONTAINER KHÁC. Deploy từng ghi cứng
  # `true` và bỏ qua phép đo đó. Ngưỡng này PHẢI bằng RAM_FLOOR_MB của
  # cmd_media_tuning (tests/ops-scripts.test.ts canh hai bên khớp nhau).
  local RAM_FLOOR_MB=4000 host_ram MEDIA_UPLOAD_ENABLED
  if host_ram=$(read_host_ram_mb) && [ "$host_ram" -ge "$RAM_FLOOR_MB" ]; then
    MEDIA_UPLOAD_ENABLED=true
    echo -e "${C_GREEN}✓ RAM máy chủ ${host_ram}MB ≥ ${RAM_FLOOR_MB}MB — bật tải video (MEDIA_UPLOAD_ENABLED=true).${C_RESET}"
    echo -e "${C_DIM}  Tắt/chỉnh sau bằng: ./manage.sh media-tuning${C_RESET}"
  else
    MEDIA_UPLOAD_ENABLED=false
    if [ -n "${host_ram:-}" ]; then
      echo -e "${C_YELLOW}⚠  RAM máy chủ ${host_ram}MB < ${RAM_FLOOR_MB}MB — TẮT tải video (MEDIA_UPLOAD_ENABLED=false).${C_RESET}"
      echo -e "${C_YELLOW}   Transcode FFmpeg trên máy nhỏ làm OOM-killer hạ container khác. Cổng vẫn chạy với video YouTube/CDN.${C_RESET}"
    else
      echo -e "${C_YELLOW}⚠  Không đọc được RAM máy chủ — TẮT tải video (MEDIA_UPLOAD_ENABLED=false) cho an toàn.${C_RESET}"
    fi
    echo -e "${C_DIM}  Muốn bật dù thiếu RAM (không khuyến nghị): ./manage.sh media-tuning${C_RESET}"
  fi

  echo -e "\n${C_BOLD}Đang tạo .env ...${C_RESET}"
  # Ghi vào tệp tạm (mktemp tạo sẵn quyền 600) rồi `mv`: tệp chứa bí mật không lúc
  # nào mang quyền 644, và một lần ghi đứt giữa chừng không để lại .env cụt. `cat >`
  # thẳng lên .env cũ giữ nguyên quyền cũ của nó (thường 644).
  local env_tmp
  env_tmp=$(mktemp "$ROOT/.env.manage.XXXXXX")
  cat > "$env_tmp" <<EOF
# ─── Auto-generated by production/manage.sh  $(date '+%Y-%m-%d %H:%M') ──
# KHÔNG commit file này (đã .gitignore). Sửa tay an toàn.

# ─── MySQL ───────────────────────────────────────
MYSQL_ROOT_PASSWORD=$MYSQL_ROOT_PASSWORD
MYSQL_DATABASE=$DB_NAME
MYSQL_USER=$DB_USER
MYSQL_PASSWORD=$DB_PASSWORD
MYSQL_EXTERNAL_PORT=$MYSQL_EXTERNAL_PORT

# Chỉ cho lệnh chạy trên HOST (qua cổng loopback ở trên). Container app dùng
# DB_HOST=mysql / DB_PORT=3306 cố định trong docker-compose.yml, không đọc 2 dòng này.
DB_HOST=$DB_HOST
DB_PORT=$DB_PORT
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
DB_NAME=$DB_NAME

# ─── App ─────────────────────────────────────────
PORT=$APP_PORT
NODE_ENV=$NODE_ENV
APP_BIND=127.0.0.1

# Public URL — cho OAuth redirect, email, canonical
PUBLIC_BASE_URL=$PUBLIC_BASE_URL
# Host được làm gốc liên kết email; host lạ → dùng PUBLIC_BASE_URL
PUBLIC_HOST_ALLOWLIST=$PUBLIC_HOST_ALLOWLIST

# ─── Bí mật BẮT BUỘC ───────────────────────────
JWT_SECRET=$JWT_SECRET
CHATBOT_ENCRYPTION_SECRET=$CHATBOT_ENCRYPTION_SECRET
ANALYTICS_HMAC_SECRET=$ANALYTICS_HMAC_SECRET
ANALYTICS_COLLECTION_ENABLED=true
NUXT_ANALYTICS_COLLECTION_ENABLED=true

# ─── Proxy tin cậy (sau nginx) ──────────────────
TRUSTED_PROXY_IPS=$TRUSTED_PROXY_IPS

# ─── Tài khoản SuperAdmin (chỉ lần đầu, seed insert-only) ────
ADMIN_PASSWORD=$ADMIN_PASSWORD
ADMIN_EMAIL=$ADMIN_EMAIL

# CI ghi đè dòng này mỗi lần deploy; có thể đặt tay
CDKT_IMAGE=ghcr.io/duogxaolin/conduonghuongthien:latest

# ─── Media Portal ───────────────────────────────
# Tải video lên máy chủ: chỉ bật sẵn khi RAM máy chủ >= ${RAM_FLOOR_MB}MB (ngưỡng
# thật của pipeline transcode, xem manage.sh media-tuning). Đổi sau bằng media-tuning.
MEDIA_UPLOAD_ENABLED=$MEDIA_UPLOAD_ENABLED
MEDIA_UPLOAD_MAX_SIZE=10737418240
MEDIA_UPLOAD_CHUNK_SIZE=10485760
MEDIA_DISK_FLOOR_BYTES=1073741824
MEDIA_PROCESSING_MAX_JOBS=1
MEDIA_PROCESSING_MAX_ATTEMPTS=3
MEDIA_PROCESSING_HEARTBEAT_SECONDS=300
MEDIA_PROCESSING_STALE_MINUTES=10
MEDIA_UPLOAD_SESSION_HOURS=24
# Bật auto-transcode: upload xong tự nén 360/720/1080p dưới nền worker, không cần
# cán bộ bấm nút. Đổi sang false để tắt (chỉ probe+thumbnail, bấm "Chuyển mã" thủ công).
MEDIA_AUTO_TRANSCODE=true
# Giới hạn ffmpeg 50% CPU — không ăn sạch mọi nhân khi transcode.
MEDIA_PROCESSING_CPU_LIMIT=50

# ─── Chat trực tiếp: 1 bản sao ──────────────────
# Đặt 1 để tắt cảnh báo replica SSE lúc khởi động (đang chạy 1 container).
CDKT_SSE_REPLICA_GUARD=1

# ─── Backup ─────────────────────────────────────
BACKUP_DIR=./backups
BACKUP_KEEP_DAYS=14
# Ping giám sát cho cron backup-db.sh / verify-restore.sh (trống = không ping).
# Chỉ script trên host đọc, không vào container (compose không liệt kê).
HEALTHCHECK_PING_URL=$HEALTHCHECK_PING_URL

# ─── Cảnh báo vận hành ──────────────────────────
# Thư cảnh báo (khôi phục hỏng, khoá MFA, Host giả, ghi khác site, khe sao lưu bị bỏ…)
# gửi qua SMTP cấu hình trong admin; tối đa 1 thư mỗi sự kiện mỗi 15 phút (ghi khác
# site: 6 giờ). Trống = không gửi.
OPS_ALERT_EMAIL=$OPS_ALERT_EMAIL

# ─── Chính sách MFA: công tắc khẩn cấp ──────────
# Trống (mặc định) = cưỡng chế MFA theo chính sách ở /admin/settings/security; bỏ dấu # và đặt 0 chỉ khi một yếu tố MFA hỏng hàng loạt, bỏ lại ngay khi xong sự cố.
# MFA_ENFORCEMENT=
EOF
  chmod 600 "$env_tmp"
  mv -f "$env_tmp" "$ROOT/.env"
  secure_env_file

  echo -e "${C_GREEN}✓ Đã tạo $ROOT/.env (quyền 600)${C_RESET}"

  # Log app vào journald; máy chủ không có journald → override json-file (in cảnh báo).
  # Trước bước khởi động — kể cả khi anh chọn tự `docker compose up -d` sau. Cấu hình
  # log hiệu lực không chạy được trên máy này → dừng, chưa container nào khởi động.
  if ! ensure_log_driver "$(env_get CDKT_IMAGE)"; then
    echo -e "${C_RED}✗ DEPLOY DỪNG trước khi khởi động — sửa cấu hình log ở trên rồi chạy lại. .env đã tạo ở $ROOT/.env.${C_RESET}"
    exit 1
  fi

  # ── Bước 6: Hỏi build luôn ─────────────────────────────────────────────────
  echo -e "\n${C_BOLD}Bước 6/6 — Khởi động${C_RESET}"
  local do_start
  if confirm "Kéo image CI + khởi động ngay (docker pull + docker compose up -d)?" "y"; then
    do_start=1
  else
    do_start=0
    echo -e "${C_DIM}Anh có thể chạy sau: cd .. && docker pull <CDKT_IMAGE trong .env> && docker compose up -d${C_RESET}"
  fi

  if [ "$do_start" = "1" ]; then
    # Image do CI dựng và đẩy lên GHCR: kéo về, KHÔNG build trên VPS. `nuxi build`
    # ngốn RAM và trên VPS nhỏ bị OOM-kill giữa chừng (docker-compose.yml, service
    # app). Build tại chỗ chỉ còn là phương án dự phòng, hỏi tường minh.
    #
    # `docker pull <image>` chứ không `docker compose pull app`: với service vừa có
    # `image:` vừa có `build:`, một số bản Compose in "must be built from source" và
    # thoát 0 khi không kéo được — rồi `up -d` ngay sau đó âm thầm BUILD trên VPS, đúng
    # ca OOM cần tránh. Nên sau khi kéo còn kiểm image thật sự có mặt (`image inspect`)
    # trước khi cho `up` chạy; kiểm này đúng với mọi bản Compose.
    local deploy_img
    deploy_img=$(env_get CDKT_IMAGE)
    echo -e "\n${C_BOLD}Kéo image ${deploy_img} ...${C_RESET}"
    if ! docker pull "$deploy_img" || ! docker image inspect "$deploy_img" >/dev/null 2>&1; then
      echo -e "${C_YELLOW}⚠  Không kéo được image (registry, thẻ, hoặc chưa 'docker login ghcr.io' — package GHCR là private).${C_RESET}"
      echo -e "${C_YELLOW}   Build trên VPS cần nhiều RAM; thiếu RAM thì bị OOM-killer hạ build (hoặc một container khác).${C_RESET}"
      if confirm "Vẫn build image trên VPS này (docker compose build app)?" "n"; then
        docker compose build app || { echo -e "${C_RED}✗ Build thất bại. .env đã tạo; container chưa khởi động.${C_RESET}"; exit 1; }
      else
        echo -e "${C_RED}✗ Chưa có image nên chưa khởi động. .env đã tạo ở $ROOT/.env.${C_RESET}"
        echo -e "${C_DIM}   Đăng nhập GHCR (docker login ghcr.io) hoặc chờ CI đẩy image, rồi chạy Deploy/Update lại.${C_RESET}"
        exit 1
      fi
    fi
    echo -e "\n${C_BOLD}Đang docker compose up -d ...${C_RESET}"
    docker compose up -d
    echo -e "${C_BOLD}Đợi healthcheck...${C_RESET}"
    if ! wait_app_healthy; then
      show_app_logs
      echo -e "${C_RED}✗ DEPLOY KHÔNG THÀNH CÔNG — cdkt_app không healthy. Xem log ở trên.${C_RESET}"
      exit 1
    fi
    # Nếu có migration folder có file → hỏi import
    if [ -d "$MIG_DIR" ] && ls "$MIG_DIR"/*.sql >/dev/null 2>&1; then
      echo
      if confirm "Có file SQL trong production/migrations/ — import luôn?" "y"; then
        cmd_migrate
      fi
    fi
  fi

  echo -e "\n${C_GREEN}${C_BOLD}═══ DEPLOY XONG ═══${C_RESET}"
  echo -e "  .env:        $ROOT/.env"
  echo -e "  App:         http://127.0.0.1:$APP_PORT  (sau nginx: $PUBLIC_BASE_URL)"
  echo -e "  Admin:       $PUBLIC_BASE_URL/admin  (user: admin / mật khẩu trong .env)"
  echo -e "  Logs:        docker compose logs -f app"
  echo
  echo -e "${C_YELLOW}⚠  NHỚ: đổi mật khẩu admin sau lần đăng nhập đầu tiên.${C_RESET}"
  echo -e "${C_DIM}    Xem README.md để biết luồng update/migrate.${C_RESET}"
}

# ════════════════════════════════════════════════════════════════════════════
# 2. UPDATE — cập nhật VPS (pull + restart)
# ════════════════════════════════════════════════════════════════════════════
cmd_update() {
  echo -e "\n${C_BOLD}${C_CYAN}═══ UPDATE — Cập nhật VPS ═══${C_RESET}\n"
  cd "$ROOT"

  if [ ! -f "$ROOT/.env" ]; then
    echo -e "${C_RED}Không có .env — chạy 'Deploy' (1) trước.${C_RESET}"
    exit 1
  fi
  # .env do bản Deploy cũ tạo mang quyền 644: siết lại ngay lượt Update đầu tiên.
  secure_env_file

  # ── Hiển thị trạng thái cũ ─────────────────────────────────────────────────
  echo -e "${C_BOLD}Trạng thái hiện tại:${C_RESET}"
  local cur_img cur_port cur_domain
  cur_img=$(env_get CDKT_IMAGE)
  cur_port=$(env_get PORT)
  cur_domain=$(env_get PUBLIC_BASE_URL)
  echo -e "  Image:    ${cur_img:-chưa đặt}"
  echo -e "  Port:     ${cur_port:-3000}"
  echo -e "  Domain:   ${cur_domain:-chưa đặt}"
  docker compose ps --format "table {{.Name}}\t{{.Status}}" 2>/dev/null || true
  echo

  # ── Sao lưu CSDL — TRƯỚC mọi thay đổi ───────────────────────────────────────
  # Điểm lùi dữ liệu, cùng bản dump CI deploy tự làm (scripts/deploy-remote.sh
  # `predeploy_dump`) và cùng chỗ trong luồng: trước git pull (đổi compose), trước
  # các câu hỏi ghi .env, trước khi kéo/đổi image. Trước nó chỉ có bước siết quyền
  # .env về 600 (secure_env_file — không đổi nội dung). Dump hỏng thì dừng: máy chủ y
  # như trước lượt Update. Trả lời 'n' chỉ khi đã có bản sao lưu mới, hoặc chính bước
  # sao lưu là thứ đang hỏng.
  #
  # CDKT_UPDATE_RESUMED=1: đây là manage.sh VỪA KÉO VỀ, được bản cũ gọi lại ngay sau
  # `git pull` (khối "Pull code" bên dưới) — sao lưu và pull đã xong ở bản cũ, chỉ chạy
  # tiếp phần còn lại bằng mã mới.
  if [ "${CDKT_UPDATE_RESUMED:-}" = 1 ]; then
    UPDATE_COMPOSE_BACKUP="${CDKT_UPDATE_COMPOSE_BACKUP:-}"
    echo -e "${C_DIM}▸ Tiếp tục Update bằng manage.sh vừa kéo về (sao lưu DB + pull code đã xong ở bước trước).${C_RESET}"
  else
    if confirm "Sao lưu DB trước khi cập nhật?" "y"; then
      echo -e "${C_BOLD}Sao lưu CSDL → .deploy-db-backups/ ...${C_RESET}"
      if ! update_predeploy_dump; then
        echo -e "${C_RED}✗ Sao lưu CSDL thất bại — dừng. Chưa pull code, chưa sửa .env, chưa kéo image hay khởi động lại gì.${C_RESET}"
        echo -e "${C_DIM}   Sửa nguyên nhân (đĩa đầy? mysql không chạy?) rồi chạy lại Update.${C_RESET}"
        exit 1
      fi
    fi

    # ── Pull code ───────────────────────────────────────────────────────────
    # CI ghi đè docker-compose.yml trên VPS → cây git "bẩn" → git pull từ chối. Xử lý
    # (sao lưu + bỏ thay đổi cục bộ của tệp đó) nằm trong update_pull_code.
    local manage_before manage_after
    manage_before=$(sha256sum "$PROD/manage.sh" 2>/dev/null | cut -d' ' -f1 || true)
    update_pull_code
    # Pull vừa đổi chính tệp này: phần còn lại của Update (kiểm log journald, kéo image,
    # khởi động lại) phải chạy bằng mã MỚI — bash đang chạy bản cũ đã nạp. `exec` giữ
    # nguyên stdin (các câu trả lời kế tiếp) và trao lại bản sao lưu compose của lượt này
    # cho đường lùi. Bản mới nhận CDKT_UPDATE_RESUMED=1 nên không pull lại (không lặp).
    manage_after=$(sha256sum "$PROD/manage.sh" 2>/dev/null | cut -d' ' -f1 || true)
    if [ -n "$manage_before" ] && [ "$manage_after" != "$manage_before" ]; then
      echo -e "${C_BOLD}▸ manage.sh vừa đổi theo git pull — chạy tiếp Update bằng bản mới (không hỏi lại sao lưu/pull).${C_RESET}"
      exec env CDKT_UPDATE_RESUMED=1 CDKT_UPDATE_COMPOSE_BACKUP="$UPDATE_COMPOSE_BACKUP" bash "$PROD/manage.sh" update
    fi
  fi

  # ── Tự chủ webfont (kiểm tra lại sau pull) ────────────────────────────────
  # Font Inter nên self-host để tránh IP visitor qua Google CDN. Sau git pull,
  # thư mục public/assets/fonts/ có thể mới (chưa self-host) hoặc cũ (refresh).
  if [ ! -f "$ROOT/public/assets/fonts/inter.css" ]; then
    echo
    echo -e "${C_YELLOW}⚠  Font Inter chưa self-host — trang đang tải từ Google CDN.${C_RESET}"
    if command -v node >/dev/null 2>&1 && confirm "Tự host font Inter (node scripts/fetch-fonts.mjs)?" "y"; then
      if (cd "$ROOT" && node scripts/fetch-fonts.mjs); then
        echo -e "${C_GREEN}✓ Font Inter đã self-host. Rebuild để áp dụng.${C_RESET}"
      else
        echo -e "${C_YELLOW}⚠  Tải font thất bại (không có Internet?). Build tiếp tục với Google CDN.${C_RESET}"
      fi
    fi
  fi

  # ── Cho sửa vài trường quan trọng ─────────────────────────────────────────
  echo -e "\n${C_BOLD}Sửa cấu hình (gõ enter giữ giá trị cũ)${C_RESET}"
  local new_port new_domain
  prompt "  PORT" "$cur_port"; new_port="$PROMPT_RESULT"
  prompt "  PUBLIC_BASE_URL" "$cur_domain"; new_domain="$PROMPT_RESULT"
  if [ "$new_port" != "$cur_port" ] || [ "$new_domain" != "$cur_domain" ]; then
    if confirm "Cập nhật .env với giá trị mới?" "y"; then
      [ "$new_port" != "$cur_port" ] && sed -i "s|^PORT=.*|PORT=$new_port|" "$ROOT/.env"
      [ "$new_domain" != "$cur_domain" ] && sed -i "s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=$new_domain|" "$ROOT/.env"
      echo -e "${C_GREEN}✓ .env đã cập nhật${C_RESET}"
    fi
  fi
  # PUBLIC_HOST_ALLOWLIST: .env cũ chưa có thì gợi ý host của PUBLIC_BASE_URL.
  local cur_hosts new_hosts _base_host
  cur_hosts=$(env_get PUBLIC_HOST_ALLOWLIST)
  _base_host="${new_domain#*://}"; _base_host="${_base_host%%/*}"
  prompt "  PUBLIC_HOST_ALLOWLIST (tên miền thật, phẩy ngăn cách)" "${cur_hosts:-$_base_host}"; new_hosts="$PROMPT_RESULT"
  if [ "$new_hosts" != "$cur_hosts" ] && confirm "Ghi PUBLIC_HOST_ALLOWLIST=$new_hosts vào .env?" "y"; then
    set_env PUBLIC_HOST_ALLOWLIST "$new_hosts"
    echo -e "${C_GREEN}✓ .env đã cập nhật${C_RESET}"
  fi
  # OPS_ALERT_EMAIL — địa chỉ nhận thư cảnh báo vận hành (wave2 D-ALERT). Không phải bí
  # mật nên in được. Enter giữ nguyên (không hỏi thêm), '-' xoá. Phải đứng TRƯỚC prompt
  # HEALTHCHECK_PING_URL bên dưới — prompt đó phải là prompt cuối.
  local cur_alert new_alert
  cur_alert=$(env_get OPS_ALERT_EMAIL)
  prompt "  OPS_ALERT_EMAIL (thư cảnh báo vận hành, phẩy ngăn cách; enter = giữ nguyên, '-' = xoá)" "$cur_alert"; new_alert="${PROMPT_RESULT//[[:space:]]/}"
  if [ "$new_alert" = "-" ]; then
    if [ -n "$cur_alert" ] && confirm "Xoá OPS_ALERT_EMAIL khỏi .env (tắt thư cảnh báo)?" "y"; then
      set_env OPS_ALERT_EMAIL ""
      echo -e "${C_GREEN}✓ .env đã cập nhật (OPS_ALERT_EMAIL trống — không gửi cảnh báo)${C_RESET}"
    fi
  elif [ "$new_alert" != "$cur_alert" ]; then
    if ! valid_alert_emails "$new_alert"; then
      echo -e "${C_YELLOW}⚠  OPS_ALERT_EMAIL không hợp lệ (vd. ops@donvi.gov.vn, nhiều địa chỉ thì phẩy ngăn cách) — giữ nguyên giá trị cũ.${C_RESET}"
    elif confirm "Ghi OPS_ALERT_EMAIL=$new_alert vào .env?" "y"; then
      set_env OPS_ALERT_EMAIL "$new_alert"
      echo -e "${C_GREEN}✓ .env đã cập nhật OPS_ALERT_EMAIL${C_RESET}"
    fi
  fi
  # HEALTHCHECK_PING_URL — ping giám sát cho cron sao lưu (scripts/backup-db.sh,
  # verify-restore.sh). URL là thứ ai có nó đều báo "đã chạy" thay được, nên KHÔNG in
  # ra màn hình: chỉ nói đang đặt hay chưa. Prompt này phải là prompt CUỐI trước
  # "Pull image" (tests/ops-scripts-sandbox.test.ts trả lời nó theo vị trí).
  local cur_ping new_ping ping_state="chưa đặt"
  cur_ping=$(env_get HEALTHCHECK_PING_URL)
  if [ -n "$cur_ping" ]; then ping_state="đang đặt"; fi
  echo -e "${C_DIM}  HEALTHCHECK_PING_URL hiện ${ping_state}.${C_RESET}"
  prompt "  HEALTHCHECK_PING_URL (enter = giữ nguyên, '-' = xoá)" ""; new_ping="$PROMPT_RESULT"
  if [ "$new_ping" = "-" ]; then
    if [ -n "$cur_ping" ] && confirm "Xoá HEALTHCHECK_PING_URL khỏi .env?" "y"; then
      set_env HEALTHCHECK_PING_URL ""
      echo -e "${C_GREEN}✓ .env đã cập nhật (HEALTHCHECK_PING_URL trống)${C_RESET}"
    fi
  elif [ -n "$new_ping" ] && [ "$new_ping" != "$cur_ping" ]; then
    if ! valid_ping_url "$new_ping"; then
      echo -e "${C_YELLOW}⚠  HEALTHCHECK_PING_URL không hợp lệ (chỉ http(s), không ?/&/#) — giữ nguyên giá trị cũ.${C_RESET}"
    elif confirm "Ghi HEALTHCHECK_PING_URL mới vào .env?" "y"; then
      set_env HEALTHCHECK_PING_URL "$new_ping"
      echo -e "${C_GREEN}✓ .env đã cập nhật HEALTHCHECK_PING_URL${C_RESET}"
    fi
  fi

  # ── Pull image + restart ─────────────────────────────────────────────────
  # VPS đang chạy chưa từng chạy lại Deploy: kiểm journald ở đây, trước lượt khởi động
  # lại (cùng hàm với lượt CI deploy). Không hỏi; cấu hình log hiệu lực không chạy được
  # trên máy này → dừng trước khi kéo image hay khởi động lại.
  if ! ensure_log_driver "$(env_get CDKT_IMAGE)"; then
    echo -e "${C_RED}✗ UPDATE DỪNG trước khi kéo image/khởi động lại — sửa cấu hình log ở trên rồi chạy lại Update. Container đang chạy không bị đụng.${C_RESET}"
    exit 1
  fi
  echo
  if confirm "Pull image mới + khởi động lại (docker compose pull && up -d)?" "y"; then
    # Bản dump trước cập nhật đã lấy ở đầu lượt Update (trước git pull).
    # Kéo + khởi động lại + đợi healthy + TỰ LÙI nếu bản mới hỏng (xem
    # update_app_image). Thất bại = thoát khác 0, không in "UPDATE XONG".
    if ! update_app_image; then
      echo -e "\n${C_RED}${C_BOLD}═══ UPDATE THẤT BẠI ═══${C_RESET}"
      docker compose ps --format "table {{.Name}}\t{{.Status}}" 2>/dev/null || true
      exit 1
    fi
  fi

  # ── Hỏi migrate ────────────────────────────────────────────────────────────
  if [ -d "$MIG_DIR" ] && ls "$MIG_DIR"/*.sql >/dev/null 2>&1; then
    echo
    if confirm "Có file SQL mới trong production/migrations/ — chạy migrate?" "n"; then
      cmd_migrate
    fi
  fi

  echo -e "\n${C_GREEN}${C_BOLD}═══ UPDATE XONG ═══${C_RESET}"
  docker compose ps --format "table {{.Name}}\t{{.Status}}" 2>/dev/null || true
}

# ════════════════════════════════════════════════════════════════════════════
# 3. MIGRATE — nhập data SQL mới
# ════════════════════════════════════════════════════════════════════════════
cmd_migrate() {
  echo -e "\n${C_BOLD}${C_CYAN}═══ MIGRATE — Nhập data SQL ═══${C_RESET}\n"
  cd "$ROOT"

  if [ ! -f "$ROOT/.env" ]; then
    echo -e "${C_RED}Không có .env — chạy 'Deploy' (1) trước.${C_RESET}"
    exit 1
  fi

  # Quét production/migrations/*.sql
  if [ ! -d "$MIG_DIR" ]; then
    echo -e "${C_YELLOW}Không có thư mục production/migrations/.${C_RESET}"
    mkdir -p "$MIG_DIR"
    echo -e "${C_DIM}Đã tạo. Thả file .sql vào đó rồi chạy lại.${C_RESET}"
    exit 0
  fi

  # Mật khẩu root + tên database: CHỈ lấy từ .env của deploy này. Không lùi về
  # DB_PASSWORD: đó là mật khẩu của user ỨNG DỤNG, còn lệnh dưới đăng nhập bằng root —
  # lùi về nó chỉ cho ra lỗi "Access denied" khó hiểu. Tên database cũng đọc từ
  # .env (Deploy bước 2 cho đặt tên tuỳ ý), không cố định `cdkt_admin`.
  local root_pw db
  root_pw=$(env_get MYSQL_ROOT_PASSWORD)
  if [ -z "$root_pw" ]; then
    echo -e "${C_RED}Không tìm thấy MYSQL_ROOT_PASSWORD trong .env${C_RESET}"
    exit 1
  fi
  db=$(db_name)
  echo -e "${C_DIM}Database đích: ${db} (container ${MYSQL_CONTAINER})${C_RESET}"

  # Đếm số bài hiện tại để đối chiếu. `</dev/null`: `docker exec -i` không được
  # nuốt stdin của script (các câu trả lời menu phía sau).
  local before_count
  before_count=$(mysql_exec "$root_pw" "$db" -N -e "SELECT COUNT(*) FROM articles;" 2>/dev/null </dev/null | tail -n1) || before_count="?"

  # Liệt kê file SQL + trạng thái đã import hay chưa
  echo -e "${C_BOLD}File SQL trong production/migrations/:${C_RESET}\n"
  local files=()
  local i=0
  for f in "$MIG_DIR"/*.sql; do
    [ -f "$f" ] || continue
    local name
    name=$(basename "$f")
    local marker="$MIG_DIR/.imported-$name"
    local status="chưa"
    if [ -f "$marker" ]; then status="${C_GREEN}đã import${C_RESET}"; fi
    # Kích thước
    local sz
    sz=$(du -h "$f" | cut -f1)
    # Dấu cảnh báo thật, từ việc quét nội dung file (không phải dòng chữ tĩnh).
    local danger_n
    danger_n=$(sql_destructive_lines "$f" | wc -l | tr -d ' ')
    if [ "$danger_n" -gt 0 ]; then status="$status  ${C_RED}⚠ ${danger_n} lệnh DROP/TRUNCATE/DELETE…${C_RESET}"; fi
    printf "  [%d] %-40s %6s  %b\n" "$((i+1))" "$name" "$sz" "$status"
    files+=("$f")
    i=$((i+1))
  done

  if [ ${#files[@]} -eq 0 ]; then
    echo -e "${C_YELLOW}Không có file .sql nào. Thả file vào production/migrations/ rồi chạy lại.${C_RESET}"
    exit 0
  fi

  echo -e "\n${C_DIM}Bài viết hiện tại trong DB: ${before_count}${C_RESET}"
  echo -e "${C_DIM}Mỗi file được quét tìm DROP, TRUNCATE, DELETE, UPDATE không WHERE và SQL động PREPARE/EXECUTE (bỏ qua chú thích, kể cả xuống dòng giữa lệnh).${C_RESET}"
  echo -e "${C_DIM}File bị đánh dấu ⚠ sẽ XÓA data cũ rồi chèn mới và đòi xác nhận riêng. Đảm bảo có backup!${C_RESET}"

  # Hỏi chọn file
  echo
  local sel
  prompt "Chọn file để import (số, hoặc 'all' cho tất cả chưa import)" "all"; sel="$PROMPT_RESULT"

  local to_import=()
  if [ "$sel" = "all" ]; then
    for f in "${files[@]}"; do
      local name
      name=$(basename "$f")
      [ -f "$MIG_DIR/.imported-$name" ] || to_import+=("$f")
    done
  else
    if ! [[ "$sel" =~ ^[0-9]+$ ]]; then
      echo -e "${C_RED}Lựa chọn không hợp lệ.${C_RESET}"; exit 1
    fi
    local idx=$((sel - 1))
    if [ "$idx" -ge 0 ] && [ "$idx" -lt "${#files[@]}" ]; then
      to_import+=("${files[$idx]}")
    else
      echo -e "${C_RED}Lựa chọn không hợp lệ.${C_RESET}"; exit 1
    fi
  fi

  if [ ${#to_import[@]} -eq 0 ]; then
    echo -e "${C_DIM}Không có file nào chưa import.${C_RESET}"
    exit 0
  fi

  echo -e "\n${C_BOLD}Sẽ import vào database '${db}':${C_RESET}"
  for f in "${to_import[@]}"; do echo "  - $(basename "$f")"; done
  echo
  if ! confirm "Xác nhận import?" "n"; then
    echo "Huyỷ."; exit 0
  fi

  # File có lệnh phá dữ liệu: đòi gõ lại ĐÚNG tên file (một cái "y" lặp thói quen
  # không đủ cho thao tác xoá bảng). Không gõ đúng → bỏ qua file đó, không import.
  local confirmed=()
  for f in "${to_import[@]}"; do
    local name
    name=$(basename "$f")
    local danger
    danger=$(sql_destructive_lines "$f")
    if [ -n "$danger" ]; then
      echo -e "\n${C_RED}${C_BOLD}⚠  $name chứa lệnh XÓA/GHI ĐÈ dữ liệu cũ:${C_RESET}"
      # Here-string, không `printf | head`: head thoát sau 8 dòng, printf của một danh
      # sách dài (dump lớn) ăn SIGPIPE, và dưới `set -o pipefail` + `set -e` cả script
      # chết giữa chừng — ngay trước câu hỏi xác nhận.
      head -n 8 <<< "$danger" | sed 's/^/    /'
      if [ "$(wc -l <<< "$danger" | tr -d ' ')" -gt 8 ]; then
        echo "    … (còn nữa)"
      fi
      echo -e "${C_YELLOW}   Bảng bị DROP/TRUNCATE, hàng bị DELETE/UPDATE sẽ mất dữ liệu hiện có trong '${db}'. Cần có bản sao lưu (scripts/backup-db.sh).${C_RESET}"
      local typed
      prompt "   Gõ đúng tên file '$name' để xác nhận (enter = bỏ qua file này)" ""; typed="$PROMPT_RESULT"
      if [ "$typed" != "$name" ]; then
        echo -e "${C_DIM}   → Bỏ qua $name (không import).${C_RESET}"
        continue
      fi
    fi
    confirmed+=("$f")
  done
  if [ ${#confirmed[@]} -eq 0 ]; then
    echo -e "${C_DIM}Không có file nào được xác nhận — không import gì.${C_RESET}"
    exit 0
  fi

  # Import lần lượt
  for f in "${confirmed[@]}"; do
    local name
    name=$(basename "$f")
    echo -e "\n${C_BOLD}Import $name ...${C_RESET}"
    # Thành công/thất bại quyết định bằng MÃ THOÁT của mysql, không bằng việc lọc
    # chữ trên stderr (cảnh báo của từng bản mysql một khác). stderr được giữ lại để
    # hiện: là cảnh báo khi thành công, là nguyên nhân khi thất bại.
    local err_out
    if err_out=$(mysql_exec "$root_pw" "$db" < "$f" 2>&1 1>/dev/null); then
      touch "$MIG_DIR/.imported-$name"
      echo -e "${C_GREEN}✓ $name đã import${C_RESET}"
      if [ -n "$err_out" ]; then
        echo -e "${C_DIM}  mysql cảnh báo:${C_RESET}"
        printf '%s\n' "$err_out" | sed 's/^/    /'
      fi
    else
      echo -e "${C_RED}✗ $name LỖI:${C_RESET}"
      printf '%s\n' "$err_out" | sed 's/^/    /'
      exit 1
    fi
  done

  # Đếm lại
  local after_count
  after_count=$(mysql_exec "$root_pw" "$db" -N -e "SELECT COUNT(*) FROM articles;" 2>/dev/null </dev/null | tail -n1) || after_count="?"
  echo -e "\n${C_GREEN}${C_BOLD}═══ MIGRATE XONG ═══${C_RESET}"
  echo -e "  Bài viết: ${before_count} → ${C_GREEN}${after_count}${C_RESET}"
  echo -e "  Đánh dấu đã import trong production/migrations/.imported-*"
}

# ════════════════════════════════════════════════════════════════════════════
# 4. MEDIA TUNING — bật/tắt tải video và đặt trần RAM cho hai container
# ════════════════════════════════════════════════════════════════════════════
#
# Lệnh này **chỉ đọc và ghi `.env`**. Nó không khởi động lại container, không sửa
# gì khác, không đụng CSDL — cán bộ chạy nó, đọc kết quả, rồi tự quyết định lúc
# nào `docker compose up -d`. Một lệnh "tiện tay restart luôn" sẽ khởi động lại
# cổng đang phục vụ công dân vì một thay đổi chưa được xem qua.
#
# Ngưỡng RAM 4000 MB là ngưỡng **thật**, không phải con số cho tròn: pipeline
# transcode chạy tới `MAX_CONCURRENT_RENDITIONS = 3` tiến trình FFmpeg song song
# (`server/services/video-renditions.ts`), mỗi tiến trình giữ nguyên khung hình
# trong RAM. Trên VPS nhỏ, lượt transcode đầu tiên sẽ khiến OOM-killer hạ **một
# container khác** — nạn nhân không phải thủ phạm. Nên dưới ngưỡng thì từ chối
# bật, và nói rõ vì sao, thay vì để cán bộ tự phát hiện qua một lần sập.
cmd_media_tuning() {
  echo -e "\n${C_BOLD}${C_CYAN}═══ MEDIA TUNING — Tải video & trần RAM ═══${C_RESET}\n"
  cd "$ROOT"

  if [ ! -f "$ROOT/.env" ]; then
    echo -e "${C_RED}Không có .env — chạy 'Deploy' (1) trước.${C_RESET}"
    exit 1
  fi

  # ── RAM máy chủ ───────────────────────────────────────────────────────────
  # Đọc /proc/meminfo như scripts/check-resources.sh (xem read_host_ram_mb).
  local host_ram_mb
  if ! host_ram_mb=$(read_host_ram_mb); then
    echo -e "${C_RED}Không đọc được dung lượng RAM máy chủ.${C_RESET}"
    exit 1
  fi
  local host_cpus
  host_cpus="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 1)"

  echo -e "  Máy chủ: ${C_CYAN}${host_ram_mb}MB${C_RESET} RAM, ${C_CYAN}${host_cpus}${C_RESET} nhân"
  echo -e "  ${C_DIM}Đang đặt: MEDIA_UPLOAD_ENABLED=$(env_get MEDIA_UPLOAD_ENABLED || true)${C_RESET}"
  echo

  # ── Công tắc nhận video ───────────────────────────────────────────────────
  local RAM_FLOOR_MB=4000
  if [ "$host_ram_mb" -lt "$RAM_FLOOR_MB" ]; then
    echo -e "  ${C_RED}⚠  Tải video cần ≥${RAM_FLOOR_MB}MB RAM (đang có ${host_ram_mb}MB).${C_RESET}"
    echo -e "  ${C_YELLOW}   FFmpeg chạy 3 bản transcode song song; trên VPS nhỏ, lượt${C_RESET}"
    echo -e "  ${C_YELLOW}   xử lý đầu tiên sẽ khiến OOM-killer hạ một container khác.${C_RESET}"
    echo -e "  ${C_DIM}   Cổng vẫn chạy bình thường với video YouTube/CDN.${C_RESET}"
    if confirm "Vẫn bật tải video (không khuyến nghị)?" "n"; then
      set_env MEDIA_UPLOAD_ENABLED true
      echo -e "  ${C_YELLOW}→ Đã bật (vượt ngưỡng khuyến nghị).${C_RESET}"
    else
      set_env MEDIA_UPLOAD_ENABLED false
      echo -e "  ${C_GREEN}→ Tải video TẮT.${C_RESET} ${C_DIM}Chỉ YouTube/CDN.${C_RESET}"
    fi
  else
    if confirm "Bật tải video lên máy chủ này?" "y"; then
      set_env MEDIA_UPLOAD_ENABLED true
      echo -e "  ${C_GREEN}→ Tải video BẬT.${C_RESET}"
    else
      set_env MEDIA_UPLOAD_ENABLED false
      echo -e "  ${C_DIM}→ Tải video TẮT.${C_RESET}"
    fi
  fi
  echo -e "  ${C_DIM}Lưu ý: giá trị này chỉ tới được container nếu docker-compose.yml${C_RESET}"
  echo -e "  ${C_DIM}liệt kê MEDIA_UPLOAD_ENABLED trong environment: — hiện đã liệt kê.${C_RESET}"

  # ── Trần RAM: hỏi chính scripts/check-resources.sh, KHÔNG tự tính ─────────
  # Công thức ở đây từng được định nghĩa lại một lần, và nó cho ra kết quả **khác**
  # script kia gấp ba lần — trong đó phần MySQL nhỏ hơn, tức đảo ngược đúng cái
  # bug mà check-resources.sh ra đời để sửa (MySQL đọc giới hạn cgroup chứ không
  # đọc RAM máy chủ để tính InnoDB buffer pool, nên trần quá thấp là chậm vĩnh
  # viễn mà không có gì báo). Script đó đã đếm container của dự án khác, đã đọc
  # trần đang đặt và mức đang dùng thật, và đã là nguồn chân lý mà .env.example
  # trỏ tới. Gọi nó thay vì chép công thức: bản sao thứ hai là chỗ thứ hai để sai.
  echo -e "\n${C_BOLD}Trần RAM container${C_RESET}"
  local resources_sh="$ROOT/scripts/check-resources.sh"
  if [ ! -x "$resources_sh" ]; then
    echo -e "  ${C_YELLOW}Không chạy được $resources_sh — bỏ qua phần trần RAM.${C_RESET}"
    echo -e "  ${C_DIM}Đặt tay trong .env: MYSQL_MEM_LIMIT=4g và APP_MEM_LIMIT=2g.${C_RESET}"
  else
    local out rc=0
    # `set -e` ở đầu tệp sẽ giết lượt chạy này khi script trả 2 — mà 2 nghĩa là
    # "nên chỉnh trần", tức đúng ca ta đang muốn xử lý. Nên phải bắt mã trả về.
    out="$("$resources_sh" 2>&1)" || rc=$?
    echo "$out"
    if [ "$rc" = "1" ]; then
      echo -e "  ${C_YELLOW}Script báo thiếu công cụ — bỏ qua phần trần RAM.${C_RESET}"
    else
      local sug_mysql sug_app
      sug_mysql="$(printf '%s\n' "$out" | sed -n 's/^ *MYSQL_MEM_LIMIT=//p' | tail -n1)"
      sug_app="$(printf '%s\n' "$out" | sed -n 's/^ *APP_MEM_LIMIT=//p' | tail -n1)"
      if [ -z "$sug_mysql" ] || [ -z "$sug_app" ]; then
        # rc=0 nghĩa là trần hiện tại đã hợp lý, nên script không in dòng nào.
        echo -e "  ${C_DIM}Trần hiện tại đã hợp lý — không có gì để ghi.${C_RESET}"
      elif confirm "Ghi hai giá trị này vào .env (MYSQL_MEM_LIMIT=$sug_mysql, APP_MEM_LIMIT=$sug_app)?" "y"; then
        set_env MYSQL_MEM_LIMIT "$sug_mysql"
        set_env APP_MEM_LIMIT "$sug_app"
        echo -e "  ${C_GREEN}→ Đã ghi vào .env.${C_RESET}"
      else
        echo -e "  ${C_DIM}Giữ nguyên trần hiện tại.${C_RESET}"
      fi
    fi
    echo -e "  ${C_DIM}CPU: không đặt trần (tiền lệ check-resources.sh). FFmpeg tự nice -n 19.${C_RESET}"
  fi

  # ── Auto-transcode: tự nén 360/720/1080p sau upload ─────────────────────
  echo -e "\n${C_BOLD}Tự nén video sau upload${C_RESET}"
  local cur_auto
  cur_auto=$(env_get MEDIA_AUTO_TRANSCODE || true)
  # Cho hiển thị: rỗng đọc thành true (mặc định code).
  echo -e "  ${C_DIM}Đang đặt: MEDIA_AUTO_TRANSCODE=${cur_auto:-true (mặc định)}${C_RESET}"
  echo -e "  ${C_DIM}true = upload xong tự nén dưới nền worker.${C_RESET}"
  echo -e "  ${C_DIM}false = chỉ probe+thumbnail; cán bộ bấm \"Chuyển mã\" thủ công.${C_RESET}"
  if confirm "Bật tự nén video sau upload?" "y"; then
    set_env MEDIA_AUTO_TRANSCODE true
    echo -e "  ${C_GREEN}→ Tự nén BẬT.${C_RESET}"
  else
    set_env MEDIA_AUTO_TRANSCODE false
    echo -e "  ${C_DIM}→ Tự nén TẮT (thủ công).${C_RESET}"
  fi

  # ── Kết thúc: nói rõ bước tiếp theo, KHÔNG tự làm ─────────────────────────
  echo -e "\n${C_GREEN}${C_BOLD}═══ XONG ═══${C_RESET}"
  echo -e "  .env: $ROOT/.env"
  echo -e "  ${C_YELLOW}Chưa có gì được khởi động lại.${C_RESET} Áp dụng bằng:"
  echo -e "  ${C_BOLD}  cd $ROOT && docker compose up -d${C_RESET}"
  echo -e "  ${C_DIM}(đổi trần RAM cần 'up -d' để container được tạo lại; đổi MEDIA_UPLOAD_ENABLED thì đủ)${C_RESET}"
}

# ════════════════════════════════════════════════════════════════════════════
# 5. CÀI CRON SAO LƯU — backup.sh hằng đêm + verify-restore.sh hằng tháng (wave2 D-OFFSITE)
# ════════════════════════════════════════════════════════════════════════════
#
# Đúng hai dòng DEPLOY.md / README.md vẫn bảo người vận hành tự gõ: `backup.sh` (dump
# CSDL qua backup-db.sh + archive media/uploads, 02:00 mỗi đêm) và
# `verify-restore.sh --latest` (nạp thử bản dump mới nhất vào CSDL tạm, 03:30 ngày 1
# hằng tháng). Cả hai tự đọc .env (kể cả HEALTHCHECK_PING_URL), nên dòng cron không
# mang bí mật nào.
#
# In ĐÚNG các dòng sẽ cài, rồi chỉ cài khi được đồng ý (mặc định KHÔNG). Các dòng nằm
# trong một khối có dấu BEGIN/END: chạy lại là thay khối đó, không bao giờ thêm khối
# thứ hai; dòng crontab khác của user giữ nguyên thứ tự. `crontab -l` hỏng vì lý do
# khác "chưa có crontab" → dừng: coi nó là rỗng rồi cài là xoá crontab thật của user.
# Log: /var/log khi user chạy lệnh ghi được vào đó (root), còn lại <repo>/logs — một
# dòng cron chuyển hướng vào tệp không mở được thì lệnh sau nó KHÔNG chạy, lặng lẽ.
CRON_BEGIN='# BEGIN cdkt-backup — production/manage.sh (Cài cron sao lưu); chạy lại lệnh đó để sửa'
CRON_END='# END cdkt-backup'

cmd_backup_cron() {
  echo -e "\n${C_BOLD}${C_CYAN}═══ CÀI CRON SAO LƯU ═══${C_RESET}\n"
  cd "$ROOT"

  if [ ! -f "$ROOT/.env" ]; then
    echo -e "${C_RED}Không có .env — chạy 'Deploy' (1) trước.${C_RESET}"
    exit 1
  fi
  if ! command -v crontab >/dev/null 2>&1; then
    echo -e "${C_RED}Máy chủ chưa có lệnh crontab — cài gói cron (cronie) rồi chạy lại.${C_RESET}"
    exit 1
  fi

  local log_dir user
  if [ -w /var/log ]; then log_dir=/var/log; else log_dir="$ROOT/logs"; fi
  # cron đọc '%' là xuống dòng, và đường dẫn nằm trong dấu nháy đơn: hai ký tự đó (và
  # xuống dòng) làm dòng cron chạy một lệnh khác với lệnh in ra.
  case "$ROOT$log_dir" in
    *%*|*\'*|*$'\n'*)
      echo -e "${C_RED}Đường dẫn repo ($ROOT) chứa ký tự cron hiểu khác (%, dấu nháy đơn, xuống dòng) — không cài. Đổi tên thư mục rồi chạy lại.${C_RESET}"
      exit 1 ;;
  esac
  user=$(id -un)

  # Thư mục mà backup-db.sh / backup-media.sh ghi vào và verify-restore.sh đọc — BACKUP_DIR
  # trong .env, giải như chính các script (tương đối = so với repo). ./backups là bind
  # mount mà entrypoint của container giao cho user `node` (uid 1000) mỗi lần khởi động:
  # user deploy không phải root thường KHÔNG ghi được vào đó, và cron của user đó sẽ hỏng
  # EACCES mỗi đêm. Cron sao lưu là việc của máy chủ — cài bằng root.
  local backup_dir
  backup_dir=$(env_get BACKUP_DIR)
  backup_dir="${backup_dir:-./backups}"
  case "$backup_dir" in /*) ;; *) backup_dir="$ROOT/${backup_dir#./}" ;; esac
  if { [ -d "$backup_dir" ] && [ ! -w "$backup_dir" ]; } \
     || { [ ! -e "$backup_dir" ] && [ ! -w "$(dirname "$backup_dir")" ]; }; then
    echo -e "${C_RED}✗ User $user không ghi được thư mục sao lưu $backup_dir — cron của user này sẽ hỏng mỗi đêm.${C_RESET}"
    echo -e "${C_YELLOW}  Cài bằng root: sudo ./manage.sh backup-cron (thư mục ./backups thuộc user của container, uid 1000).${C_RESET}"
    exit 1
  fi

  local block
  block="$CRON_BEGIN
0 2 * * * cd '$ROOT' && ./scripts/backup.sh >> '$log_dir/cdkt-backup.log' 2>&1
30 3 1 * * cd '$ROOT' && ./scripts/verify-restore.sh --latest >> '$log_dir/cdkt-verify-restore.log' 2>&1
$CRON_END"

  echo -e "Các dòng sẽ cài vào crontab của user ${C_BOLD}$user${C_RESET}:\n"
  echo "$block"
  echo
  # Ping giám sát: script tự đọc từ .env. URL là thứ ai có cũng báo "đã chạy" thay
  # được — chỉ nói đang đặt hay chưa (cùng quy tắc với Update).
  if [ -n "$(env_get HEALTHCHECK_PING_URL)" ]; then
    echo -e "${C_DIM}HEALTHCHECK_PING_URL đang đặt — backup-db.sh và verify-restore.sh sẽ ping dịch vụ giám sát.${C_RESET}"
  else
    echo -e "${C_YELLOW}HEALTHCHECK_PING_URL chưa đặt — cron ngừng chạy sẽ không ai biết. Đặt bằng Update (2).${C_RESET}"
  fi

  local errfile current rc=0
  errfile=$(mktemp)
  current=$(crontab -l 2>"$errfile") || rc=$?
  if [ "$rc" != 0 ]; then
    if ! awk '/no crontab/ { found = 1 } END { exit found ? 0 : 1 }' "$errfile"; then
      echo -e "${C_RED}✗ Không đọc được crontab hiện tại ($(head -n 1 "$errfile")) — không cài (cài lúc này có thể xoá crontab đang có).${C_RESET}"
      rm -f "$errfile"
      exit 1
    fi
    current=''
  fi
  rm -f "$errfile"

  # Dòng gọi script sao lưu NGOÀI khối của lệnh này (thêm tay theo tài liệu cũ):
  # cài thêm là mỗi đêm chạy hai lần.
  local others
  others=$(printf '%s\n' "$current" | awk -v b="$CRON_BEGIN" -v e="$CRON_END" '
    $0 == b { skip = 1; next }
    $0 == e { skip = 0; next }
    !skip && /scripts\/(backup|backup-db|verify-restore)\.sh/')
  if [ -n "$others" ]; then
    echo -e "\n${C_YELLOW}⚠  Crontab đã có dòng chạy script sao lưu ngoài khối của lệnh này — cài thêm là chạy hai lần:${C_RESET}"
    echo "$others"
    echo -e "${C_YELLOW}   Xoá các dòng đó (crontab -e) trước, hoặc trả lời 'n'.${C_RESET}"
  fi

  echo
  if ! confirm "Cài các dòng trên vào crontab của $user?" "n"; then
    echo "Không cài — crontab giữ nguyên."
    return 0
  fi

  if [ "$log_dir" = "$ROOT/logs" ]; then mkdir -p "$log_dir"; fi
  local kept tmp
  # Giữ mọi dòng ngoài khối cũ (`$(…)` bỏ các dòng trống ở cuối), rồi một dòng trống +
  # khối mới — chạy lại cho ra đúng tệp cũ.
  kept=$(printf '%s\n' "$current" | awk -v b="$CRON_BEGIN" -v e="$CRON_END" '
    $0 == b { skip = 1; next }
    $0 == e { skip = 0; next }
    !skip')
  tmp=$(mktemp)
  if [ -n "$kept" ]; then printf '%s\n\n' "$kept" > "$tmp"; fi
  printf '%s\n' "$block" >> "$tmp"
  if ! crontab "$tmp"; then
    rm -f "$tmp"
    echo -e "${C_RED}✗ crontab từ chối tệp mới — crontab cũ giữ nguyên.${C_RESET}"
    exit 1
  fi
  rm -f "$tmp"
  echo -e "${C_GREEN}✓ Đã cài cron sao lưu cho user $user.${C_RESET} Log: $log_dir/cdkt-backup.log, $log_dir/cdkt-verify-restore.log"
  echo -e "${C_DIM}  Xem: crontab -l   ·   Gỡ: crontab -e rồi xoá khối '# BEGIN cdkt-backup' … '# END cdkt-backup'.${C_RESET}"
}

# ════════════════════════════════════════════════════════════════════════════
# 6. XUẤT .env ĐÃ MÃ HOÁ — bản ngoài VPS của mọi bí mật (wave2 D-OFFSITE)
# ════════════════════════════════════════════════════════════════════════════
#
# Mất VPS là mất .env: JWT_SECRET (đăng nhập), CHATBOT_ENCRYPTION_SECRET (khoá giải
# mã API key AI, Google OAuth secret, liên kết Drive đã lưu trong CSDL — bản dump CSDL
# không có nó thì các giá trị đó vô dụng), mật khẩu MySQL. Lệnh này ghi .env.enc
# (AES-256-CBC, khoá dẫn xuất PBKDF2 200 000 vòng) để anh tải về giữ ngoài VPS.
#   - Passphrase gõ hai lần, không hiện, tối thiểu 12 ký tự; tới openssl qua một file
#     descriptor (`-pass fd:3`), không bao giờ trên dòng lệnh (`ps` thấy mọi argv).
#   - Không in nội dung .env hay passphrase. Ghi tệp tạm 600 rồi `mv`, giải mã thử
#     ngay để chắc passphrase vừa gõ mở được tệp.
#   - openssl không có -pbkdf2 (OpenSSL 1.0.x) → từ chối, không lùi về dẫn xuất khoá
#     yếu hơn.
cmd_export_env() {
  echo -e "\n${C_BOLD}${C_CYAN}═══ XUẤT .env ĐÃ MÃ HOÁ ═══${C_RESET}\n"
  cd "$ROOT"

  if [ ! -f "$ROOT/.env" ]; then
    echo -e "${C_RED}Không có .env — không có gì để xuất.${C_RESET}"
    exit 1
  fi
  if ! command -v openssl >/dev/null 2>&1; then
    echo -e "${C_RED}Máy chủ chưa có openssl.${C_RESET}"
    exit 1
  fi
  local help
  help=$(openssl enc -help 2>&1 || true)
  case "$help" in
    *-pbkdf2*) ;;
    *)
      echo -e "${C_RED}✗ openssl trên máy chủ này không hỗ trợ -pbkdf2 (cần OpenSSL ≥ 1.1.1) — không xuất bằng cách mã hoá yếu hơn.${C_RESET}"
      exit 1 ;;
  esac

  if [ -f "$ROOT/.env.enc" ]; then
    echo -e "${C_YELLOW}⚠  Đã có $ROOT/.env.enc (lần xuất trước).${C_RESET}"
    if ! confirm "Ghi đè .env.enc?" "n"; then
      echo "Giữ nguyên .env.enc cũ."
      return 0
    fi
  fi

  local pass pass2
  # `IFS=`: giữ nguyên dấu cách đầu/cuối — passphrase là đúng những gì đã gõ.
  printf 'Passphrase (≥ 12 ký tự, không hiện khi gõ): '
  IFS= read -rs pass || true
  echo
  printf 'Gõ lại passphrase: '
  IFS= read -rs pass2 || true
  echo
  if [ "$pass" != "$pass2" ]; then
    echo -e "${C_RED}✗ Hai lần gõ không khớp — không ghi gì.${C_RESET}"
    exit 1
  fi
  if [ "${#pass}" -lt 12 ]; then
    echo -e "${C_RED}✗ Passphrase ngắn hơn 12 ký tự — không ghi gì.${C_RESET}"
    exit 1
  fi

  local tmp
  tmp=$(mktemp "$ROOT/.env.enc.XXXXXX")
  if ! openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$ROOT/.env" -out "$tmp" -pass fd:3 3< <(printf '%s' "$pass"); then
    rm -f "$tmp"
    echo -e "${C_RED}✗ openssl mã hoá thất bại — không ghi gì.${C_RESET}"
    exit 1
  fi
  # Giải mã thử bằng đúng passphrase vừa gõ: tệp không mở lại được thì vô dụng.
  if ! cmp -s "$ROOT/.env" <(openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$tmp" -pass fd:3 3< <(printf '%s' "$pass")); then
    rm -f "$tmp"
    echo -e "${C_RED}✗ Giải mã thử không ra đúng .env — không ghi gì.${C_RESET}"
    exit 1
  fi
  pass=''
  pass2=''
  chmod 600 "$tmp"
  mv -f "$tmp" "$ROOT/.env.enc"

  echo -e "${C_GREEN}✓ Đã ghi $ROOT/.env.enc (quyền 600, $(wc -c < "$ROOT/.env.enc") byte).${C_RESET}"
  echo -e "  Tải về máy của anh rồi XOÁ khỏi VPS (bản trên VPS mất cùng VPS):"
  echo -e "    scp <user>@<vps>:$ROOT/.env.enc ./cdkt-env-$(date +%Y%m%d).enc"
  echo -e "    rm $ROOT/.env.enc"
  echo -e "  Giải mã (hỏi passphrase):"
  echo -e "    openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in .env.enc -out .env"
  echo -e "${C_YELLOW}  Giữ passphrase ở nơi KHÁC tệp này — mất passphrase là mất bản xuất.${C_RESET}"
}

# ── Entry ──────────────────────────────────────────────────────────────────
# Cho phép truyền tham số để bypass menu (chắc ăn với terminal web aaPanel):
#   ./manage.sh deploy | update | migrate | media-tuning | backup-cron | export-env | 1 … 6
# Không tham số → vào menu tương tác.
arg="${1:-}"
case "$arg" in
  deploy|1)  cmd_deploy ;;
  update|2)  cmd_update ;;
  migrate|3) cmd_migrate ;;
  media-tuning|media|4) cmd_media_tuning ;;
  backup-cron|cron|5) cmd_backup_cron ;;
  export-env|6) cmd_export_env ;;
  ''|menu)  main_menu ;;
  -h|--help|help)
    echo "Cách dùng: ./manage.sh [deploy|update|migrate|media-tuning|backup-cron|export-env|1…6]"
    echo "  deploy       (1)  thiết lập mới (chạy lần đầu)"
    echo "  update       (2)  cập nhật VPS (pull + restart)"
    echo "  migrate      (3)  nhập data SQL mới"
    echo "  media-tuning (4)  bật/tắt tải video, đặt trần RAM (chỉ sửa .env)"
    echo "  backup-cron  (5)  cài cron sao lưu đêm + kiểm chứng khôi phục hằng tháng (hỏi trước)"
    echo "  export-env   (6)  xuất .env đã mã hoá (.env.enc) để giữ ngoài VPS"
    echo "  (không tham số) vào menu tương tác"
    exit 0 ;;
  *) echo "Tham số không hợp lệ: $arg"; echo "Dùng: ./manage.sh [deploy|update|migrate|media-tuning|backup-cron|export-env|1…6]"; exit 1 ;;
esac
