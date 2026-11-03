# shellcheck shell=bash
#
# production/lib/media.sh — Menu 4: Media tuning (bật/tắt tải video, trần RAM; chỉ sửa .env).
# Nạp bởi production/manage.sh; chỉ định nghĩa hàm.

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
