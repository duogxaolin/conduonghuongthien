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
 * not hide a real change. The last block is KNOWN 5/6 of the split ("Thử lại"), fixed since.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { byText, click, input } from './_sfc-mount.ts'
import type { NetCall } from './_admin-page-harness.ts'
import { ARTICLE, dialogs, h3Error, isDisabled, json, openEditor, server, textOf, titleInput, type Editor } from './_article-editor-harness.ts'

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
 * KNOWN 5 and 6 of the split (docs/decisions/refactor-large-files.md), both pre-existing, both
 * measured on the base build in Chromium with TinyMCE 6 before the fix (first read answered 403,
 * then "Thử lại"):
 *   (5) the unsaved-changes baseline was taken ONCE, in onMounted after the first load. After a
 *       failed load that is the empty form, so after a good "Thử lại" the page asked "Rời trang?"
 *       on every route leave and the browser warned on every tab close, with nothing edited (the
 *       verifier's probe P7, kept here as a `todo` until now);
 *   (6) "Thử lại" shows the placeholder (`v-if="loading"`), which takes the editor grid off the
 *       page and TinyMCE's element with it, and nothing started the editor again: the body was a
 *       bare, empty 700px box — nothing to read or type in — while every save sent the body of
 *       the orphaned editor.
 * Fixed: after a reload the page does what onMounted does after the first load, on the grid that
 * replaced the placeholder — the baseline (a good load only) and the editor (`initTinyMCE` removes
 * the orphaned one first, as it removes one left from an earlier visit). RED on the base: every
 * test here — the third and the second order of the script race through (5) only (onMounted
 * starts the editor there).
 */
describe('KNOWN 5/6: "Thử lại" after a failed load', () => {
  const article = () => json({ ok: true, article: { ...ARTICLE, content: STORED } })
  /** First read refused, then `then` (a good read by default; `undefined` leaves it pending). */
  const failingOnce = (then: (call: NetCall) => Response | undefined = article) => {
    let reads = 0
    // 403, not 5xx: ofetch retries a GET once on 5xx, which would hide the failed first read.
    return stored({ 'GET /api/admin/articles/42': (call: NetCall) => (++reads === 1 ? h3Error(403, 'Không đọc được.') : then(call)) })
  }
  const retry = async (ctx: Editor) => {
    await click(byText(ctx.page.root, 'button', 'Thử lại'))
    await ctx.settle()
  }
  const puts = (ctx: Editor) => ctx.calls.filter(call => call.method === 'PUT')
  /** The config minus its two functions (a new closure on every init). */
  const settings = (config: Record<string, unknown>) => {
    const { setup: _setup, images_upload_handler: _upload, ...rest } = config
    return rest
  }

  it('(5) P7: with no edit, neither a route leave nor closing the tab asks anything', async (t) => {
    const ctx = await openEditor(t, '42', { normalize: serialise, responder: failingOnce() })
    await retry(ctx)
    assert.equal(titleInput(ctx).model?.value, ARTICLE.title)
    assert.equal(ctx.beforeUnload(), false, 'the tab warns about unsaved changes that do not exist')
    assert.equal(await ctx.leave(), true)
    assert.deepEqual(ctx.confirms, [], '"Rời trang?" with nothing edited')
  })

  it('(6) the editor is on the page again, with the article\'s body and the same config — and what is typed there is saved', async (t) => {
    const ctx = await openEditor(t, '42', { normalize: serialise, responder: failingOnce() })
    assert.equal(ctx.tiny.onScreen(), true, 'the editor came up over the failed load')
    await retry(ctx)
    assert.equal(ctx.tiny.onScreen(), true, 'after "Thử lại" the body box is bare: the editor is attached to the element the placeholder removed')
    // The orphan removed, a new editor started on the element now on the page.
    assert.deepEqual(ctx.tiny.log, ['init', 'remove', 'init'])
    assert.equal(ctx.tiny.editor.html, serialise(STORED))
    assert.equal(ctx.tiny.configs.length, 2)
    assert.deepEqual(settings(ctx.tiny.configs[1]!), settings(ctx.tiny.configs[0]!), 'the second init is the same editor (height 700, content_style)')

    ctx.tiny.editor.html = '<p>Một</p>\n<p>Hai đã sửa</p>'
    ctx.tiny.editor.fire('change')
    await click(byText(ctx.page.root, 'button', 'Cập Nhật Bài Viết'))
    await ctx.settle()
    assert.deepEqual(puts(ctx).map(call => (call.body as { content: string }).content), ['<p>Một</p>\n<p>Hai đã sửa</p>'])
  })

  it('an edit after "Thử lại" still asks — the body in the editor, a field; a save clears it', async (t) => {
    const ctx = await openEditor(t, '42', { normalize: serialise, responder: failingOnce() })
    await retry(ctx)
    ctx.tiny.editor.html = '<p>Một</p>\n<p>Ba</p>'
    assert.equal(ctx.beforeUnload(), true, 'a body edit after the retry')
    ctx.tiny.editor.html = serialise(STORED)
    assert.equal(ctx.beforeUnload(), false, 'undone')
    await input(titleInput(ctx), 'Tiêu đề sửa sau khi thử lại')
    assert.equal(ctx.beforeUnload(), true, 'a title edit after the retry')
    await save(ctx)
    assert.equal(ctx.beforeUnload(), false, 'saved')
    // AE1 still holds on the re-started editor: the edit is a change.
    assert.equal(prompted(ctx), true)
  })

  it('"Thử lại" that fails again: the editor is back over the empty form, and what was typed before it still asks', async (t) => {
    const ctx = await openEditor(t, '42', { normalize: serialise, responder: failingOnce(() => h3Error(403, 'Vẫn không đọc được.')) })
    await input(titleInput(ctx), 'Gõ vào biểu mẫu trống')
    await retry(ctx)
    assert.match(textOf(ctx.page.root), /Vẫn không đọc được\./)
    assert.equal(ctx.tiny.onScreen(), true)
    assert.equal(titleInput(ctx).model?.value, 'Gõ vào biểu mẫu trống')
    assert.equal(ctx.beforeUnload(), true, 'a failed reload must not take what was typed as saved')
    assert.equal(isDisabled(byText(ctx.page.root, 'button', 'Cập Nhật Bài Viết')), true, 'nothing loaded: no save')
  })

  for (const order of ['the script loads while "Thử lại" is in flight', '"Thử lại" lands before the script loads'] as const) {
    it(`TinyMCE still loading when "Thử lại" is pressed (${order}): one editor, on the page, with the body`, async (t) => {
      const pending: NetCall[] = []
      const ctx = await openEditor(t, '42', { normalize: serialise, tinymceLoaded: false, responder: failingOnce((call) => { pending.push(call); return undefined }) })
      void click(byText(ctx.page.root, 'button', 'Thử lại'))
      await ctx.settle()
      const loadScript = async () => {
        ctx.win.tinymce = ctx.tiny.tinymce
        ctx.scripts[0]!.onload!()
        await ctx.settle()
      }
      if (order === 'the script loads while "Thử lại" is in flight') await loadScript()
      pending[0]!.respond(article())
      await ctx.settle()
      if (order === '"Thử lại" lands before the script loads') await loadScript()
      assert.equal(ctx.tiny.onScreen(), true)
      assert.equal(ctx.tiny.editor.html, serialise(STORED))
      assert.equal(ctx.tiny.log.filter(entry => entry === 'init').length - ctx.tiny.log.filter(entry => entry === 'remove').length, 1, ctx.tiny.log.join(' → '))
      assert.equal(ctx.beforeUnload(), false)
    })
  }
})
