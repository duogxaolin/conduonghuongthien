# shellcheck shell=bash
#
# production/lib/deploy.sh — Menu 1: Deploy (thiết lập mới, chạy lần đầu).
# Nạp bởi production/manage.sh; chỉ định nghĩa hàm.

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
