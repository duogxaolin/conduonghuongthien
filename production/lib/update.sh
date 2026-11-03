# shellcheck shell=bash
#
# production/lib/update.sh — Menu 2: Update (sao lưu DB, pull code, sửa .env, đổi image).
# Phần kéo/áp image và đường lùi ở lib/update-image.sh. Nạp bởi production/manage.sh;
# chỉ định nghĩa hàm.

# Dump CSDL ở bước ĐẦU của Update, trước git pull / compose / .env / image, bằng
# scripts/backup-db.sh (cùng phép kiểm: gzip, dòng "-- Dump completed" ở ĐẦU một trong
# 5 dòng cuối — đúng luật restore-db.sh nhận, ≥ 20 bảng; tệp
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

# Dấu vân tay của bộ công cụ trên đĩa: production/manage.sh + mọi production/lib/*.sh,
# cả tên tệp lẫn nội dung. Update so nó trước/sau `git pull` để biết phần còn lại có
# phải chạy bằng mã MỚI không. Tiến trình đang chạy đã nạp lib/ CŨ vào bộ nhớ, nên một
# lượt kéo chỉ đổi lib/update.sh (manage.sh giữ nguyên) cũng phải được nhận ra — bản
# một tệp cũ chỉ băm manage.sh. Rỗng (không có sha256sum) = không so được → không chạy
# lại, như bản cũ.
manage_toolkit_digest() {
  (cd "$PROD" && sha256sum manage.sh lib/*.sh 2>/dev/null) | sha256sum | cut -d' ' -f1 || true
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
    manage_before=$(manage_toolkit_digest)
    update_pull_code
    # Pull vừa đổi manage.sh hoặc một tệp lib/: phần còn lại của Update (kiểm log
    # journald, kéo image, khởi động lại) phải chạy bằng mã MỚI — bash đang chạy bản cũ
    # đã nạp. `exec` giữ nguyên stdin (các câu trả lời kế tiếp) và trao lại bản sao lưu
    # compose của lượt này cho đường lùi. Bản mới nhận CDKT_UPDATE_RESUMED=1 nên không
    # pull lại (không lặp).
    manage_after=$(manage_toolkit_digest)
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
