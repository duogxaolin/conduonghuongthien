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
  echo -e "  ${C_BOLD}q)${C_RESET} Thoát"
  echo
  prompt "Chọn" ""
  local choice="$PROMPT_RESULT"
  case "$choice" in
    1) cmd_deploy ;;
    2) cmd_update ;;
    3) cmd_migrate ;;
    4) cmd_media_tuning ;;
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

  # ── Bước 1: Chọn nguồn SQL ──────────────────────────────────────────────
  echo -e "\n${C_BOLD}Bước 1/6 — Nguồn cơ sở dữ liệu${C_RESET}"
  echo -e "  ${C_BOLD}1)${C_RESET} Existing DB — dùng MySQL có sẵn (chỉ import data)"
  echo -e "  ${C_BOLD}2)${C_RESET} Docker fresh — tạo MySQL mới qua docker compose (Recommended)"
  echo
  local sql_choice
  prompt "Chọn nguồn SQL" "2"; sql_choice="$PROMPT_RESULT"
  if [ "$sql_choice" != "1" ] && [ "$sql_choice" != "2" ]; then
    echo -e "${C_RED}Chỉ 1 hoặc 2.${C_RESET}"; exit 1
  fi

  # ── Bước 2: DB / user / password / port (gợi ý, bấm enter giữ default) ──
  echo -e "\n${C_BOLD}Bước 2/6 — Cơ sở dữ liệu${C_RESET}"
  echo -e "${C_DIM}Gõ enter để giữ giá trị gợi ý, hoặc sửa rồi enter.${C_RESET}\n"

  local DB_NAME DB_USER DB_PASSWORD MYSQL_ROOT_PASSWORD DB_HOST DB_PORT

  if [ "$sql_choice" = "1" ]; then
    # Existing DB — user cung cấp connection string
    prompt "  DB host" "127.0.0.1"; DB_HOST="$PROMPT_RESULT"
    prompt "  DB port" "3306"; DB_PORT="$PROMPT_RESULT"
    prompt "  DB name" "cdkt_admin"; DB_NAME="$PROMPT_RESULT"
    prompt "  DB user" "root"; DB_USER="$PROMPT_RESULT"
    prompt "  DB password" ""; DB_PASSWORD="$PROMPT_RESULT"
    MYSQL_ROOT_PASSWORD="$DB_PASSWORD"
    echo -e "${C_YELLOW}⚠  Existing DB: app sẽ nối tới MySQL ngoài docker compose.${C_RESET}"
    echo -e "${C_YELLOW}   MySQL đó phải đang chạy và user có quyền CREATE/INSERT.${C_RESET}"
  else
    # Docker fresh — gợiy password ngẫu nhiên
    DB_HOST="cdkt_mysql"   # tên service trong compose
    DB_PORT="3306"          # port nội bộ container
    MYSQL_ROOT_PASSWORD=$(gen_password)
    prompt "  Tên database" "cdkt_admin"; DB_NAME="$PROMPT_RESULT"
    prompt "  DB user (app dùng)" "cdkt_user"; DB_USER="$PROMPT_RESULT"
    prompt "  DB password (app)" "$(gen_password)"; DB_PASSWORD="$PROMPT_RESULT"
    prompt "  MySQL root password" "$MYSQL_ROOT_PASSWORD"; MYSQL_ROOT_PASSWORD="$PROMPT_RESULT"

    # Port publish ra host (tránh đụng 3306 nếu máy có MySQL sẵn)
    local ext_port
    prompt "  Port publish ra máy chủ" "33069"; ext_port="$PROMPT_RESULT"
    MYSQL_EXTERNAL_PORT="$ext_port"
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

  # ── Bước 5: ADMIN_PASSWORD + ghi .env ────────────────────────────────────
  echo -e "\n${C_BOLD}Bước 5/6 — Tài khoản SuperAdmin (chỉ lần đầu)${C_RESET}"
  local ADMIN_PASSWORD ADMIN_EMAIL
  prompt "  ADMIN_PASSWORD (≥12 ký tự, đủ 3/4 nhóm)" "$(gen_password)"; ADMIN_PASSWORD="$PROMPT_RESULT"
  prompt "  ADMIN_EMAIL" "admin@conduonghuongthien.com.vn"; ADMIN_EMAIL="$PROMPT_RESULT"

  # Proxy tin cậy — mặc định docker bridge gateway, anh có thể sửa
  local TRUSTED_PROXY_IPS
  prompt "  TRUSTED_PROXY_IPS (gateway docker)" "172.17.0.1"; TRUSTED_PROXY_IPS="$PROMPT_RESULT"

  echo -e "\n${C_BOLD}Đang tạo .env ...${C_RESET}"
  cat > "$ROOT/.env" <<EOF
# ─── Auto-generated by production/manage.sh  $(date '+%Y-%m-%d %H:%M') ──
# KHÔNG commit file này (đã .gitignore). Sửa tay an toàn.

# ─── MySQL ───────────────────────────────────────
MYSQL_ROOT_PASSWORD=$MYSQL_ROOT_PASSWORD
MYSQL_DATABASE=$DB_NAME
MYSQL_USER=$DB_USER
MYSQL_PASSWORD=$DB_PASSWORD
$( [ "$sql_choice" = "2" ] && echo "MYSQL_EXTERNAL_PORT=$MYSQL_EXTERNAL_PORT" )

# App nối tới DB
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
# Tải video lên máy chủ (cần đủ RAM — xem manage.sh media-tuning).
MEDIA_UPLOAD_ENABLED=true
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
EOF

  echo -e "${C_GREEN}✓ Đã tạo $ROOT/.env${C_RESET}"

  # ── Bước 6: Hỏi build luôn ─────────────────────────────────────────────────
  echo -e "\n${C_BOLD}Bước 6/6 — Khởi động${C_RESET}"
  local do_build
  if confirm "Build + khởi động ngay (docker compose up -d --build)?" "y"; then
    do_build=1
  else
    do_build=0
    echo -e "${C_DIM}Anh có thể chạy sau: cd .. && docker compose up -d --build${C_RESET}"
  fi

  if [ "$do_build" = "1" ]; then
    echo -e "\n${C_BOLD}Đang docker compose up -d --build ...${C_RESET}"
    docker compose up -d --build
    echo -e "${C_GREEN}✓ Container đã khởi động. Đợi healthcheck...${C_RESET}"
    # Đợi healthcheck
    local i
    for i in $(seq 1 60); do
      if docker inspect --format '{{.State.Health.Status}}' cdkt_app 2>/dev/null | grep -q healthy; then
        echo -e "${C_GREEN}✓ cdkt_app healthy${C_RESET}"
        break
      fi
      sleep 3
    done
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

  # ── Pull code ─────────────────────────────────────────────────────────────
  if confirm "Pull code mới từ git (git pull)?" "y"; then
    git pull origin main
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

  # ── Pull image + restart ─────────────────────────────────────────────────
  echo
  if confirm "Pull image mới + khởi động lại (docker compose pull && up -d)?" "y"; then
    echo -e "${C_BOLD}Pull image...${C_RESET}"
    docker compose pull app 2>/dev/null || docker compose build app
    echo -e "${C_BOLD}Khởi động lại...${C_RESET}"
    docker compose up -d app
    # Đợi healthy
    local i
    for i in $(seq 1 60); do
      if docker inspect --format '{{.State.Health.Status}}' cdkt_app 2>/dev/null | grep -q healthy; then
        echo -e "${C_GREEN}✓ cdkt_app healthy${C_RESET}"
        break
      fi
      sleep 3
    done
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

  # Lấy password root từ .env
  local root_pw
  root_pw=$(env_get MYSQL_ROOT_PASSWORD)
  if [ -z "$root_pw" ]; then
    root_pw=$(env_get DB_PASSWORD)
  fi
  if [ -z "$root_pw" ]; then
    echo -e "${C_RED}Không tìm thấy MYSQL_ROOT_PASSWORD/DB_PASSWORD trong .env${C_RESET}"
    exit 1
  fi

  # Đếm số bài hiện tại để đối chiếu
  local before_count
  before_count=$(docker exec -i cdkt_mysql mysql -uroot -p"$root_pw" cdkt_admin \
    -e "SELECT COUNT(*) FROM articles;" 2>/dev/null | tail -n1) || before_count="?"

  # Liệt kê file SQL + trạng thái đã import hay chưa
  echo -e "${C_BOLD}File SQL trong production/migrations/:${C_RESET}\n"
  local files=()
  local i=0
  for f in "$MIG_DIR"/*.sql; do
    [ -f "$f" ] || continue
    local name=$(basename "$f")
    local marker="$MIG_DIR/.imported-$name"
    local status="chưa"
    if [ -f "$marker" ]; then status="${C_GREEN}đã import${C_RESET}"; fi
    # Kích thước
    local sz=$(du -h "$f" | cut -f1)
    printf "  [%d] %-40s %6s  %s\n" "$((i+1))" "$name" "$sz" "$status"
    files+=("$f")
    i=$((i+1))
  done

  if [ ${#files[@]} -eq 0 ]; then
    echo -e "${C_YELLOW}Không có file .sql nào. Thả file vào production/migrations/ rồi chạy lại.${C_RESET}"
    exit 0
  fi

  echo -e "\n${C_DIM}Bài viết hiện tại trong DB: ${before_count}${C_RESET}"
  echo -e "${C_YELLOW}⚠  File SQL có DROP TABLE sẽ XÓA data cũ rồi chèn mới. Đảm bảo có backup!${C_RESET}"

  # Hỏi chọn file
  echo
  local sel
  prompt "Chọn file để import (số, hoặc 'all' cho tất cả chưa import)" "all"; sel="$PROMPT_RESULT"

  local to_import=()
  if [ "$sel" = "all" ]; then
    for f in "${files[@]}"; do
      local name=$(basename "$f")
      [ -f "$MIG_DIR/.imported-$name" ] || to_import+=("$f")
    done
  else
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

  echo -e "\n${C_BOLD}Sẽ import:${C_RESET}"
  for f in "${to_import[@]}"; do echo "  - $(basename "$f")"; done
  echo
  if ! confirm "Xác nhận import?" "n"; then
    echo "Huyỷ."; exit 0
  fi

  # Import lần lượt
  for f in "${to_import[@]}"; do
    local name=$(basename "$f")
    echo -e "\n${C_BOLD}Import $name ...${C_RESET}"
    # mysql in warning ra stderr; lỗi SQL cũng ra stderr. Tách stderr, chỉ exit
    # khi mysql trả khác 0. KHÔNG pipe qua grep vì grep không match warning → trả
    # exit 1 → if tưởng fail dù import OK.
    local err_out
    if err_out=$(docker exec -i cdkt_mysql mysql -uroot -p"$root_pw" cdkt_admin < "$f" 2>&1 1>/dev/null) \
       && [ -z "$err_out" -o -z "${err_out##*Using a password*}" ]; then
      touch "$MIG_DIR/.imported-$name"
      echo -e "${C_GREEN}✓ $name đã import${C_RESET}"
    else
      echo -e "${C_RED}✗ $name LỖI:${C_RESET}"
      echo "$err_out" | grep -v "Using a password" | sed 's/^/    /'
      exit 1
    fi
  done

  # Đếm lại
  local after_count
  after_count=$(docker exec -i cdkt_mysql mysql -uroot -p"$root_pw" cdkt_admin \
    -e "SELECT COUNT(*) FROM articles;" 2>/dev/null | tail -n1) || after_count="?"
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
# (`server/services/video-processing.ts`), mỗi tiến trình giữ nguyên khung hình
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
  # Đọc /proc/meminfo như scripts/check-resources.sh, không `free`: nhãn cột của
  # `free` khác nhau giữa các bản procps, còn /proc/meminfo thì không.
  local host_ram_mb
  if [ -r /proc/meminfo ]; then
    host_ram_mb=$(( $(awk '/^MemTotal:/ {print $2}' /proc/meminfo) / 1024 ))
  elif [ "$(uname -s)" = "Darwin" ]; then
    host_ram_mb=$(( $(sysctl -n hw.memsize) / 1024 / 1024 ))
  else
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

# ── Entry ──────────────────────────────────────────────────────────────────
# Cho phép truyền tham số để bypass menu (chắc ăn với terminal web aaPanel):
#   ./manage.sh deploy | update | migrate | media-tuning | 1 | 2 | 3 | 4
# Không tham số → vào menu tương tác.
arg="${1:-}"
case "$arg" in
  deploy|1)  cmd_deploy ;;
  update|2)  cmd_update ;;
  migrate|3) cmd_migrate ;;
  media-tuning|media|4) cmd_media_tuning ;;
  ''|menu)  main_menu ;;
  -h|--help|help)
    echo "Cách dùng: ./manage.sh [deploy|update|migrate|media-tuning|1|2|3|4]"
    echo "  deploy       (1)  thiết lập mới (chạy lần đầu)"
    echo "  update       (2)  cập nhật VPS (pull + restart)"
    echo "  migrate      (3)  nhập data SQL mới"
    echo "  media-tuning (4)  bật/tắt tải video, đặt trần RAM (chỉ sửa .env)"
    echo "  (không tham số) vào menu tương tác"
    exit 0 ;;
  *) echo "Tham số không hợp lệ: $arg"; echo "Dùng: ./manage.sh [deploy|update|migrate|media-tuning|1|2|3|4]"; exit 1 ;;
esac
