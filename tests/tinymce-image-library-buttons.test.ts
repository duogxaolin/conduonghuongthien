import assert from 'node:assert/strict'
import test from 'node:test'
import {
  IMAGE_CAPTION_EDITOR_STYLE,
  IMAGE_EDIT_BUTTON,
  IMAGE_LIBRARY_BUTTON,
  captionText,
  figureCaptionAlt,
  insertLibraryImages,
  isImageSelection,
  libraryImageHtml,
  registerImageLibraryButtons,
  stepOutOfFigure,
} from '../app/utils/tinymce-image-picker.ts'
import { registerVideoLibraryButton } from '../app/utils/tinymce-video-picker.ts'
import type { AdminMediaItem } from '../app/types/admin-api.ts'
import type { MediaItem } from '../app/types/media.ts'
import type { TinyMceAstNode, TinyMceDomNode, TinyMceEditorInstance } from '../app/types/tinymce.ts'

/**
 * "Chèn ảnh" in both TinyMCE editors opens the media library at once (TinyMCE's own "Insert/edit image" opened a
 * dialog asking for a URL), the image goes in as a full-width picture WITH ITS CAPTION BOX (the caret lands in it),
 * and the picture's alt text follows the caption. Editing an image is a labelled "Sửa ảnh" button that is on only
 * while an image is selected — a captioned one is selected as its `<figure>`, not its `<img>`. The real TinyMCE
 * (toolbar, Insert menu, quick bars, dialog, typing a caption, the serializer) is checked in a browser:
 * tests/e2e/admin-editor-image-buttons.spec.ts. The init options of both editors are pinned in
 * tests/admin-article-editor.test.ts and tests/editor-video-button-permission.test.ts.
 *
 * The editor double below is deliberately as lazy as the real one: its `serializer` does not exist until `PreInit`
 * fires (TinyMCE runs `setup` from the editor's constructor, before it makes the serializer — a filter added in
 * `setup` was lost, and a double that already had a serializer then, hid it).
 */

const media = (extra: Partial<MediaItem> = {}): MediaItem => ({
  id: 7, filename: 'a.webp', originalName: 'Ảnh lễ trao quyết định.webp', mimeType: 'image/webp', sizeBytes: 10, provider: 'local',
  url: '/uploads/2026/11/a.webp', ...extra,
})

const FIGURE = '<figure class="image" style="width: 100%;"><img src="/uploads/2026/11/a.webp" alt="" style="width: 100%; height: auto;"><figcaption></figcaption></figure>'

// ─── A tiny DOM, as far as the editor code reads it ───────────────────────────────────────────────

type Dom = TinyMceDomNode & { attrs: Map<string, string>, kids: Dom[], parent?: Dom, value?: string, tag: string }
function el(tag: string, kids: Dom[] = [], attrs: Record<string, string> = {}): Dom {
  const node: Dom = {
    tag, nodeName: tag.toUpperCase(), nodeType: 1, kids, attrs: new Map(Object.entries(attrs)),
    get className() { return node.attrs.get('class') ?? '' },
    get childNodes() { return node.kids },
    getAttribute: name => node.attrs.get(name) ?? null,
    setAttribute: (name, value) => { node.attrs.set(name, value) },
    removeAttribute: (name) => { node.attrs.delete(name) },
    closest: (selector) => {
      for (let current: Dom | undefined = node; current; current = current.parent) {
        if (selector === 'figure.image' && current.tag === 'figure' && /(^|\s)image(\s|$)/.test(current.className)) return current
      }
      return null
    },
    querySelector: selector => all(node, selector)[0] ?? null,
    querySelectorAll: selector => all(node, selector),
  }
  kids.forEach((kid) => { kid.parent = node })
  return node
}
const txt = (value: string): Dom => ({ nodeName: '#text', nodeType: 3, nodeValue: value, value, tag: '#text', attrs: new Map(), kids: [] })
/** The selectors the editor code uses, evaluated against `Dom`: `:scope > x`, `a, b`, and `figure.image > figcaption`. */
function all(root: Dom, selector: string): Dom[] {
  const found: Dom[] = []
  const direct = (parent: Dom, names: string[]) => parent.kids.filter(kid => names.includes(kid.tag))
  for (const alternative of selector.split(',').map(part => part.trim())) {
    if (alternative === ':scope > figcaption') found.push(...direct(root, ['figcaption']))
    else if (alternative === ':scope > img') found.push(...direct(root, ['img']))
    else if (alternative === ':scope > a > img') for (const link of direct(root, ['a'])) found.push(...direct(link, ['img']))
    else if (alternative === 'figure.image > figcaption') {
      const walk = (node: Dom) => { for (const kid of node.kids) { if (kid.tag === 'figure' && /(^|\s)image(\s|$)/.test(kid.className)) found.push(...direct(kid, ['figcaption'])); walk(kid) } }
      walk(root)
    }
  }
  return found
}
function domFigure(captionWords = '', alt = '') {
  const image = el('img', [], { alt })
  const caption = el('figcaption', captionWords ? [txt(captionWords)] : [])
  const figure = el('figure', [image, caption], { class: 'image' })
  const setWords = (words: string) => { caption.kids = words ? [txt(words)] : []; caption.kids.forEach((kid) => { kid.parent = caption }) }
  return { figure, caption, image, setWords, alt: () => image.attrs.get('alt') }
}

// ─── A tree as the serializer walks it ────────────────────────────────────────────────────────────

type Ast = TinyMceAstNode & { attrs: Record<string, string>, kids: Ast[] }
function ast(name: string, kids: Ast[] = [], attrs: Record<string, string> = {}): Ast {
  const node = { name, type: 1, value: undefined, firstChild: kids[0] ?? null, next: null, attrs, kids } as unknown as Ast
  kids.forEach((kid, index) => { kid.next = kids[index + 1] ?? null })
  node.getAll = (wanted: string) => {
    const found: TinyMceAstNode[] = []
    const walk = (parent: Ast) => { for (const kid of parent.kids) { if (kid.name === wanted) found.push(kid); walk(kid) } }
    walk(node)
    return found
  }
  node.attr = (key: string, value?: string | null) => {
    if (value === undefined) return attrs[key]
    if (value === null) delete attrs[key]
    else attrs[key] = value
    return node
  }
  return node
}
const text = (value: string): Ast => ({ name: '#text', type: 3, value, firstChild: null, next: null, kids: [], attrs: {}, getAll: () => [], attr: () => undefined }) as unknown as Ast
const figureWith = (alt: string | undefined, ...caption: Ast[]) => {
  const image = ast('img', [], alt === undefined ? {} : { alt })
  return { figure: ast('figure', [image, ast('figcaption', caption)], { class: 'image' }), alt: () => image.attrs.alt as string | undefined }
}

// ─── The editor double ────────────────────────────────────────────────────────────────────────────

type Spec = { icon: string, text?: string, tooltip: string, onAction: () => void, onSetup?: (api: { setEnabled: (state: boolean) => void }) => () => void }
type Filters = { node: Array<{ name: string, handler: (nodes: TinyMceAstNode[]) => void }>, temp: string[] }
function fakeEditor(options: { serializerFromStart?: boolean } = {}) {
  const buttons = new Map<string, Spec>()
  const menuItems = new Map<string, { icon: string, text: string, onAction: () => void }>()
  const handlers = new Map<string, Set<() => void>>()
  const filters: Filters = { node: [], temp: [] }
  let serializerExists = options.serializerFromStart === true
  const state = {
    inserted: [] as string[],
    commands: [] as string[],
    log: [] as string[],
    cursorMoves: [] as Array<[TinyMceDomNode, number | undefined]>,
    node: { nodeName: 'P' } as TinyMceDomNode | null,
    /** What the selection is on once `insertContent` has run (TinyMCE selects the figure it inserted). */
    nodeAfterInsert: undefined as TinyMceDomNode | null | undefined,
    body: el('body'),
    /** Paragraphs the editor's DOM tool made and where they went. */
    madeParagraphs: [] as Dom[],
    insertedAfter: [] as Array<[TinyMceDomNode, TinyMceDomNode]>,
  }
  const editor = {
    on: (event: string, handler: () => void) => { (handlers.get(event) ?? handlers.set(event, new Set()).get(event)!).add(handler) },
    off: (event: string, handler: () => void) => { handlers.get(event)?.delete(handler) },
    insertContent: (html: string) => {
      state.inserted.push(html)
      state.log.push('insert')
      if (state.nodeAfterInsert !== undefined) state.node = state.nodeAfterInsert
    },
    execCommand: (name: string) => { state.commands.push(name) },
    getBody: () => state.body,
    dom: {
      create: (name: string) => { const node = el(name); state.madeParagraphs.push(node); return node },
      insertAfter: (node: TinyMceDomNode, reference: TinyMceDomNode) => { state.insertedAfter.push([node, reference]); state.log.push('insertAfter') },
    },
    selection: {
      getNode: () => state.node,
      setCursorLocation: (node: TinyMceDomNode, offset?: number) => { state.cursorMoves.push([node, offset]); state.log.push('cursor') },
    },
    get serializer() {
      if (!serializerExists) return undefined
      return {
        addNodeFilter: (name: string, handler: (nodes: TinyMceAstNode[]) => void) => { filters.node.push({ name, handler }) },
        addTempAttr: (name: string) => { filters.temp.push(name) },
      }
    },
    ui: { registry: { addButton: (name: string, spec: Spec) => { buttons.set(name, spec) }, addMenuItem: (name: string, spec: { icon: string, text: string, onAction: () => void }) => { menuItems.set(name, spec) } } },
  } as unknown as TinyMceEditorInstance
  const fire = (event: string) => handlers.get(event)?.forEach(handler => handler())
  /** What TinyMCE does: it makes the serializer, THEN fires `PreInit`. */
  const preInit = () => { serializerExists = true; fire('PreInit') }
  return { editor, buttons, menuItems, handlers, filters, state, preInit, nodeChange: () => fire('NodeChange'), typed: () => fire('input'), fire }
}

// ─── The inserted HTML ────────────────────────────────────────────────────────────────────────────

test('the library image is a captioned figure, the full width of the column, height following the picture, alt empty', () => {
  assert.equal(libraryImageHtml(media()), FIGURE)
})

test('a url that holds a quote or a tag cannot break out of the attribute', () => {
  const html = libraryImageHtml(media({ url: '/uploads/x.png?a=1&b="2<b>' }))
  assert.equal(html, '<figure class="image" style="width: 100%;"><img src="/uploads/x.png?a=1&amp;b=&quot;2&lt;b&gt;" alt="" style="width: 100%; height: auto;"><figcaption></figcaption></figure>')
  assert.equal(html.split('"').length - 1, 10, 'only the five attributes\' own quotes are raw — every quote in the url is escaped')
})

test('the file name is no longer the alt text: it was never a description, and the caption is', () => {
  assert.doesNotMatch(libraryImageHtml(media({ originalName: 'IMG_2231.JPG' })), /IMG_2231/)
})

// ─── The entries ──────────────────────────────────────────────────────────────────────────────────

test('the insert button, the Insert menu item and the quick-bar entry are one action: the library opens, the choice goes in at the caret', () => {
  const { editor, buttons, menuItems, state } = fakeEditor()
  const asked: Array<(m: MediaItem) => void> = []
  registerImageLibraryButtons(editor, onPick => asked.push(onPick))

  assert.deepEqual([...buttons.keys()], [IMAGE_LIBRARY_BUTTON, IMAGE_EDIT_BUTTON])
  assert.deepEqual([...menuItems.keys()], [IMAGE_LIBRARY_BUTTON])
  assert.match(buttons.get(IMAGE_LIBRARY_BUTTON)!.tooltip, /thư viện/)

  for (const open of [buttons.get(IMAGE_LIBRARY_BUTTON)!.onAction, menuItems.get(IMAGE_LIBRARY_BUTTON)!.onAction]) {
    open()
    assert.deepEqual(state.inserted, [], 'nothing is inserted until the officer chooses')
  }
  assert.equal(asked.length, 2, 'each entry opened the library — not a dialog asking for a URL')

  asked[0]!(media())
  assert.deepEqual(state.inserted, [FIGURE], 'a block figure, not wrapped in a paragraph')
  assert.deepEqual(state.commands, [], 'TinyMCE\'s image dialog is not opened for an insertion')
})

test('"Sửa ảnh" is labelled, opens the image dialog, and is on while an image — bare or captioned — is selected', () => {
  const { editor, buttons, state, nodeChange } = fakeEditor()
  registerImageLibraryButtons(editor, () => {})
  const edit = buttons.get(IMAGE_EDIT_BUTTON)!
  assert.equal(edit.text, 'Sửa ảnh', 'a visible label, not an icon alone')

  const enabled: boolean[] = []
  edit.onSetup!({ setEnabled: value => enabled.push(value) })
  assert.deepEqual(enabled, [false], 'a paragraph is selected when the toolbar is drawn')

  const moves: Array<[TinyMceDomNode | null, boolean]> = [
    [{ nodeName: 'IMG' }, true],
    [{ nodeName: 'P' }, false],
    [{ nodeName: 'FIGURE', className: 'image' }, true], // clicking the picture of a captioned image
    [{ nodeName: 'FIGCAPTION' }, false], // the caret is in the caption's text
    [{ nodeName: 'FIGURE', className: 'table-figure' }, false], // some other figure
    [null, false],
  ]
  for (const [node, expected] of moves) {
    state.node = node
    nodeChange()
    assert.equal(enabled.at(-1), expected, JSON.stringify(node))
  }

  edit.onAction()
  assert.deepEqual(state.commands, ['mceImage'])
})

test('which node counts as "an image is selected"', () => {
  assert.equal(isImageSelection({ nodeName: 'IMG' }), true)
  assert.equal(isImageSelection({ nodeName: 'FIGURE', className: 'image' }), true)
  assert.equal(isImageSelection({ nodeName: 'FIGURE', className: 'align-left image' }), true)
  assert.equal(isImageSelection({ nodeName: 'FIGURE', className: 'images' }), false)
  assert.equal(isImageSelection({ nodeName: 'FIGURE' }), false)
  assert.equal(isImageSelection({ nodeName: 'FIGCAPTION' }), false)
  assert.equal(isImageSelection(null), false)
  assert.equal(isImageSelection(undefined), false)
})

test('the button stops following the selection when the toolbar lets it go', () => {
  const { editor, buttons, handlers } = fakeEditor()
  registerImageLibraryButtons(editor, () => {})
  const handlersBefore = handlers.get('NodeChange')?.size ?? 0
  const teardown = buttons.get(IMAGE_EDIT_BUTTON)!.onSetup!({ setEnabled: () => {} })
  assert.equal(handlers.get('NodeChange')?.size, handlersBefore + 1)
  teardown()
  assert.equal(handlers.get('NodeChange')?.size, handlersBefore, 'the button left no handler on the editor')
})

test('an editor without a UI registry gets no buttons and no error', () => {
  assert.doesNotThrow(() => registerImageLibraryButtons({} as TinyMceEditorInstance, () => {}))
})

// ─── Inserting: where, and how many ───────────────────────────────────────────────────────────────

test('after ONE insertion the caret goes into the new caption, ready to type', () => {
  const { editor, state } = fakeEditor()
  const inserted = domFigure()
  state.nodeAfterInsert = inserted.figure
  insertLibraryImages(editor, [media()])
  assert.deepEqual(state.inserted, [FIGURE])
  assert.deepEqual(state.cursorMoves, [[inserted.caption, 0]])
})

test('SEVERAL images go in as ONE insertion (TinyMCE selects the figure it just wrote, so a second insertion replaces it)', () => {
  const { editor, state } = fakeEditor()
  state.nodeAfterInsert = domFigure().figure
  insertLibraryImages(editor, [media({ url: '/a.png' }), media({ url: '/b.png' }), media({ url: '/c.png' })])
  assert.equal(state.inserted.length, 1)
  assert.equal(state.inserted[0], ['/a.png', '/b.png', '/c.png'].map(url => libraryImageHtml({ url })).join(''))
  assert.deepEqual(state.cursorMoves, [], 'no one caption to fill: the caret stays')
  insertLibraryImages(editor, [])
  assert.equal(state.inserted.length, 1, 'an empty choice inserts nothing')
})

test('if the selection is not on the inserted figure, the caret is left alone (and nothing throws)', () => {
  for (const after of [{ nodeName: 'P' }, null]) {
    const { editor, state } = fakeEditor()
    state.nodeAfterInsert = after
    assert.doesNotThrow(() => insertLibraryImages(editor, [media()]))
    assert.deepEqual(state.cursorMoves, [])
  }
})

test('with the caret in a caption, or a picture selected, an insertion goes AFTER that figure, in a new paragraph', () => {
  for (const where of ['caption', 'figure'] as const) {
    const { editor, state } = fakeEditor()
    const existing = domFigure('Ảnh có sẵn')
    state.node = where === 'caption' ? existing.caption : existing.figure
    const fresh = domFigure()
    state.nodeAfterInsert = fresh.figure // TinyMCE selects the figure it wrote
    insertLibraryImages(editor, [media()])
    assert.deepEqual(state.log, ['insertAfter', 'cursor', 'insert', 'cursor'], `${where}: step out, insert, then the caret into the NEW caption`)
    assert.equal(state.insertedAfter[0]![1], existing.figure, `${where}: the new paragraph follows the figure, not the caption`)
    assert.deepEqual(state.cursorMoves[0], [state.madeParagraphs[0], 0], `${where}: the caret is in that paragraph, so the insertion replaces it and cannot nest`)
    assert.deepEqual(state.cursorMoves[1], [fresh.caption, 0], `${where}: and ends in the new caption, not the old one`)
  }
})

test('outside a figure nothing is stepped out of', () => {
  for (const node of [{ nodeName: 'P', closest: () => null }, { nodeName: 'P' }, null]) {
    const { editor, state } = fakeEditor()
    state.node = node
    stepOutOfFigure(editor)
    assert.deepEqual(state.log, [])
  }
})

test('a video from the library also never goes into a caption', () => {
  const { editor, buttons, state } = fakeEditor()
  const existing = domFigure('Ảnh')
  state.node = existing.caption
  state.nodeAfterInsert = null
  const video = { shortId: 'Ab3_x-9Qz1k', title: 'Lễ trao quyết định', source: 'upload', youtubeVideoId: null, status: 'published', processingStatus: 'ready' }
  registerVideoLibraryButton(editor, onPick => onPick(video as unknown as AdminMediaItem))
  buttons.get('cdktvideo')!.onAction()
  assert.equal(state.inserted.length, 1, 'the video was inserted')
  assert.match(state.inserted[0]!, /^<p><iframe /)
  assert.deepEqual(state.log, ['insertAfter', 'cursor', 'insert'], 'stepped out of the figure first')
  assert.equal(state.insertedAfter[0]![1], existing.figure)
})

// ─── Alt follows the caption — in the saved HTML ──────────────────────────────────────────────────

test('the serializer filter is added when `PreInit` fires — not in `setup`, where the serializer does not exist yet', () => {
  const { editor, filters, preInit } = fakeEditor()
  registerImageLibraryButtons(editor, () => {})
  assert.deepEqual(filters.node, [], 'nothing could be added: there is no serializer in `setup`')
  preInit()
  assert.deepEqual(filters.node.map(filter => filter.name), ['figure'])
  assert.equal(filters.node[0]!.handler, figureCaptionAlt)
  assert.deepEqual(filters.temp, ['data-mce-empty'], 'the hint\'s mark is a TEMP attribute: in the DOM, never in the saved HTML')
})

test('a serializer that is already there is used at once', () => {
  const { editor, filters } = fakeEditor({ serializerFromStart: true })
  registerImageLibraryButtons(editor, () => {})
  assert.deepEqual(filters.node.map(filter => filter.name), ['figure'])
})

test('in the saved HTML the picture\'s alt is the caption\'s words — whatever put the caption there', () => {
  const typed = figureWith('', text('Cán bộ trao quà'))
  const older = figureWith('IMG_2231.jpg', text('Chú thích mới'))
  const noAlt = figureWith(undefined, text('Chưa có alt'))
  figureCaptionAlt([typed.figure, older.figure, noAlt.figure])
  assert.equal(typed.alt(), 'Cán bộ trao quà')
  assert.equal(older.alt(), 'Chú thích mới', 'an old alt is replaced by the caption: the caption is the rule')
  assert.equal(noAlt.alt(), 'Chưa có alt')
})

test('the caption is read as words: markup gone, &nbsp; and runs of white space one space, a line break a space', () => {
  const mixed = figureWith('', text('  Hai  chữ  '), ast('em', [text('nghiêng')]), text(' và '), ast('strong', [text('đậm')]), text('\n  cuối '))
  figureCaptionAlt([mixed.figure])
  assert.equal(mixed.alt(), 'Hai chữ nghiêng và đậm cuối')
  const twoLines = figureWith('', text('Dòng 1'), ast('br'), text('Dòng 2'))
  figureCaptionAlt([twoLines.figure])
  assert.equal(twoLines.alt(), 'Dòng 1 Dòng 2', 'two lines do not run together')
  assert.equal(captionText(' a  b\n c '), 'a b c')
})

test('an empty caption leaves alt as it was: a new image stays "", an old figure keeps its own', () => {
  const fresh = figureWith('')
  const blanks = figureWith('giữ nguyên', text('   \n'), ast('br'))
  const old = figureWith('mô tả cũ')
  figureCaptionAlt([fresh.figure, blanks.figure, old.figure])
  assert.deepEqual([fresh.alt(), blanks.alt(), old.alt()], ['', 'giữ nguyên', 'mô tả cũ'])
})

test('only a figure.image\'s OWN picture and caption count: other figures, nested figures and a picture in a caption are left alone', () => {
  const table = figureWith('bảng', text('không phải ảnh'))
  table.figure.attrs.class = 'table'
  const noClass = figureWith('x', text('không lớp'))
  delete noClass.figure.attrs.class

  const innerImage = ast('img', [], { alt: 'trong' })
  const inner = ast('figure', [innerImage, ast('figcaption', [text('trong cap')])], { class: 'image' })
  const outer = ast('figure', [ast('figcaption', [text('ngoài'), inner])], { class: 'image' })

  const inCaption = ast('img', [], { alt: 'nằm trong chú thích' })
  const own = ast('img', [], { alt: '' })
  const withPictureInCaption = ast('figure', [own, ast('figcaption', [text('Chữ'), inCaption])], { class: 'image' })

  figureCaptionAlt([table.figure, noClass.figure, outer, inner, withPictureInCaption])
  assert.equal(table.alt(), 'bảng')
  assert.equal(noClass.alt(), 'x')
  assert.equal(innerImage.attrs.alt, 'trong cap', 'the inner figure follows its OWN caption')
  assert.equal(own.attrs.alt, 'Chữ', 'the figure\'s own picture')
  assert.equal(inCaption.attrs.alt, 'nằm trong chú thích', 'a picture inside a caption is not the figure\'s picture')
})

test('a picture wrapped in its link is still the figure\'s picture', () => {
  const image = ast('img', [], { alt: 'cũ' })
  const linked = ast('figure', [ast('a', [image], { href: '/lien-ket' }), ast('figcaption', [text('Có liên kết')])], { class: 'image' })
  figureCaptionAlt([linked])
  assert.equal(image.attrs.alt, 'Có liên kết')
})

test('a figure without a picture or without a caption is skipped without error', () => {
  const noCaption = ast('figure', [ast('img', [], { alt: 'a' })], { class: 'image' })
  const noImage = ast('figure', [ast('figcaption', [text('x')])], { class: 'image' })
  assert.doesNotThrow(() => figureCaptionAlt([noCaption, noImage]))
  assert.equal(noCaption.getAll('img')[0]!.attr('alt'), 'a')
})

// ─── Alt follows the caption — in the live DOM while typing ───────────────────────────────────────

test('typing in a caption moves the live alt, so the image dialog shows the current words', () => {
  const { editor, state, typed } = fakeEditor()
  registerImageLibraryButtons(editor, () => {})
  const live = domFigure('Cán bộ trao quà', '')
  state.node = live.caption
  typed()
  assert.equal(live.alt(), 'Cán bộ trao quà')

  live.setWords('  Cán bộ trao quà   cho dân ')
  typed()
  assert.equal(live.alt(), 'Cán bộ trao quà cho dân', 'the normalised words')

  live.caption.kids = [txt('Dòng 1'), el('br'), txt('Dòng 2')]
  typed()
  assert.equal(live.alt(), 'Dòng 1 Dòng 2')
})

test('emptying a caption puts back the alt the picture had before the first key — "" for a new one, the old alt for an old one', () => {
  const { editor, state, typed } = fakeEditor()
  registerImageLibraryButtons(editor, () => {})

  const fresh = domFigure('Ô', '')
  state.node = fresh.caption
  typed()
  assert.equal(fresh.alt(), 'Ô')
  fresh.setWords('')
  typed()
  assert.equal(fresh.alt(), '', 'typing then deleting leaves no stray "Ô"')

  // An old figure: a description, and a caption with no words. Typing replaces the alt; deleting must bring it BACK.
  const old = domFigure('', 'Mô tả có sẵn')
  state.node = old.caption
  typed()
  assert.equal(old.alt(), 'Mô tả có sẵn', 'a loaded empty caption blanks nothing')
  old.setWords('x')
  typed()
  assert.equal(old.alt(), 'x')
  old.setWords('xy')
  typed()
  old.setWords('')
  typed()
  assert.equal(old.alt(), 'Mô tả có sẵn', 'typed then deleted: the alt it had comes back, not ""')

  // What the officer set in the image dialog since the last key is not ours to undo.
  const edited = domFigure('Chữ', '')
  state.node = edited.caption
  typed()
  edited.image.attrs.set('alt', 'đặt trong hộp thoại')
  edited.setWords('')
  typed()
  assert.equal(edited.alt(), 'đặt trong hộp thoại')
})

test('typing outside a figure writes nothing anywhere', () => {
  const { editor, state, typed } = fakeEditor()
  registerImageLibraryButtons(editor, () => {})
  const writes: string[] = []
  const paragraph: TinyMceDomNode = { nodeName: 'P', closest: () => null, setAttribute: (name) => { writes.push(`P ${name}`) }, removeAttribute: (name) => { writes.push(`P -${name}`) } }
  for (const node of [paragraph, null, { nodeName: 'FIGCAPTION' }]) {
    state.node = node
    assert.doesNotThrow(() => typed())
  }
  assert.deepEqual(writes, [])
})

test('registering writes nothing: the editor loading, or content being set, does not move any alt', () => {
  const { editor, state, fire, preInit } = fakeEditor()
  const loaded = domFigure('Chú thích', 'alt khác')
  state.body.kids = [loaded.figure]
  loaded.figure.parent = state.body
  registerImageLibraryButtons(editor, () => {})
  preInit()
  fire('SetContent')
  fire('NodeChange')
  assert.equal(loaded.alt(), 'alt khác', 'the saved HTML gets the caption as alt through the serializer, not by rewriting the live DOM')
})

// ─── What the officer sees in an empty caption ────────────────────────────────────────────────────

test('the hint follows the caption\'s words: marked when there are none (even with a bogus <br>), unmarked once there are', () => {
  const { editor, state, fire } = fakeEditor()
  registerImageLibraryButtons(editor, () => {})
  const none = domFigure('')
  const withBr = domFigure('')
  withBr.caption.kids = [el('br')]
  const words = domFigure('abc')
  const wordsAndBr = domFigure('')
  wordsAndBr.caption.kids = [txt('abc'), el('br')]
  state.body.kids = [none.figure, withBr.figure, words.figure, wordsAndBr.figure]
  for (const figure of state.body.kids) figure.parent = state.body

  fire('NodeChange')
  const marked = (f: ReturnType<typeof domFigure>) => f.caption.attrs.has('data-mce-empty')
  assert.deepEqual([none, withBr, words, wordsAndBr].map(marked), [true, true, false, false])

  words.setWords('')
  fire('input')
  none.setWords('xin chào')
  fire('SetContent')
  assert.deepEqual([none, words].map(marked), [false, true])
})

test('an empty caption shows a hint in the editor only: two separate rules, no attribute of the saved HTML, no hex', () => {
  const rules = IMAGE_CAPTION_EDITOR_STYLE.match(/figure\.image figcaption[^{]*\{[^}]*\}/g) ?? []
  assert.equal(rules.length, 2)
  assert.match(rules[0]!, /^figure\.image figcaption:empty::before \{/)
  assert.match(rules[1]!, /^figure\.image figcaption\[data-mce-empty\]::before \{/)
  for (const rule of rules) assert.match(rule, /content: 'Nhập chú thích ảnh/)
  assert.doesNotMatch(IMAGE_CAPTION_EDITOR_STYLE, /data-placeholder/, 'an attribute would be serialised into the saved HTML')
  assert.doesNotMatch(IMAGE_CAPTION_EDITOR_STYLE, /:has\(/, ':has also matches a caption with words and a line break')
  assert.doesNotMatch(IMAGE_CAPTION_EDITOR_STYLE, /#[0-9a-fA-F]{3,8}\b/, 'colour by name, not hex')
})

test('both editors keep the caption options that the alt rule depends on', async () => {
  const { readFile } = await import('node:fs/promises')
  for (const file of ['../app/composables/useArticleEditorTinymce.ts', '../app/components/admin/TinyMceEditor.vue']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8')
    assert.match(source, /entity_encoding: 'raw'/, `${file}: without it a typed caption reaches \`alt\` as \`C&aacute;n\`, which the sanitizer double-escapes`)
    assert.match(source, /image_caption: true/, `${file}: the image dialog's "Show caption"`)
    assert.match(source, /IMAGE_CAPTION_EDITOR_STYLE/, `${file}: the hint in an empty caption`)
  }
})

test('the Page Builder editor emits only when what the editor reads back really changed (a key that changes nothing is not an edit)', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('../app/components/admin/TinyMceEditor.vue', import.meta.url), 'utf8')
  assert.match(source, /ed\.on\('init', \(\) => \{ ed\.setContent\(props\.modelValue \|\| ''\); lastEmitted = ed\.getContent\(\) \}\)/)
  assert.match(source, /if \(html === lastEmitted\) return/)
  assert.match(source, /lastEmitted = editor\.getContent\(\)/, 'a model change from outside moves the baseline too')
})

test('a picture is never shown wider than its own file: figure and image carry max-width = the file width; an unknown size keeps the old style', () => {
  const html = libraryImageHtml({ url: '/uploads/a.webp', width: 420 })
  assert.equal(html, '<figure class="image" style="width: 100%; max-width: 420px;"><img src="/uploads/a.webp" alt="" style="width: 100%; max-width: 420px; height: auto;"><figcaption></figcaption></figure>')
  assert.equal(libraryImageHtml({ url: '/uploads/a.webp', width: 1234.6 }).includes('max-width: 1235px'), true, 'a fractional width is rounded')
  for (const width of [null, undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.doesNotMatch(libraryImageHtml({ url: '/uploads/a.webp', width }), /max-width/, `width ${String(width)}: no cap`)
  }
})
