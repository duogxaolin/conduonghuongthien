# Màu: 22 token và bảng gộp (D-T1, task 3.7)

Quyết định ngày 2026-10-27. Nguồn: `shared/color-tokens.ts` (22 token), `shared/color-merges.ts` (118 mục), công cụ `scripts/codemod-hex-tokens.ts --merges`.

## Đã duyệt
- **Phần A:** gộp 91 màu lệch ΔE (CIEDE2000) dưới 2 vào token cũ gần nhất.
- **Phần B:** 10 token mới (`ink-admin`, `ink-soft`, `brand-300`, `accent`, `danger-soft`, `ink-faint`, `brand-800`, `danger-bg`, `ink-strong`, `warn-ink`); màu cách token ≤ 2 là `member`; ba nhóm `fold` (`#556450`, `#385932` + `#2d5a27`, `#fff4f3`) chỉ nhận mục cách token ≤ 3,75.
- **Giữ hex:** màu ΔE 2–3 không liệt kê và các màu đỏ rời rạc (`#a32924`, `#b42318`, `#b71c1c`, `#b0403c`).
- `accent` (`#7cb342`) chỉ trang trí: không làm vòng/viền focus (test chặn); chữ trên nền trắng chưa có test chặn — vài chỗ cũ (`qa-documents.vue`, số thứ hạng) vi phạm, cần task a11y riêng.

## Giữ lại chờ duyệt lại (sau verify độc lập)
- 9 màu fold đo lại cách token 4,2–6,7 (81 lượt): `held-for-reapproval.txt` trong thư mục proof.
- `#fff4f3` (3,75; 24 lượt): gộp sẽ tách nó khỏi `#fff5f4` (lệch 0,45). `#556350` (3,36; 2 lượt): vượt 3,0 đã duyệt cho nhóm. Cả hai ở lại hex.

## Số đo
Hex 3.946 → ~1.725 (baseline `tests/ratchets/hex-colors.baseline.json`). Phần còn lại: ~1.500 màu chưa có token, cùng các hex trùng giá trị token nhưng giữ để không đổi lớp thắng trong cascade (hai hex trên một phần tử cùng thành một token thì giữ cả hai). Ratchet hex "gần 0" của 3.7 vì vậy không đạt được theo D-T1 — mục tiêu thực là không tăng.

Bằng chứng (CSS, ảnh chụp 95 trạng thái, sai lệch từng trang) nằm ngoài repo ở `/home/ray/orca/cdht-dt1-proof/`; ΔE pixel lớn nhất 3,97 (răng cưa chữ), ΔE màu tính được lớn nhất 3,75.
