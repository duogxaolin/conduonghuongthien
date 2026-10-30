/**
 * FINDING-AE1 of the article editor's wave3 split (`pages/admin/content/articles/[id].vue`):
 * the re-translate prompt opened on a save with NO edit.
 *
 * After a PUT the page compares the Vietnamese title, excerpt and body with a snapshot and, if
 * any differs, asks "Phát hiện nội dung Tiếng Việt vừa thay đổi!" — "Dịch lại tất cả ngay" POSTs
 * `translate-all`. The body snapshot was the HTML as STORED (`form.content` at load), but the body
 * compared at save is the HTML as TinyMCE SERIALISES it (`form.content = getEditorContent()`),
 * and the editor rewrites HTML on the way in (blocks on their own lines, `<br>` → `<br />`,
 * entities). So any article whose stored HTML is not already in TinyMCE's own format — imported
 * from the old CMS, sanitised by the server — claimed "the Vietnamese text changed" on every plain
 * "Cập Nhật Bài Viết": a false statement, and a prompt officers learn to dismiss — including the
 * time the text really did change. (Confirming does NOT overwrite existing translations:
 * `triggerTranslateAllLanguages` queues only missing or failed languages — a separate finding,
 * docs/decisions/refactor-large-files.md.) The unsaved-changes guard never had this problem: its
 * body baseline is taken from the editor (`init`).
 *
 * Fixed: the load snapshot's body is rebased onto the editor's serialisation when the editor
 * takes the loaded body — at its `init` (first load) or right away (a "Thử lại" with the editor
 * up) — and only while the body is still exactly what was loaded, so an edit made before the
 * editor was ready (the AI panel writes the form) still counts.
 *
 * RED on the base (551651c7) and on the split before the fix: the first two tests. The rest of
 * the first block and the verifier's probes below are green on both — they pin that the fix does
 * not hide a real change. The last test is a KNOWN pre-existing bug, run as `todo`.
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

/**
 * The fix must not hide a real change — the independent verifier's probes P1–P6, kept. With
 * TinyMCE 6.8.6 in Chromium the verifier measured the same: no prompt on a plain save of 10
 * stored-HTML samples (the base prompted on 6), a prompt after bold / an inserted image /
 * centring / one typed character (docs/decisions/refactor-large-files.md). Two mutants these
 * kill: rebasing the snapshot in the editor's `change` handler (it would swallow every edit made
 * after a first prompt — P5) and comparing the body as TEXT with the tags stripped (a format-only
 * edit or an image changes no text — P1, P2).
 */
describe('FINDING-AE1: a real change still asks (verifier probes)', () => {
  const editorHtml = (ctx: Editor, html: string, change: boolean) => {
    ctx.tiny.editor.html = html
    if (change) ctx.tiny.editor.fire('change')
  }

  for (const change of [false, true]) {
    it(`P1 a format-only edit (bold) asks${change ? ', with the change event a real blur fires' : ''}`, async (t) => {
      const ctx = await openEditor(t, '42', { responder: stored(), normalize: serialise })
      editorHtml(ctx, '<p><strong>Một</strong></p>\n<p>Hai</p>', change)
      await save(ctx)
      assert.equal(prompted(ctx), true)
    })
  }

  it('P2 an image from the library into the live editor asks', async (t) => {
    const ctx = await openEditor(t, '42', { responder: stored(), normalize: serialise })
    await click(byText(ctx.page.root, 'button', 'Chèn Ảnh Từ Thư Viện'))
    ctx.pickers.at(-1)!.onSelectMultiple!([{ url: '/uploads/a.jpg', originalName: 'a.jpg' }])
    await save(ctx)
    assert.equal(prompted(ctx), true)
  })

  it('P3 an image appended without an editor asks', async (t) => {
    const ctx = await openEditor(t, '42', { responder: stored(), normalize: serialise, tinymceLoaded: false })
    await click(byText(ctx.page.root, 'button', 'Chèn Ảnh Từ Thư Viện'))
    ctx.pickers.at(-1)!.onSelectMultiple!([{ url: '/uploads/a.jpg', originalName: 'a.jpg' }])
    await save(ctx)
    assert.equal(prompted(ctx), true)
  })

  it('P4 the AI panel polishing the body after the editor is ready asks', async (t) => {
    const ctx = await openEditor(t, '42', { responder: stored(), normalize: serialise })
    ctx.ai.props!.setEditorContent('<p>Một đã sửa</p><p>Hai</p>')
    await save(ctx)
    assert.equal(prompted(ctx), true)
  })

  it('P5 after "Để sau": an unchanged save asks nothing, a second real edit (with its change event) asks again', async (t) => {
    const ctx = await openEditor(t, '42', { responder: stored(), normalize: serialise })
    editorHtml(ctx, '<p>Một</p>\n<p>Ba</p>', false)
    await save(ctx)
    assert.equal(prompted(ctx), true)
    await click(byText(dialogs(ctx)[0]!, 'button', 'Để sau / Giữ bản dịch hiện tại'))
    await ctx.settle()
    assert.equal(prompted(ctx), false)
    await save(ctx)
    assert.equal(prompted(ctx), false, 'unchanged save after a prompt')
    editorHtml(ctx, '<p>Một</p>\n<p>Bốn</p>', true)
    await save(ctx)
    assert.equal(prompted(ctx), true, 'the second edit was swallowed')
  })

  it('P6 an edit undone back to the loaded body (change events between) asks nothing', async (t) => {
    const ctx = await openEditor(t, '42', { responder: stored(), normalize: serialise })
    const original = ctx.tiny.editor.html
    editorHtml(ctx, '<p>Một</p>\n<p>X</p>', true)
    editorHtml(ctx, original, true)
    await save(ctx)
    assert.equal(prompted(ctx), false)
  })
})

/**
 * KNOWN, pre-existing, NOT fixed (docs/decisions/refactor-large-files.md, item 5 of the article
 * editor's entry): the fields baseline of the unsaved-changes guard is taken ONCE, in `onMounted`
 * after the first `fetchArticle`. After a failed load it is the empty form; a good "Thử lại" then
 * fills the form and the tab warns about changes nobody made. Red on the base (551651c7) and on
 * HEAD — kept as `todo` so it runs and shows, without failing the suite, until it is fixed.
 */
it('KNOWN (P7): after a failed load and a good "Thử lại", closing the tab with no edit warns about nothing', { todo: 'pre-existing: markSaved() runs once, before a retry' }, async (t) => {
  let reads = 0
  const ctx = await openEditor(t, '42', {
    normalize: serialise,
    responder: stored({ 'GET /api/admin/articles/42': () => (++reads === 1 ? h3Error(403, 'Không đọc được.') : json({ ok: true, article: { ...ARTICLE, content: STORED } })) }),
  })
  await click(byText(ctx.page.root, 'button', 'Thử lại'))
  await ctx.settle()
  assert.equal(ctx.beforeUnload(), false, 'the tab warns about unsaved changes that do not exist')
})
