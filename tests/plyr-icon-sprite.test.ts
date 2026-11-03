import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { PLYR_ICON_URL } from '../app/composables/usePlyrPlayer.ts'

/**
 * Plyr mặc định tải bộ biểu tượng từ `cdn.plyr.io` bằng fetch; `connect-src` của cổng chặn nên nút
 * điều khiển video trống biểu tượng (đo trên bản docker, 2026-11-03) — và đó là tài nguyên bên thứ
 * ba. Cổng phục vụ bản sao cùng phiên bản từ `public/assets/plyr.svg` và truyền `iconUrl`.
 */
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url))

test('iconUrl trỏ tới tệp cùng gốc, và tệp đó đúng là bộ biểu tượng của gói plyr đang cài', () => {
  assert.equal(PLYR_ICON_URL, '/assets/plyr.svg')
  const served = read(`public${PLYR_ICON_URL}`)
  const installed = read('node_modules/plyr/dist/plyr.svg')
  assert.ok(served.equals(installed), 'public/assets/plyr.svg khác plyr/dist/plyr.svg — sao lại sau khi đổi phiên bản plyr')
  assert.match(served.toString('utf8'), /<symbol[^>]*id="plyr-play"/)
})

test('composable truyền iconUrl cho Plyr và không còn trỏ tới cdn.plyr.io', () => {
  const source = readFileSync(new URL('../app/composables/usePlyrPlayer.ts', import.meta.url), 'utf8')
  assert.match(source, /iconUrl:\s*PLYR_ICON_URL/)
  assert.equal(/https:\/\/cdn\.plyr\.io/.test(source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')), false)
})
