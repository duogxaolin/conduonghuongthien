#!/usr/bin/env bash
#
# Đối chiếu tài nguyên máy chủ với trần đang đặt cho container, rồi đề xuất giá
# trị hợp lý.
#
# Trần RAM trong docker-compose.yml mặc định 1g/1g — chọn cho VPS 1-2 GB. Con số
# đó không tự lớn lên khi máy chủ được nâng cấp, nên một VPS 8 GB vẫn đang ép
# MySQL chạy trong 1 GB. Đây không phải lỗi thấy được: MySQL đọc giới hạn cgroup
# chứ KHÔNG đọc RAM máy chủ để tự tính InnoDB buffer pool, nên nó chỉ đơn giản là
# chậm hơn mức đáng ra phải có, mãi mãi, mà không có gì báo.
#
# Chiều ngược lại cũng có thật: nới trần trên một máy còn chạy dự án khác thì
# OOM-killer sẽ hạ một container KHÁC — nạn nhân không phải thủ phạm. Vì vậy
# script này đếm cả container của dự án khác trước khi đề xuất.
#
#   ./scripts/check-resources.sh
#
# Chỉ ĐỌC: không sửa .env, không khởi động lại gì. Kết quả là hai dòng để dán
# vào .env nếu thấy hợp lý.
#
# Exit codes: 0 trần đang hợp lý, 1 thiếu công cụ, 2 nên chỉnh trần.

set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "Không tìm thấy docker. Script này để chạy trên máy chủ đang chạy container." >&2
  exit 1
fi

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1090,SC1091
  source <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' .env)
  set +a
fi

MYSQL_CONTAINER="${MYSQL_CONTAINER:-cdkt_mysql}"
APP_CONTAINER="${APP_CONTAINER:-cdkt_app}"

# ── Máy chủ ────────────────────────────────────────────────────────────────
# Đọc thẳng /proc thay vì phân tích đầu ra của `free`: nhãn cột của `free` khác
# nhau giữa các bản procps, còn /proc/meminfo thì không.
if [[ -r /proc/meminfo ]]; then
  HOST_MEM_KB="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)"
  HOST_MEM_MB=$(( HOST_MEM_KB / 1024 ))
elif [[ "$(uname -s)" == "Darwin" ]]; then
  HOST_MEM_MB=$(( $(sysctl -n hw.memsize) / 1024 / 1024 ))
else
  echo "Không đọc được dung lượng RAM máy chủ." >&2
  exit 1
fi

HOST_CPUS="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 1)"

printf '\n═══ Máy chủ ═══\n'
printf '  CPU:  %s nhân\n' "$HOST_CPUS"
printf '  RAM:  %s MB (%.1f GB)\n' "$HOST_MEM_MB" "$(awk "BEGIN{print $HOST_MEM_MB/1024}")"

# ── Container của dự án khác trên cùng máy ──────────────────────────────────
# `docker stats` không tính container đang dừng, nhưng chúng vẫn giữ chỗ khi
# được khởi động lại, nên đếm bằng `docker ps -a`.
ALL_RUNNING="$(docker ps --format '{{.Names}}' | wc -l | tr -d ' ')"
OTHERS="$(docker ps --format '{{.Names}}' | grep -vcE "^(${MYSQL_CONTAINER}|${APP_CONTAINER})$" || true)"

printf '\n═══ Container đang chạy ═══\n'
printf '  Tổng cộng:        %s\n' "$ALL_RUNNING"
printf '  Của dự án khác:   %s\n' "$OTHERS"

# ── Trần và mức dùng thực tế ────────────────────────────────────────────────
# `docker inspect` cho trần đã cấu hình (byte, 0 = không trần); `docker stats`
# cho mức đang dùng. Hai nguồn khác nhau vì trần là cấu hình còn mức dùng là
# quan sát — số đề xuất phải dựa trên cả hai.
read_limit_mb() {
  local name="$1" bytes
  bytes="$(docker inspect --format '{{.HostConfig.Memory}}' "$name" 2>/dev/null || echo 0)"
  echo $(( bytes / 1024 / 1024 ))
}

read_usage_mb() {
  local name="$1" raw
  raw="$(docker stats --no-stream --format '{{.MemUsage}}' "$name" 2>/dev/null || echo '')"
  [[ -z "$raw" ]] && { echo 0; return; }
  # "571.8MiB / 1GiB" → 571
  awk -v s="${raw%% *}" 'BEGIN {
    n = s + 0
    if (s ~ /GiB$/) n *= 1024
    else if (s ~ /KiB$/) n /= 1024
    printf "%d", n
  }'
}

MYSQL_LIMIT_MB="$(read_limit_mb "$MYSQL_CONTAINER")"
APP_LIMIT_MB="$(read_limit_mb "$APP_CONTAINER")"
MYSQL_USED_MB="$(read_usage_mb "$MYSQL_CONTAINER")"
APP_USED_MB="$(read_usage_mb "$APP_CONTAINER")"

pct() { # dùng/trần → phần trăm, "—" nếu không có trần
  local used="$1" limit="$2"
  [[ "$limit" -le 0 ]] && { echo '—'; return; }
  awk "BEGIN{printf \"%.0f%%\", $used*100/$limit}"
}

printf '\n═══ Trần hiện tại so với mức dùng ═══\n'
printf '  %-14s %8s %10s %8s\n' 'Container' 'Đang dùng' 'Trần' 'Tỷ lệ'
for row in "$MYSQL_CONTAINER:$MYSQL_USED_MB:$MYSQL_LIMIT_MB" "$APP_CONTAINER:$APP_USED_MB:$APP_LIMIT_MB"; do
  IFS=: read -r name used limit <<< "$row"
  if [[ "$limit" -le 0 ]]; then
    printf '  %-14s %7sMB %10s %8s\n' "$name" "$used" 'không trần' '—'
  else
    printf '  %-14s %7sMB %8sMB %8s\n' "$name" "$used" "$limit" "$(pct "$used" "$limit")"
  fi
done

# ── Đề xuất ─────────────────────────────────────────────────────────────────
# Chừa lại phần cho hệ điều hành và cho container của dự án khác. Không chia hết
# RAM cho hai container này: máy chủ còn nginx, sshd, và chính docker daemon.
#
# Ngưỡng 75% là chỗ đáng chỉnh chứ chưa phải chỗ hỏng. MySQL chạm trần không
# sập ngay — nó co buffer pool lại và đọc từ đĩa nhiều hơn, tức là chậm dần chứ
# không báo lỗi. Đợi tới lúc OOM-kill mới chỉnh là đợi quá muộn.
RESERVE_MB=512
if [[ "$OTHERS" -gt 0 ]]; then
  # Chừa thêm cho hàng xóm. 256MB/container là ước lượng thô nhưng thà thấp còn
  # hơn cao: nới trần quá tay thì nạn nhân là container của dự án khác.
  RESERVE_MB=$(( RESERVE_MB + OTHERS * 256 ))
fi

AVAILABLE_MB=$(( HOST_MEM_MB - RESERVE_MB ))
[[ "$AVAILABLE_MB" -lt 512 ]] && AVAILABLE_MB=512

# MySQL 2 phần, app 1 phần: buffer pool là thứ đổi RAM lấy tốc độ trực tiếp
# nhất, còn Nitro là tiến trình Node phần lớn nằm yên (đo được ~76MB lúc chạy).
SUGGEST_MYSQL_MB=$(( AVAILABLE_MB * 2 / 3 ))
SUGGEST_APP_MB=$(( AVAILABLE_MB / 3 ))

# Chặn dưới và chặn trên. Dưới 512MB thì MySQL 8 không chạy nổi; trên 4GB thì
# buffer pool lớn hơn toàn bộ CSDL của cổng này, thêm nữa là RAM nằm không.
[[ "$SUGGEST_MYSQL_MB" -lt 512 ]] && SUGGEST_MYSQL_MB=512
[[ "$SUGGEST_MYSQL_MB" -gt 4096 ]] && SUGGEST_MYSQL_MB=4096
[[ "$SUGGEST_APP_MB" -lt 512 ]] && SUGGEST_APP_MB=512
[[ "$SUGGEST_APP_MB" -gt 2048 ]] && SUGGEST_APP_MB=2048

to_g() { awk "BEGIN{printf \"%.10g\", $1/1024}"; }

printf '\n═══ Đề xuất ═══\n'
printf '  RAM chừa cho hệ điều hành và %s container khác: %s MB\n' "$OTHERS" "$RESERVE_MB"

NEEDS_CHANGE=0
note() { printf '  %s\n' "$1"; }

if [[ "$MYSQL_LIMIT_MB" -gt 0 ]]; then
  USED_PCT=$(( MYSQL_USED_MB * 100 / MYSQL_LIMIT_MB ))
  if [[ "$USED_PCT" -ge 75 ]]; then
    note "⚠ ${MYSQL_CONTAINER} đang dùng ${USED_PCT}% trần — InnoDB tự thu nhỏ buffer pool theo trần này."
    NEEDS_CHANGE=1
  fi
fi

if [[ "$SUGGEST_MYSQL_MB" -gt $(( MYSQL_LIMIT_MB + MYSQL_LIMIT_MB / 4 )) ]]; then
  note "⚠ Trần MySQL đang thấp hơn mức máy chủ này gánh được."
  NEEDS_CHANGE=1
fi

if [[ "$MYSQL_LIMIT_MB" -gt 0 && "$SUGGEST_MYSQL_MB" -lt $(( MYSQL_LIMIT_MB * 3 / 4 )) ]]; then
  note "⚠ Trần MySQL đang CAO hơn mức máy chủ này gánh được — rủi ro OOM-kill sang container khác."
  NEEDS_CHANGE=1
fi

if [[ "$NEEDS_CHANGE" -eq 0 ]]; then
  note "✅ Trần hiện tại hợp lý với máy chủ này. Không cần đổi gì."
else
  printf '\n  Hai dòng để dán vào .env, rồi chạy `docker compose up -d`:\n\n'
  printf '    MYSQL_MEM_LIMIT=%sg\n' "$(to_g "$SUGGEST_MYSQL_MB")"
  printf '    APP_MEM_LIMIT=%sg\n' "$(to_g "$SUGGEST_APP_MB")"
fi

# ── CPU ─────────────────────────────────────────────────────────────────────
# Cố ý KHÔNG đề xuất trần CPU. Trần RAM là cần thiết vì vượt RAM là bị giết;
# vượt CPU chỉ là chờ, và cả hai container này đều đo được ở mức gần 0% lúc
# bình thường. Đặt trần CPU ở đây chỉ làm chậm đúng lúc cần nhanh nhất — lượt
# khởi động, lượt sao lưu, lượt dọn dữ liệu — mà không đổi lại được gì.
printf '\n═══ CPU ═══\n'
printf '  %s nhân, không đặt trần (đúng chủ đích).\n' "$HOST_CPUS"
printf '  Vượt RAM là bị OOM-kill nên phải có trần; vượt CPU chỉ là chờ tới lượt.\n'
if [[ "$HOST_CPUS" -lt 2 ]]; then
  printf '  ⚠ Chỉ 1 nhân: `nuxi build` trên máy này sẽ rất lâu — build ở CI (xem CI-CD.md).\n'
fi

printf '\n'
exit $(( NEEDS_CHANGE == 0 ? 0 : 2 ))
