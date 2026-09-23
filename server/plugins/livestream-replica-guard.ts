/**
 * Cảnh báo lúc khởi động khi cổng chạy nhiều bản sao.
 *
 * ## Vì sao đây là một CẢNH BÁO chứ không phải một lượt từ chối khởi động
 *
 * Sổ luồng SSE (`server/utils/sse-manager.ts`) nằm trong bộ nhớ tiến trình: một
 * khách nối vào bản sao A sẽ **không bao giờ** nhận được tin nhắn phát trên bản
 * sao B. Triệu chứng duy nhất là "chat lúc có lúc không" — không lỗi, không dòng
 * log, không gì chỉ vào nguyên nhân, và nó chỉ hiện ra khi có đủ đông người xem.
 *
 * Nhưng từ chối khởi động cũng sai: nhiều deployment hợp lệ chạy nhiều bản sao
 * **mà không dùng chat trực tiếp**, và chặn họ khởi động vì một tính năng họ
 * không bật là biến một hạn chế đã ghi thành một sự cố. Nên đây là một dòng log
 * `warn` — đủ để người vận hành tìm thấy khi họ đi tìm, không đủ để làm sập thứ
 * đang chạy.
 *
 * ## Ghim một bản sao nằm ở HAI chỗ, và cả hai đều cần
 *
 * `container_name: cdkt_app` trong `docker-compose.yml` chặn `docker compose up
 * --scale app=2` (Compose từ chối container thứ hai cùng tên). Nhưng nó chỉ chặn
 * được đường compose: một bản sao dựng bằng `docker run`, bằng systemd, hay trên
 * một máy khác đứng sau cùng một nginx thì nó không thấy. `CDKT_SSE_REPLICA_GUARD=1`
 * là lời khai của người vận hành rằng họ **đã** kiểm và chỉ có một bản sao —
 * biến này không tự làm gì cả, nó chỉ tắt lời cảnh báo đi.
 *
 * Cố ý **không** đặt giá trị mặc định là `'1'`: một biến có mặc định đúng thì
 * không bao giờ cảnh báo ai, và cảnh báo này tồn tại chính vì cái mặc định đúng
 * là thứ không ai kiểm.
 *
 * Đa bản sao cần một backplane pub/sub (Redis) — ngoài phạm vi thay đổi này;
 * `README.md` ghi rõ hạn chế đó.
 */
export default defineNitroPlugin(() => {
  if (process.env.NODE_ENV !== 'production') return
  if ((process.env.CDKT_SSE_REPLICA_GUARD || '').trim() === '1') return

  console.warn(
    '[livestream] CDKT_SSE_REPLICA_GUARD chưa được đặt. Sổ luồng SSE nằm trong bộ nhớ '
    + 'tiến trình, nên chat trực tiếp chỉ đúng khi cổng chạy ĐÚNG MỘT bản sao. '
    + 'docker-compose.yml đã ghim bằng `container_name: cdkt_app`; nếu anh chạy nhiều '
    + 'bản sao theo cách khác, hãy tắt chat trực tiếp hoặc dựng backplane pub/sub. '
    + 'Đặt CDKT_SSE_REPLICA_GUARD=1 để tắt lời cảnh báo này.',
  )
})
