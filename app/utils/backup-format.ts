/** Định dạng thời điểm backup theo giờ Việt Nam; chuỗi không hợp lệ trả nguyên văn. */
export const formatWhen = (v: string) => {
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString('vi-VN')
}
