/**
 * The "video from the library" toolbar button (`cdktvideo`) is registered only for an account that can read
 * the video library (`media_portal` read). Its list is `GET /api/admin/media-portal`, which refuses anyone
 * else (403) — before this, the button showed for every editor and opened a list that only said "forbidden".
 * TinyMCE leaves out a toolbar name nothing registered, so the toolbar string itself stays the same.
 *
 * Both TinyMCE init paths: the article editor (`useArticleEditorTinymce`, through the page) and the page
 * builder's `components/admin/TinyMceEditor.vue`. Also pinned here: TinyMCE's own Media dialog is gone from
 * both toolbars and from the article editor's Insert menu (it took any typed URL; the HTML filter keeps only
 * two frame shapes, so anything else vanished on save) — the plugin stays for frames already in a body.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { mountAdminPage, routes, unmountAll } from './_admin-page-harness.ts'
import { ARTICLE, json, openEditor, server } from './_article-editor-harness.ts'

afterEach(unmountAll)

const noVideoLibrary = (resource: string) => resource !== 'media_portal'
const article = () => server({ 'GET /api/admin/articles/42': () => json({ ok: true, article: ARTICLE }) })

describe('article editor — the video-library button follows media_portal read', () => {
  it('an account that can read the video library gets the button', async (t) => {
    const ctx = await openEditor(t, '42', { responder: article() })
    await ctx.settle()
    assert.deepEqual(ctx.tiny.editor.buttons, ['cdktimage', 'cdktimageedit', 'cdktvideo'])
  })

  it('an account that cannot read it does not', async (t) => {
    const ctx = await openEditor(t, '42', { responder: article(), can: noVideoLibrary })
    await ctx.settle()
    assert.equal(ctx.tiny.configs.length, 1, 'the editor still starts')
    assert.deepEqual(ctx.tiny.editor.buttons, ['cdktimage', 'cdktimageedit'], 'the image buttons stay; only the video one needs media_portal')
  })

  it("TinyMCE's own Media dialog is off the toolbar and the Insert menu; the plugin stays", async (t) => {
    const ctx = await openEditor(t, '42', { responder: article() })
    await ctx.settle()
    const config = ctx.tiny.configs[0]!
    assert.doesNotMatch(String(config.toolbar), /\bmedia\b/)
    assert.equal(config.removed_menuitems, 'media')
    assert.ok((config.plugins as string[]).includes('media'))
  })
})

describe('components/admin/TinyMceEditor.vue — the same rule', () => {
  type Config = { toolbar?: string, plugins?: string[], setup?: (editor: unknown) => void }
  async function buttonsFor(can?: (resource: string, action: string) => boolean) {
    let config: Config = {}
    await mountAdminPage('components/admin/TinyMceEditor.vue', routes({}), {
      can,
      auto: {
        useImagePicker: () => ({ openPicker: () => {} }),
        useVideoPicker: () => ({ openVideoPicker: () => {} }),
        window: { tinymce: { init: (given: Config) => { config = given } } },
      },
    })
    const buttons: string[] = []
    config.setup?.({ ui: { registry: { addButton: (name: string) => { buttons.push(name) } } }, on: () => {}, off: () => {}, selection: { getNode: () => null } })
    return { buttons, config }
  }

  it('registered for an account that can read the video library, not for one that cannot', async () => {
    assert.deepEqual((await buttonsFor()).buttons, ['cdktimage', 'cdktimageedit', 'cdktvideo'])
    assert.deepEqual((await buttonsFor(noVideoLibrary)).buttons, ['cdktimage', 'cdktimageedit'])
  })

  it("TinyMCE's own Media button is off the toolbar; the plugin stays", async () => {
    const { config } = await buttonsFor()
    assert.match(String(config.toolbar), /\bcdktvideo\b/)
    assert.doesNotMatch(String(config.toolbar), /\bmedia\b/)
    assert.ok(config.plugins?.includes('media'))
  })
})
