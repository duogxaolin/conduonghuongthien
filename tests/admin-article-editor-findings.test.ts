/**
 * FINDING-AE1 of the article editor's wave3 split (`pages/admin/content/articles/[id].vue`):
 * the re-translate prompt opened on a save with NO edit.
 *
 * After a PUT the page compares the Vietnamese title, excerpt and body with a snapshot and, if
 * any differs, asks "Phát hiện nội dung Tiếng Việt vừa thay đổi!" — confirm, and every
 * translation is redone by the AI (as drafts, or published). The body snapshot was the HTML as
 * STORED (`form.content` at load), but the body compared at save is the HTML as TinyMCE
 * SERIALISES it (`form.content = getEditorContent()`), and the editor rewrites HTML on the way in
 * (blocks on their own lines, `<br>` → `<br />`, entities). So any article whose stored HTML is
 * not already in TinyMCE's own format — imported from the old CMS, sanitised by the server —
 * asked on every plain "Cập Nhật Bài Viết", and an officer who believed it replaced the curated
 * translations with machine drafts. The unsaved-changes guard never had this problem: its body
 * baseline is taken from the editor (`init`).
 *
 * Fixed: the load snapshot's body is rebased onto the editor's serialisation when the editor
 * takes the loaded body — at its `init` (first load) or right away (a "Thử lại" with the editor
 * up) — and only while the body is still exactly what was loaded, so an edit made before the
 * editor was ready (the AI panel writes the form) still counts.
 *
 * RED on the base (551651c7) and on the split before the fix: the first two tests. The last two
 * are green on both — they pin that the fix does not hide a real change.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { byText, click, input } from './_sfc-mount.ts'
import { ARTICLE, dialogs, h3Error, json, openEditor, server, textOf, titleInput, type Editor } from './_article-editor-harness.ts'

const STORED = '<p>Một</p><p>Hai</p>'
/** What TinyMCE does to it: every block on its own line. */
const serialise = (html: string) => html.replace(/<\/p><p>/g, '</p>\n<p>')
const stored = (overrides = {}) => server({ 'GET /api/admin/articles/42': () => json({ ok: true, article: { ...ARTICLE, content: STORED } }), ...overrides })
const prompted = (ctx: Editor) => dialogs(ctx).some(d => d.props['aria-label'] === 'Phát hiện nội dung Tiếng Việt vừa thay đổi!')

async function save(ctx: Editor) {
  await click(byText(ctx.page.root, 'button', 'Cập Nhật Bài Viết'))
  await ctx.settle()
}

describe('FINDING-AE1: the re-translate prompt and the body TinyMCE rewrote', () => {
  it('a save with no edit asks nothing, though the editor rewrote the stored HTML', async (t) => {
    const ctx = await openEditor(t, '42', { responder: stored(), normalize: serialise })
    assert.equal(ctx.tiny.editor.html, '<p>Một</p>\n<p>Hai</p>')
    await save(ctx)
    assert.equal(prompted(ctx), false, 'asked to re-translate every language after a save that changed nothing')
  })

  it('the same after "Thử lại" with the editor already up', async (t) => {
    let reads = 0
    const ctx = await openEditor(t, '42', {
      normalize: serialise,
      // 403, not 5xx: ofetch retries a GET once on 5xx, which would hide the failed first read.
      responder: stored({ 'GET /api/admin/articles/42': () => (++reads === 1 ? h3Error(403, 'Không đọc được.') : json({ ok: true, article: { ...ARTICLE, content: STORED } })) }),
    })
    assert.deepEqual(ctx.tiny.log, ['init'], 'the editor came up over the failed load')
    assert.match(textOf(ctx.page.root), /Không đọc được\./)
    await click(byText(ctx.page.root, 'button', 'Thử lại'))
    await ctx.settle()
    assert.equal(ctx.tiny.editor.html, '<p>Một</p>\n<p>Hai</p>')
    await save(ctx)
    assert.equal(prompted(ctx), false)
  })

  it('a real body edit still asks (rewritten HTML on both sides)', async (t) => {
    const ctx = await openEditor(t, '42', { responder: stored(), normalize: serialise })
    ctx.tiny.editor.html = '<p>Một</p>\n<p>Ba</p>'
    await save(ctx)
    assert.equal(prompted(ctx), true)
  })

  it('a body the AI panel wrote before the editor was ready still asks; so does a title typed then', async (t) => {
    const ctx = await openEditor(t, '42', { responder: stored(), normalize: serialise, tinymceLoaded: false })
    ctx.ai.props!.setEditorContent('<p>Bản AI</p><p>viết lại</p>')
    ctx.win.tinymce = ctx.tiny.tinymce
    ctx.scripts[0]!.onload!()
    await ctx.settle()
    assert.equal(ctx.tiny.editor.html, '<p>Bản AI</p>\n<p>viết lại</p>')
    await save(ctx)
    assert.equal(prompted(ctx), true)

    ctx.close()
    const typed = await openEditor(t, '42', { responder: stored(), normalize: serialise, tinymceLoaded: false })
    await input(titleInput(typed), 'Tiêu đề gõ trước khi trình soạn sẵn sàng')
    typed.win.tinymce = typed.tiny.tinymce
    typed.scripts[0]!.onload!()
    await typed.settle()
    await save(typed)
    assert.equal(prompted(typed), true)
  })
})
