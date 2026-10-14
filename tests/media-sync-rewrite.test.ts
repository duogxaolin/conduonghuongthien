/**
 * Các mảnh thuần của lượt thay URL khi ảnh đổi chỗ lưu (`media-sync-rewrite.ts`,
 * `media-sync-url-match.ts`): câu SQL được dựng ra sao, RANH GIỚI URL (`a.jpg` không
 * khớp bên trong `a.jpg.webp`), cặp URL nào bị từ chối, bản đồ vá dở dang dựng từ
 * audit trail, và bộ dò URL cũ trong văn bản. Hành vi trên MySQL thật (REGEXP_REPLACE
 * ICU, JSON, dạng tuyệt đối, không đổi thẻ HTML) nằm ở
 * `media-sync-rewrite-integration.test.ts`.
 *
 * Mẫu ranh giới được chạy ở đây bằng engine JS (bỏ `(?-i)` — JS không có cờ nội tuyến
 * đó, và JS vốn phân biệt hoa thường). Cùng chuỗi mẫu đã được đối chiếu trên MySQL 8.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { MySqlDialect } from 'drizzle-orm/mysql-core'

import {
  URL_REFERENCE_TARGETS,
  assertRewritable,
  buildCandidateQuery,
  buildRemainingReferenceQuery,
  buildRepairMap,
  buildRewriteUpdates,
  findPresentOldUrls,
  rewriteForms,
  urlPairs,
  type UrlRewrite,
} from '../server/services/media-sync-rewrite.ts'

const dialect = new MySqlDialect()
const target = (label: string) => {
  const t = URL_REFERENCE_TARGETS.find(x => x.label === label)
  assert.ok(t, `thiếu ${label}`)
  return t
}

/** Áp mọi dạng của một cặp URL lên một chuỗi, như REGEXP_REPLACE của MySQL. */
function applyJs(kind: 'text' | 'json', rewrite: UrlRewrite, text: string): string {
  let out = text
  for (const form of rewriteForms(kind, rewrite)) {
    assert.ok(form.pattern.startsWith('(?-i)'), 'thiếu (?-i): collation _ci làm REGEXP không phân biệt hoa thường')
    const re = new RegExp(form.pattern.slice('(?-i)'.length), 'gu')
    const literal = form.replacement.replace(/\\(.)/g, '$1')
    out = out.replace(re, () => literal)
  }
  return out
}

describe('danh sách cột tham chiếu', () => {
  it('phủ mọi chỗ một ảnh thư viện có thể nằm — gồm settings, chat, phiên bản trang', () => {
    const labels = new Set(URL_REFERENCE_TARGETS.map(t => t.label))
    for (const label of [
      'articles.content', 'articles.thumbnail_url', 'article_translations.content',
      'article_translations.title', 'page_blocks.data', 'pages.published_blocks', 'pages.draft_blocks',
      // Logo/favicon/og:image chọn từ thư viện — thiếu cột này là logo đầu trang 404 sau sync.
      'settings.value',
      'chat_messages.content', 'page_versions.blocks', 'home_sections.config',
      'social_links.icon', 'media_items.thumbnail_url', 'livestream_sessions.thumbnail_url',
      'chatbot_knowledge.approved_answer', 'chatbot_small_talk.answer',
    ]) assert.ok(labels.has(label), `thiếu ${label}`)
    // Nhật ký kiểm toán là nguồn sự thật của lượt vá — không bao giờ bị sửa/quét.
    assert.ok(!labels.has('activity_logs.meta'))
    assert.equal(labels.size, URL_REFERENCE_TARGETS.length, 'nhãn trùng')
  })
})

describe('câu SQL dựng ra', () => {
  const rewrite = { oldUrl: '/uploads/2026/10/a_b$1.png', newUrl: 'https://cdn.test/2026/10/a_b$1.png' }

  it('URL đi qua tham số — không chuỗi người dùng nào nằm trong văn bản SQL', () => {
    const evil = "/uploads/2026/10/x');DROP TABLE articles;--.png"
    // Có `'` → bị từ chối trước khi tới SQL.
    assert.throws(() => assertRewritable({ oldUrl: evil, newUrl: 'https://cdn.test/x.png' }))
    for (const t of URL_REFERENCE_TARGETS) {
      for (const q of [
        buildCandidateQuery(t, rewrite),
        ...buildRewriteUpdates(t, rewrite, [1, 2]),
        buildRemainingReferenceQuery(t, rewrite.oldUrl),
      ]) {
        const { sql } = dialect.sqlToQuery(q)
        assert.ok(!sql.includes('/uploads/') && !sql.includes('cdn.test'), `${t.label}: URL lọt vào văn bản SQL`)
      }
    }
  })

  it('UPDATE dùng REGEXP_REPLACE có ranh giới, chỉ trên id đã chọn; ký tự LIKE/regex/replacement được thoát', () => {
    const [update] = buildRewriteUpdates(target('articles.content'), rewrite, [7, 9])
    const { sql, params } = dialect.sqlToQuery(update!)
    assert.match(sql, /REGEXP_REPLACE/)
    assert.doesNotMatch(sql, /\bREPLACE\(`/, 'REPLACE trần (khớp chuỗi con) không còn được dùng')
    assert.match(sql, / in \(\?, \?\)/i)
    const [pattern, replacement, id1, id2, like] = params as (string | number)[]
    assert.ok(String(pattern).startsWith('(?-i)'))
    assert.ok(String(pattern).includes('/uploads/2026/10/a_b\\$1\\.png'))
    assert.equal(replacement, 'https://cdn.test/2026/10/a_b\\$1.png')
    assert.deepEqual([id1, id2], [7, 9])
    assert.equal(like, '%/uploads/2026/10/a\\_b$1.png%')
  })

  it('id được chia lô — không có câu IN() khổng lồ', () => {
    const ids = Array.from({ length: 1201 }, (_, i) => i + 1)
    assert.equal(buildRewriteUpdates(target('articles.content'), rewrite, ids).length, 3)
  })

  it('settings dùng khoá chuỗi; lưới an toàn dò bằng REGEXP có ranh giới, tối đa một hàng', () => {
    const { sql, params } = dialect.sqlToQuery(buildRemainingReferenceQuery(target('settings.value'), '/uploads/q.jpg'))
    assert.match(sql, /select `settings`\.`key`/i)
    assert.match(sql, /REGEXP/)
    assert.match(sql, /limit 1$/i)
    assert.ok((params as string[]).some(p => typeof p === 'string' && p.startsWith('(?-i)')))
  })

  it('cột JSON thay cả dạng đã thoát `\\/` (JSON lưu nguyên văn trong cột TEXT)', () => {
    const forms = rewriteForms('json', { oldUrl: '/uploads/a.png', newUrl: 'https://cdn.test/a.png' })
    assert.deepEqual(forms.map(f => f.old), ['/uploads/a.png', '\\/uploads\\/a.png'])
    assert.deepEqual(forms.map(f => f.new), ['https://cdn.test/a.png', 'https:\\/\\/cdn.test\\/a.png'])
  })
})

describe('ranh giới URL (REGEXP_REPLACE)', () => {
  const r = { oldUrl: '/uploads/vfy/a.jpg', newUrl: 'https://cdn.test/2026/10/a.jpg' }
  const N = r.newUrl

  it('cặp tiền tố/hậu tố: `a.jpg` KHÔNG khớp bên trong `a.jpg.webp`, `a.jpg-1`, `a.jpgx`, `a.jpg/b`', () => {
    for (const other of ['/uploads/vfy/a.jpg.webp', '/uploads/vfy/a.jpg-1', '/uploads/vfy/a.jpgx', '/uploads/vfy/a.jpg/b', '/uploads/vfy/a.jpgđ']) {
      const html = `<img src="${other}">`
      assert.equal(applyJs('text', r, html), html, other)
    }
    // Ngược lại: URL `a.jpg.webp` không chạm `a.jpg`.
    const webp = { oldUrl: '/uploads/vfy/a.jpg.webp', newUrl: 'https://cdn.test/2026/10/a.jpg.webp' }
    assert.equal(applyJs('text', webp, '<img src="/uploads/vfy/a.jpg">'), '<img src="/uploads/vfy/a.jpg">')
  })

  it('giữ query/fragment; cuối chuỗi; kết thúc bằng dấu nháy, `&quot;`, `)`, dấu câu cuối câu', () => {
    assert.equal(applyJs('text', r, '<img src="/uploads/vfy/a.jpg?v=2#x">'), `<img src="${N}?v=2#x">`)
    assert.equal(applyJs('text', r, '/uploads/vfy/a.jpg'), N)
    assert.equal(applyJs('text', r, "<img src='/uploads/vfy/a.jpg'>"), `<img src='${N}'>`)
    assert.equal(applyJs('text', r, 'style="background:url(&quot;/uploads/vfy/a.jpg&quot;)"'), `style="background:url(&quot;${N}&quot;)"`)
    assert.equal(applyJs('text', r, '![ảnh](/uploads/vfy/a.jpg)'), `![ảnh](${N})`)
    assert.equal(applyJs('text', r, 'Xem /uploads/vfy/a.jpg. Hết'), `Xem ${N}. Hết`)
    assert.equal(applyJs('text', r, 'srcset="/uploads/vfy/a.jpg 1x,/uploads/vfy/a.jpg.webp 2x"'), `srcset="${N} 1x,/uploads/vfy/a.jpg.webp 2x"`)
  })

  it('dạng tuyệt đối của chính URL được thay cả cụm; đường dẫn của URL khác thì không', () => {
    assert.equal(applyJs('text', r, '<img src="http://localhost:3000/uploads/vfy/a.jpg">'), `<img src="${N}">`)
    for (const other of ['https://mirror.example/archive/uploads/vfy/a.jpg', '/x/uploads/vfy/a.jpg', 'ảnh/uploads/vfy/a.jpg']) {
      assert.equal(applyJs('text', r, other), other, other)
    }
    assert.equal(applyJs('text', r, 'https://fb.com/share?u=/uploads/vfy/a.jpg'), `https://fb.com/share?u=${N}`)
  })

  it('phân biệt hoa thường: `A.JPG` là tệp khác', () => {
    assert.equal(applyJs('text', r, '/uploads/vfy/A.JPG'), '/uploads/vfy/A.JPG')
  })

  it('trong JSON: chuỗi thường, `\\"` của HTML lồng, và dạng `\\/`', () => {
    const json = JSON.stringify({ a: '/uploads/vfy/a.jpg', b: '/uploads/vfy/a.jpg.webp', html: '<img src="/uploads/vfy/a.jpg">' })
    assert.deepEqual(JSON.parse(applyJs('json', r, json)), { a: N, b: '/uploads/vfy/a.jpg.webp', html: `<img src="${N}">` })
    const slashed = json.replace(/\//g, '\\/')
    assert.deepEqual(JSON.parse(applyJs('json', r, slashed)), { a: N, b: '/uploads/vfy/a.jpg.webp', html: `<img src="${N}">` })
  })

  it('dạng mã hoá phần trăm và `&amp;` cũng có ranh giới', () => {
    const u = { oldUrl: '/uploads/vfy/ảnh 1.jpg', newUrl: 'https://cdn.test/ảnh 1.jpg' }
    assert.equal(applyJs('text', u, '<img src="/uploads/vfy/%E1%BA%A3nh%201.jpg">'), '<img src="https://cdn.test/%E1%BA%A3nh%201.jpg">')
    assert.equal(applyJs('text', u, '<img src="/uploads/vfy/%E1%BA%A3nh%201.jpg.webp">'), '<img src="/uploads/vfy/%E1%BA%A3nh%201.jpg.webp">')
    const amp = { oldUrl: '/uploads/vfy/a&b.jpg', newUrl: 'https://cdn.test/a&b.jpg' }
    assert.equal(applyJs('text', amp, '<img src="/uploads/vfy/a&amp;b.jpg"><img src="/uploads/vfy/a&amp;b.jpg2">'),
      '<img src="https://cdn.test/a&amp;b.jpg"><img src="/uploads/vfy/a&amp;b.jpg2">')
  })

  it('URL tuyệt đối cũ (R2 → local) chỉ khớp đúng nó', () => {
    const back = { oldUrl: 'https://cdn.test/2026/10/a.jpg', newUrl: '/uploads/2026/10/a.jpg' }
    assert.equal(applyJs('text', back, '<img src="https://cdn.test/2026/10/a.jpg"><img src="https://cdn.test/2026/10/a.jpg.webp">'),
      '<img src="/uploads/2026/10/a.jpg"><img src="https://cdn.test/2026/10/a.jpg.webp">')
  })

  it('bộ dò của lượt vá (JS) đồng ý với mẫu SQL trên cùng một bộ chuỗi', () => {
    const corpus = [
      '<img src="/uploads/vfy/a.jpg">', '<img src="/uploads/vfy/a.jpg.webp">', '/uploads/vfy/a.jpg-1',
      'x /uploads/vfy/a.jpg?v=1', 'Xem /uploads/vfy/a.jpg.', 'http://localhost:3000/uploads/vfy/a.jpg',
      'https://mirror.example/archive/uploads/vfy/a.jpg', '/x/uploads/vfy/a.jpg', 'url(&quot;/uploads/vfy/a.jpg&quot;)',
      '?u=/uploads/vfy/a.jpg', '/uploads/vfy/A.JPG', '{"u":"\\/uploads\\/vfy\\/a.jpg"}', '/uploads/vfy/a.jpg~x',
    ]
    for (const text of corpus) {
      const found = new Set<string>()
      findPresentOldUrls(text, new Set([r.oldUrl]), found)
      const sqlHit = applyJs('json', r, text) !== text
      assert.equal(found.has(r.oldUrl), sqlHit, text)
    }
  })
})

describe('urlPairs', () => {
  it('tên tệp có dấu/khoảng trắng: thay cả dạng mã hoá phần trăm', () => {
    assert.deepEqual(urlPairs({ oldUrl: '/uploads/ảnh 1.png', newUrl: 'https://cdn.test/ảnh 1.png' }), [
      { old: '/uploads/ảnh 1.png', new: 'https://cdn.test/ảnh 1.png' },
      { old: '/uploads/%E1%BA%A3nh%201.png', new: 'https://cdn.test/%E1%BA%A3nh%201.png' },
    ])
    assert.deepEqual(urlPairs({ oldUrl: '/uploads/a&b.png', newUrl: 'https://cdn.test/a&b.png' }).at(-1),
      { old: '/uploads/a&amp;b.png', new: 'https://cdn.test/a&amp;b.png' }, 'dạng `&amp;` trong HTML đã lọc')
  })
})

describe('assertRewritable', () => {
  it('từ chối cặp không thay an toàn được', () => {
    assert.throws(() => assertRewritable({ oldUrl: '', newUrl: 'x' }))
    assert.throws(() => assertRewritable({ oldUrl: '/a', newUrl: '/a' }))
    assert.throws(() => assertRewritable({ oldUrl: '/uploads/a.png', newUrl: 'https://cdn"onerror="x/a.png' }), /không an toàn/)
    // URL mới chứa URL cũ → REPLACE chạy lại sẽ thay chồng: không idempotent.
    assert.throws(() => assertRewritable({ oldUrl: '/uploads/2026/10/a.png', newUrl: 'https://cdn.test/uploads/2026/10/a.png' }), /idempotent/)
    assertRewritable({ oldUrl: '/uploads/2026/10/a.png', newUrl: 'https://cdn.test/2026/10/a.png' })
  })
})

describe('buildRepairMap (vá lượt đồng bộ dở dang từ audit trail)', () => {
  const audit = (resourceId: number, sync: string, oldUrl: string, newUrl: string) => ({ resourceId, meta: { sync, oldUrl, newUrl } })

  it('URL cũ → URL HIỆN TẠI của hàng; chuỗi A→B→C vá thẳng về C', () => {
    const map = buildRepairMap(
      [audit(1, 'to-r2', '/uploads/a.png', 'https://cdn/a.png'), audit(1, 'to-local', 'https://cdn/a.png', '/uploads/2026/10/a.png'), audit(1, 'to-r2', '/uploads/2026/10/a.png', 'https://cdn/2026/10/a.png')],
      [{ id: 1, url: 'https://cdn/2026/10/a.png', provider: 'r2' }],
    )
    assert.deepEqual([...map.entries()], [
      ['/uploads/a.png', { mediaId: 1, newUrl: 'https://cdn/2026/10/a.png' }],
      ['https://cdn/a.png', { mediaId: 1, newUrl: 'https://cdn/2026/10/a.png' }],
      ['/uploads/2026/10/a.png', { mediaId: 1, newUrl: 'https://cdn/2026/10/a.png' }],
    ])
  })

  it('meta dạng chuỗi JSON (MariaDB lưu JSON là LONGTEXT) vẫn đọc được; chuỗi hỏng bị bỏ qua', () => {
    const map = buildRepairMap(
      [
        { resourceId: 1, meta: JSON.stringify({ sync: 'to-r2', oldUrl: '/uploads/s.png', newUrl: 'https://cdn/s.png' }) },
        { resourceId: 1, meta: '{hỏng' },
      ],
      [{ id: 1, url: 'https://cdn/s.png', provider: 'r2' }],
    )
    assert.deepEqual([...map.entries()], [['/uploads/s.png', { mediaId: 1, newUrl: 'https://cdn/s.png' }]])
  })

  it('không đoán: hàng đã xoá, provider lệch hướng sync, URL đang được hàng khác sở hữu, URL mơ hồ', () => {
    const map = buildRepairMap(
      [
        audit(1, 'to-r2', '/uploads/gone.png', 'https://cdn/gone.png'),
        audit(2, 'to-r2', '/uploads/b.png', 'https://cdn/b.png'),
        audit(3, 'to-r2', '/uploads/reused.png', 'https://cdn/c.png'),
        audit(4, 'to-r2', '/uploads/dup.png', 'https://cdn/d1.png'),
        audit(5, 'to-r2', '/uploads/dup.png', 'https://cdn/d2.png'),
        { resourceId: 6, meta: { action: 'rename' } },
        { resourceId: 7, meta: null },
      ],
      [
        { id: 2, url: '/uploads/2026/10/b.png', provider: 'local' },
        { id: 3, url: 'https://cdn/c.png', provider: 'r2' },
        { id: 9, url: '/uploads/reused.png', provider: 'local' },
        { id: 4, url: 'https://cdn/d1.png', provider: 'r2' },
        { id: 5, url: 'https://cdn/d2.png', provider: 'r2' },
      ],
    )
    assert.deepEqual([...map.keys()], [])
  })
})

describe('findPresentOldUrls', () => {
  const candidates = new Set(['/uploads/2026/10/a.png', 'https://cdn.test/2026/10/b.png', '/uploads/2026/10/%E1%BA%A3nh.png', '/uploads/2026/10/c&d.png'])
  const find = (text: string) => {
    const found = new Set<string>()
    findPresentOldUrls(text, candidates, found)
    return [...found].sort()
  }

  it('thấy dạng tương đối, tuyệt đối, có query, JSON \\/, &amp;, mã hoá', () => {
    assert.deepEqual(find('<img src="/uploads/2026/10/a.png">'), ['/uploads/2026/10/a.png'])
    assert.deepEqual(find('<img src="http://localhost:3000/uploads/2026/10/a.png?v=2">'), ['/uploads/2026/10/a.png'])
    assert.deepEqual(find('{"imageUrl":"\\/uploads\\/2026\\/10\\/a.png"}'), ['/uploads/2026/10/a.png'])
    assert.deepEqual(find('<a href="https://cdn.test/2026/10/b.png#x">'), ['https://cdn.test/2026/10/b.png'])
    assert.deepEqual(find('srcset="/uploads/2026/10/a.png 1x, https://cdn.test/2026/10/b.png 2x"'), ['/uploads/2026/10/a.png', 'https://cdn.test/2026/10/b.png'])
    assert.deepEqual(find('<img src="/uploads/2026/10/%E1%BA%A3nh.png">'), ['/uploads/2026/10/%E1%BA%A3nh.png'])
    assert.deepEqual(find('<img src="/uploads/2026/10/c&amp;d.png">'), ['/uploads/2026/10/c&d.png'])
  })

  it('không báo nhầm: URL mới sau sync (cùng tên tệp) và đường dẫn chỉ trùng tiền tố', () => {
    assert.deepEqual(find('<img src="https://cdn.test/2026/10/a.png">'), [])
    assert.deepEqual(find('<img src="/uploads/2026/10/a.png.webp">'), [])
    assert.deepEqual(find('<img src="/uploads/2026/10/xa.png">'), [])
    assert.deepEqual(find(''), [])
  })
})
