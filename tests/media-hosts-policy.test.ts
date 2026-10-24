/**
 * Host được phép phục vụ ảnh (`shared/media-hosts.ts`) — MỘT nguồn cho CSP `img-src`
 * và IPX `image.domains` (`nuxt.config.ts`) lẫn phép kiểm của lượt đổi domain R2
 * (`media-repoint.ts`, wave2 2B W2).
 *
 * Đổi domain R2 sang một host ngoài `img-src` thì trình duyệt chặn MỌI ảnh vừa đổi trên
 * toàn site; ngoài `image.domains` thì NuxtImg (IPX) không tải được và hiện ảnh dự phòng.
 * Phép kiểm chỉ đúng khi nó đọc CÙNG danh sách mà header được dựng từ đó.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { CSP_IMG_SRC_HOSTS, IMAGE_PROXY_DOMAINS, cspHostAllows, cspImgSrcDirective, mediaHostProblem } from '../shared/media-hosts.ts'

test('CSP host-source: `*.x` khớp mọi subdomain nhưng không khớp chính `x`; host cụ thể khớp đúng nó; có cổng thì không khớp', () => {
  assert.equal(cspHostAllows('*.delify.vn', 'cdn1.delify.vn'), true)
  assert.equal(cspHostAllows('*.delify.vn', 'a.b.delify.vn'), true)
  assert.equal(cspHostAllows('*.delify.vn', 'delify.vn'), false)
  assert.equal(cspHostAllows('*.delify.vn', 'xdelify.vn'), false)
  assert.equal(cspHostAllows('*.delify.vn', 'cdn1.delify.vn.evil'), false)
  assert.equal(cspHostAllows('*.delify.vn', 'cdn1.delify.vn:8443'), false)
  assert.equal(cspHostAllows('www.facebook.com', 'www.facebook.com'), true)
  assert.equal(cspHostAllows('www.facebook.com', 'm.facebook.com'), false)
  assert.equal(cspHostAllows('*.delify.vn', 'CDN1.DELIFY.VN'), true, 'host so khớp không phân biệt hoa thường')
})

test('mediaHostProblem: ngoài img-src → csp; trong img-src mà ngoài image.domains → ipx; cả hai → null', () => {
  assert.equal(mediaHostProblem('media.example.com'), 'csp')
  assert.equal(mediaHostProblem('cdn2.delify.vn'), 'ipx')
  assert.equal(mediaHostProblem('cdn1.delify.vn'), null)
  for (const domain of IMAGE_PROXY_DOMAINS) assert.equal(mediaHostProblem(domain), null, `${domain}: image.domains must also be inside img-src`)
})

test('nuxt.config.ts dựng img-src và image.domains từ shared/media-hosts.ts — không chép danh sách', () => {
  const config = readFileSync(new URL('../nuxt.config.ts', import.meta.url), 'utf8')
  assert.match(config, /from '\.\/shared\/media-hosts'/)
  assert.match(config, /domains: \[\.\.\.IMAGE_PROXY_DOMAINS\]/)
  assert.match(config, /cspImgSrcDirective\(\)/)
  assert.doesNotMatch(config, /"img-src /, 'img-src must not be written out by hand again')
  // Cùng header như trước khi tách (không đổi hành vi).
  assert.equal(
    cspImgSrcDirective(),
    "img-src 'self' data: https://*.delify.vn https://*.conduonghuongthien.vn https://www.facebook.com https://www.googletagmanager.com https://*.gov.vn",
  )
  assert.deepEqual([...IMAGE_PROXY_DOMAINS], ['cdn1.delify.vn'])
  assert.ok(CSP_IMG_SRC_HOSTS.includes('*.delify.vn'))
})
