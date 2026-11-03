# shellcheck shell=bash
#
# production/lib/log-driver.sh — log của app: journald, hoặc json-file dự phòng.
# Nạp bởi production/manage.sh; chỉ định nghĩa hàm (biến LOG_* và trap EXIT ở lib/common.sh).

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
# trap EXIT trong lib/common.sh.

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
