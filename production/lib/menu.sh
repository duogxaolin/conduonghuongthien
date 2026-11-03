# shellcheck shell=bash
#
# production/lib/menu.sh — menu tương tác của production/manage.sh (không tham số / `menu`).
# Nạp bởi production/manage.sh; chỉ định nghĩa hàm.

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
