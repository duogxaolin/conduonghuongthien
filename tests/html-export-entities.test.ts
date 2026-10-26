/**
 * HTML entities in the two article exporters (`htmlToMarkdown`, `htmlToDocs`).
 *
 * Both exporters used to carry the same private `stripTags()`. Its "decode" lines were
 * no-ops (`.replace(/&/g, '&')`) followed by `.replace(/&[a-z]+;/g, '')`, so every
 * NAMED entity was deleted: `Phòng R&amp;D` exported as `Phòng RD`, `Ng&agrave;y`
 * as `Ngy`, `&lt;tháng&gt;` vanished. Content imported from the old CMS is full of
 * exactly these entities (CLAUDE.md, "Trường văn bản thuần … giải mã HTML entity").
 * The Docs exporter never decoded inline text at all, so headings and paragraphs
 * reached the Google Doc as literal `R&amp;D`, and `<pre>` blocks were dropped.
 *
 * Now one helper (`server/utils/html-fragment-text.ts`) strips tags and THEN decodes
 * with `decode-html-entities.ts`, and each output format escapes what it must:
 *
 *  - Markdown heading: plain text in an inline context → backslash-escape the
 *    characters CommonMark would read as markup, including `<` (a decoded `<b>`
 *    would otherwise render as an HTML tag) and an `&` that starts an entity-shaped
 *    run (a decoded `&amp;lt;` is the literal text `&lt;`, which a viewer would turn
 *    back into `<`). A bare `&` as in `R&D` is left alone.
 *  - Markdown code span / fenced block: CommonMark reads their content literally —
 *    no entity decoding, no backslash escapes — so the decoded text goes in as is,
 *    and only the fence grows to stay longer than any backtick run inside.
 *  - Markdown table: kept as raw HTML on purpose, so its entities must STAY encoded
 *    (decoding there would turn `&lt;script&gt;` into live markup).
 *  - Google Docs: the batchUpdate body is JSON carrying plain text; Docs never
 *    interprets markup or entities, so the decoded text needs no escaping.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { htmlToMarkdown } from '../server/utils/html-to-markdown.ts'
import { htmlToDocs } from '../server/utils/html-to-docs.ts'

const mdLines = (html: string) => htmlToMarkdown(html).split('\n')

type InsertText = { insertText: { location: { index: number }, text: string } }
type TextStyle = { updateTextStyle: { range: { startIndex: number, endIndex: number }, textStyle: Record<string, unknown> } }
type ParagraphStyle = { updateParagraphStyle: { range: { startIndex: number, endIndex: number }, paragraphStyle: Record<string, unknown> } }

const inserts = (html: string) => (htmlToDocs(html).requests as Array<Partial<InsertText>>)
  .filter((r): r is InsertText => !!r.insertText)
  .map(r => r.insertText)
const insertedTexts = (html: string) => inserts(html).map(r => r.text)

describe('htmlToMarkdown — headings decode entities, then escape for Markdown', () => {
  it('named entities survive: R&amp;D → R&D, Ng&agrave;y → Ngày', () => {
    const lines = mdLines('<h2>Phòng R&amp;D</h2><h3>Ng&agrave;y 1 th&aacute;ng</h3>')
    assert.ok(lines.includes('## Phòng R&D'), JSON.stringify(lines))
    assert.ok(lines.includes('### Ngày 1 tháng'), JSON.stringify(lines))
  })

  it('&lt;tháng&gt; decodes to <tháng>, written as \\<tháng> so no viewer reads a tag', () => {
    const lines = mdLines('<h3>Ng&agrave;y 1 &lt;tháng&gt;</h3>')
    assert.ok(lines.includes('### Ngày 1 \\<tháng>'), JSON.stringify(lines))
  })

  it('tag-shaped text never becomes a live HTML tag, and &amp;lt; stays the literal text &lt;', () => {
    const out = htmlToMarkdown('<h2>Thẻ &lt;b&gt;đậm&lt;/b&gt; và &amp;lt;script&amp;gt;</h2>')
    assert.ok(out.includes('## Thẻ \\<b>đậm\\</b> và \\&lt;script\\&gt;'), out)
    assert.doesNotMatch(out, /(^|[^\\])<\/?b>/, 'an unescaped <b> renders as bold in a Markdown viewer')
  })

  it('numeric entities decode (decimal and hex)', () => {
    const lines = mdLines('<h2>&#272;&#7889;i t&#x1EA1;i &#8212; m&#7909;c</h2>')
    assert.ok(lines.includes('## Đối tại — mục'), JSON.stringify(lines))
  })

  it('a literal & that is not an entity is left as is; &nbsp; is a space', () => {
    const lines = mdLines('<h2>AT&T &amp; R&D&nbsp;2026 & co</h2>')
    assert.ok(lines.includes('## AT&T & R&D 2026 & co'), JSON.stringify(lines))
  })

  it('a heading stays on one line and Markdown markup characters in it are escaped', () => {
    const lines = mdLines('<h2>Điều *1*\n&gt; trích [dẫn]</h2>')
    assert.ok(lines.includes('## Điều \\*1\\* > trích \\[dẫn\\]'), JSON.stringify(lines))
  })
})

describe('htmlToMarkdown — code is literal in Markdown: decoded, never backslash-escaped', () => {
  it('inline code', () => {
    const lines = mdLines('<p>Lệnh <code>a &lt; b &amp;&amp; c &gt; d</code></p>')
    assert.ok(lines.includes('Lệnh `a < b && c > d`'), JSON.stringify(lines))
  })

  it('inline code holding a backtick gets a longer fence', () => {
    const lines = mdLines('<p><code>x &#96;y&#96; z</code></p>')
    assert.ok(lines.includes('``x `y` z``'), JSON.stringify(lines))
  })

  it('code block', () => {
    const out = htmlToMarkdown('<pre><code>if (a &lt; b &amp;&amp; c) {\n  s = &quot;R&amp;D&quot;; // Ng&agrave;y\n}</code></pre>')
    assert.ok(out.includes('```\nif (a < b && c) {\n  s = "R&D"; // Ngày\n}\n```'), out)
  })

  it('a code block holding ``` gets a longer fence', () => {
    const out = htmlToMarkdown('<pre>&#96;&#96;&#96;js\nx &lt; 1\n&#96;&#96;&#96;</pre>')
    assert.ok(out.includes('````\n```js\nx < 1\n```\n````'), out)
  })
})

describe('htmlToMarkdown — tables stay raw HTML, so their entities stay encoded', () => {
  it('table cells keep R&amp;D and &lt;script&gt; verbatim (pin: decoding here would inject markup)', () => {
    const out = htmlToMarkdown('<table><tr><td>R&amp;D &lt;script&gt;alert(1)&lt;/script&gt;</td></tr></table>')
    assert.ok(out.includes('<td>R&amp;D &lt;script&gt;alert(1)&lt;/script&gt;</td>'), out)
    assert.doesNotMatch(out, /<script>/)
  })
})

describe('htmlToDocs — every text run reaches the Doc decoded', () => {
  it('heading: R&amp;D → R&D, styled over the decoded length', () => {
    const { requests } = htmlToDocs('<h2>Phòng R&amp;D</h2>')
    assert.deepEqual(insertedTexts('<h2>Phòng R&amp;D</h2>'), ['Phòng R&D\n'])
    const heading = (requests as Array<Partial<ParagraphStyle>>).find(r => r.updateParagraphStyle)!.updateParagraphStyle!
    assert.deepEqual(heading.range, { startIndex: 1, endIndex: 1 + 'Phòng R&D\n'.length })
    assert.equal(heading.paragraphStyle.headingType, 'HEADING_2')
  })

  it('paragraph: inline style ranges are measured on the decoded text', () => {
    const html = '<p>R&amp;D <strong>Ng&agrave;y</strong> &lt;1&gt;</p>'
    assert.deepEqual(insertedTexts(html), ['R&D Ngày <1>\n'])
    const bold = (htmlToDocs(html).requests as Array<Partial<TextStyle>>).find(r => r.updateTextStyle)!.updateTextStyle!
    assert.deepEqual(bold.range, { startIndex: 1 + 4, endIndex: 1 + 4 + 4 })
    assert.equal(bold.textStyle.bold, true)
  })

  it('the next block starts right after the decoded text', () => {
    assert.deepEqual(inserts('<h2>R&amp;D</h2><p>x</p>'), [
      { location: { index: 1 }, text: 'R&D\n' },
      { location: { index: 5 }, text: 'x\n' },
    ])
  })

  it('inline code', () => {
    assert.deepEqual(insertedTexts('<p>Lệnh <code>a &lt; b &amp;&amp; c</code></p>'), ['Lệnh a < b && c\n'])
  })

  it('code block: inserted (it used to be dropped), decoded, line breaks kept', () => {
    assert.deepEqual(
      insertedTexts('<pre><code>if (a &lt; b) {\n  x = &quot;Ng&agrave;y&quot;\n}</code></pre>'),
      ['if (a < b) {\n  x = "Ngày"\n}\n'],
    )
  })

  it('table cells', () => {
    const texts = insertedTexts('<table><tr><td>R&amp;D</td><td>Ng&agrave;y &lt;1&gt; &#8212; &#x41;</td></tr></table>')
    assert.deepEqual(texts, ['R&D', 'Ngày <1> — A'])
  })

  it('a literal & is kept, and one pass only: &amp;lt; is the text &lt;', () => {
    assert.deepEqual(insertedTexts('<p>AT&T & co &amp;lt;b&amp;gt;</p>'), ['AT&T & co &lt;b&gt;\n'])
  })
})

describe('one tag-stripping helper for both exporters', () => {
  for (const file of ['server/utils/html-to-markdown.ts', 'server/utils/html-to-docs.ts']) {
    it(`${file} has no private stripTags/headingLevel and imports the shared helper`, () => {
      const source = readFileSync(file, 'utf8')
      assert.doesNotMatch(source, /function\s+(stripTags|headingLevel)\b/, 'a private copy is where the entity bug lived twice')
      assert.match(source, /from '\.\/html-fragment-text'/)
    })
  }
})
