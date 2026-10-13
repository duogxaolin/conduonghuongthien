/**
 * Guard test for admin documentation hub.
 *
 * Validates: (a) every AdminDoc has required non-empty fields, (b) all slugs unique,
 * (c) all category values exist in ADMIN_DOC_CATEGORIES, (d) every PagePreview slug unique,
 * (e) every hotspot docSlug exists in ADMIN_DOCS, (f) searchDocs returns correct top-1,
 * (g) searchDocs returns bai-viet-ban-tin in top-3 for procedure query,
 * (h) intent detection works for location query.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ADMIN_DOCS, ADMIN_DOC_CATEGORIES, findDocBySlug } from '../app/utils/docs/admin-docs-index.ts'
import { DOC_PREVIEWS } from '../app/utils/docs/previews.ts'
import { searchDocs, detectIntent } from '../app/utils/docs/search.ts'

describe('admin-docs: every doc has required fields', () => {
  for (const doc of ADMIN_DOCS) {
    it(`doc "${doc.slug}" has non-empty slug`, () => {
      assert.ok(doc.slug && doc.slug.length > 0, `slug is empty for doc at index ${ADMIN_DOCS.indexOf(doc)}`)
    })
    it(`doc "${doc.slug}" has non-empty title`, () => {
      assert.ok(doc.title && doc.title.length > 0, `title is empty for ${doc.slug}`)
    })
    it(`doc "${doc.slug}" has non-empty category`, () => {
      assert.ok(doc.category && doc.category.length > 0, `category is empty for ${doc.slug}`)
    })
    it(`doc "${doc.slug}" has non-empty icon`, () => {
      assert.ok(doc.icon && doc.icon.length > 0, `icon is empty for ${doc.slug}`)
    })
    it(`doc "${doc.slug}" has non-empty summary`, () => {
      assert.ok(doc.summary && doc.summary.length > 0, `summary is empty for ${doc.slug}`)
    })
    it(`doc "${doc.slug}" has non-empty description`, () => {
      assert.ok(doc.description && doc.description.length > 0, `description is empty for ${doc.slug}`)
    })
    it(`doc "${doc.slug}" has workflow with at least 1 step`, () => {
      assert.ok(Array.isArray(doc.workflow) && doc.workflow.length >= 1, `workflow is empty for ${doc.slug}`)
      for (const step of doc.workflow) {
        assert.ok(step.title && step.title.length > 0, `workflow step title is empty for ${doc.slug}`)
        assert.ok(step.detail && step.detail.length > 0, `workflow step detail is empty for ${doc.slug}`)
      }
    })
    it(`doc "${doc.slug}" has non-empty mermaid`, () => {
      assert.ok(doc.mermaid && doc.mermaid.length > 0, `mermaid is empty for ${doc.slug}`)
      assert.ok(doc.mermaid.includes('flowchart'), `mermaid must be a flowchart for ${doc.slug}`)
    })
  }
})

describe('admin-docs: all slugs are unique', () => {
  it('no duplicate slugs in ADMIN_DOCS', () => {
    const slugs = ADMIN_DOCS.map(d => d.slug)
    const duplicates = slugs.filter((s, i) => slugs.indexOf(s) !== i)
    assert.deepEqual(duplicates, [], `duplicate slugs found: ${duplicates.join(', ')}`)
  })
})

describe('admin-docs: all category values exist in ADMIN_DOC_CATEGORIES', () => {
  it('every doc.category is defined in ADMIN_DOC_CATEGORIES', () => {
    const validCategories = ADMIN_DOC_CATEGORIES.map(c => c.key)
    for (const doc of ADMIN_DOCS) {
      assert.ok(validCategories.includes(doc.category), `doc "${doc.slug}" has invalid category "${doc.category}"`)
    }
  })
})

describe('admin-docs: preview hotspots reference valid doc slugs', () => {
  it('every PagePreview slug is unique', () => {
    const slugs = DOC_PREVIEWS.map(p => p.slug)
    const duplicates = slugs.filter((s, i) => slugs.indexOf(s) !== i)
    assert.deepEqual(duplicates, [], `duplicate preview slugs: ${duplicates.join(', ')}`)
  })

  it('every hotspot docSlug exists in ADMIN_DOCS', () => {
    const validSlugs = ADMIN_DOCS.map(d => d.slug)
    for (const preview of DOC_PREVIEWS) {
      for (const hotspot of preview.hotspots) {
        assert.ok(
          validSlugs.includes(hotspot.docSlug),
          `preview "${preview.slug}" hotspot "${hotspot.id}" references invalid docSlug "${hotspot.docSlug}"`,
        )
      }
    }
  })
})

describe('admin-docs: searchDocs returns correct results', () => {
  it('searchDocs("cài đặt chatbot") top-1 is cai-dat-chatbot', () => {
    const results = searchDocs(ADMIN_DOCS, 'cài đặt chatbot')
    assert.ok(results.length > 0, 'expected at least 1 result for "cài đặt chatbot"')
    assert.equal(results[0].slug, 'cai-dat-chatbot', `expected top-1 to be "cai-dat-chatbot" but got "${results[0]?.slug}"`)
  })

  it('searchDocs("làm sao đăng bài") returns bai-viet-ban-tin in top-3 and intent is procedure', () => {
    const intent = detectIntent('làm sao đăng bài')
    assert.equal(intent, 'procedure', `expected intent to be "procedure" but got "${intent}"`)
    const results = searchDocs(ADMIN_DOCS, 'làm sao đăng bài')
    assert.ok(results.length > 0, 'expected at least 1 result for "làm sao đăng bài"')
    const top3Slugs = results.slice(0, 3).map(r => r.slug)
    assert.ok(
      top3Slugs.includes('bai-viet-ban-tin'),
      `expected "bai-viet-ban-tin" in top-3 but got [${top3Slugs.join(', ')}]`,
    )
  })

  it('searchDocs("backup ở đâu") intent is location', () => {
    const intent = detectIntent('backup ở đâu')
    assert.equal(intent, 'location', `expected intent to be "location" but got "${intent}"`)
    const results = searchDocs(ADMIN_DOCS, 'backup ở đâu')
    assert.ok(results.length > 0, 'expected at least 1 result for "backup ở đâu"')
  })
})

describe('admin-docs: findDocBySlug works', () => {
  it('finds existing doc by slug', () => {
    const doc = findDocBySlug('bai-viet-ban-tin')
    assert.ok(doc, 'expected to find doc "bai-viet-ban-tin"')
    assert.equal(doc!.title, 'Bài viết & Bản tin')
  })
  it('returns undefined for nonexistent slug', () => {
    const doc = findDocBySlug('nonexistent-slug-xyz')
    assert.equal(doc, undefined)
  })
})

it('trang hub không xáo câu hỏi gợi ý lúc setup (tránh hydration mismatch)', async () => {
  const { readFileSync } = await import('node:fs')
  const page = readFileSync(new URL('../app/pages/admin/docs/index.vue', import.meta.url), 'utf8')
  // `suggestQuestions` dùng Math.random: gọi lúc setup → máy chủ và trình duyệt ra hai danh sách khác nhau.
  assert.match(page, /const suggestedQuestions = ref<string\[\]>\(\[\]\)/)
  assert.match(page, /onMounted\(\(\) => \{ suggestedQuestions\.value = suggestQuestions\(/)
  assert.doesNotMatch(page, /computed\(\(\) => suggestQuestions\(/)
})
