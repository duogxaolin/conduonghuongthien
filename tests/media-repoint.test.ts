/**
 * Đổi domain R2 — các mảnh không cần MySQL (wave2 D-REPOINT):
 *
 *   - mẫu khớp domain (`domainRepointForms`, `media-repoint-match.ts`) chạy bằng engine
 *     JS: chỉ đổi domain đứng ngay sau `scheme://` và trước `/` hoặc ranh giới URL; host
 *     giống (`xold.cdn`, `old.cdn.evil`, `old.cdn:8443`, `//old.cdn`) và tiền tố đường
 *     dẫn khác (`cdn/media2`) không đổi; cột JSON đổi cả dạng thoát `\/`;
 *   - scheme + host KHÔNG phân biệt hoa thường (`HTTPS://OLD.CDN/…` là cùng một host),
 *     đường dẫn thì CÓ; đầu vào chuẩn hoá qua `URL` (host chữ thường, IDN → punycode);
 *   - domain mới phải được CSP `img-src` và IPX (`image.domains`) cho phép — nếu không,
 *     trình duyệt chặn mọi ảnh vừa đổi (`shared/media-hosts.ts`);
 *   - từ chối domain mới chứa domain cũ (không idempotent);
 *   - sao lưu hỏng → dừng TRƯỚC transaction; khoá đồng bộ ảnh / quét thư mục bận → 409;
 *     endpoint không bao giờ trả nguyên văn lỗi nội bộ.
 *
 * Hành vi trên MySQL thật (27 cột, REGEXP_REPLACE ICU, JSON, một transaction, chạy
 * lại không đổi gì) nằm ở `media-repoint-integration.test.ts`.
 *
 * Mẫu được chạy bằng engine JS (bỏ `(?-i)` đầu mẫu — JS vốn phân biệt hoa thường).
 */
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { restoreRefusalStubs } from './_restore-refusal-stubs'

const locks = { busy: new Set<string>(), acquired: [] as string[], released: [] as string[] }
const transactions = { opened: 0, fail: null as Error | null }
mock.module('../server/utils/db', {
  namedExports: {
    getDb: () => ({
      transaction: async () => {
        transactions.opened += 1
        throw transactions.fail ?? new Error('the repoint opened a transaction')
      },
    }),
    getPool: () => ({
      getConnection: async () => ({
        query: async (sql: string, params: unknown[] = []) => {
          const name = String(params[0])
          if (sql.includes('GET_LOCK')) {
            if (locks.busy.has(name)) return [[{ acquired: 0 }]]
            locks.acquired.push(name)
            return [[{ acquired: 1 }]]
          }
          if (sql.includes('RELEASE_LOCK')) locks.released.push(name)
          return [[]]
        },
        release: () => undefined,
      }),
    }),
  },
})
const logged: Array<Record<string, unknown>> = []
mock.module('../server/utils/logger', {
  namedExports: {
    logInfo: (r: Record<string, unknown>) => { logged.push(r) },
    logWarn: (r: Record<string, unknown>) => { logged.push(r) },
    logError: (r: Record<string, unknown>) => { logged.push(r) },
  },
})
let backupOutcome: () => Promise<unknown> = async () => ({ stamp: 's', files: [], driveUploaded: false })
mock.module('../server/services/backup', {
  namedExports: {
    runBackup: async () => backupOutcome(),
    ...restoreRefusalStubs(),
  },
})
mock.module('../server/utils/permissions', { namedExports: { requireResourcePermission: () => {} } })

const { domainRepointForms } = await import('../server/services/media-repoint-match.ts')
const repoint = await import('../server/services/media-repoint.ts')
const { MEDIA_SYNC_LOCK_NAME } = await import('../server/services/media-sync-rewrite.ts')
const { MEDIA_SCAN_LOCK_NAME } = await import('../server/services/media-scan.ts')

/** Domain mới hợp lệ: được CSP `img-src` (`*.delify.vn`) và IPX (`image.domains`) cho phép. */
const NEW = 'cdn1.delify.vn'

/** Áp mọi dạng lên một chuỗi, như REGEXP_REPLACE của MySQL. */
function applyJs(kind: 'text' | 'json', oldDomain: string, newDomain: string, text: string): string {
  let out = text
  for (const form of domainRepointForms(kind, oldDomain, newDomain)) {
    assert.ok(form.pattern.startsWith('(?-i)'), 'thiếu (?-i): collation _ci làm REGEXP không phân biệt hoa thường cả đường dẫn')
    const re = new RegExp(form.pattern.slice('(?-i)'.length), 'gu')
    const literal = form.replacement.replace(/\\(.)/g, '$1')
    out = out.replace(re, () => literal)
  }
  return out
}

test('domain đứng sau scheme:// và trước / hoặc ranh giới URL thì đổi; host giống thì không', () => {
  const cases: Array<[string, string]> = [
    ['<img src="https://old.cdn/a/x.webp">', '<img src="https://new.cdn/a/x.webp">'],
    ['<a href="http://old.cdn/b.pdf">', '<a href="http://new.cdn/b.pdf">'],
    ['logo: https://old.cdn', 'logo: https://new.cdn'],
    ['(https://old.cdn)', '(https://new.cdn)'],
    ['https://old.cdn?v=2 https://old.cdn#top', 'https://new.cdn?v=2 https://new.cdn#top'],
    ['Xem https://old.cdn.', 'Xem https://new.cdn.'],
    // Host khác, không đổi:
    ['https://xold.cdn/a.png', 'https://xold.cdn/a.png'],
    ['https://old.cdn.evil/a.png', 'https://old.cdn.evil/a.png'],
    ['https://old.cdnx/a.png', 'https://old.cdnx/a.png'],
    ['https://old.cdn:8443/p.png', 'https://old.cdn:8443/p.png'],
    ['//old.cdn/rel.png', '//old.cdn/rel.png'],
    ['old.cdn/khong-scheme.png', 'old.cdn/khong-scheme.png'],
    ['https://cdn.old.cdn/a.png', 'https://cdn.old.cdn/a.png'],
    ['https://XOLD.CDN/a.png', 'https://XOLD.CDN/a.png'],
  ]
  for (const [input, expected] of cases) assert.equal(applyJs('text', 'old.cdn', 'new.cdn', input), expected, input)
})

test('scheme + host không phân biệt hoa thường; đường dẫn giữ nguyên chữ hoa và vẫn phân biệt (W1)', () => {
  // Ca của người kiểm chứng: bản trước để nguyên cả ba, lượt đổi "thành công" với 0 hàng.
  assert.equal(
    applyJs('text', 'old.cdn', 'new.cdn', 'https://OLD.CDN/a.png HTTPS://old.cdn/b.png https://Old.Cdn/C.PNG HtTp://oLd.CdN'),
    'https://new.cdn/a.png https://new.cdn/b.png https://new.cdn/C.PNG http://new.cdn',
  )
  assert.equal(applyJs('json', 'old.cdn', 'new.cdn', '{"a":"HTTPS:\\/\\/OLD.CDN\\/x.png"}'), '{"a":"https:\\/\\/new.cdn\\/x.png"}')
  // Tiền tố đường dẫn là phần của đường dẫn: phân biệt hoa thường.
  assert.equal(applyJs('text', 'cdn.x.vn/media', 'r2.y.vn', 'https://CDN.X.VN/media/a.png'), 'https://r2.y.vn/a.png')
  assert.equal(applyJs('text', 'cdn.x.vn/media', 'r2.y.vn', 'https://cdn.x.vn/MEDIA/a.png'), 'https://cdn.x.vn/MEDIA/a.png')
})

test('domain có tiền tố đường dẫn khớp đúng tiền tố đó, không khớp tiền tố dài hơn', () => {
  assert.equal(applyJs('text', 'cdn.x.vn/media', 'r2.y.vn', 'https://cdn.x.vn/media/a.png'), 'https://r2.y.vn/a.png')
  assert.equal(applyJs('text', 'cdn.x.vn/media', 'r2.y.vn', 'https://cdn.x.vn/media2/a.png'), 'https://cdn.x.vn/media2/a.png')
  assert.equal(applyJs('text', 'cdn.x.vn/media', 'r2.y.vn', 'https://cdn.x.vn/a.png'), 'https://cdn.x.vn/a.png')
})

test('cột json: đổi cả dạng thô lẫn dạng thoát \\/ (JSON trong cột TEXT), và chạy lại không đổi gì', () => {
  const value = JSON.stringify({ a: 'https://old.cdn/x.png', b: '<img src="http://old.cdn/y.png">', c: 'https://xold.cdn/z.png' })
  const escaped = value.replace(/\//g, '\\/')
  const once = applyJs('json', 'old.cdn', 'new.cdn', `${value}|${escaped}`)
  assert.equal(once, `${value.replaceAll('//old.cdn', '//new.cdn')}|${escaped.replaceAll('\\/\\/old.cdn', '\\/\\/new.cdn')}`)
  assert.equal(applyJs('json', 'old.cdn', 'new.cdn', once), once, 'idempotent')
  assert.deepEqual(JSON.parse(once.split('|')[0]!).c, 'https://xold.cdn/z.png')
})

test('chuẩn hoá domain qua URL: host chữ thường, IDN → punycode, tiền tố đường dẫn giữ nguyên (W1)', () => {
  assert.equal(repoint.normalizeRepointDomain('  https://Old.cdn/// ', 'Domain cũ'), 'old.cdn')
  assert.equal(repoint.normalizeRepointDomain('HTTPS://OLD.CDN/', 'Domain cũ'), 'old.cdn')
  assert.equal(repoint.normalizeRepointDomain('CDN.X.VN/Media/', 'Domain cũ'), 'cdn.x.vn/Media')
  assert.equal(repoint.normalizeRepointDomain('bücher.example', 'Domain cũ'), 'xn--bcher-kva.example')
  for (const bad of ['   ', 'old cdn', 'https://u:p@old.cdn', 'old.cdn?x=1', 'old.cdn#top', 'ftp://old.cdn', 'https://']) {
    assert.throws(() => repoint.normalizeRepointDomain(bad, 'Domain cũ'), repoint.RepointInputError, bad)
  }
})

test('domain mới ngoài CSP img-src / IPX image.domains bị từ chối, nêu đúng danh sách cho phép (W2)', async () => {
  const refused = async (newDomain: string) => {
    try {
      await repoint.repointR2Urls('old.cdn', newDomain, null)
    } catch (err) {
      assert.ok(err instanceof repoint.RepointInputError, String(err))
      return err.message
    }
    assert.fail(`${newDomain} was accepted`)
  }
  const outsideCsp = await refused('media.example.com')
  assert.match(outsideCsp, /img-src/)
  assert.match(outsideCsp, /\*\.delify\.vn/)
  assert.match(outsideCsp, /\*\.conduonghuongthien\.vn/)
  // `*.x` không gồm chính `x` (CSP host-source); cổng khác mặc định không khớp mẫu không cổng.
  assert.match(await refused('delify.vn'), /img-src/)
  assert.match(await refused('cdn1.delify.vn:8443'), /img-src/)
  // Trong CSP nhưng NuxtImg (IPX) không được tải ảnh từ đó → ảnh tối ưu thành ảnh dự phòng.
  const outsideIpx = await refused('cdn2.delify.vn')
  assert.match(outsideIpx, /image\.domains|IPX/)
  assert.match(outsideIpx, /cdn1\.delify\.vn/)
  assert.equal(transactions.opened, 0)
})

test('từ chối đầu vào không đổi được — trước khi chạm CSDL', async () => {
  await assert.rejects(() => repoint.repointR2Urls(NEW, `https://${NEW.toUpperCase()}/`, null), repoint.RepointInputError)
  // Domain mới chứa domain cũ: chạy lại sẽ nối thêm `/v2/v2/…` — từ chối.
  await assert.rejects(() => repoint.repointR2Urls(NEW, `${NEW}/v2`, null), repoint.RepointInputError)
  await assert.rejects(() => repoint.repointR2Urls('old.cdn', 'new"cdn', null), repoint.RepointInputError)
  assert.equal(transactions.opened, 0)
})

test('sao lưu hỏng: dừng trước transaction, log nguyên nhân, không đổi gì', async () => {
  backupOutcome = async () => { throw new Error('mysqldump: Got errno 28 on write') }
  logged.length = 0
  await assert.rejects(() => repoint.repointR2Urls('old.cdn', NEW, 7), repoint.RepointBackupError)
  assert.equal(transactions.opened, 0, 'không transaction nào được mở khi sao lưu hỏng')
  const failure = logged.find(r => r.event === 'media.repoint_pre_backup_failed')
  assert.ok(failure, 'nguyên nhân được log')
  assert.match(String(failure.error), /errno 28/)
})

test('giữ khoá đồng bộ ảnh VÀ khoá quét thư mục suốt lượt đổi; một trong hai bận → bận, không sao lưu, không đổi (W4)', async () => {
  backupOutcome = async () => ({ stamp: 's', files: [], driveUploaded: false })
  transactions.opened = 0
  transactions.fail = new Error('injected failure inside the transaction')
  locks.acquired = []
  locks.released = []
  await assert.rejects(() => repoint.repointR2Urls('old.cdn', NEW, null), /injected failure/)
  assert.deepEqual(locks.acquired, [MEDIA_SYNC_LOCK_NAME, MEDIA_SCAN_LOCK_NAME], 'both media writers that mint R2 URLs are held off')
  assert.deepEqual([...locks.released].sort(), [MEDIA_SYNC_LOCK_NAME, MEDIA_SCAN_LOCK_NAME].sort(), 'and released')
  transactions.fail = null

  let backups = 0
  backupOutcome = async () => { backups += 1; return { stamp: 's', files: [], driveUploaded: false } }
  for (const busy of [MEDIA_SYNC_LOCK_NAME, MEDIA_SCAN_LOCK_NAME]) {
    locks.busy = new Set([busy])
    transactions.opened = 0
    await assert.rejects(() => repoint.repointR2Urls('old.cdn', NEW, null), repoint.RepointBusyError, busy)
    assert.equal(transactions.opened, 0)
  }
  assert.equal(backups, 0, 'no backup is taken while another media writer runs')
  locks.busy = new Set()
})

// ── Endpoint ─────────────────────────────────────────────────────────────────

const h3 = await import('h3')
type Event = { body: unknown, context: { adminUser: unknown } }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.readBody = async (event: Event) => event.body
globals.createError = h3.createError
const handler = (await import('../server/api/admin/media/repoint-r2-urls.post.ts')).default as unknown as (event: Event) => Promise<unknown>

async function failure(body: unknown): Promise<{ statusCode?: number, statusMessage?: string }> {
  try {
    await handler({ body, context: { adminUser: { id: 1 } } })
  } catch (error) {
    return error as { statusCode?: number, statusMessage?: string }
  }
  assert.fail('the handler should have thrown')
}

test('endpoint: đầu vào sai 400, khoá bận 409, sao lưu hỏng 500; lỗi khác 500 với câu đã phân loại (S5)', async () => {
  assert.equal((await failure({ oldDomain: 'old.cdn' })).statusCode, 400)
  assert.equal((await failure({ oldDomain: NEW, newDomain: `${NEW}/v2` })).statusCode, 400)
  assert.equal((await failure({ oldDomain: 'old.cdn', newDomain: 'media.example.com' })).statusCode, 400)

  backupOutcome = async () => { throw new Error('mysqldump: Got errno 28 on write') }
  const backupFailed = await failure({ oldDomain: 'old.cdn', newDomain: NEW })
  assert.equal(backupFailed.statusCode, 500)
  assert.match(String(backupFailed.statusMessage), /chưa đổi URL nào/)
  assert.doesNotMatch(String(backupFailed.statusMessage), /mysqldump|errno/)

  locks.busy = new Set([MEDIA_SYNC_LOCK_NAME])
  assert.equal((await failure({ oldDomain: 'old.cdn', newDomain: NEW })).statusCode, 409)
  locks.busy = new Set()

  // Lỗi không phân loại (vd. driver): 500 với câu soạn sẵn, nguyên văn chỉ ở log.
  backupOutcome = async () => ({ stamp: 's', files: [], driveUploaded: false })
  transactions.fail = new Error("Table 'cdkt.secret_internal' doesn't exist")
  logged.length = 0
  const unexpected = await failure({ oldDomain: 'old.cdn', newDomain: NEW })
  transactions.fail = null
  assert.equal(unexpected.statusCode, 500)
  assert.doesNotMatch(String(unexpected.statusMessage), /secret_internal|doesn't exist/)
  assert.match(String(unexpected.statusMessage), /chưa đổi URL nào/)
  const logLine = logged.find(r => r.event === 'media.repoint_failed')
  assert.ok(logLine, 'the raw error goes to the log')
  assert.match(String(logLine.error), /secret_internal/)
})
