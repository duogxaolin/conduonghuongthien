/**
 * Sổ đăng ký luồng SSE — trần người đọc chậm, lượt gỡ khi ngắt, và tắt máy.
 *
 * Tệp này kiểm tra sổ và vòng đời bằng transport giả. Giới hạn bộ đệm thật,
 * tín hiệu drain và hai người đọc HTTP được kiểm riêng trong node-sse-stream.test.ts.
 * Promise resolve không tự chứng minh socket đã thoát dữ liệu: adapter WebStream
 * của h3 bỏ qua res.write(false). `.catch()` không có callback vẫn truyền rejection.
 *
 * ⚠️ **Nhóm "tắt máy" phải nằm CUỐI tệp.** `beginShutdown` bật một cờ một chiều
 * trong `sse-manager.ts` (cố ý không có đường lật lại), và mọi `broadcastToSession`
 * sau đó trả 0 vĩnh viễn. Đặt nó lên trên là biến các lượt kiểm phía trên thành đỏ
 * vì thứ tự tệp, không vì hành vi.
 *
 * Mọi luồng dựng ra ở đây đều được **gỡ khi lượt kiểm kết thúc** (`t.after`): sổ là
 * toàn tiến trình; dọn sau mỗi test để không lẫn kết nối giữa các tình huống.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { EventStreamMessage } from 'h3'
import type { SseStream } from '../server/utils/sse-manager.ts'

const sse = await import('../server/utils/sse-manager.ts')

/**
 * Một luồng giả điều khiển được **thời điểm resolve** của `push`.
 *
 * Transport giả chỉ cô lập hành vi của sổ; nó không thay cho kiểm thử HTTP/socket.
 *
 * Mặc định `push` resolve **ngay** — một khách bình thường. `hold: true` mới là
 * khách không tiêu thụ nổi; lượt ghi của họ chỉ kết thúc khi test gọi `settle()`,
 * hoặc khi luồng bị đóng (đóng writer làm mọi lượt ghi đang chờ kết thúc).
 */
function makeStream({ hold = false }: { hold?: boolean } = {}) {
  const pushed: EventStreamMessage[] = []
  const pending: Array<() => void> = []
  let closed = false
  let onClosedCb: (() => unknown) | null = null

  const settleAll = () => { while (pending.length) pending.shift()?.() }

  const stream: SseStream = {
    push(message: EventStreamMessage) {
      pushed.push(message)
      if (closed || !hold) return Promise.resolve()
      return new Promise<void>((resolve) => { pending.push(resolve) })
    },
    close() {
      closed = true
      settleAll()
      // Transport thông báo cả đóng chủ động lẫn khách ngắt.
      onClosedCb?.()
      return Promise.resolve()
    },
    onClosed(cb: () => unknown) { onClosedCb = cb },
  }

  return {
    stream,
    pushed,
    get closed() { return closed },
    /** Xong một lượt ghi đang lơ lửng — mô phỏng socket đã đẩy được đệm đi. */
    settle(count = 1) {
      for (let i = 0; i < count; i += 1) pending.shift()?.()
    },
    /** Mô phỏng khách ngắt kết nối. */
    disconnect() { closed = true; settleAll(); onClosedCb?.() },
  }
}

/** Mỗi lượt kiểm dùng một mã phiên riêng để không dính trạng thái của nhau. */
let sessionCounter = 1000
const nextSession = () => { sessionCounter += 1; return sessionCounter }

const msg = (data: string): EventStreamMessage => ({ event: 'message', data })

describe('12.1 — trần người đọc chậm là một BỘ ĐẾM, không phải một promise bị từ chối', () => {
  it('một luồng dồn quá trần thì bị đóng và bị gỡ khỏi sổ', async (t) => {
    const a = makeStream({ hold: true })
    const session = nextSession()
    sse.registerStream(a.stream, session)
    t.after(() => sse.releaseStream(a.stream))

    // Đẩy nhiều hơn trần mà không lượt nào kết thúc — đúng một khách mạng chậm.
    for (let i = 0; i < sse.MAX_PENDING + 5; i += 1) {
      sse.broadcastToSession(session, msg(`tin ${i}`))
    }

    assert.equal(a.closed, true, 'vượt trần thì luồng phải bị đóng')
    assert.equal(sse.trackedStreamCount(session), 0, 'luồng bị đóng phải được gỡ khỏi sổ')
    // Số lượt ghi ĐÃ gửi không vượt quá trần: lượt vượt bị chặn trước khi ghi.
    assert.ok(a.pushed.length <= sse.MAX_PENDING, `đã ghi ${a.pushed.length} lượt, trần là ${sse.MAX_PENDING}`)
  })

  it('một luồng tiêu thụ kịp thì KHÔNG bao giờ bị đóng', async (t) => {
    const a = makeStream({ hold: true })
    const session = nextSession()
    sse.registerStream(a.stream, session)
    t.after(() => sse.releaseStream(a.stream))

    for (let i = 0; i < sse.MAX_PENDING * 3; i += 1) {
      sse.broadcastToSession(session, msg(`tin ${i}`))
      a.settle()
      // `pending` giảm trong một microtask, nên nhường một nhịp trước lượt kế.
      await Promise.resolve()
    }

    assert.equal(a.closed, false, 'một khách đọc kịp không được bị cắt')
    assert.equal(sse.trackedStreamCount(session), 1)
  })

  it('một khách chậm KHÔNG làm hỏng buổi phát của người khác', async (t) => {
    // Đặc tả: "the session remains active and other streams remain open". Một
    // khách mạng chậm không có tư cách cắt buổi phát của mọi người còn lại.
    const slow = makeStream({ hold: true })
    const fast = makeStream({ hold: true })
    const session = nextSession()
    sse.registerStream(slow.stream, session)
    sse.registerStream(fast.stream, session)
    t.after(() => { sse.releaseStream(slow.stream); sse.releaseStream(fast.stream) })

    for (let i = 0; i < sse.MAX_PENDING + 5; i += 1) {
      sse.broadcastToSession(session, msg(`tin ${i}`))
      fast.settle()
      await Promise.resolve()
    }

    assert.equal(slow.closed, true, 'khách chậm phải bị cắt')
    assert.equal(fast.closed, false, 'khách đọc kịp phải được giữ')
    assert.equal(sse.trackedStreamCount(session), 1)
    // Và phiên vẫn sống: luồng còn lại vẫn nhận được tin tiếp theo.
    assert.equal(sse.broadcastToSession(session, msg('sau khi cắt')), 1)
    assert.equal(fast.pushed.at(-1)?.data, 'sau khi cắt')
  })
})

describe('12.2 — ngắt kết nối gỡ luồng khỏi sổ', () => {
  it('khách ngắt thì luồng không còn được ghi danh và không nhận gì nữa', async (t) => {
    const a = makeStream()
    const session = nextSession()
    sse.registerStream(a.stream, session)
    t.after(() => sse.releaseStream(a.stream))
    assert.equal(sse.trackedStreamCount(session), 1)

    a.disconnect()

    assert.equal(sse.trackedStreamCount(session), 0, 'luồng đã ngắt phải rời khỏi sổ')
    const before = a.pushed.length
    sse.broadcastToSession(session, msg('sau khi ngắt'))
    assert.equal(a.pushed.length, before, 'không được ghi thêm gì cho một luồng đã ngắt')
  })

  it('đóng chủ động cũng gỡ luồng, và gỡ hai lần là vô hại', async () => {
    const a = makeStream()
    const session = nextSession()
    sse.registerStream(a.stream, session)

    sse.releaseStream(a.stream)
    sse.releaseStream(a.stream)

    assert.equal(sse.trackedStreamCount(session), 0, 'gỡ hai lần không được để lại rác trong sổ theo phiên')
  })
})

describe('đóng phiên báo cho người xem rồi mới đóng', () => {
  it('đẩy sự kiện kết thúc TRƯỚC khi đóng, không phải sau', async (t) => {
    // Đóng trước rồi đẩy thì khách không bao giờ nhận được sự kiện: họ thấy một
    // kết nối đứt không lý do thay vì một lời giải thích.
    const a = makeStream()
    const session = nextSession()
    sse.registerStream(a.stream, session)
    t.after(() => sse.releaseStream(a.stream))

    const ended: EventStreamMessage = { event: sse.SSE_EVENT_ENDED, data: 'Buổi phát đã kết thúc.' }
    const count = await sse.closeSessionStreams(session, ended)

    assert.equal(count, 1)
    assert.deepEqual(a.pushed.at(-1), ended)
    assert.equal(a.closed, true)
    assert.equal(sse.trackedStreamCount(session), 0)
  })

  it('phiên không có luồng nào thì trả 0, không ném', async () => {
    const count = await sse.closeSessionStreams(nextSession(), { event: 'ended', data: 'x' })
    assert.equal(count, 0)
  })
})

// ─── Tắt máy. Nhóm CUỐI TỆP — xem đầu tệp. ──────────────────────────────────

describe('12.4 — tắt máy: cờ, sự kiện dạng OBJECT, và không phát gì sau đó', () => {
  it('MỌI luồng đang mở nhận một sự kiện shutdown rồi bị đóng', async (t) => {
    const a = makeStream()
    const b = makeStream()
    const session = nextSession()
    sse.registerStream(a.stream, session)
    sse.registerStream(b.stream, session)
    t.after(() => { sse.releaseStream(a.stream); sse.releaseStream(b.stream) })

    // Sổ là toàn tiến trình, nên đối chiếu với số đang ghi danh thay vì ghim một
    // con số tuyệt đối: điều cần khẳng định là **mọi** luồng đang mở đều được báo.
    const before = sse.trackedStreamCount()
    const shutdown: EventStreamMessage = { event: sse.SSE_EVENT_SHUTDOWN, data: 'Máy chủ đang khởi động lại.' }
    const count = await sse.beginShutdown(shutdown)

    assert.equal(count, before)
    for (const s of [a, b]) {
      assert.equal(s.closed, true, 'phải đóng sau khi báo')
      assert.deepEqual(s.pushed.at(-1), shutdown)
    }
    assert.equal(sse.trackedStreamCount(), 0, 'sổ phải rỗng sau khi tắt máy')
  })

  it('sự kiện tắt máy là OBJECT có `event` — chuỗi sẽ mất tên sự kiện', async () => {
    // `formatEventStreamMessage` của h3 chỉ phát `event:` khi `message.event`
    // truthy. Một chuỗi `'data: {...}\n\n'` tự dựng đi qua `push()` sẽ được đọc
    // thành `{ data: chuỗi }`, tới trình duyệt **không có tên sự kiện**, và
    // `addEventListener('shutdown')` không bao giờ chạy — im lặng hoàn toàn.
    //
    // Khẳng định bám vào `sse.SSE_EVENT_SHUTDOWN` chứ không vào chuỗi `'shutdown'`
    // viết thẳng: hằng số là thứ trình duyệt và máy chủ phải khớp nhau.
    const a = makeStream()
    const session = nextSession()
    sse.registerStream(a.stream, session)

    await sse.beginShutdown({ event: sse.SSE_EVENT_SHUTDOWN, data: 'Máy chủ đang khởi động lại.' })

    const last = a.pushed.at(-1)
    assert.equal(typeof last, 'object', 'phải là object, không phải chuỗi đã định dạng sẵn')
    assert.equal(last?.event, 'shutdown')
    assert.equal(typeof last?.data, 'string')
    assert.ok((last?.data ?? '').length > 0, 'một `data` rỗng đọc ra là cổng hỏng, không phải máy chủ đang khởi động lại')
  })

  it('KHÔNG lượt phát nào tới được luồng sau khi cờ tắt máy bật lên', async (t) => {
    // Đặc tả: "no messages are broadcast after shutdown begins". Nhánh duy nhất
    // thực thi điều đó nằm trong `broadcastToSession` chứ không ở nơi gọi — nơi
    // gọi nào quên kiểm thì tin nhắn vẫn tới khách.
    //
    // Bật cờ ngay trong lượt kiểm này thay vì dựa vào thứ tự với lượt trước: một
    // khẳng định đọc trạng thái do test khác để lại là khẳng định về thứ tự tệp,
    // không phải về hành vi.
    const a = makeStream()
    const session = nextSession()
    sse.registerStream(a.stream, session)

    await sse.beginShutdown({ event: sse.SSE_EVENT_SHUTDOWN, data: 'Máy chủ đang khởi động lại.' })
    assert.equal(sse.isShuttingDown(), true)

    const late = makeStream()
    sse.registerStream(late.stream, session)
    t.after(() => { sse.releaseStream(a.stream); sse.releaseStream(late.stream) })
    const delivered = sse.broadcastToSession(session, msg('tin sau khi tắt máy'))

    assert.equal(delivered, 0, 'không luồng nào được nhận tin sau khi cờ bật')
    assert.equal(late.pushed.length, 0, 'luồng mở sau khi tắt máy cũng không nhận gì')
  })

  it('đóng phiên KHÔNG đẩy sự kiện kết thúc khi máy chủ đang tắt', async (t) => {
    // Lúc đó đường tắt máy đã gửi lý do thật; một sự kiện "phiên đã kết thúc" tới
    // sau đó là thông tin sai về việc vừa xảy ra.
    const a = makeStream()
    const session = nextSession()
    sse.registerStream(a.stream, session)
    t.after(() => sse.releaseStream(a.stream))

    const closedCount = await sse.closeSessionStreams(session, { event: sse.SSE_EVENT_ENDED, data: 'Buổi phát đã kết thúc.' })

    assert.equal(closedCount, 1)
    assert.equal(a.pushed.length, 0, 'không đẩy gì — đường tắt máy đã báo lý do thật rồi')
    assert.equal(a.closed, true, 'nhưng vẫn phải đóng')
  })
})
