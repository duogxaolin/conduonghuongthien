/**
 * Wave 3 D-FETCH, batch D: the article editor — `pages/admin/content/articles/[id].vue` (6 `$fetch`
 * casts) — calls `adminFetch<T>()` with response types derived from the handlers
 * (app/types/admin-articles-api.ts, admin-taxonomy-api.ts). Only the casts change in the file's
 * TinyMCE set-up (one expression in `images_upload_handler`); nothing is split.
 *
 * The REAL page — `<script setup>` and template — is mounted (tests/_admin-page-harness.ts) over
 * REAL ofetch on a fake network. TinyMCE is a stand-in on `window.tinymce` that records its config
 * and runs `setup`/`init` as the editor does; the four child components are stubs (the translation
 * panel exposes what the page reads from it). Pinned, green before and after the conversion:
 *   - the mount's reads in order (the default type's categories, the content types, the article,
 *     the article type's categories) and the form they fill;
 *   - "Cập Nhật Bài Viết" PUTs the form with the editor's HTML; "Đăng Bài Mới" POSTs it, starts the
 *     chosen auto-translations, then goes to the new article;
 *   - the editor's image upload POSTs the file and hands TinyMCE the URL, or the server's sentence;
 *   - a refused save says the server's sentence; a failed load is a `role="alert"` with "Thử lại".
 *
 * FINDINGS, RED on the base (fb4751c1):
 *   - "Thử lại" after a successful retry: the article loaded but the red banner stayed —
 *     `fetchArticle` never cleared `errorMsg`;
 *   - a refused SAVE landed in the same banner as a failed load, with the same "Thử lại" — which
 *     reloads the article: one click threw away everything typed since the last save, and the
 *     editor showed the stored text again. A save error now offers no reload (the save button is
 *     the retry) and the typing stays;
 *   - after a failed load the editor grid stays on screen with an EMPTY form and an enabled
 *     "Cập Nhật Bài Viết": type a title, save, and the PUT replaced the stored article's body,
 *     excerpt, thumbnail and category with blanks. Saving is refused until the article is loaded;
 *   - switching "Thể loại bài viết" twice on a slow connection: the first type's categories landing
 *     last filled the "Danh mục" select under the second type. Only the latest request writes now.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import * as Vue from 'vue'

import { byText, click, findAll, fire, input, textOf } from './_sfc-mount.ts'
import {
  alertText, alerts, dropped, h3Error, json, mountAdminPage, OFETCH_LINE, OpenModal, routes, sent, settle, Stub, unmountAll, wire,
  type MountedAdminPage, type NetCall, type Responder,
} from './_admin-page-harness.ts'

afterEach(unmountAll)

type Route = (call: NetCall) => Response | Error | undefined

const PAGE = 'pages/admin/content/articles/[id].vue'
const STAMP = '2026-10-20T02:00:00.000Z'
const ARTICLE = {
  id: 42, title: 'Bài gốc', slug: 'bai-goc', type: 'role_model', category: '', categoryId: 21, excerpt: 'Tóm tắt gốc',
  content: '<p>Nội dung gốc</p>', thumbnailUrl: '/uploads/goc.jpg', status: 'draft', authorId: 1, publishedAt: null,
  createdAt: STAMP, updatedAt: STAMP, commentsEnabled: false,
}
const cats = (type: string) => [
  { id: type === 'news' ? 10 : 20, name: `Gốc ${type}`, slug: `goc-${type}`, parentId: null, type, description: null, displayOrder: 0, createdAt: STAMP, parentName: null },
  { id: type === 'news' ? 11 : 21, name: `Con ${type}`, slug: `con-${type}`, parentId: type === 'news' ? 10 : 20, type, description: null, displayOrder: 0, createdAt: STAMP, parentName: null },
]
const TYPES = [
  { id: 1, name: 'Tin tức', slug: 'news', icon: 'fa-solid fa-newspaper', description: null, displayOrder: 1, isSystem: true, createdAt: STAMP, categoryCount: 2, articleCount: 4 },
  { id: 2, name: 'Tấm gương', slug: 'role_model', icon: 'fa-solid fa-star', description: null, displayOrder: 2, isSystem: true, createdAt: STAMP, categoryCount: 2, articleCount: 1 },
]

function server(overrides: Record<string, Route> = {}): Responder {
  return routes({
    'GET /api/admin/categories': call => json({ ok: true, items: cats(call.url.searchParams.get('type') ?? '') }),
    'GET /api/admin/content-types': () => json({ ok: true, items: TYPES }),
    'GET /api/admin/articles/42': () => json({ ok: true, article: ARTICLE }),
    'PUT /api/admin/articles/42': () => json({ ok: true }),
    'POST /api/admin/articles': () => json({ ok: true, id: 99, slug: 'bai-moi' }),
    'POST /api/admin/articles/99/translations/translate': () => json({ ok: true, message: 'Đã bắt đầu dịch. Vui lòng đợi.' }),
    'POST /api/admin/media/upload': () => json({ ok: true, media: { id: 5, url: 'https://cdn.example/anh.webp' } }),
    ...overrides,
  })
}

/** TinyMCE as the page drives it: `init` runs `setup`, then the editor's `init` event. */
function fakeTinymce() {
  const handlers: Record<string, () => void> = {}
  const editor = {
    html: '',
    on(event: string, handler: () => void) { handlers[event] = handler },
    setContent(html: string) { editor.html = html },
    getContent() { return editor.html },
    insertContent(html: string) { editor.html += html },
    remove() {}, destroy() {},
  }
  let config: Record<string, unknown> | null = null
  const tinymce = {
    get: () => (config ? editor : undefined),
    init(options: Record<string, unknown>) {
      config = options
      ;(options.setup as (e: typeof editor) => void)(editor)
      handlers.init?.()
    },
  }
  return { tinymce, editor, config: () => config! }
}

/** The translation panel as far as the page reads it (`translationPanelRef`). */
const TranslationPanel = Vue.defineComponent({
  setup(_props, { expose }) {
    expose({ availableLanguages: [{ code: 'en', label: 'Tiếng Anh', flag: 'EN' }], translateAllForThisArticle: async () => {} })
    return () => null
  },
})

interface Opened extends MountedAdminPage { tiny: ReturnType<typeof fakeTinymce> }
/** Where `navigateTo` was asked to go (a Nuxt auto-import). */
const navigations: unknown[] = []

async function openEditor(id: string, responder = server()): Promise<Opened> {
  const tiny = fakeTinymce()
  const opened = await mountAdminPage(PAGE, responder, {
    route: { params: { id } },
    modules: {
      '~/components/admin/TinyMceEditor.vue': { default: Stub },
      '~/components/admin/AdminModal.vue': { default: OpenModal },
      '~/components/admin/articles/ArticleTranslationPanel.vue': { default: TranslationPanel },
      '~/components/admin/articles/ArticleAIPanel.vue': { default: Stub },
    },
    auto: {
      window: { tinymce: tiny.tinymce, addEventListener: () => {}, removeEventListener: () => {} },
      document: { createElement: () => ({}), head: { appendChild: () => {} }, getElementById: () => null },
      onBeforeRouteLeave: () => {},
      navigateTo: (to: unknown) => { navigations.push(to) },
      useImagePicker: () => ({ openPicker: () => {} }),
      useUpload: () => ({ uploading: Vue.ref(false), uploadFile: async () => null }),
    },
  })
  return Object.assign(opened, { tiny })
}

const titleInput = (opened: Opened) => findAll(opened.page.root, el => el.tag === 'input' && el.props.placeholder === 'Nhập tiêu đề hấp dẫn...')[0]
const saveButton = (opened: Opened, label: string) => byText(opened.page.root, 'button', label)
const selectOf = (opened: Opened, label: string) => {
  const field = findAll(opened.page.root, el => el.tag === 'div' && findAll(el, l => l.tag === 'label' && textOf(l).startsWith(label)).length === 1
    && findAll(el, s => s.tag === 'select').length === 1)
  return findAll(field.at(-1)!, el => el.tag === 'select')[0]!
}
/** The PUT lines sent since `from`. */
const puts = (opened: Opened, from: number) => opened.calls.slice(from).map(wire).filter(line => line.startsWith('PUT'))
const categoryOptions = (opened: Opened) => findAll(selectOf(opened, 'Danh mục'), el => el.tag === 'option').map(textOf)

describe(PAGE, () => {
  it('mount (edit): default type\'s categories, content types, the article, then its type\'s categories; the form is filled', async () => {
    const opened = await openEditor('42')
    assert.deepEqual(opened.calls.map(wire), [
      'GET /api/admin/categories?type=news',
      'GET /api/admin/content-types',
      'GET /api/admin/articles/42',
      'GET /api/admin/categories?type=role_model',
    ])
    assert.equal(titleInput(opened)?.model?.value, 'Bài gốc')
    assert.equal(selectOf(opened, 'Thể loại bài viết').model?.value, 'role_model')
    assert.equal(selectOf(opened, 'Danh mục').model?.value, 21)
    assert.deepEqual(categoryOptions(opened), ['— Không có danh mục —', 'Gốc role_model', '↳ Con role_model'])
    assert.equal(opened.tiny.editor.html, '<p>Nội dung gốc</p>')
    assert.equal(alertText(opened.page), '')
  })

  it('save (edit): PUT the form with the editor\'s HTML; toast', async () => {
    const opened = await openEditor('42')
    await input(titleInput(opened)!, 'Bài đã sửa')
    opened.tiny.editor.html = '<p>Nội dung mới</p>'
    const before = opened.calls.length
    await click(saveButton(opened, 'Cập Nhật Bài Viết'))
    await settle()
    assert.deepEqual(sent(opened.calls, before), [{
      wire: 'PUT /api/admin/articles/42',
      body: { title: 'Bài đã sửa', type: 'role_model', category: '', categoryId: 21, excerpt: 'Tóm tắt gốc', content: '<p>Nội dung mới</p>', thumbnailUrl: '/uploads/goc.jpg', status: 'draft' },
    }])
    assert.equal(opened.lastToast('success'), 'Đã cập nhật bài viết thành công!')
  })

  it('create: POST, the auto-translation per chosen language, then the new article\'s page', async () => {
    navigations.length = 0
    const opened = await openEditor('new')
    assert.deepEqual(opened.calls.map(wire), ['GET /api/admin/categories?type=news', 'GET /api/admin/content-types'])
    await input(titleInput(opened)!, 'Bài mới tinh')
    opened.tiny.editor.html = '<p>Thân bài</p>'
    const before = opened.calls.length
    await click(saveButton(opened, 'Đăng Bài Mới'))
    await settle()
    assert.deepEqual(sent(opened.calls, before), [
      { wire: 'POST /api/admin/articles', body: { title: 'Bài mới tinh', type: 'news', category: '', categoryId: null, excerpt: '', content: '<p>Thân bài</p>', thumbnailUrl: '', status: 'published' } },
      { wire: 'POST /api/admin/articles/99/translations/translate', body: { langCode: 'en' } },
    ])
    assert.deepEqual(opened.toasts.map(t => t.message), ['Tạo bài viết mới thành công!', 'Đã kích hoạt dịch tự động sang 1 ngôn ngữ trong nền!'])
    assert.deepEqual(navigations, ['/admin/content/articles/99'])
  })

  it('editor image upload: POST the file, hand TinyMCE the URL — or the server\'s sentence', async () => {
    const opened = await openEditor('42', server({
      'POST /api/admin/media/upload': call => ((call.body as FormData).get('file') as File).name === 'lon.png'
        ? h3Error(413, 'Ảnh vượt quá 10 MB.')
        : json({ ok: true, media: { id: 5, url: 'https://cdn.example/anh.webp' } }),
    }))
    const upload = opened.tiny.config().images_upload_handler as (info: { blob: () => Blob, filename: () => string }) => Promise<string>
    const before = opened.calls.length
    assert.equal(await upload({ blob: () => new Blob(['png']), filename: () => 'anh.png' }), 'https://cdn.example/anh.webp')
    assert.deepEqual(opened.calls.slice(before).map(wire), ['POST /api/admin/media/upload'])
    assert.equal(((opened.calls.at(-1)!.body as FormData).get('file') as File).name, 'anh.png')
    await assert.rejects(upload({ blob: () => new Blob(['png']), filename: () => 'lon.png' }), (reason: unknown) => reason === 'Ảnh vượt quá 10 MB.')
  })

  it('a refused save: the server\'s sentence in the banner and a toast', async () => {
    const opened = await openEditor('42', server({ 'PUT /api/admin/articles/42': () => h3Error(403, 'Forbidden: Không có quyền với thể loại mới này') }))
    await click(saveButton(opened, 'Cập Nhật Bài Viết'))
    await settle()
    assert.match(alertText(opened.page), /Forbidden: Không có quyền với thể loại mới này/)
    assert.equal(opened.lastToast('error'), 'Forbidden: Không có quyền với thể loại mới này')
    assert.doesNotMatch(alertText(opened.page), OFETCH_LINE)
  })

  it('FINDING: a save refused after editing — nothing in the banner reloads the article over the typing', async () => {
    const opened = await openEditor('42', server({ 'PUT /api/admin/articles/42': () => h3Error(400, 'Tiêu đề bài viết quá ngắn.') }))
    await input(titleInput(opened)!, 'Tiêu đề đang gõ dở')
    opened.tiny.editor.html = '<p>Hai trang đang viết</p>'
    await click(saveButton(opened, 'Cập Nhật Bài Viết'))
    await settle()
    const before = opened.calls.length
    for (const alert of alerts(opened.page)) for (const button of findAll(alert, el => el.tag === 'button')) await click(button)
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire).filter(line => line.startsWith('GET')), [], 'the banner reloaded the stored article')
    assert.equal(titleInput(opened)?.model?.value, 'Tiêu đề đang gõ dở')
    assert.equal(opened.tiny.editor.html, '<p>Hai trang đang viết</p>')
  })

  it('load failure: the server\'s sentence + "Thử lại"; FINDING: a successful retry clears the banner', async () => {
    let answer: () => Response | Error = () => h3Error(403, 'Bạn không có quyền xem bài viết này.')
    const opened = await openEditor('42', server({ 'GET /api/admin/articles/42': () => answer() }))
    assert.match(alertText(opened.page), /Bạn không có quyền xem bài viết này\./)
    answer = () => json({ ok: true, article: ARTICLE })
    const before = opened.calls.length
    await click(byText(opened.page.root, 'button', 'Thử lại'))
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), ['GET /api/admin/articles/42', 'GET /api/admin/categories?type=role_model'])
    assert.equal(titleInput(opened)?.model?.value, 'Bài gốc')
    assert.equal(opened.tiny.editor.html, '<p>Nội dung gốc</p>')
    assert.equal(alertText(opened.page), '', 'the article loaded but the banner still says it could not')

    const offline = await openEditor('42', server({ 'GET /api/admin/articles/42': () => dropped() }))
    assert.match(alertText(offline.page), /Lỗi tải bài viết/)
  })

  it('FINDING: after a failed load, saving cannot overwrite the stored article with the empty form', async () => {
    const opened = await openEditor('42', server({ 'GET /api/admin/articles/42': () => h3Error(503, 'Không đọc được cơ sở dữ liệu.') }))
    await input(titleInput(opened)!, 'Tiêu đề gõ vào biểu mẫu trống')
    const before = opened.calls.length
    const save = saveButton(opened, 'Cập Nhật Bài Viết')
    if (!save.props.disabled) await click(save)
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire).filter(line => line.startsWith('PUT')), [], 'a PUT of the empty form')
  })

  // Independent verification of batch D (PROBE-A): the first fix keyed both guards on `errorMsg`,
  // which `fetchArticle` clears BEFORE its await — so while "Thử lại" was in flight the button was
  // enabled again and the same PUT of the empty form went out (and published it). The guards now
  // key on a POSITIVE `loaded`: false from the start of every load until the form is filled.
  it('FINDING: failed load, title typed, "Thử lại" in flight — no PUT of the empty form', async () => {
    let reads = 0
    const opened = await openEditor('42', server({ 'GET /api/admin/articles/42': () => (++reads === 1 ? h3Error(403, 'Bạn không có quyền xem bài viết này.') : undefined) }))
    await input(titleInput(opened)!, 'Tiêu đề gõ vào biểu mẫu trống')
    void click(byText(opened.page.root, 'button', 'Thử lại'))
    await settle()
    assert.equal(reads, 2, 'the retry is in flight')
    const before = opened.calls.length
    const save = saveButton(opened, 'Cập Nhật Bài Viết')
    if (save.props.disabled !== true) await click(save)
    await settle()
    assert.deepEqual(puts(opened, before), [], 'a PUT of the empty form while the retry was pending')
  })

  it('guard 1, the button: disabled until the article is loaded — first load, failed load, retry in flight', async () => {
    const pending: NetCall[] = []
    const opened = await openEditor('42', server({ 'GET /api/admin/articles/42': (call) => { pending.push(call); return undefined } }))
    const disabled = () => saveButton(opened, 'Cập Nhật Bài Viết').props.disabled
    assert.equal(disabled(), true, 'first load in flight')
    pending[0]!.respond(h3Error(403, 'Bạn không có quyền xem bài viết này.'))
    await settle()
    assert.equal(disabled(), true, 'the load failed')
    void click(byText(opened.page.root, 'button', 'Thử lại'))
    await settle()
    assert.equal(disabled(), true, 'the retry is in flight')
    pending[1]!.respond(json({ ok: true, article: ARTICLE }))
    await settle()
    assert.equal(disabled(), false, 'loaded: saving is allowed')
  })

  it('guard 2, handleSave itself: a click that reaches it past the disabled button sends no PUT', async () => {
    let reads = 0
    const opened = await openEditor('42', server({ 'GET /api/admin/articles/42': () => (++reads === 1 ? h3Error(403, 'Bạn không có quyền xem bài viết này.') : undefined) }))
    await input(titleInput(opened)!, 'Tiêu đề gõ vào biểu mẫu trống')
    const before = opened.calls.length
    await fire(saveButton(opened, 'Cập Nhật Bài Viết'), 'click')
    await settle()
    assert.deepEqual(puts(opened, before), [], 'after the failed load')
    void click(byText(opened.page.root, 'button', 'Thử lại'))
    await settle()
    await fire(saveButton(opened, 'Cập Nhật Bài Viết'), 'click')
    await settle()
    assert.deepEqual(puts(opened, before), [], 'while the retry is in flight')
  })

  it('a refused save leaves the article loaded: the second click PUTs again and clears the banner', async () => {
    let answer: () => Response | Error = () => h3Error(400, 'Tiêu đề bài viết quá ngắn.')
    const opened = await openEditor('42', server({ 'PUT /api/admin/articles/42': () => answer() }))
    await click(saveButton(opened, 'Cập Nhật Bài Viết'))
    await settle()
    answer = () => json({ ok: true })
    const before = opened.calls.length
    await click(saveButton(opened, 'Cập Nhật Bài Viết'))
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), ['PUT /api/admin/articles/42'])
    assert.equal(alertText(opened.page), '')
  })

  it('a NEW article has nothing to load: it saves even when the content types and categories cannot be read', async () => {
    navigations.length = 0
    const opened = await openEditor('new', server({
      'GET /api/admin/categories': () => h3Error(403, 'Không có quyền.'),
      'GET /api/admin/content-types': () => h3Error(403, 'Không có quyền.'),
    }))
    assert.notEqual(saveButton(opened, 'Đăng Bài Mới').props.disabled, true)
    await input(titleInput(opened)!, 'Bài mới tinh')
    const before = opened.calls.length
    await click(saveButton(opened, 'Đăng Bài Mới'))
    await settle()
    assert.equal(opened.calls.slice(before).map(wire)[0], 'POST /api/admin/articles')
    assert.deepEqual(navigations, ['/admin/content/articles/99'])
  })

  it('FINDING: two type switches in flight — the first type\'s categories landing last do not fill the second', async () => {
    const pending: NetCall[] = []
    let mounted = false
    const opened = await openEditor('new', server({
      'GET /api/admin/categories': (call) => {
        const type = call.url.searchParams.get('type') ?? ''
        if (!mounted) return json({ ok: true, items: cats(type) })
        pending.push(call)
        return undefined
      },
    }))
    mounted = true
    await input(selectOf(opened, 'Thể loại bài viết'), 'role_model')
    await settle()
    await input(selectOf(opened, 'Thể loại bài viết'), 'news')
    await settle()
    assert.deepEqual(pending.map(call => call.url.searchParams.get('type')), ['role_model', 'news'])
    pending[1]!.respond(json({ ok: true, items: cats('news') }))
    await settle()
    pending[0]!.respond(json({ ok: true, items: cats('role_model') }))
    await settle()
    assert.deepEqual(categoryOptions(opened), ['— Không có danh mục —', 'Gốc news', '↳ Con news'], 'role_model categories under "Tin tức"')
  })
})
