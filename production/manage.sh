#!/usr/bin/env bash
# shellcheck source-path=SCRIPTDIR
#
# production/manage.sh — Công cụ quản trị VPS CDKT
#
# Một cửa vào: deploy mới / update / import data migration.
# Chạy:  cd production && ./manage.sh
#
# Không tự ý commit hay push. Mọi thay đổi .env đều có xác nhận trước.
# Xem README.md trong thư mục này để biết luồng đầy đủ.
#
# Tệp này chỉ là cửa vào: mã nằm ở production/lib/*.sh, nạp theo vị trí THẬT của chính
# tệp này (lần theo symlink), không theo thư mục đang đứng — `cd production &&
# ./manage.sh`, đường dẫn tuyệt đối hay terminal web aaPanel đều như nhau. lib/ PHẢI
# nằm cạnh manage.sh: kéo/chép cả thư mục production/, không bao giờ chỉ tệp này.
#
# Cả tệp là MỘT khối `{ … }` kết thúc bằng `exit`. bash đọc script dần trong lúc chạy,
# nên một manage.sh bị ghi đè TẠI CHỖ giữa lượt chạy (scp, `cat >`) sẽ trộn dòng cũ với
# dòng mới; với khối này bash phân tích trọn tệp trước khi chạy dòng đầu, và `exit` không
# cho nó đọc thêm. (`git pull` thay tệp bằng inode mới nên không gặp chuyện đó; lib/
# được `source` đọc trọn một lần lúc khởi động.)
{
set -euo pipefail

# ── Thư mục & thư viện ─────────────────────────────────────────────────────
# Vị trí thật của tệp này: lần theo symlink (vd. /usr/local/bin/cdkt → …/production/manage.sh).
MANAGE_SELF="${BASH_SOURCE[0]}"
while [ -L "$MANAGE_SELF" ]; do
  MANAGE_LINK="$(readlink "$MANAGE_SELF")"
  case "$MANAGE_LINK" in
    /*) MANAGE_SELF="$MANAGE_LINK" ;;
    *) MANAGE_SELF="$(cd -P "$(dirname "$MANAGE_SELF")" && pwd)/$MANAGE_LINK" ;;
  esac
done
# Đường dẫn gốc repo (cha của production/) — tất cả lệnh docker compose chạy ở đó.
ROOT="$(cd "$(dirname "$MANAGE_SELF")/.." && pwd)"
PROD="$ROOT/production"
MANAGE_LIB_DIR="$(cd "$(dirname "$MANAGE_SELF")" && pwd)/lib"

# Thiếu (hoặc không đọc được) một tệp lib/ → dừng ngay, trước khi nạp hay chạy gì.
# Danh sách này và các dòng `.` bên dưới phải khớp nhau và khớp lib/*.sh trên đĩa
# (tests/ops-scripts.test.ts kiểm cả ba).
for MANAGE_LIB in common log-driver menu deploy update-image update migrate media backup-cron export-env; do
  if [ ! -f "$MANAGE_LIB_DIR/$MANAGE_LIB.sh" ] || [ ! -r "$MANAGE_LIB_DIR/$MANAGE_LIB.sh" ]; then
    echo "✗ manage.sh: không đọc được $MANAGE_LIB_DIR/$MANAGE_LIB.sh — dừng, chưa làm gì." >&2
    echo "  Thư mục lib/ phải nằm cạnh manage.sh: git pull lại cả repo, hoặc chép cả thư mục production/ (không chép riêng manage.sh)." >&2
    exit 1
  fi
done

# common.sh TRƯỚC (biến toàn cục, màu, helper dùng chung); các tệp sau chỉ định nghĩa hàm.
# shellcheck source=lib/common.sh
. "$MANAGE_LIB_DIR/common.sh"
# shellcheck source=lib/log-driver.sh
. "$MANAGE_LIB_DIR/log-driver.sh"
# shellcheck source=lib/menu.sh
. "$MANAGE_LIB_DIR/menu.sh"
# shellcheck source=lib/deploy.sh
. "$MANAGE_LIB_DIR/deploy.sh"
# shellcheck source=lib/update-image.sh
. "$MANAGE_LIB_DIR/update-image.sh"
# shellcheck source=lib/update.sh
. "$MANAGE_LIB_DIR/update.sh"
# shellcheck source=lib/migrate.sh
. "$MANAGE_LIB_DIR/migrate.sh"
# shellcheck source=lib/media.sh
. "$MANAGE_LIB_DIR/media.sh"
# shellcheck source=lib/backup-cron.sh
. "$MANAGE_LIB_DIR/backup-cron.sh"
# shellcheck source=lib/export-env.sh
. "$MANAGE_LIB_DIR/export-env.sh"

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
exit
}
