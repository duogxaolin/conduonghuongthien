# shellcheck shell=bash
#
# production/lib/update-image.sh — Update: kéo + áp dụng image mới, tự lùi khi hỏng, dọn
# image cũ. Nạp bởi production/manage.sh; chỉ định nghĩa hàm.

# Gỡ image app cũ THEO THẺ sau một lượt Update khoẻ — cùng hàm, cùng quy tắc với
# scripts/deploy-remote.sh: giữ image đang chạy + IMAGE_KEEP bản sha-* mới nhất khác
# của CÙNG repo (thẻ lùi cdkt-rollback/app:* không thuộc repo đó nên không bao giờ
# bị xét), `docker image rm` không `-f`, rồi `image prune -f` cho layer lơ lửng.
# Không bao giờ làm hỏng lượt Update: mọi lỗi chỉ là cảnh báo.
prune_app_images() {
  local repo="${1%:*}" running_id tag line
  local -a rows=() sorted=()
  running_id=$(docker image inspect --format '{{.Id}}' "$1" 2>/dev/null || true)
  if [ -z "$running_id" ]; then
    return 0
  fi
  while IFS= read -r tag; do
    case "$tag" in
      sha-*) ;;
      *) continue ;;
    esac
    line=$(docker image inspect --format '{{.Created}} {{.Id}}' "$repo:$tag" 2>/dev/null || true)
    if [ -z "$line" ] || [ "${line##* }" = "$running_id" ]; then
      continue
    fi
    rows+=("${line%% *} $tag")
  done < <(docker image ls --format '{{.Tag}}' "$repo" 2>/dev/null || true)
  if [ "${#rows[@]}" -gt "$IMAGE_KEEP" ]; then
    mapfile -t sorted < <(printf '%s\n' "${rows[@]}" | sort -r)
    for line in "${sorted[@]:IMAGE_KEEP}"; do
      tag=${line##* }
      if docker image rm "$repo:$tag" >/dev/null 2>&1; then
        echo -e "${C_DIM}  Gỡ image cũ $repo:$tag${C_RESET}"
      else
        echo -e "${C_YELLOW}⚠  Không gỡ được $repo:$tag (còn container dùng?) — để lại.${C_RESET}"
      fi
    done
  fi
  docker image prune -f >/dev/null 2>&1 || true
}

warn_disk_usage() {
  local root pct
  root=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)
  root=${root:-/var/lib/docker}
  pct=$(df --output=pcent "$root" 2>/dev/null | tail -n 1 | tr -dc '0-9' || true)
  if [ -n "$pct" ] && [ "$pct" -gt "$DISK_WARN_PCT" ]; then
    echo -e "${C_YELLOW}⚠  Đĩa chứa dữ liệu Docker ($root) đã dùng ${pct}% (ngưỡng ${DISK_WARN_PCT}%) — dọn image/backup cũ trước khi đầy.${C_RESET}"
  fi
}

# Kéo + áp dụng image mới cho Update, có đường lùi. Trả 0 khi app healthy (kể cả khi
# không có gì để áp), 1 khi thất bại (đã in lý do; đã lùi nếu có thể).
update_app_image() {
  local cur_img new_img prev_id rollback_ref="" img_after reason="" latest_ref repo
  cur_img=$(env_get CDKT_IMAGE)
  new_img="$cur_img"

  # Image đang chạy THẬT (theo ID, không theo tên thẻ): sau `docker pull` thẻ
  # `:latest` đã trỏ sang bản mới, nên "thẻ trước đó" của nó không còn là bản trước.
  prev_id=$(docker inspect --format '{{.Image}}' "$APP_CONTAINER" 2>/dev/null || true)

  # CI ghim CDKT_IMAGE vào `:sha-<commit>` sau lượt deploy đầu tiên. Kéo lại đúng
  # tên đó chỉ ra cùng một image — Update trông như chạy mà không đổi gì.
  case "$cur_img" in
    '') reason="CDKT_IMAGE chưa đặt — compose dùng cdkt/app:local (chỉ build tại chỗ, không kéo được)." ;;
    *:sha-*) reason="CDKT_IMAGE đang ghim vào một bản CI cụ thể ($cur_img): kéo lại sẽ chỉ ra đúng bản đó." ;;
    cdkt-rollback/*|cdkt/app:*) reason="CDKT_IMAGE là image cục bộ ($cur_img), không có trên registry để kéo." ;;
  esac
  if [ -n "$reason" ]; then
    case "$cur_img" in ghcr.io/*) repo="${cur_img%:*}" ;; *) repo="$DEFAULT_IMAGE_REPO" ;; esac
    latest_ref="$repo:latest"
    echo -e "${C_YELLOW}⚠  $reason${C_RESET}"
    echo -e "${C_DIM}   Lượt CI deploy kế tiếp sẽ ghim lại vào bản của nó.${C_RESET}"
    if confirm "Trỏ CDKT_IMAGE về $latest_ref để kéo bản mới nhất?" "y"; then
      new_img="$latest_ref"
    fi
  fi

  # Thẻ an toàn cho image đang chạy — đích của đường lùi, độc lập với việc thẻ
  # `:latest` / `:sha-…` có bị kéo/đè hay không.
  if [ -n "$prev_id" ]; then
    rollback_ref="cdkt-rollback/app:$(date -u +%Y%m%dT%H%M%SZ)"
    if docker image tag "$prev_id" "$rollback_ref"; then
      echo -e "${C_DIM}Image đang chạy được giữ làm đích lùi: $rollback_ref${C_RESET}"
    else
      echo -e "${C_YELLOW}⚠  Không gắn được thẻ lùi — nếu bản mới hỏng sẽ KHÔNG tự lùi được.${C_RESET}"
      rollback_ref=""
    fi
  fi

  echo -e "${C_BOLD}Pull image $new_img ...${C_RESET}"
  if [ -z "$new_img" ] || ! docker pull "$new_img"; then
    echo -e "${C_YELLOW}⚠  Không kéo được image (registry, thẻ, hoặc chưa 'docker login ghcr.io' — package GHCR là private).${C_RESET}"
    echo -e "${C_YELLOW}   Build ngay trên VPS có thể bị OOM giữa chừng — đúng lúc container cũ vẫn đang phục vụ${C_RESET}"
    echo -e "${C_YELLOW}   (docker-compose.yml, service app: 'build ở nơi khác thì một lần build hỏng không chạm được trang đang chạy').${C_RESET}"
    if confirm "Vẫn build image trên VPS này (docker compose build app)?" "n"; then
      if ! CDKT_IMAGE="${new_img:-cdkt/app:local}" docker compose build app; then
        echo -e "${C_RED}✗ Build thất bại. Container đang chạy không bị đụng tới.${C_RESET}"
        return 1
      fi
      [ -n "$new_img" ] || new_img="cdkt/app:local"
    else
      echo -e "${C_RED}✗ Không có image mới. Container đang chạy không bị đụng tới.${C_RESET}"
      echo -e "${C_DIM}   Đăng nhập GHCR (docker login ghcr.io) hoặc chờ CI đẩy image, rồi chạy lại Update.${C_RESET}"
      return 1
    fi
  fi

  if [ "$new_img" != "$cur_img" ]; then
    set_env CDKT_IMAGE "$new_img"
    echo -e "${C_GREEN}✓ .env: CDKT_IMAGE=$new_img${C_RESET}"
  fi

  img_after=$(docker image inspect --format '{{.Id}}' "$new_img" 2>/dev/null || true)
  if [ -n "$prev_id" ] && [ "$img_after" = "$prev_id" ]; then
    echo -e "${C_DIM}Image kéo về trùng image đang chạy — không có bản mới hơn.${C_RESET}"
    if ! confirm "Vẫn khởi động lại app?" "n"; then
      return 0
    fi
  fi

  echo -e "${C_BOLD}Khởi động lại app ...${C_RESET}"
  if start_app && wait_app_healthy; then
    # Chỉ giữ thẻ lùi của lượt này; thẻ của các lượt trước dọn đi cho khỏi đầy đĩa.
    if [ -n "$rollback_ref" ]; then
      { docker image ls --format '{{.Repository}}:{{.Tag}}' cdkt-rollback/app 2>/dev/null \
          | grep -vxF "$rollback_ref" \
          | while IFS= read -r old_tag; do docker image rm "$old_tag" >/dev/null 2>&1 || true; done; } || true
    fi
    # Image sha-* cũ của CI: giữ image đang chạy + IMAGE_KEEP bản mới nhất.
    prune_app_images "$new_img" || true
    warn_disk_usage || true
    return 0
  fi

  echo -e "${C_RED}✗ Bản mới không khoẻ.${C_RESET}"
  show_app_logs
  if [ -z "$rollback_ref" ]; then
    echo -e "${C_RED}✗ Không có image trước để lùi về (chưa có container chạy, hoặc không gắn được thẻ) — cần xử lý tay.${C_RESET}"
    return 1
  fi
  echo -e "${C_BOLD}Lùi về image trước ($rollback_ref) ...${C_RESET}"
  # compose đã bị git pull thay mới: lùi cả nó, vì image trước chạy trên compose trước.
  if [ -n "$UPDATE_COMPOSE_BACKUP" ] && [ -f "$UPDATE_COMPOSE_BACKUP" ] \
     && ! cmp -s "$UPDATE_COMPOSE_BACKUP" "$ROOT/docker-compose.yml"; then
    cp "$UPDATE_COMPOSE_BACKUP" "$ROOT/docker-compose.yml"
    echo -e "${C_DIM}docker-compose.yml đã trả về bản trước lượt pull ($UPDATE_COMPOSE_BACKUP).${C_RESET}"
  fi
  set_env CDKT_IMAGE "$rollback_ref"
  if start_app && wait_app_healthy; then
    echo -e "${C_RED}✗ UPDATE THẤT BẠI — đã lùi về $rollback_ref và dịch vụ đã khoẻ trở lại.${C_RESET}"
    echo -e "${C_DIM}   .env đang đặt CDKT_IMAGE=$rollback_ref (image cục bộ). Lượt CI deploy kế tiếp, hoặc Update${C_RESET}"
    echo -e "${C_DIM}   lần sau, sẽ đề nghị trỏ lại về bản trên GHCR.${C_RESET}"
  else
    echo -e "${C_RED}✗ UPDATE THẤT BẠI VÀ lượt lùi về $rollback_ref cũng không khoẻ — cần vào máy chủ xử lý ngay.${C_RESET}"
  fi
  return 1
}
