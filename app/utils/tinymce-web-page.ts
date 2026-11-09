import type { TinyMceEditorInstance } from '../types/tinymce'

/**
 * The article editor shows the article as the public page shows it (CHANGELOG § 108): a white "sheet" as wide as the
 * public text column (808 px — `lg:grid-cols-[minmax(0,820px)_320px]` of the article page) on a grey desk, in the
 * portal's own type (Inter 18 px, `ink` colour, line height 1.75) with the same rules for headings, quotes, pictures,
 * captions and video frames as `components/article/ArticleBody.vue`. Not A4: a reader never sees A4, and a sheet of
 * another width wraps lines and sizes pictures differently from the page that is published (the print page `/in-bai`
 * is the only paper layout). Editor-only CSS for `content_style` — nothing of it is in the saved HTML.
 *
 * Keep it in step with ArticleBody.vue: tests/tinymce-web-page.test.ts compares the shared values (column width, size,
 * colour, line height, and "inline font-family / font-size are ignored", § 107).
 */
export const WEB_PAGE_COLUMN = 808
/** The sheet's own width: the column plus its 48 px padding either side. */
export const WEB_PAGE_SHEET = WEB_PAGE_COLUMN + 96

export const WEB_PAGE_EDITOR_STYLE = `
      html { background: #e2ece3; }
      body { box-sizing: border-box; max-width: ${WEB_PAGE_SHEET}px; min-height: 480px; margin: 24px auto; padding: 48px; background: #fff; box-shadow: 0 1px 6px rgba(30, 37, 28, 0.18); font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif; font-size: 1.125rem; line-height: 1.75; color: #1E251C; }
      p, li { font-size: 1.125rem; line-height: 1.75; color: #1E251C; }
      p { margin: 0 0 20px; }
      [style*="font-family"] { font-family: inherit !important; }
      [style*="font-size"], [style*="line-height"] { font-size: inherit !important; line-height: inherit !important; }
      h2 { font-size: 1.5rem; font-weight: 800; color: #1E251C; margin: 2rem 0 0.8rem; }
      h3 { font-size: 1.2rem; font-weight: 800; color: #1E251C; margin: 1.6rem 0 0.6rem; }
      h4 { font-size: 1.05rem; font-weight: 700; color: #2b352a; margin: 1.3rem 0 0.5rem; }
      img, video { max-width: 100%; height: auto; border-radius: 8px; display: block; margin: 1.5rem auto; }
      figure.image img { margin: 0; }
      figure.image figcaption { margin-top: 0.5rem; font-size: 0.9rem; line-height: 1.5; text-align: center; color: #5A6C58; }
      blockquote { background-color: #F8FAF7; border-left: 4px solid #4A6741; padding: 20px 24px; margin: 30px 0; font-style: italic; font-size: 1.1rem; color: #385130; }
      code { background: #f4f4f4; padding: 2px 6px; border-radius: 4px; font-family: 'Fira Code', monospace; }
      pre[class*="language-"] { background: #2d2d2d; border-radius: 6px; padding: 1em; overflow-x: auto; }
      table { border-collapse: collapse; width: 100%; }
      table td, table th { border: 1px solid #ddd; padding: 8px; }
`

export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 2
export const ZOOM_STEP = 0.1
export const ZOOM_STORAGE_KEY = 'cdkt.editor.zoom'

/** A zoom level the editor can show: 50%–200%, in whole percent steps; anything else is 100%. */
export function clampZoom(value: unknown): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(number)) return 1
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, number)) * 100) / 100
}

export const zoomLabel = (zoom: number) => `${Math.round(clampZoom(zoom) * 100)}%`

/** What the viewer chose last time on this browser (a convenience: storage may be blocked or empty → 100%). */
export function loadZoom(storage: Pick<Storage, 'getItem'> | null | undefined): number {
  try {
    return clampZoom(storage?.getItem(ZOOM_STORAGE_KEY))
  } catch {
    return 1
  }
}

function saveZoom(storage: Pick<Storage, 'setItem'> | null | undefined, zoom: number): void {
  try { storage?.setItem(ZOOM_STORAGE_KEY, String(zoom)) } catch { /* private window, blocked storage: the level just is not remembered */ }
}

/**
 * The level at which the whole sheet fits the editing area ("page width" in Word): never above 100% (no enlarging) nor
 * below the lowest level. A frame narrower than the sheet — most laptops, in the article editor's column — shows the
 * page wrapped differently from the public one until it is zoomed to this.
 */
export function fitZoom(areaWidth: number): number {
  if (!Number.isFinite(areaWidth) || areaWidth <= 0) return 1
  return clampZoom(Math.min(1, Math.floor((areaWidth / WEB_PAGE_SHEET) * 100) / 100))
}

/**
 * Zoom the page inside the editor's iframe. CSS `zoom` on the document: measured on Chromium 156 + TinyMCE 6.8.6, a
 * selection toolbar and the bar over a picture land right at 50%, 70%, 150% and 200%; one that is already open does
 * not follow until TinyMCE is told the layout changed, hence the three notifications.
 */
export function applyEditorZoom(editor: TinyMceEditorInstance, zoom: number): number {
  const level = clampZoom(zoom)
  const root = editor.getDoc?.()?.documentElement
  if (root) root.style.setProperty('zoom', String(level))
  editor.dispatch?.('ResizeWindow')
  editor.dispatch?.('ScrollContent')
  editor.nodeChanged?.()
  return level
}

/**
 * The Word-like zoom control, in the editor's own status bar (so it is there in full screen too, where nothing of the
 * page is): `−` · slider · `+` · the percentage (a button: back to 100%) · "Vừa khít" (the whole sheet fits the frame). Ctrl + mouse wheel over the page zooms too.
 * Plain DOM, built here because TinyMCE 6 has no slider widget; every control is labelled and keyboard-operable.
 *
 * Pure of auto-imports; `win` is `window` (tests/e2e/admin-editor-web-page.spec.ts drives the real thing).
 */
export function registerZoomControl(editor: TinyMceEditorInstance, win: Pick<Window, 'localStorage'>): void {
  let zoom = loadZoom(win.localStorage)
  let control: HTMLElement | null = null
  let slider: HTMLInputElement | null = null
  let percent: HTMLButtonElement | null = null

  const set = (next: number) => {
    zoom = applyEditorZoom(editor, next)
    if (slider) { slider.value = String(Math.round(zoom * 100)); slider.setAttribute('aria-valuetext', zoomLabel(zoom)) }
    if (percent) percent.textContent = zoomLabel(zoom)
    saveZoom(win.localStorage, zoom)
  }

  const build = () => {
    const container = editor.getContainer?.()
    const bar = container?.querySelector('.tox-statusbar')
    if (!container || !bar) return
    const doc = container.ownerDocument
    const make = <K extends keyof HTMLElementTagNameMap>(tag: K, style: string) => {
      const element = doc.createElement(tag)
      element.setAttribute('style', style)
      return element
    }
    const buttonStyle = 'all: unset; box-sizing: border-box; width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; border-radius: 4px; font: 600 16px/1 sans-serif; color: inherit;'
    const button = (label: string, text: string, onClick: () => void) => {
      const element = make('button', buttonStyle)
      element.type = 'button'
      element.setAttribute('aria-label', label)
      element.setAttribute('title', label)
      element.textContent = text
      element.addEventListener('click', onClick)
      return element
    }
    control = make('div', 'display: inline-flex; align-items: center; gap: 6px; margin: 0 8px; flex: none;')
    control.setAttribute('data-cdkt-zoom', '')
    slider = make('input', 'width: 120px; margin: 0; cursor: pointer;')
    slider.type = 'range'
    slider.min = String(Math.round(ZOOM_MIN * 100))
    slider.max = String(Math.round(ZOOM_MAX * 100))
    slider.step = '5'
    slider.setAttribute('aria-label', 'Mức phóng to của trang soạn')
    slider.addEventListener('input', () => set(Number(slider!.value) / 100))
    percent = make('button', `${buttonStyle} width: auto; min-width: 44px; padding: 0 4px; font: 500 12px/1 sans-serif;`)
    percent.type = 'button'
    percent.setAttribute('aria-label', 'Về mức 100%')
    percent.setAttribute('title', 'Về mức 100%')
    percent.addEventListener('click', () => set(1))
    const fit = button('Vừa với bề rộng khung soạn', 'Vừa khít', () => set(fitZoom(container.querySelector('.tox-edit-area')?.clientWidth ?? 0)))
    fit.setAttribute('style', `${buttonStyle} width: auto; padding: 0 6px; border: 1px solid currentColor; font: 500 12px/1 sans-serif;`)
    control.append(
      button('Giảm mức xem', '−', () => set(zoom - ZOOM_STEP)),
      slider,
      button('Tăng mức xem', '+', () => set(zoom + ZOOM_STEP)),
      percent,
      fit,
    )
    const anchor = bar.querySelector('.tox-statusbar__right-container') ?? bar.querySelector('.tox-statusbar__resize-handle')
    if (anchor?.parentElement) anchor.parentElement.insertBefore(control, anchor)
    else bar.append(control)
    set(zoom)
  }

  editor.on('init', () => {
    build()
    // Ctrl + wheel over the page, as in Word. Not passive: the browser's own page zoom must not also happen.
    editor.getDoc?.()?.addEventListener('wheel', (event) => {
      if (!event.ctrlKey) return
      event.preventDefault()
      set(zoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP))
    }, { passive: false })
  })
}
