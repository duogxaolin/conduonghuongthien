/**
 * The article editor (`app/pages/admin/content/articles/[id].vue`) — behaviour, written BEFORE
 * its wave3 split and run on both versions (`ARTICLE_EDITOR_FILE=<original>`). The batch-D
 * suite (tests/admin-fetch-rollout-article-editor.test.ts) pins the requests, the load/retry
 * banner and the two `loaded` guards; this one pins everything else an officer does on the page:
 *   - the load placeholder and when TinyMCE is created — after the article, once, on
 *     `#tinymce-content-editor`, with EXACTLY the article config (height 700, the
 *     `content_style` with `img/iframe/video { max-width: 100% }`), full section width (no
 *     `max-w-*` on the editor or any ancestor — CLAUDE.md "TinyMCE admin editor"), an editor
 *     left from an earlier visit removed first, the self-hosted script when TinyMCE is not
 *     on the page yet;
 *   - the save: empty title, every field in the PUT, the busy button, the fallback sentence;
 *     the create with its auto-translations (menu all/none, one POST per language in order);
 *   - the re-translate prompt after a save that changed the Vietnamese text;
 *   - the AI panel's bridge into the editor and its title/excerpt suggestions;
 *   - images: into the editor (at the cursor, in order; appended without an editor), the
 *     thumbnail from the library, its upload and its removal;
 *   - the unsaved-changes guard: route leave (exact prompt) and `beforeunload`, for a field
 *     and for the body as TinyMCE serialises it; quiet after a save, while loading, and on
 *     the redirect after a create; the listener and the editor go at unmount.
 *
 * Not the page's job, so not here: sanitising (the page renders no HTML — AI HTML is filtered
 * in server/api/admin/ai/editorial.post.ts, tests/security-ai-editorial-html.test.ts; article
 * HTML on write, tests/article-write-sanitize-behavior.test.ts); the slug (the editor has no
 * slug field and sends none — the PUT/POST bodies below are compared whole); whether a type
 * change is allowed (`articles/[id].put.ts` checks the permission; the page shows the server's
 * sentence — tests/admin-fetch-rollout-article-editor.test.ts).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { byText, click, fire, input, type MiniElement } from './_sfc-mount.ts'
import { alertText, dropped, OFETCH_LINE, sent, wire, type NetCall } from './_admin-page-harness.ts'
import {
  ARTICLE, all, classOf, dialogs, editorBox, excerptInput, findAll, h3Error, isDisabled, json, openEditor, optionsOf,
  placeholder, selectOf, server, textOf, titleInput, type Editor,
} from './_article-editor-harness.ts'

const button = (ctx: Editor, text: string) => byText(ctx.page.root, 'button', text)
const save = (ctx: Editor) => all(ctx, el => el.tag === 'button' && /Cập Nhật Bài Viết|Đăng Bài Mới|Đang lưu\.\.\./.test(textOf(el)))[0]!
const thumbnail = (ctx: Editor) => all(ctx, el => el.tag === 'img')[0]
const removeThumbnail = (ctx: Editor) => all(ctx, el => el.tag === 'button' && el.props['aria-label'] === 'Xóa ảnh đại diện')[0]!
const fileInput = (ctx: Editor) => all(ctx, el => el.tag === 'input' && el.props.type === 'file')[0]!
/**
 * Is it on screen. Compare THIS, never the element itself: a failing `assert.equal(el, undefined)`
 * makes node inspect the element — parent links and all — and the run hangs instead of failing
 * (seen with a mutant that left the thumbnail in place).
 */
const shown = (el: MiniElement | undefined) => el !== undefined
const RETRANSLATE = 'Phát hiện nội dung Tiếng Việt vừa thay đổi!'
const retranslate = (ctx: Editor) => dialogs(ctx).find(d => d.props['aria-label'] === RETRANSLATE)
const LEAVE_PROMPT = {
  title: 'Rời trang?', message: 'Bài viết có thay đổi chưa lưu. Rời trang bây giờ sẽ mất các thay đổi này.',
  confirmLabel: 'Rời trang', cancelLabel: 'Ở lại', danger: true,
}
const BODY = { title: 'Bài gốc', type: 'role_model', category: '', categoryId: 21, excerpt: 'Tóm tắt gốc', content: '<p>Nội dung gốc</p>', thumbnailUrl: '/uploads/goc.jpg', status: 'draft' }

type Line = string | { wire: string, body: Record<string, unknown> }
async function saveNow(ctx: Editor): Promise<Line[]> {
  const before = ctx.calls.length
  await click(save(ctx))
  await ctx.settle()
  return sent(ctx.calls, before) as Line[]
}
const bodyOf = (line: Line | undefined) => (typeof line === 'object' ? line.body : undefined)
const wires = (lines: Line[]) => lines.map(line => (typeof line === 'string' ? line : line.wire))
/** The chips of the re-translate prompt: `flag label`. */
const chips = (modal: MiniElement) => findAll(modal, el => el.tag === 'span' && classOf(el).startsWith('inline-flex'))
  .map(chip => findAll(chip, el => el.tag === 'span' && el !== chip).map(textOf).join(' '))

// The article config, byte for byte (CLAUDE.md: height 700, `img/iframe/video { max-width:100% }`).
const CONTENT_STYLE = `
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.6; padding: 12px; color: #1a1a1a; }
      img { max-width: 100%; height: auto; border-radius: 8px; }
      iframe, video { max-width: 100%; height: auto; }
      pre[class*="language-"] { background: #2d2d2d; border-radius: 6px; padding: 1em; overflow-x: auto; }
      code { background: #f4f4f4; padding: 2px 6px; border-radius: 4px; font-family: 'Fira Code', monospace; }
      blockquote { border-left: 4px solid #2c6e33; margin: 1em 0; padding-left: 1em; color: #555; }
      table { border-collapse: collapse; width: 100%; }
      table td, table th { border: 1px solid #ddd; padding: 8px; }
    `
const CONFIG = {
  selector: '#tinymce-content-editor', height: 700, menubar: true, promotion: false, branding: false, skin: 'oxide', content_css: 'default',
  relative_urls: false, remove_script_host: false, convert_urls: true,
  plugins: ['advlist', 'autolink', 'lists', 'link', 'image', 'charmap', 'anchor', 'searchreplace', 'visualblocks', 'code', 'fullscreen',
    'insertdatetime', 'media', 'table', 'wordcount', 'quickbars'],
  toolbar: 'undo redo | blocks | bold italic underline strikethrough | forecolor backcolor | alignleft aligncenter alignright alignjustify | '
    + 'bullist numlist outdent indent | link image media | table | removeformat | fullscreen code',
  toolbar_mode: 'sliding', quickbars_selection_toolbar: 'bold italic | quicklink h2 h3 blockquote', quickbars_insert_toolbar: 'quickimage quicktable',
  contextmenu: 'link image table', image_advtab: true, image_caption: true, automatic_uploads: true, paste_data_images: true,
  paste_merge_formats: true, file_picker_types: 'image', content_style: CONTENT_STYLE,
}

describe('article editor — load and TinyMCE', () => {
  it('while the article loads: an announced placeholder, no grid, no editor, saving off; then the form, then TinyMCE', async (t) => {
    const pending: NetCall[] = []
    const ctx = await openEditor(t, '42', { responder: server({ 'GET /api/admin/articles/42': (call) => { pending.push(call); return undefined } }) })
    assert.equal(placeholder(ctx)?.props['aria-busy'], 'true')
    assert.match(textOf(placeholder(ctx)!), /Đang tải nội dung bài viết/)
    assert.equal(shown(editorBox(ctx)), false)
    assert.equal(ctx.tiny.configs.length, 0)
    assert.equal(isDisabled(save(ctx)), true)
    assert.equal(await ctx.leave(), true, 'nothing to lose while loading')
    pending[0]!.respond(json({ ok: true, article: ARTICLE }))
    await ctx.settle()
    assert.equal(shown(placeholder(ctx)), false)
    assert.ok(editorBox(ctx))
    assert.deepEqual(ctx.tiny.log, ['init'])
    assert.equal(ctx.tiny.editor.html, '<p>Nội dung gốc</p>')
    assert.equal(titleInput(ctx).model?.value, 'Bài gốc')
    assert.equal(excerptInput(ctx).model?.value, 'Tóm tắt gốc')
    assert.equal(selectOf(ctx, 'Trạng thái').model?.value, 'draft')
    assert.equal(thumbnail(ctx)?.props.src, '/uploads/goc.jpg')
  })

  it('a failed load: the server\'s sentence; "Thử lại" brings the placeholder back while it runs', async (t) => {
    let read: NetCall | null = null
    let first = true
    const ctx = await openEditor(t, '42', { responder: server({
      'GET /api/admin/articles/42': (call) => { if (first) { first = false; return h3Error(404, 'Không tìm thấy bài viết.') } read = call; return undefined },
    }) })
    assert.match(alertText(ctx.page), /^Không tìm thấy bài viết\.\s*Thử lại$/)
    void click(button(ctx, 'Thử lại'))
    await ctx.settle()
    assert.ok(read, 'the retry asked again')
    assert.equal(alertText(ctx.page), '')
    assert.ok(placeholder(ctx))
    read!.respond(json({ ok: true, article: ARTICLE }))
    await ctx.settle()
    assert.equal(shown(placeholder(ctx)), false)
    assert.equal(titleInput(ctx).model?.value, 'Bài gốc')
  })

  it('TinyMCE gets exactly the article config, once, after the article', async (t) => {
    const ctx = await openEditor(t, '42')
    assert.equal(ctx.tiny.configs.length, 1)
    const { setup, images_upload_handler: upload, ...config } = ctx.tiny.configs[0]!
    assert.deepEqual(config, CONFIG)
    assert.equal(typeof setup, 'function')
    assert.equal(typeof upload, 'function')
    assert.match(CONTENT_STYLE, /img \{ max-width: 100%;/)
    assert.match(CONTENT_STYLE, /iframe, video \{ max-width: 100%;/)
  })

  it('the editor spans the section: no max-w on it or any ancestor; its box keeps the 700px floor', async (t) => {
    const ctx = await openEditor(t, '42')
    const box = editorBox(ctx)!
    assert.equal(classOf(box), 'min-h-[700px]')
    for (let el: typeof box | null = box; el; el = el.parent) assert.doesNotMatch(classOf(el), /max-w-/, `<${el.tag} class="${classOf(el)}">`)
  })

  it('an editor left from an earlier visit is removed before the new one is created', async (t) => {
    const ctx = await openEditor(t, '42', { leftover: true })
    assert.deepEqual(ctx.tiny.log, ['remove', 'init'])
  })

  it('TinyMCE not on the page yet: the self-hosted script is added once, the editor follows its load', async (t) => {
    const ctx = await openEditor(t, '42', { tinymceLoaded: false })
    assert.deepEqual(ctx.scripts.map(s => [s.tag, s.src]), [['script', '/assets/tinymce/tinymce.min.js']])
    assert.equal(ctx.tiny.configs.length, 0)
    ctx.win.tinymce = ctx.tiny.tinymce
    ctx.scripts[0]!.onload!()
    await ctx.settle()
    assert.deepEqual(ctx.tiny.log, ['init'])
    assert.equal(ctx.tiny.editor.html, '<p>Nội dung gốc</p>')
  })

  it('the script fails to load: a console line, no editor, and the stored body still saves', async (t) => {
    const errors = t.mock.method(console, 'error', () => {})
    const ctx = await openEditor(t, '42', { tinymceLoaded: false })
    ctx.scripts[0]!.onerror!()
    await ctx.settle()
    assert.match(String(errors.mock.calls[0]?.arguments[0]), /TinyMCE local assets missing/)
    assert.equal(ctx.tiny.configs.length, 0)
    assert.deepEqual(await saveNow(ctx), [{ wire: 'PUT /api/admin/articles/42', body: BODY }])
  })

  it('the editor\'s change event keeps the form body: an editor that later reads empty saves the settled body', async (t) => {
    const ctx = await openEditor(t, '42')
    ctx.tiny.editor.html = '<p>Đã gõ xong</p>'
    ctx.tiny.editor.fire('change')
    ctx.tiny.editor.html = ''
    assert.equal(bodyOf((await saveNow(ctx))[0])?.content, '<p>Đã gõ xong</p>')
  })
})

describe('article editor — saving', () => {
  it('an empty title: a warning, no request', async (t) => {
    const ctx = await openEditor(t, '42')
    await input(titleInput(ctx), '   ')
    assert.deepEqual(await saveNow(ctx), [])
    assert.equal(ctx.lastToast('warning'), 'Tiêu đề bài viết không được để trống')
    assert.equal(textOf(save(ctx)), 'Cập Nhật Bài Viết')
  })

  it('every field reaches the PUT: type (its categories reload, the category resets), category, status, excerpt, thumbnail removed', async (t) => {
    const ctx = await openEditor(t, '42')
    assert.deepEqual(optionsOf(selectOf(ctx, 'Thể loại bài viết')), ['fa-newspaper Tin tức', 'fa-star Tấm gương', 'Không biểu tượng'])
    const before = ctx.calls.length
    await input(selectOf(ctx, 'Thể loại bài viết'), 'news')
    await ctx.settle()
    assert.deepEqual(ctx.calls.slice(before).map(wire), ['GET /api/admin/categories?type=news'])
    assert.equal(selectOf(ctx, 'Danh mục').model?.value, null)
    assert.deepEqual(optionsOf(selectOf(ctx, 'Danh mục')), ['— Không có danh mục —', 'Gốc news', '↳ Con news'])
    assert.equal(classOf(findAll(selectOf(ctx, 'Danh mục'), el => el.tag === 'option')[1]!), 'font-bold')
    await input(selectOf(ctx, 'Danh mục'), 11)
    await input(selectOf(ctx, 'Trạng thái'), 'archived')
    assert.deepEqual(optionsOf(selectOf(ctx, 'Trạng thái')), ['🟢 Xuất Bản Ngay', '🟡 Bản Nháp (Draft)', '⚪ Lưu Trữ'])
    await input(excerptInput(ctx), 'Tóm tắt mới')
    await click(removeThumbnail(ctx))
    assert.deepEqual(await saveNow(ctx), [{
      wire: 'PUT /api/admin/articles/42',
      body: { ...BODY, type: 'news', categoryId: 11, excerpt: 'Tóm tắt mới', thumbnailUrl: '', status: 'archived' },
    }])
    assert.equal(ctx.lastToast('success'), 'Đã cập nhật bài viết thành công!')
  })

  it('while the PUT is out: "Đang lưu..." and disabled; back to "Cập Nhật Bài Viết" after', async (t) => {
    const pending: NetCall[] = []
    const ctx = await openEditor(t, '42', { responder: server({ 'PUT /api/admin/articles/42': (call) => { pending.push(call); return undefined } }) })
    void click(save(ctx))
    await ctx.settle()
    assert.equal(textOf(save(ctx)), 'Đang lưu...')
    assert.equal(isDisabled(save(ctx)), true)
    pending[0]!.respond(json({ ok: true }))
    await ctx.settle()
    assert.equal(textOf(save(ctx)), 'Cập Nhật Bài Viết')
    assert.equal(isDisabled(save(ctx)), false)
  })

  it('a save that never got an answer: the page\'s own sentence, never ofetch\'s line; a 500 with a sentence shows it', async (t) => {
    let answer: () => Response | Error = dropped
    const ctx = await openEditor(t, '42', { responder: server({ 'PUT /api/admin/articles/42': () => answer() }) })
    await saveNow(ctx)
    assert.equal(alertText(ctx.page), 'Lỗi lưu bài viết')
    assert.equal(ctx.lastToast('error'), 'Lỗi lưu bài viết')
    answer = () => h3Error(500, 'Máy chủ đang bận, thử lại sau.')
    await saveNow(ctx)
    assert.equal(alertText(ctx.page), 'Máy chủ đang bận, thử lại sau.')
    assert.doesNotMatch(alertText(ctx.page), OFETCH_LINE)
  })

  it('create: the auto-translate menu (all, none, one) decides the POSTs, one per language in order', async (t) => {
    const ctx = await openEditor(t, 'new')
    assert.equal(textOf(all(ctx, el => el.tag === 'h1')[0]!), '✍️ Viết Bài Mới')
    await click(button(ctx, 'Tự động dịch (1)'))
    await click(button(ctx, 'Tất cả'))
    assert.ok(button(ctx, 'Tự động dịch (3)'))
    await click(button(ctx, 'Bỏ chọn'))
    assert.ok(button(ctx, 'Tự động dịch...'))
    const boxes = all(ctx, el => el.tag === 'input' && el.props.type === 'checkbox')
    assert.deepEqual(boxes.map(b => b.props.value), ['en', 'zh', 'fr'])
    await input(boxes[2]!, ['fr'])
    await input(boxes[1]!, ['fr', 'zh'])
    await input(titleInput(ctx), 'Bài mới tinh')
    assert.deepEqual((await saveNow(ctx)).map(c => (typeof c === 'string' ? c : `${c.wire} ${JSON.stringify(c.body?.langCode ?? '')}`)), [
      'POST /api/admin/articles ""',
      'POST /api/admin/articles/99/translations/translate "fr"',
      'POST /api/admin/articles/99/translations/translate "zh"',
    ])
    assert.deepEqual(ctx.toasts.map(x => x.message), ['Tạo bài viết mới thành công!', 'Đã kích hoạt dịch tự động sang 2 ngôn ngữ trong nền!'])
    assert.deepEqual(ctx.navigations, ['/admin/content/articles/99'])
    assert.equal(await ctx.leaveAtNavigation[0], true, 'the redirect to the new article must not ask "leave without saving?"')
    assert.deepEqual(ctx.confirms, [])
  })

  it('create with no language chosen: only the article; a failed auto-translation stops the rest silently (pinned as is)', async (t) => {
    const none = await openEditor(t, 'new')
    await click(button(none, 'Tự động dịch (1)'))
    await click(button(none, 'Tất cả'))
    await click(button(none, 'Bỏ chọn'))
    await input(titleInput(none), 'Bài mới')
    assert.deepEqual(wires(await saveNow(none)), ['POST /api/admin/articles'])
    assert.deepEqual(none.toasts.map(x => x.message), ['Tạo bài viết mới thành công!'])
    none.close()

    const failing = await openEditor(t, 'new', { responder: server({ 'POST /api/admin/articles/99/translations/translate': () => h3Error(503, 'AI bận.') }) })
    await click(button(failing, 'Tự động dịch (1)'))
    await click(button(failing, 'Tất cả'))
    await input(titleInput(failing), 'Bài mới')
    assert.deepEqual(wires(await saveNow(failing)), ['POST /api/admin/articles', 'POST /api/admin/articles/99/translations/translate'])
    assert.deepEqual(failing.toasts.map(x => x.message), ['Tạo bài viết mới thành công!'])
    assert.deepEqual(failing.navigations, ['/admin/content/articles/99'])
  })

  it('a refused create: the sentence, no navigation, the typing stays', async (t) => {
    const ctx = await openEditor(t, 'new', { responder: server({ 'POST /api/admin/articles': () => h3Error(400, 'Tiêu đề quá dài.') }) })
    await input(titleInput(ctx), 'Tiêu đề rất dài')
    await saveNow(ctx)
    assert.equal(alertText(ctx.page), 'Tiêu đề quá dài.')
    assert.deepEqual(ctx.navigations, [])
    assert.equal(titleInput(ctx).model?.value, 'Tiêu đề rất dài')
  })
})

describe('article editor — header, translations, re-translate prompt', () => {
  it('edit: the header, the cancel link, the translations button scrolls to the panel; the panel gets id/new/title', async (t) => {
    const ctx = await openEditor(t, '42')
    assert.equal(textOf(all(ctx, el => el.tag === 'h1')[0]!), '✏️ Chỉnh Sửa Bài Viết')
    const cancel = all(ctx, el => el.tag === 'nuxt-link')[0]!
    assert.equal(cancel.props.to, '/admin/content/articles')
    assert.equal(textOf(cancel), 'Hủy & Quay lại')
    await click(button(ctx, 'Bản dịch (3 ngôn ngữ)'))
    await ctx.settle()
    assert.deepEqual(ctx.scrolls, [{ id: 'article-translations-section', options: { behavior: 'smooth' } }])
    assert.deepEqual({ ...ctx.panel.props }, { articleId: 42, isNew: false, formTitle: 'Bài gốc' })
    await input(titleInput(ctx), 'Tên mới')
    assert.equal(ctx.panel.props!.formTitle, 'Tên mới')
  })

  it('a PUT that changed the Vietnamese text opens the prompt with the languages; confirming translates as ai_draft', async (t) => {
    const ctx = await openEditor(t, '42')
    ctx.tiny.editor.html = '<p>Nội dung sửa</p>'
    await saveNow(ctx)
    const modal = retranslate(ctx)!
    assert.ok(modal)
    assert.equal(modal.props['data-icon'], 'fa-solid fa-lightbulb')
    assert.deepEqual(chips(modal), ['EN Tiếng Anh', 'ZH Tiếng Trung', 'FR Tiếng Pháp'])
    await click(byText(modal, 'button', 'Dịch lại tất cả ngay'))
    await ctx.settle()
    assert.deepEqual(ctx.panel.translateAll, ['ai_draft'])
    assert.equal(shown(retranslate(ctx)), false)
  })

  it('ticked "Tự động xuất bản": published; while it starts the dialog is busy and the button says so', async (t) => {
    const ctx = await openEditor(t, '42')
    await input(excerptInput(ctx), 'Tóm tắt khác')
    await saveNow(ctx)
    const box = findAll(retranslate(ctx)!, el => el.tag === 'input' && el.props.type === 'checkbox')[0]!
    assert.equal(box.model?.value, false)
    await input(box, true)
    ctx.panel.hold = true
    void click(byText(retranslate(ctx)!, 'button', 'Dịch lại tất cả ngay'))
    await ctx.settle()
    assert.deepEqual(ctx.panel.translateAll, ['published'])
    assert.equal(retranslate(ctx)!.props['aria-busy'], 'true')
    const busy = byText(retranslate(ctx)!, 'button', 'Đang kích hoạt...')
    assert.equal(isDisabled(busy), true)
    ctx.panel.pending!()
    await ctx.settle()
    assert.equal(shown(retranslate(ctx)), false)
  })

  it('an unchanged PUT asks nothing; "Để sau" closes without translating, and the next unchanged save asks nothing', async (t) => {
    const ctx = await openEditor(t, '42')
    await saveNow(ctx)
    assert.equal(shown(retranslate(ctx)), false)
    await input(titleInput(ctx), 'Đổi tên')
    await saveNow(ctx)
    await click(byText(retranslate(ctx)!, 'button', 'Để sau / Giữ bản dịch hiện tại'))
    await ctx.settle()
    assert.equal(shown(retranslate(ctx)), false)
    await saveNow(ctx)
    assert.equal(shown(retranslate(ctx)), false)
    assert.deepEqual(ctx.panel.translateAll, [])
  })
})

describe('article editor — AI panel and images', () => {
  it('the AI panel reads the title and the editor; its polish writes the editor; its suggestions fill title and excerpt', async (t) => {
    const ctx = await openEditor(t, '42')
    assert.equal(ctx.ai.props!.formTitle, 'Bài gốc')
    assert.equal(ctx.ai.props!.getEditorContent(), '<p>Nội dung gốc</p>')
    ctx.ai.props!.setEditorContent('<p>Đã trau chuốt</p>')
    assert.equal(ctx.tiny.editor.html, '<p>Đã trau chuốt</p>')
    ctx.ai.emit!('update:title', 'Tiêu đề AI')
    ctx.ai.emit!('update:excerpt', 'Tóm tắt AI')
    await ctx.settle()
    assert.equal(titleInput(ctx).model?.value, 'Tiêu đề AI')
    assert.equal(ctx.ai.props!.formTitle, 'Tiêu đề AI')
    assert.deepEqual(await saveNow(ctx), [{ wire: 'PUT /api/admin/articles/42', body: { ...BODY, title: 'Tiêu đề AI', excerpt: 'Tóm tắt AI', content: '<p>Đã trau chuốt</p>' } }])
  })

  it('the AI bridge without an editor (or an empty one) reads and writes the form body', async (t) => {
    const ctx = await openEditor(t, '42', { tinymceLoaded: false })
    assert.equal(ctx.ai.props!.getEditorContent(), '<p>Nội dung gốc</p>')
    ctx.ai.props!.setEditorContent('<p>Không có trình soạn</p>')
    assert.equal(ctx.tiny.editor.html, '')
    assert.equal(bodyOf((await saveNow(ctx))[0])?.content, '<p>Không có trình soạn</p>')
    ctx.close()

    const empty = await openEditor(t, '42')
    empty.tiny.editor.html = '  '
    assert.equal(empty.ai.props!.getEditorContent(), '<p>Nội dung gốc</p>')
  })

  it('"Chèn Ảnh Từ Thư Viện": several images, each inserted at the cursor in order', async (t) => {
    const ctx = await openEditor(t, '42')
    await click(button(ctx, 'Chèn Ảnh Từ Thư Viện'))
    const request = ctx.pickers.at(-1)!
    assert.equal(request.multiple, true)
    assert.equal(request.onSelect, undefined)
    request.onSelectMultiple!([{ url: '/uploads/a.jpg', originalName: 'a.jpg' }, { url: '/uploads/b.jpg', originalName: 'b.jpg' }])
    assert.deepEqual(ctx.tiny.editor.inserted, ['<p><img src="/uploads/a.jpg" alt="a.jpg" /></p>', '<p><img src="/uploads/b.jpg" alt="b.jpg" /></p>'])
  })

  it('without an editor, a chosen image is appended to the body that is saved', async (t) => {
    const ctx = await openEditor(t, '42', { tinymceLoaded: false })
    await click(button(ctx, 'Chèn Ảnh Từ Thư Viện'))
    ctx.pickers.at(-1)!.onSelectMultiple!([{ url: '/uploads/a.jpg', originalName: 'a.jpg' }])
    assert.equal(bodyOf((await saveNow(ctx))[0])?.content, '<p>Nội dung gốc</p>\n<p><img src="/uploads/a.jpg" alt="a.jpg" /></p>')
  })

  it('thumbnail from the library; ✕ removes it', async (t) => {
    const ctx = await openEditor(t, 'new')
    assert.equal(shown(thumbnail(ctx)), false)
    await click(button(ctx, 'Chọn từ thư viện'))
    const request = ctx.pickers.at(-1)!
    assert.equal(request.multiple, undefined)
    request.onSelect!({ url: '/uploads/dai-dien.jpg', originalName: 'dai-dien.jpg' })
    await ctx.settle()
    assert.equal(thumbnail(ctx)?.props.src, '/uploads/dai-dien.jpg')
    assert.ok(button(ctx, 'Đổi từ thư viện'))
    await click(removeThumbnail(ctx))
    assert.equal(shown(thumbnail(ctx)), false)
  })

  it('thumbnail upload: the file goes up, the control is off meanwhile, the URL lands, the input is cleared; a failed upload keeps the old one', async (t) => {
    const ctx = await openEditor(t, '42')
    const file = { name: 'anh.png' }
    const target = { files: [file], value: 'C:\\fakepath\\anh.png' }
    const done = fire(fileInput(ctx), 'change', { target })
    await ctx.settle()
    assert.deepEqual(ctx.uploads.map(u => u.file), [file])
    const label = all(ctx, el => el.tag === 'label' && textOf(el).includes('Đang tải...'))[0]!
    assert.match(classOf(label), /opacity-60 cursor-not-allowed pointer-events-none/)
    assert.equal(isDisabled(fileInput(ctx)), true)
    ctx.uploads[0]!.answer({ url: '/uploads/moi.jpg' })
    await done
    await ctx.settle()
    assert.equal(thumbnail(ctx)?.props.src, '/uploads/moi.jpg')
    assert.equal(target.value, '')
    assert.ok(all(ctx, el => el.tag === 'label' && textOf(el) === 'Upload ảnh').length === 1)

    const again = { files: [{ name: 'hong.png' }], value: 'C:\\fakepath\\hong.png' }
    const failed = fire(fileInput(ctx), 'change', { target: again })
    await ctx.settle()
    ctx.uploads[1]!.answer(null)
    await failed
    await ctx.settle()
    assert.equal(thumbnail(ctx)?.props.src, '/uploads/moi.jpg')
    assert.equal(again.value, '')
    const none = { files: [], value: '' }
    await fire(fileInput(ctx), 'change', { target: none })
    assert.equal(ctx.uploads.length, 2)
  })
})

describe('article editor — unsaved changes', () => {
  it('nothing changed: leaving asks nothing, the tab warns about nothing', async (t) => {
    const ctx = await openEditor(t, '42')
    assert.equal(await ctx.leave(), true)
    assert.equal(ctx.beforeUnload(), false)
    assert.deepEqual(ctx.confirms, [])
  })

  for (const [what, edit] of [
    ['the title', (ctx: Editor) => input(titleInput(ctx), 'Khác')],
    ['the excerpt', (ctx: Editor) => input(excerptInput(ctx), 'Khác')],
    ['the status', (ctx: Editor) => input(selectOf(ctx, 'Trạng thái'), 'published')],
    ['the category', (ctx: Editor) => input(selectOf(ctx, 'Danh mục'), 20)],
    ['the thumbnail', (ctx: Editor) => click(removeThumbnail(ctx))],
    ['the body in the editor', async (ctx: Editor) => { ctx.tiny.editor.html = '<p>Sửa trong trình soạn</p>' }],
  ] as const) {
    it(`${what} changed: leaving asks with the exact text, "Ở lại" keeps the page; the tab warns`, async (t) => {
      const ctx = await openEditor(t, '42')
      await edit(ctx)
      ctx.answers.confirm = false
      assert.equal(await ctx.leave(), false)
      assert.deepEqual(ctx.confirms, [LEAVE_PROMPT])
      assert.equal(ctx.beforeUnload(), true)
      ctx.answers.confirm = true
      assert.equal(await ctx.leave(), true)
    })
  }

  it('a body the editor rewrote on load is not a change (the baseline is what TinyMCE serialises)', async (t) => {
    const ctx = await openEditor(t, '42', { normalize: html => `${html}\n` })
    assert.equal(ctx.tiny.editor.html, '<p>Nội dung gốc</p>\n')
    assert.equal(await ctx.leave(), true)
    assert.deepEqual(ctx.confirms, [])
  })

  it('after a successful save nothing is pending; after a refused one the change still is', async (t) => {
    let answer: () => Response | Error = () => h3Error(400, 'Không lưu được.')
    const ctx = await openEditor(t, '42', { responder: server({ 'PUT /api/admin/articles/42': () => answer() }) })
    await input(titleInput(ctx), 'Khác')
    ctx.tiny.editor.html = '<p>Thân mới</p>'
    await saveNow(ctx)
    assert.equal(ctx.beforeUnload(), true)
    answer = () => json({ ok: true })
    await saveNow(ctx)
    assert.equal(ctx.beforeUnload(), false)
    assert.equal(await ctx.leave(), true)
    assert.deepEqual(ctx.confirms, [])
  })

  it('unmount: the beforeunload listener goes and the editor is destroyed', async (t) => {
    const ctx = await openEditor(t, '42')
    assert.equal(ctx.listeners.get('beforeunload')?.size, 1)
    ctx.close()
    assert.equal(ctx.listeners.get('beforeunload')?.size, 0)
    assert.deepEqual(ctx.tiny.log, ['init', 'destroy'])
  })
})
