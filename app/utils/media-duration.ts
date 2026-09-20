/**
 * Đổi `durationSeconds` thành chuỗi thời lượng để hiển thị.
 *
 * Nằm ở `app/utils` chứ không trong trang: hàm này được dùng ở **hai** chỗ trên
 * cùng một trang (khối thông tin của video đang xem và từng mục trong danh sách
 * gợi ý), và hai bản sao của một phép đổi số sẽ chỉ được đối chiếu vào lúc một
 * trong hai hiện ra khác — tức là sau khi người đọc đã thấy.
 *
 * **Trả chuỗi rỗng cho mọi giá trị không dùng được**, không trả `"0:00"`. Video
 * chưa đo được thời lượng là chuyện thật (`ffprobe` không đọc được, hoặc một mục
 * nguồn ngoài chưa có số), và `"0:00"` là một lời khẳng định sai về nội dung —
 * người đọc thấy nó sẽ tưởng video hỏng. Chuỗi rỗng để nơi gọi bỏ hẳn phần tử.
 *
 * `Number.isFinite` trước mọi phép tính, cùng lý do `finitePositive()` tồn tại ở
 * tầng máy chủ: `NaN` và `Infinity` đi qua `Math.round` mà không ai chặn.
 */
export function formatMediaDuration(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return ''
  const seconds = Math.round(value)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  const pad = (part: number) => String(part).padStart(2, '0')
  // Dưới một giờ thì không hiện `0:` — "0:05:12" là cách viết của một bảng giờ
  // làm việc, không phải của một video ngắn.
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`
}
