/**
 * Ngày đăng trên trang chi tiết bài (và trang in) đọc theo giờ Việt Nam ở CẢ máy chủ lẫn
 * trình duyệt — nếu không, HTML dựng ở máy chủ và lượt hydrate ở trình duyệt ra hai ngày khác.
 *
 * Đo trên cdkt_app (container `TZ=Asia/Ho_Chi_Minh`), trình duyệt ở Europe/London (múi giờ
 * máy dev), chỉ GET: bài 1134 đăng 2026-10-05T20:59:44Z → HTML "Ngày đăng: 06/10/2026", sau
 * hydrate "05/10/2026" và console "Hydration completed but contains mismatches."; cùng trang
 * ở trình duyệt giờ Việt Nam thì không lệch. Mọi bài đăng 17:00–23:59 UTC (00:00–06:59 giờ VN)
 * đều dính — đúng "bài vừa tạo" lúc tối ở London; bài cũ đăng ban ngày thì không.
 *
 * Mount `ArticleMetaHeader.vue` THẬT (tests/_sfc-mount.ts) dưới từng múi giờ máy
 * (`process.env.TZ` đổi giữa chừng, như tests/queue-ai-verdict-ui.test.ts) — cùng một bài phải
 * cho cùng một chuỗi: đó chính là điều kiện để hydrate không lệch.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { findAll, mountSfc, textOf } from './_sfc-mount.ts'

const { formatPortalDate, PORTAL_TIME_ZONE } = await import('../app/utils/formatDate.ts')
const HEADER = new URL('../app/components/article/ArticleMetaHeader.vue', import.meta.url).pathname
const ZONES = ['Asia/Ho_Chi_Minh', 'Europe/London', 'UTC', 'America/Los_Angeles']

async function withZone<T>(zone: string, run: () => Promise<T> | T): Promise<T> {
  const saved = process.env.TZ
  process.env.TZ = zone
  try {
    return await run()
  } finally {
    if (saved === undefined) delete process.env.TZ
    else process.env.TZ = saved
  }
}

async function publishedLine(publishedAt: string, lang = 'vi') {
  const mounted = await mountSfc(HEADER, {
    auto: { useI18n: () => ({ currentLang: ref(lang), t: (key: string) => (key === 'a_published_on' ? 'Ngày đăng:' : key) }) },
    components: { SafeImg: { props: ['src'], template: '<img>' } },
  }, {
    article: { title: 'Bài thử', excerpt: null, thumbnailUrl: null, publishedAt, createdAt: null, authorName: 'admin', viewTotal: 0 },
    categoryLabel: 'Tin tức',
    metaIcon: '📰',
  })
  try {
    // The innermost span carrying the label (the badge around it carries it too).
    const line = findAll(mounted.root, el => el.tag === 'span').map(textOf).filter(text => text.includes('Ngày đăng:')).sort((a, b) => a.length - b.length)[0]
    assert.ok(line, mounted.html())
    return line.trim()
  } finally {
    mounted.unmount()
  }
}

test('ArticleMetaHeader: the same article reads the same Vietnam date on every machine zone', async () => {
  for (const zone of ZONES) {
    await withZone(zone, async () => {
      // 20:59Z on 05/10 is 03:59 on 06/10 in Vietnam — the article the mismatch was measured on.
      assert.equal(await publishedLine('2026-10-05T20:59:44.000Z'), 'Ngày đăng: 06/10/2026', zone)
      // A daytime article (the ones that never mismatched) is unchanged.
      assert.equal(await publishedLine('2026-08-27T08:28:24.000Z'), 'Ngày đăng: 27/08/2026', zone)
      // The VN-midnight edge, both sides.
      assert.equal(await publishedLine('2026-11-02T16:59:59.000Z'), 'Ngày đăng: 02/11/2026', zone)
      assert.equal(await publishedLine('2026-11-02T17:00:00.000Z'), 'Ngày đăng: 03/11/2026', zone)
    })
  }
})

test('ArticleMetaHeader: the date keeps following the page language (en-US order), still in Vietnam time', async () => {
  for (const zone of ['Asia/Ho_Chi_Minh', 'America/Los_Angeles']) {
    await withZone(zone, async () => {
      assert.equal(await publishedLine('2026-10-05T20:59:44.000Z', 'en'), 'Ngày đăng: 10/06/2026', zone)
    })
  }
})

test('formatPortalDate: Vietnam date whatever the machine zone; empty for nothing or garbage', async () => {
  assert.equal(PORTAL_TIME_ZONE, 'Asia/Ho_Chi_Minh')
  for (const zone of ZONES) {
    await withZone(zone, () => {
      const options = { day: '2-digit', month: '2-digit', year: 'numeric' } as const
      assert.equal(formatPortalDate('2026-10-05T20:59:44.000Z', 'vi-VN', options), '06/10/2026', zone)
      assert.equal(formatPortalDate(new Date('2026-10-05T16:59:00.000Z'), 'vi-VN', options), '05/10/2026', zone)
    })
  }
  for (const nothing of [null, undefined, '', 'không phải ngày']) assert.equal(formatPortalDate(nothing, 'vi-VN', { day: '2-digit' }), '')
})
