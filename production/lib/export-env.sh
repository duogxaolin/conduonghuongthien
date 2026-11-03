# shellcheck shell=bash
#
# production/lib/export-env.sh — Menu 6: xuất .env đã mã hoá (.env.enc) để giữ ngoài VPS.
# Nạp bởi production/manage.sh; chỉ định nghĩa hàm.

# ════════════════════════════════════════════════════════════════════════════
# 6. XUẤT .env ĐÃ MÃ HOÁ — bản ngoài VPS của mọi bí mật (wave2 D-OFFSITE)
# ════════════════════════════════════════════════════════════════════════════
#
# Mất VPS là mất .env: JWT_SECRET (đăng nhập), CHATBOT_ENCRYPTION_SECRET (khoá giải
# mã API key AI, Google OAuth secret, liên kết Drive đã lưu trong CSDL — bản dump CSDL
# không có nó thì các giá trị đó vô dụng), mật khẩu MySQL. Lệnh này ghi .env.enc
# (AES-256-CBC, khoá dẫn xuất PBKDF2 200 000 vòng) để anh tải về giữ ngoài VPS.
#   - Passphrase gõ hai lần, không hiện, tối thiểu 12 ký tự; tới openssl qua một file
#     descriptor (`-pass fd:3`), không bao giờ trên dòng lệnh (`ps` thấy mọi argv).
#   - Không in nội dung .env hay passphrase. Ghi tệp tạm 600 rồi `mv`, giải mã thử
#     ngay để chắc passphrase vừa gõ mở được tệp.
#   - openssl không có -pbkdf2 (OpenSSL 1.0.x) → từ chối, không lùi về dẫn xuất khoá
#     yếu hơn.
cmd_export_env() {
  echo -e "\n${C_BOLD}${C_CYAN}═══ XUẤT .env ĐÃ MÃ HOÁ ═══${C_RESET}\n"
  cd "$ROOT"

  if [ ! -f "$ROOT/.env" ]; then
    echo -e "${C_RED}Không có .env — không có gì để xuất.${C_RESET}"
    exit 1
  fi
  if ! command -v openssl >/dev/null 2>&1; then
    echo -e "${C_RED}Máy chủ chưa có openssl.${C_RESET}"
    exit 1
  fi
  local help
  help=$(openssl enc -help 2>&1 || true)
  case "$help" in
    *-pbkdf2*) ;;
    *)
      echo -e "${C_RED}✗ openssl trên máy chủ này không hỗ trợ -pbkdf2 (cần OpenSSL ≥ 1.1.1) — không xuất bằng cách mã hoá yếu hơn.${C_RESET}"
      exit 1 ;;
  esac

  if [ -f "$ROOT/.env.enc" ]; then
    echo -e "${C_YELLOW}⚠  Đã có $ROOT/.env.enc (lần xuất trước).${C_RESET}"
    if ! confirm "Ghi đè .env.enc?" "n"; then
      echo "Giữ nguyên .env.enc cũ."
      return 0
    fi
  fi

  local pass pass2
  # `IFS=`: giữ nguyên dấu cách đầu/cuối — passphrase là đúng những gì đã gõ.
  printf 'Passphrase (≥ 12 ký tự, không hiện khi gõ): '
  IFS= read -rs pass || true
  echo
  printf 'Gõ lại passphrase: '
  IFS= read -rs pass2 || true
  echo
  if [ "$pass" != "$pass2" ]; then
    echo -e "${C_RED}✗ Hai lần gõ không khớp — không ghi gì.${C_RESET}"
    exit 1
  fi
  if [ "${#pass}" -lt 12 ]; then
    echo -e "${C_RED}✗ Passphrase ngắn hơn 12 ký tự — không ghi gì.${C_RESET}"
    exit 1
  fi

  local tmp
  tmp=$(mktemp "$ROOT/.env.enc.XXXXXX")
  if ! openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$ROOT/.env" -out "$tmp" -pass fd:3 3< <(printf '%s' "$pass"); then
    rm -f "$tmp"
    echo -e "${C_RED}✗ openssl mã hoá thất bại — không ghi gì.${C_RESET}"
    exit 1
  fi
  # Giải mã thử bằng đúng passphrase vừa gõ: tệp không mở lại được thì vô dụng.
  if ! cmp -s "$ROOT/.env" <(openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$tmp" -pass fd:3 3< <(printf '%s' "$pass")); then
    rm -f "$tmp"
    echo -e "${C_RED}✗ Giải mã thử không ra đúng .env — không ghi gì.${C_RESET}"
    exit 1
  fi
  pass=''
  pass2=''
  chmod 600 "$tmp"
  mv -f "$tmp" "$ROOT/.env.enc"

  echo -e "${C_GREEN}✓ Đã ghi $ROOT/.env.enc (quyền 600, $(wc -c < "$ROOT/.env.enc") byte).${C_RESET}"
  echo -e "  Tải về máy của anh rồi XOÁ khỏi VPS (bản trên VPS mất cùng VPS):"
  echo -e "    scp <user>@<vps>:$ROOT/.env.enc ./cdkt-env-$(date +%Y%m%d).enc"
  echo -e "    rm $ROOT/.env.enc"
  echo -e "  Giải mã (hỏi passphrase):"
  echo -e "    openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in .env.enc -out .env"
  echo -e "${C_YELLOW}  Giữ passphrase ở nơi KHÁC tệp này — mất passphrase là mất bản xuất.${C_RESET}"
}
