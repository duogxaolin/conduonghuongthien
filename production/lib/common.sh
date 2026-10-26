# shellcheck shell=bash
#
# production/lib/common.sh — biến toàn cục, màu và helper dùng chung của manage.sh.
#
# Chỉ production/manage.sh nạp tệp này, và nạp nó ĐẦU TIÊN: manage.sh đặt ROOT/PROD
# theo vị trí thật của chính nó rồi mới nạp lib/. MỌI biến toàn cục của bộ công cụ nằm
# ở đây; các tệp lib/ khác chỉ định nghĩa hàm (tests/ops-scripts.test.ts kiểm).
: "${ROOT:?production/lib/common.sh chỉ được nạp bởi production/manage.sh}"
: "${PROD:?production/lib/common.sh chỉ được nạp bởi production/manage.sh}"

# ── Thư mục & helpers ──────────────────────────────────────────────────────
# ROOT = gốc repo (cha của production/) — tất cả lệnh docker compose chạy ở đó.
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

# ── Log của app: journald, hoặc json-file dự phòng (hàm ở lib/log-driver.sh) ─
# Dấu ở dòng đầu bản override do script sinh — cùng chữ với scripts/deploy-remote.sh
# (tests/ops-scripts.test.ts so). Tệp tạm của bản override (LOG_FALLBACK_TMP) được dọn
# ở trap EXIT dưới đây.
LOG_FALLBACK_MARKER='# cdkt-log-fallback — sinh bởi production/manage.sh / scripts/deploy-remote.sh; đừng sửa tay'
LOG_WARN_PREFIX='⚠  '
LOG_ERROR_PREFIX='✗ '
LOG_FALLBACK_TMP=''
trap 'if [ -n "$LOG_FALLBACK_TMP" ]; then rm -f "$LOG_FALLBACK_TMP"; fi' EXIT

# ── Cron sao lưu: dấu đầu/cuối khối trong crontab (hàm ở lib/backup-cron.sh) ──
CRON_BEGIN='# BEGIN cdkt-backup — production/manage.sh (Cài cron sao lưu); chạy lại lệnh đó để sửa'
CRON_END='# END cdkt-backup'

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
