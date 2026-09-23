/**
 * Hai plugin Nitro của phòng chat trực tiếp: ghim một bản sao (12.5) và tắt máy (12.4).
 *
 * ## Vì sao tệp này CHẠY ĐƯỢC plugin, thay vì soi văn bản mã nguồn
 *
 * `defineNitroPlugin` là một auto-import **lúc build** của Nitro, không phải một
 * global lúc chạy: `node -e "typeof defineNitroPlugin"` in ra `undefined`. Đó là lý
 * do `tests/analytics-scheduler.test.ts` phải đọc chữ trong tệp plugin — cách duy
 * nhất còn lại khi không import được.
 *
 * Nhưng "không import được" chỉ đúng khi để nguyên. Một định danh tự do trong ESM
 * được phân giải qua **global environment record**, nên gán `globalThis.defineNitroPlugin`
 * trước lượt `import()` là đủ để tệp plugin nạp được và **hàm plugin lộ ra cho
 * người gọi**. Đã kiểm bằng một tệp thăm dò dựng tay trước khi viết tệp này: cả hai
 * plugin nạp được, và hàm bắt được.
 *
 * Điều đó đổi hẳn giá trị của lượt kiểm. `design.md` §"Testing" nói thẳng: hành vi
 * gọi được thì phải **gọi**, chỉ hành vi chỉ tồn tại trong template mới đọc chữ —
 * "a source-text assertion proves structure, not behavior". Một khẳng định
 * `assert.match(source, /console\.warn/)` xanh kể cả khi dòng cảnh báo nằm trong
 * một nhánh `if` không bao giờ đúng; ở đây cảnh báo được **đếm trên từng tổ hợp
 * môi trường**.
 *
 * ## ⚠️ Nhóm "tắt máy" phải nằm CUỐI TỆP
 *
 * Lượt kiểm cuối gọi hook thật, mà hook gọi `beginShutdown` — hàm này bật một cờ
 * **một chiều** trong `sse-manager.ts` (cố ý không có đường lật lại, xem tệp đó).
 * Sau lượt đó mọi `broadcastToSession` trả 0 vĩnh viễn. Đặt nó lên trên là biến
 * các lượt kiểm phía trên thành đỏ vì **thứ tự tệp**, không vì hành vi.
 *
 * (Node chạy mỗi tệp test trong một tiến trình con riêng, nên cờ này không rò sang
 * `tests/media-sse-guard.test.ts` — tệp đó cũng có nhóm tắt máy của nó.)
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import type { SseStream } from '../server/utils/sse-manager.ts'

const read = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')

type HookHandler = (...args: never[]) => unknown
type NitroApp = { hooks: { hook: (name: string, handler: HookHandler) => void } }
type NitroPlugin = (nitroApp: NitroApp) => void

/**
 * Bắt hàm plugin mà tệp sắp nạp đăng ký.
 *
 * Gán lên `globalThis` chứ không phải một biến cục bộ: tệp plugin tham chiếu
 * `defineNitroPlugin` như một định danh tự do, và ESM phân giải nó qua global
 * environment record — một `const` trong tệp này sẽ không nhìn thấy được từ đó.
 */
let captured: NitroPlugin | null = null
;(globalThis as { defineNitroPlugin?: (fn: NitroPlugin) => void }).defineNitroPlugin = (fn) => {
  captured = fn
}

/** Nạp một tệp plugin và trả về hàm nó đăng ký. Nạp từng tệp một để không lẫn lượt bắt. */
async function loadPlugin(relative: string): Promise<NitroPlugin> {
  captured = null
  await import(`../${relative}`)
  assert.ok(captured, `${relative} không đăng ký plugin nào — thiếu defineNitroPlugin?`)
  return captured
}

/** Đặt biến môi trường, chạy, rồi trả môi trường về **đúng** trạng thái trước đó. */
function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const previous = new Map<string, string | undefined>()
  for (const key of Object.keys(env)) previous.set(key, process.env[key])

  try {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    return fn()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

// Nạp cả hai ở cấp module: hàm `describe` của node:test chạy **đồng bộ**, nên
// `await` bên trong nó là lỗi cú pháp. Nạp ở đây cũng đúng về ngữ nghĩa — việc nạp
// plugin không phụ thuộc lượt kiểm nào.
const guard = await loadPlugin('server/plugins/livestream-replica-guard.ts')
const shutdown = await loadPlugin('server/plugins/livestream-shutdown.ts')

describe('12.5 — ghim một bản sao: cảnh báo lúc khởi động', () => {
  /**
   * Chạy plugin dưới một môi trường cho trước và trả về **những dòng đã cảnh báo**.
   *
   * Đếm chứ không chỉ khẳng định "có gọi console.warn": câu hỏi thật của lượt kiểm
   * này là *khi nào* cảnh báo im, và một phép khẳng định sự tồn tại không trả lời
   * được nó.
   */
  function runGuard(env: { NODE_ENV?: string, CDKT_SSE_REPLICA_GUARD?: string }): string[] {
    const warnings: string[] = []
    const originalWarn = console.warn
    console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')) }

    try {
      return withEnv(env, () => {
        guard({ hooks: { hook: () => {} } })
        return warnings
      })
    } finally {
      // Trả `console.warn` về ngay cả khi `withEnv` ném: một `console.warn` bị treo
      // lại sẽ nuốt log của mọi tệp test chạy sau trong cùng tiến trình.
      console.warn = originalWarn
    }
  }

  /**
   * Khẳng định **không** cảnh báo, kèm nội dung cảnh báo trong thông báo lỗi.
   *
   * `assert.deepEqual(warnings, [])` cũng đúng nhưng khi đỏ thì chỉ in ra một mảng
   * — người đọc phải đi tìm dòng log thật ở chỗ khác. Ở đây câu hỏi của lượt kiểm
   * là "vì sao nó lại kêu", nên chính nội dung phải nằm trong thông báo.
   */
  function assertSilent(env: { NODE_ENV?: string, CDKT_SSE_REPLICA_GUARD?: string }, why: string): void {
    const warnings = runGuard(env)
    assert.equal(warnings.length, 0, `${why} — nhưng đã cảnh báo: ${warnings.join(' | ')}`)
  }

  it('ngoài production thì im lặng — máy phát triển không cần cảnh báo', () => {
    // Cảnh báo này nói về cách một deployment chạy thật. Ở máy phát triển thì nó
    // chỉ là tiếng ồn, và tiếng ồn là thứ dạy người đọc bỏ qua cảnh báo.
    assertSilent({ NODE_ENV: 'development', CDKT_SSE_REPLICA_GUARD: undefined }, 'máy phát triển')
    assertSilent({ NODE_ENV: undefined, CDKT_SSE_REPLICA_GUARD: undefined }, 'NODE_ENV vắng mặt')
  })

  it('production mà biến khai báo vắng mặt thì CẢNH BÁO, và cảnh báo nêu đúng tên biến', () => {
    const warnings = runGuard({ NODE_ENV: 'production', CDKT_SSE_REPLICA_GUARD: undefined })

    assert.equal(warnings.length, 1, 'production thiếu lời khai phải có đúng một dòng cảnh báo')
    // Tên biến phải nằm trong chính dòng log: người vận hành grep log tìm cách tắt
    // cảnh báo, và một thông báo không nói ra tên biến là một ngỏ cụt.
    assert.match(warnings[0] ?? '', /CDKT_SSE_REPLICA_GUARD/)
    // Và phải nói ra hạn chế thật, không phải "có gì đó không ổn".
    assert.match(warnings[0] ?? '', /một bản sao/i)
  })

  it('production có `=1` thì im — đó là lời khai của người vận hành', () => {
    assertSilent({ NODE_ENV: 'production', CDKT_SSE_REPLICA_GUARD: '1' }, 'đã khai')
  })

  it('khoảng trắng quanh giá trị vẫn tính là đã khai', () => {
    // `.trim()` không phải chuyện hình thức: biến đi qua `.env`, qua compose và
    // qua shell, nên `" 1"` là giá trị một người thật sẽ gõ. Thiếu `.trim()` thì
    // lời khai đúng bị đọc thành vắng mặt.
    assertSilent({ NODE_ENV: 'production', CDKT_SSE_REPLICA_GUARD: ' 1 ' }, 'có khoảng trắng hai đầu')
    assertSilent({ NODE_ENV: 'production', CDKT_SSE_REPLICA_GUARD: '1\n' }, 'có ký tự xuống dòng cuối')
  })

  it('chuỗi RỖNG vẫn cảnh báo — compose luôn đặt biến, kể cả khi bỏ trống', () => {
    // Đây là ca thật của mọi deployment dùng compose: dòng
    // `CDKT_SSE_REPLICA_GUARD: ${CDKT_SSE_REPLICA_GUARD:-}` **luôn** đặt biến, nên
    // một phép kiểm dựa vào "biến có tồn tại hay không" sẽ im lặng ở đúng cái
    // deployment cần được cảnh báo nhất.
    assert.equal(runGuard({ NODE_ENV: 'production', CDKT_SSE_REPLICA_GUARD: '' }).length, 1)
  })

  it('`=0` KHÔNG tắt cảnh báo — đây là lời khai về một sự thật, không phải công tắc', () => {
    // Cố ý khác bốn bộ đếm lịch (`RETENTION_SCHEDULER`, `ANALYTICS_SCHEDULER`,
    // `VIEW_BOOST_SCHEDULER`, `MEDIA_REAPER_SCHEDULER`): ở đó `'0'` là một mệnh
    // lệnh "đừng chạy", nên nó phải được tôn trọng. Ở đây biến không bật/tắt việc
    // gì cả — nó là lời khai "tôi đã kiểm và chỉ có một bản sao". `'0'` nghĩa là
    // *không* khai được điều đó, nên cảnh báo vẫn phải kêu. Một lượt "dọn cho
    // nhất quán" gộp hai hình dạng này lại sẽ tắt mất cảnh báo bằng một giá trị
    // trông y hệt giá trị đúng.
    assert.equal(runGuard({ NODE_ENV: 'production', CDKT_SSE_REPLICA_GUARD: '0' }).length, 1)
    assert.equal(runGuard({ NODE_ENV: 'production', CDKT_SSE_REPLICA_GUARD: 'yes' }).length, 1)
  })
})

describe('12.5 — chốt thứ hai: compose và tài liệu', () => {
  // Cảnh báo chỉ là nửa sau của chốt. Nửa trước là `container_name`: nó **chặn**
  // `docker compose up --scale app=2` (Compose từ chối container thứ hai cùng tên),
  // nên đường compose không thể chạy hai bản sao ngay cả khi người vận hành không
  // đọc cảnh báo nào.
  it('compose ghim tên container, nên `--scale app=2` thất bại thật', () => {
    assert.match(read('docker-compose.yml'), /container_name: cdkt_app/)
  })

  it('compose chuyển tiếp biến khai báo, và LUÔN đặt nó kể cả khi rỗng', () => {
    // `${...:-}` là phần mang nghĩa: nó đặt biến thành chuỗi rỗng khi `.env` không
    // có, và đó chính là ca mà lượt kiểm "chuỗi rỗng vẫn cảnh báo" ở trên mô tả.
    assert.match(
      read('docker-compose.yml'),
      /CDKT_SSE_REPLICA_GUARD: \$\{CDKT_SSE_REPLICA_GUARD:-\}/,
    )
  })

  it('README ghi rõ hạn chế một bản sao VÀ cấu hình nginx bắt buộc', () => {
    // Phần nginx không phải trang trí: thiếu `proxy_buffering off` thì luồng bị
    // gom lại và người xem nhận tin theo từng đợt — hoặc không nhận gì — mà máy
    // chủ không có lỗi nào. Đó là hạn chế đã ghi trong design.md, và một hạn chế
    // đã ghi mà không có gì canh thì lần dọn tài liệu sau sẽ xoá nó.
    const readme = read('README.md')
    assert.match(readme, /one replica only/)
    assert.match(readme, /proxy_buffering off/)
    assert.match(readme, /proxy_read_timeout/)
  })
})

// ─── Tắt máy. Nhóm CUỐI TỆP — xem đầu tệp. ──────────────────────────────────

describe('12.4 — plugin tắt máy', () => {
  it('đăng ký đúng hook `close`, và hook KHÔNG nhận tham số', () => {
    const registered: Array<{ name: string, handler: HookHandler }> = []
    shutdown({ hooks: { hook: (name, handler) => { registered.push({ name, handler }) } } })

    assert.equal(registered.length, 1, 'plugin phải đăng ký đúng một hook')
    assert.equal(registered[0]?.name, 'close')

    // Nitro gọi `nitroApp.hooks.callHook("close")` **trần** (`nitropack/dist/runtime/
    // internal/shutdown.mjs`) và kiểu là `close: () => HookResult`. Một handler khai
    // tham số sẽ nhận `undefined` — khai tham số ở đây là một giả định sai về API,
    // và nó sai im lặng.
    assert.equal(
      registered[0]?.handler.length,
      0,
      'hook `close` của Nitro không truyền tham số — khai tham số là đọc `undefined`',
    )
  })

  it('gọi hook: mọi luồng đang mở nhận một sự kiện shutdown dạng OBJECT, rồi bị đóng', async (t) => {
    const pushed: unknown[] = []
    let closed = false
    const stream: SseStream = {
      push: async (message) => { pushed.push(message) },
      close: async () => { closed = true },
      onClosed: () => {},
    }

    const sse = await import('../server/utils/sse-manager.ts')
    sse.registerStream(stream, 4242)
    t.after(() => sse.releaseStream(stream))

    const registered: Array<{ name: string, handler: HookHandler }> = []
    shutdown({ hooks: { hook: (name, handler) => { registered.push({ name, handler }) } } })
    // Hook awaits concurrent final delivery, bounded by the manager's deadline.
    await registered[0]?.handler()

    assert.equal(pushed.length, 1, 'luồng đang mở phải nhận đúng một sự kiện')
    const event = pushed[0] as { event?: unknown, data?: unknown } | undefined

    // Sự kiện phải là OBJECT có `event`: `formatEventStreamMessage` của h3 chỉ phát
    // dòng `event:` khi `message.event` truthy. Một chuỗi `'data: ...'` tự dựng đi
    // qua `push()` được đọc thành `{ data: chuỗi }`, tới trình duyệt **không có tên
    // sự kiện**, nên `addEventListener('shutdown')` không bao giờ chạy — và không
    // có gì đỏ ở đâu cả.
    assert.equal(typeof event, 'object', 'phải là object, không phải chuỗi đã định dạng sẵn')
    assert.equal(event?.event, sse.SSE_EVENT_SHUTDOWN)
    assert.equal(typeof event?.data, 'string')

    // `data` rỗng làm người đọc thấy một khung chat im lặng — đọc ra là cổng hỏng,
    // không phải máy chủ đang khởi động lại. Đây là toàn bộ giá trị của hook này.
    assert.ok(
      typeof event?.data === 'string' && event.data.length > 0,
      'lý do tắt máy phải có nội dung',
    )

    assert.equal(closed, true, 'báo xong phải đóng luồng')
    assert.equal(sse.isShuttingDown(), true, 'cờ tắt máy phải được bật')
  })

  it('sau khi hook chạy, KHÔNG lượt phát nào tới được luồng nữa', async (t) => {
    // Đặc tả 12.4: "drop all broadcasts once the flag is set". Khẳng định ở đây là
    // khẳng định về **hiệu ứng của chính plugin này** — lượt kiểm hành vi đầy đủ
    // của nhánh đó nằm ở `tests/media-sse-guard.test.ts`, tệp này chỉ nối đầu dây
    // cuối: hook đã chạy thì đường phát đã đóng.
    const sse = await import('../server/utils/sse-manager.ts')

    const late: unknown[] = []
    const stream: SseStream = {
      push: async (message) => { late.push(message) },
      close: async () => {},
      onClosed: () => {},
    }
    sse.registerStream(stream, 4243)
    t.after(() => sse.releaseStream(stream))

    const delivered = sse.broadcastToSession(4243, { event: sse.SSE_EVENT_MESSAGE, data: 'tin sau khi tắt máy' })

    assert.equal(delivered, 0, 'không luồng nào được nhận tin sau khi cờ tắt máy bật')
    assert.equal(late.length, 0)
  })
})
