# shellcheck shell=bash
#
# production/lib/migrate.sh — Menu 3: Migrate (nhập production/migrations/*.sql), kèm máy
# quét lệnh phá dữ liệu. Nạp bởi production/manage.sh; chỉ định nghĩa hàm.

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

  # Mật khẩu root + tên database: CHỈ lấy từ .env của deploy này. Không lùi về
  # DB_PASSWORD: đó là mật khẩu của user ỨNG DỤNG, còn lệnh dưới đăng nhập bằng root —
  # lùi về nó chỉ cho ra lỗi "Access denied" khó hiểu. Tên database cũng đọc từ
  # .env (Deploy bước 2 cho đặt tên tuỳ ý), không cố định `cdkt_admin`.
  local root_pw db
  root_pw=$(env_get MYSQL_ROOT_PASSWORD)
  if [ -z "$root_pw" ]; then
    echo -e "${C_RED}Không tìm thấy MYSQL_ROOT_PASSWORD trong .env${C_RESET}"
    exit 1
  fi
  db=$(db_name)
  echo -e "${C_DIM}Database đích: ${db} (container ${MYSQL_CONTAINER})${C_RESET}"

  # Đếm số bài hiện tại để đối chiếu. `</dev/null`: `docker exec -i` không được
  # nuốt stdin của script (các câu trả lời menu phía sau).
  local before_count
  before_count=$(mysql_exec "$root_pw" "$db" -N -e "SELECT COUNT(*) FROM articles;" 2>/dev/null </dev/null | tail -n1) || before_count="?"

  # Liệt kê file SQL + trạng thái đã import hay chưa
  echo -e "${C_BOLD}File SQL trong production/migrations/:${C_RESET}\n"
  local files=()
  local i=0
  for f in "$MIG_DIR"/*.sql; do
    [ -f "$f" ] || continue
    local name
    name=$(basename "$f")
    local marker="$MIG_DIR/.imported-$name"
    local status="chưa"
    if [ -f "$marker" ]; then status="${C_GREEN}đã import${C_RESET}"; fi
    # Kích thước
    local sz
    sz=$(du -h "$f" | cut -f1)
    # Dấu cảnh báo thật, từ việc quét nội dung file (không phải dòng chữ tĩnh).
    local danger_n
    danger_n=$(sql_destructive_lines "$f" | wc -l | tr -d ' ')
    if [ "$danger_n" -gt 0 ]; then status="$status  ${C_RED}⚠ ${danger_n} lệnh DROP/TRUNCATE/DELETE…${C_RESET}"; fi
    printf "  [%d] %-40s %6s  %b\n" "$((i+1))" "$name" "$sz" "$status"
    files+=("$f")
    i=$((i+1))
  done

  if [ ${#files[@]} -eq 0 ]; then
    echo -e "${C_YELLOW}Không có file .sql nào. Thả file vào production/migrations/ rồi chạy lại.${C_RESET}"
    exit 0
  fi

  echo -e "\n${C_DIM}Bài viết hiện tại trong DB: ${before_count}${C_RESET}"
  echo -e "${C_DIM}Mỗi file được quét tìm DROP, TRUNCATE, DELETE, UPDATE không WHERE và SQL động PREPARE/EXECUTE (bỏ qua chú thích, kể cả xuống dòng giữa lệnh).${C_RESET}"
  echo -e "${C_DIM}File bị đánh dấu ⚠ sẽ XÓA data cũ rồi chèn mới và đòi xác nhận riêng. Đảm bảo có backup!${C_RESET}"

  # Hỏi chọn file
  echo
  local sel
  prompt "Chọn file để import (số, hoặc 'all' cho tất cả chưa import)" "all"; sel="$PROMPT_RESULT"

  local to_import=()
  if [ "$sel" = "all" ]; then
    for f in "${files[@]}"; do
      local name
      name=$(basename "$f")
      [ -f "$MIG_DIR/.imported-$name" ] || to_import+=("$f")
    done
  else
    if ! [[ "$sel" =~ ^[0-9]+$ ]]; then
      echo -e "${C_RED}Lựa chọn không hợp lệ.${C_RESET}"; exit 1
    fi
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

  echo -e "\n${C_BOLD}Sẽ import vào database '${db}':${C_RESET}"
  for f in "${to_import[@]}"; do echo "  - $(basename "$f")"; done
  echo
  if ! confirm "Xác nhận import?" "n"; then
    echo "Huyỷ."; exit 0
  fi

  # File có lệnh phá dữ liệu: đòi gõ lại ĐÚNG tên file (một cái "y" lặp thói quen
  # không đủ cho thao tác xoá bảng). Không gõ đúng → bỏ qua file đó, không import.
  local confirmed=()
  for f in "${to_import[@]}"; do
    local name
    name=$(basename "$f")
    local danger
    danger=$(sql_destructive_lines "$f")
    if [ -n "$danger" ]; then
      echo -e "\n${C_RED}${C_BOLD}⚠  $name chứa lệnh XÓA/GHI ĐÈ dữ liệu cũ:${C_RESET}"
      # Here-string, không `printf | head`: head thoát sau 8 dòng, printf của một danh
      # sách dài (dump lớn) ăn SIGPIPE, và dưới `set -o pipefail` + `set -e` cả script
      # chết giữa chừng — ngay trước câu hỏi xác nhận.
      head -n 8 <<< "$danger" | sed 's/^/    /'
      if [ "$(wc -l <<< "$danger" | tr -d ' ')" -gt 8 ]; then
        echo "    … (còn nữa)"
      fi
      echo -e "${C_YELLOW}   Bảng bị DROP/TRUNCATE, hàng bị DELETE/UPDATE sẽ mất dữ liệu hiện có trong '${db}'. Cần có bản sao lưu (scripts/backup-db.sh).${C_RESET}"
      local typed
      prompt "   Gõ đúng tên file '$name' để xác nhận (enter = bỏ qua file này)" ""; typed="$PROMPT_RESULT"
      if [ "$typed" != "$name" ]; then
        echo -e "${C_DIM}   → Bỏ qua $name (không import).${C_RESET}"
        continue
      fi
    fi
    confirmed+=("$f")
  done
  if [ ${#confirmed[@]} -eq 0 ]; then
    echo -e "${C_DIM}Không có file nào được xác nhận — không import gì.${C_RESET}"
    exit 0
  fi

  # Import lần lượt
  for f in "${confirmed[@]}"; do
    local name
    name=$(basename "$f")
    echo -e "\n${C_BOLD}Import $name ...${C_RESET}"
    # Thành công/thất bại quyết định bằng MÃ THOÁT của mysql, không bằng việc lọc
    # chữ trên stderr (cảnh báo của từng bản mysql một khác). stderr được giữ lại để
    # hiện: là cảnh báo khi thành công, là nguyên nhân khi thất bại.
    local err_out
    if err_out=$(mysql_exec "$root_pw" "$db" < "$f" 2>&1 1>/dev/null); then
      touch "$MIG_DIR/.imported-$name"
      echo -e "${C_GREEN}✓ $name đã import${C_RESET}"
      if [ -n "$err_out" ]; then
        echo -e "${C_DIM}  mysql cảnh báo:${C_RESET}"
        printf '%s\n' "$err_out" | sed 's/^/    /'
      fi
    else
      echo -e "${C_RED}✗ $name LỖI:${C_RESET}"
      printf '%s\n' "$err_out" | sed 's/^/    /'
      exit 1
    fi
  done

  # Đếm lại
  local after_count
  after_count=$(mysql_exec "$root_pw" "$db" -N -e "SELECT COUNT(*) FROM articles;" 2>/dev/null </dev/null | tail -n1) || after_count="?"
  echo -e "\n${C_GREEN}${C_BOLD}═══ MIGRATE XONG ═══${C_RESET}"
  echo -e "  Bài viết: ${before_count} → ${C_GREEN}${after_count}${C_RESET}"
  echo -e "  Đánh dấu đã import trong production/migrations/.imported-*"
}

# Quét một file SQL tìm câu lệnh phá/ghi đè dữ liệu. In "số-dòng:câu-lệnh" (dòng nơi
# câu lệnh BẮT ĐẦU, cắt 110 ký tự) cho từng câu lệnh bị gắn cờ; không in gì nếu sạch.
# Chủ đích bắt THỪA hơn thiếu — gắn cờ chỉ đòi gõ lại tên file, bỏ sót thì mất bảng.
#
# Bản cũ dò từng dòng bằng grep nên lọt: `DROP` và `TABLE` trên hai dòng, `DROP/**/TABLE`,
# `TRUNCATE`a`` (không có dấu cách), DROP trong thân thủ tục (`BEGIN DROP TABLE …`),
# SQL động (PREPARE/EXECUTE), và BOM UTF-8 ở dòng 1. Nay đọc như trình phân tích của
# MySQL ở mức token:
#   - bỏ BOM; bỏ chú thích `-- `, `#`, `/* … */` — NHƯNG giữ phần trong `/*!NNNNN … */`
#     và `/*M!NNNNNN … */` (MySQL/MariaDB VẪN chạy) như mã;
#   - nhận chuỗi '…' "…" (có `\` và nháy đôi) và `định danh`, nên `--`, `/*`, `;` nằm
#     TRONG chuỗi không bị hiểu nhầm là chú thích/kết thúc câu (`VALUES ('--'); DROP …`
#     không lọt). Nội dung chuỗi không được đem dò (bài viết có chữ "drop" không bị gắn
#     cờ) — trừ khi file đổi cách MySQL đọc chuỗi (NO_BACKSLASH_ESCAPES, hoặc SET NAMES
#     big5/cp932/gbk/gb18030/sjis — byte 0x5C nằm trong ký tự nhiều byte): khi đó máy
#     quét không chắc mình tách chuỗi giống MySQL, nên dò thêm cả văn bản thô từng dòng;
#   - gộp mọi khoảng trắng (kể cả xuống dòng) rồi tách câu theo `;` (thân thủ tục sau
#     `DELIMITER` cũng bị tách — vẫn dò được), so không phân biệt hoa thường.
# Gắn cờ: mọi token DROP / TRUNCATE (cả `ALTER … DROP`, `TRUNCATE t` không có TABLE),
# PREPARE / EXECUTE (SQL động — nội dung nằm trong chuỗi, không đọc được trước), mọi
# DELETE (trừ mệnh đề khoá ngoại `ON DELETE`), và UPDATE không có WHERE. Chuỗi/chú thích
# chưa đóng tới cuối file cũng bị gắn cờ (phần sau đó không quét được).
sql_destructive_lines() {
  local file="$1" raw=0
  if LC_ALL=C grep -aqiE "no_backslash_escapes|(names|character_set_client|charset|character[[:space:]]+set)[[:space:]=]*['\"]?(big5|cp932|gbk|gb18030|sjis)" "$file" 2>/dev/null; then
    raw=1
  fi
  { LC_ALL=C awk -v raw="$raw" "$(sql_scan_awk)" "$file" 2>/dev/null | cut -c1-110; } || true
}
sql_scan_awk() {
  cat <<'AWK'
# Theo byte (LC_ALL=C), awk POSIX: cùng kết quả dưới gawk, mawk (awk mặc định của
# Ubuntu) và BusyBox. Tuyến tính theo kích thước file: một dòng extended-INSERT 1 MB
# được đọc qua một cửa sổ nhỏ (`more`), không bị chép lại cả dòng cho mỗi token, và
# câu lệnh không bị gom lại — mỗi đoạn mã được dò từng từ ngay khi đi qua.
BEGIN { st = "N"; W = (window > 0) ? window : 512; NB = "[^a-z0-9_$]"; reset() }
function reset() { flag = 0; firstw = ""; prevw = ""; sawwhere = 0; disp = ""; sline = 0 }
function more() {
  if (lpos > llen) return 0
  s = s substr(line, lpos, W); lpos += W
  return 1
}
function show(t) {
  if (sline == 0 && t ~ /[^ \t\r\f\v]/) sline = NR
  if (length(disp) < 200) disp = disp substr(t, 1, 200)
}
function word(w) {
  if (w == "drop" || w == "truncate" || w == "prepare" || w == "execute") flag = 1
  else if (w == "delete" && prevw != "on") flag = 1
  else if (w == "where") sawwhere = 1
  if (firstw == "") firstw = w
  prevw = w
}
function code(t,   lt) {
  if (t == "") return
  show(t)
  lt = tolower(t)
  while (match(lt, /[a-z0-9_$]+/)) {
    word(substr(lt, RSTART, RLENGTH))
    lt = substr(lt, RSTART + RLENGTH)
  }
}
function has(str, w) { return str ~ ("(^|" NB ")(" w ")(" NB "|$)") }
function flush(   d) {
  if (sline && (flag || (firstw == "update" && !sawwhere))) {
    d = disp; gsub(/[ \t\r\f\v]+/, " ", d); sub(/^ /, "", d)
    printf "%d:%s\n", sline, d
  }
  reset()
}
{
  line = $0
  if (NR == 1) sub(/^\357\273\277/, "", line)
  if (raw && has(tolower(line), "drop|truncate|prepare|execute|delete|update")) rawhits = rawhits NR ":" substr(line, 1, 200) "\n"
  llen = length(line); lpos = 1; s = ""
  while (1) {
    if (s == "" && !more()) break
    eol = (lpos > llen)
    if (st == "N" || st == "X") {
      p = match(s, /['"`\/#;*-]/)
      if (p == 0) {
        # Không có ký tự đặc biệt trong cửa sổ: giữ lại từ cuối, nó có thể còn tiếp.
        if (!eol && match(s, /[A-Za-z0-9_$]+$/)) {
          if (RSTART == 1) { more(); continue }
          hold = RSTART   # code() runs match() too, which overwrites RSTART
          code(substr(s, 1, hold - 1)); s = substr(s, hold); more(); continue
        }
        code(s); s = ""; more(); continue
      }
      # Các quyết định dưới đây nhìn tới 3 ký tự sau ký tự đặc biệt.
      if (!eol && p + 3 > length(s)) { more(); continue }
      code(substr(s, 1, p - 1))
      c = substr(s, p, 1); s = substr(s, p + 1)
      if (c == ";") { flush(); continue }
      if (c == "'" || c == "\"") { q = c; ret = st; st = "S"; show(c); continue }
      if (c == "`") { ret = st; st = "B"; show(c); continue }
      if (c == "/" && substr(s, 1, 1) == "*" && st == "N") {
        # Số phiên bản sau `/*!` / `/*M!` có thể vắt qua cửa sổ: đọc thêm tới hết số.
        if (substr(s, 2, 1) == "!") { s = substr(s, 3); while (s ~ /^[0-9]*$/ && more()) {}; sub(/^[0-9]*/, "", s); st = "X"; code(" "); continue }
        if (substr(s, 2, 2) == "M!") { s = substr(s, 4); while (s ~ /^[0-9]*$/ && more()) {}; sub(/^[0-9]*/, "", s); st = "X"; code(" "); continue }
        st = "C"; s = substr(s, 2); code(" "); continue
      }
      if (c == "*" && st == "X" && substr(s, 1, 1) == "/") { st = "N"; s = substr(s, 2); code(" "); continue }
      if (c == "#" && st == "N") { s = ""; lpos = llen + 1; continue }
      if (c == "-" && st == "N" && substr(s, 1, 1) == "-" && (length(s) == 1 || substr(s, 2, 1) <= " ")) { s = ""; lpos = llen + 1; continue }
      code(c); continue
    }
    if (st == "S") {
      pq = index(s, q); pb = index(s, "\\")
      if (pq == 0 && pb == 0) { show(s); s = ""; more(); continue }
      p = (pb > 0 && (pq == 0 || pb < pq)) ? pb : pq
      # `\` hoặc nháy ở cuối cửa sổ: cần ký tự kế tiếp (ký tự bị thoát / nháy đôi).
      if (!eol && p == length(s)) { more(); continue }
      if (p == pb) { show(substr(s, 1, pb + 1)); s = substr(s, pb + 2); continue }
      show(substr(s, 1, pq)); s = substr(s, pq + 1)
      if (substr(s, 1, 1) == q) { show(q); s = substr(s, 2); continue }
      st = ret; continue
    }
    if (st == "B") {
      pq = index(s, "`")
      if (pq == 0) { show(s); s = ""; more(); continue }
      if (!eol && pq == length(s)) { more(); continue }
      show(substr(s, 1, pq)); s = substr(s, pq + 1)
      if (substr(s, 1, 1) == "`") { show("`"); s = substr(s, 2); continue }
      st = ret; continue
    }
    # st == "C": chú thích thường, tới */ (giữ `*` cuối cửa sổ cho lượt sau)
    p = index(s, "*/")
    if (p == 0) {
      if (eol) { s = ""; continue }
      s = substr(s, length(s)); more(); continue
    }
    s = substr(s, p + 2); st = "N"
  }
  if (st == "S") show(" "); else code(" ")
}
END {
  if (st != "N") {
    flag = 1
    if (sline == 0) sline = NR
    disp = substr(disp, 1, 100) " … (chuỗi/chú thích chưa đóng tới cuối file — phần sau không quét được)"
  }
  flush()
  printf "%s", rawhits
}
AWK
}
