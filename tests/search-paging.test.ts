import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSearchCounts,
  normalizeSearchFilter,
  planSearchSlices,
  searchSegments,
  type SearchSegment,
} from '../server/utils/search-paging'

/**
 * `/api/public/search` nối ba nguồn (bài viết → Hỏi–Đáp → trang). Các test này
 * chạy phần phân trang thật: ghép mọi trang lại phải ra đúng danh sách nối, không
 * trùng, không sót — và tổng không phụ thuộc trang đang xem (lỗi cũ: tổng là độ
 * dài một lượt lấy bị chặn trần, tăng dần khi bấm sang trang sau).
 */

const segments = (articles: number, qa: number, pages: number): SearchSegment[] => [
  { source: 'articles', total: articles },
  { source: 'qa', total: qa },
  { source: 'pages', total: pages },
]

/** Danh sách nối "thật" để so: mỗi phần tử là `${nguồn}:${chỉ số trong nguồn}`. */
function concatenated(list: SearchSegment[]): string[] {
  return list.flatMap((segment) => Array.from({ length: segment.total }, (_, i) => `${segment.source}:${i}`))
}

/** Đọc một trang theo kế hoạch — giả lập `LIMIT/OFFSET` trên từng nguồn. */
function readPage(list: SearchSegment[], page: number, limit: number): string[] {
  return planSearchSlices(list, (page - 1) * limit, limit)
    .flatMap((slice) => Array.from({ length: slice.limit }, (_, i) => `${slice.source}:${slice.offset + i}`))
}

test('ghép mọi trang lại ra đúng danh sách nối — không trùng, không sót, qua mọi ranh giới nguồn', () => {
  for (const [a, q, p] of [[0, 0, 0], [7, 3, 2], [10, 0, 5], [0, 4, 0], [23, 17, 1], [100, 50, 20], [101, 49, 3]] as const) {
    for (const limit of [1, 3, 6, 10, 50]) {
      const list = segments(a, q, p)
      const expected = concatenated(list)
      const pages = Math.ceil(expected.length / limit)
      const collected: string[] = []
      for (let page = 1; page <= pages; page++) {
        const items = readPage(list, page, limit)
        assert.ok(items.length <= limit, 'một trang không vượt limit')
        if (page < pages) assert.equal(items.length, limit, `trang ${page}/${pages} phải đầy (a=${a} q=${q} p=${p} limit=${limit})`)
        collected.push(...items)
      }
      assert.deepEqual(collected, expected)
    }
  }
})

test('trang vượt tổng không lên kế hoạch truy vấn nào', () => {
  assert.deepEqual(planSearchSlices(segments(5, 5, 5), 15, 10), [])
  assert.deepEqual(planSearchSlices(segments(5, 5, 5), 99_990, 10), [])
  assert.deepEqual(planSearchSlices(segments(0, 0, 0), 0, 10), [])
})

test('một trang nằm vắt qua ba nguồn đọc đúng phần giao của từng nguồn', () => {
  assert.deepEqual(planSearchSlices(segments(3, 2, 4), 2, 5), [
    { source: 'articles', offset: 2, limit: 1 },
    { source: 'qa', offset: 0, limit: 2 },
    { source: 'pages', offset: 0, limit: 2 },
  ])
})

test('tổng của bộ lọc không đổi theo trang đang xem (hồi quy của lỗi cũ)', () => {
  const counts = buildSearchCounts([{ type: 'news', total: 230 }, { type: 'role_model', total: '4' }], 12, 1)
  const totals = new Set<number>()
  for (let page = 1; page <= 30; page++) {
    totals.add(searchSegments('all', counts).reduce((sum, s) => sum + s.total, 0))
  }
  assert.deepEqual([...totals], [247])
})

test('bộ đếm tab gộp hai giá trị "mô hình tái hoà nhập" và tính loại tuỳ biến vào "Tất cả"', () => {
  const counts = buildSearchCounts(
    [
      { type: 'news', total: 10 },
      { type: 'reintegration', total: 2 },
      { type: 'reintegration_model', total: '3' },
      { type: 'document', total: 1 },
      { type: 'faq', total: 4 },
      { type: 'test_the_loai', total: 6 },
    ],
    7,
    2,
  )
  assert.deepEqual(counts, { all: 35, news: 10, role_model: 0, reintegration_model: 5, document: 1, faq: 4, qa: 7, page: 2 })
  assert.deepEqual(searchSegments('reintegration_model', counts), [{ source: 'articles', total: 5 }])
  assert.deepEqual(searchSegments('qa', counts), [{ source: 'qa', total: 7 }])
  assert.deepEqual(searchSegments('page', counts), [{ source: 'pages', total: 2 }])
  assert.deepEqual(searchSegments('all', counts).map((s) => s.total), [26, 7, 2])
})

test('bộ lọc: bí danh `reintegration`, giá trị lạ không khớp nguồn nào', () => {
  assert.equal(normalizeSearchFilter(undefined), 'all')
  assert.equal(normalizeSearchFilter(''), 'all')
  assert.equal(normalizeSearchFilter(' NEWS '), 'news')
  assert.equal(normalizeSearchFilter('reintegration'), 'reintegration_model')
  assert.equal(normalizeSearchFilter('foo'), 'unknown')
  assert.deepEqual(searchSegments('unknown', buildSearchCounts([{ type: 'news', total: 3 }], 1, 1)), [])
})
