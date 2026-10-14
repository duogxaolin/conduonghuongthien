/**
 * `/role-models` và `/reintegration-models` dùng chung `ModelArticlesListPage.vue`;
 * khác biệt nằm trong `MODEL_ARTICLE_VARIANTS`. Khoá i18n giờ là dữ liệu chứ không
 * còn là chữ trong template, nên một khoá gõ sai sẽ không lộ ra khi đọc mã — `t()`
 * lặng lẽ hiện tên khoá trên trang. Test này chặn điều đó.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { MODEL_ARTICLE_VARIANTS } from '../app/utils/model-article-variants'
import { hardcodedDictionary } from '../app/composables/i18n-default-dictionary'
import { DEFAULT_TRANSLATIONS_SEED } from '../server/data/default-translations-seed'

const seedKeys = new Set(DEFAULT_TRANSLATIONS_SEED.map(row => row.key))
const viDictionary = hardcodedDictionary.vi ?? {}

const allKeys = (variant: (typeof MODEL_ARTICLE_VARIANTS)[keyof typeof MODEL_ARTICLE_VARIANTS]) => [
  ...Object.values(variant.keys),
  ...variant.relatedLinks.map(link => link.labelKey),
]

test('mọi khoá i18n của hai biến thể có bản tiếng Việt dự phòng và có trong seed', () => {
  for (const [name, variant] of Object.entries(MODEL_ARTICLE_VARIANTS)) {
    for (const key of allKeys(variant)) {
      assert.ok(viDictionary[key], `${name}: thiếu "${key}" trong i18n-default-dictionary (vi)`)
      assert.ok(seedKeys.has(key), `${name}: thiếu "${key}" trong default-translations-seed`)
    }
  }
})

test('hai biến thể giữ đúng route, loại bài và khoá riêng của từng trang', () => {
  const { role_model: role, reintegration } = MODEL_ARTICLE_VARIANTS
  assert.equal(role.basePath, '/role-models')
  assert.equal(role.type, 'role_model')
  assert.equal(reintegration.basePath, '/reintegration-models')
  assert.equal(reintegration.type, 'reintegration')
  assert.ok(Object.values(role.keys).every(key => key.startsWith('rm_')))
  assert.ok(Object.values(reintegration.keys).every(key => key.startsWith('ri_')))
  // Liên kết chéo trỏ sang trang anh em, không trỏ về chính mình.
  assert.ok(role.relatedLinks.some(link => link.to === '/reintegration-models'))
  assert.ok(reintegration.relatedLinks.some(link => link.to === '/role-models'))
  assert.ok(!role.relatedLinks.some(link => link.to === role.basePath))
  assert.ok(!reintegration.relatedLinks.some(link => link.to === reintegration.basePath))
})

test('lớp màu viết thẳng chữ — không có nội suy mà Tailwind sẽ purge', () => {
  for (const variant of Object.values(MODEL_ARTICLE_VARIANTS)) {
    for (const value of Object.values(variant.theme)) {
      assert.doesNotMatch(value, /\$\{/)
    }
  }
})
