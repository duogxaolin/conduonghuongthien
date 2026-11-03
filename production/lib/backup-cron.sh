# shellcheck shell=bash
#
# production/lib/backup-cron.sh — Menu 5: cài cron sao lưu đêm + kiểm chứng khôi phục.
# Nạp bởi production/manage.sh; chỉ định nghĩa hàm (CRON_BEGIN/CRON_END ở lib/common.sh).

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
