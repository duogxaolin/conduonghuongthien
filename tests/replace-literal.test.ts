import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { replaceFirstLiteral } from '../app/utils/replace-literal'

/**
 * "Áp dụng gợi ý" của trợ lý AI biên tập thay đoạn gốc bằng đoạn AI đề xuất. Nó
 * từng gọi `html.replace(original, suggested)` — vế thay thế của `replace` coi
 * `$&` (cả đoạn khớp), `` $` `` (mọi thứ TRƯỚC), `$'` (mọi thứ SAU) và `$$` là
 * mẫu, nên một gợi ý chứa các chuỗi đó nhân bản nửa bài viết vào giữa bài.
 */

const ARTICLE = '<p>Mở đầu.</p><p>Giá vé 50$ một người.</p><p>Kết.</p>'

test('special replacement patterns are inserted literally', () => {
  for (const suggestion of ['Giá $& mới', 'trước: $`', "sau: $'", 'đô la $$ hai lần', '$1 $<name>']) {
    const out = replaceFirstLiteral(ARTICLE, 'Giá vé 50$ một người.', suggestion)
    assert.equal(out, `<p>Mở đầu.</p><p>${suggestion}</p><p>Kết.</p>`, suggestion)
  }
  // The bug being fixed, for the record:
  assert.notEqual(ARTICLE.replace('Kết.', "sau: $'"), '<p>Mở đầu.</p><p>Giá vé 50$ một người.</p><p>sau: $\'</p>')
})

test('only the first occurrence changes; a missing or empty needle is reported, not silently ignored', () => {
  assert.equal(replaceFirstLiteral('a-a-a', 'a', 'b'), 'b-a-a')
  assert.equal(replaceFirstLiteral(ARTICLE, 'không có', 'x'), null)
  assert.equal(replaceFirstLiteral(ARTICLE, '', 'x'), null, 'an empty needle would otherwise prepend the suggestion')
})

test('the AI panel applies suggestions through the literal helper, never String.replace(string, string)', () => {
  const source = readFileSync(path.resolve(import.meta.dirname, '../app/components/admin/articles/ArticleAIPanel.vue'), 'utf8')
  assert.doesNotMatch(source, /\.replace\((?:change|c)\.original\s*,/)
  assert.doesNotMatch(source, /\.replace\(plainOrig\s*,/)
  assert.ok((source.match(/replaceFirstLiteral\(/g) ?? []).length >= 3)
})
