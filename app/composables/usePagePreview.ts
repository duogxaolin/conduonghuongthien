import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import type { BlockNode } from '~/utils/blocks/types'

// ─── Page Builder preview bridge ─────────────────────────────────────────────
// Runs on a *public* page when it is loaded inside the builder's preview
// <iframe> (detected via the `?__preview=1` query flag). It lets the builder
// shell push the blocks currently being edited into the real page so the
// preview is pixel-for-pixel the published site — same layout, header, footer,
// fonts and CSS context. Strictly additive: without the flag every branch is
// inert, so normal visitors get the untouched production render.
//
// Protocol (same-origin postMessage):
//   shell → page :  { type: 'cdkt:blocks', blocks }   push live-edited blocks
//                   { type: 'cdkt:select', id }        highlight a block
//   page  → shell:  { type: 'cdkt:ready' }             page mounted, send state
//                   { type: 'cdkt:height', height }     content height for sizing
//                   { type: 'cdkt:select', id }         a block was clicked
export function usePagePreview() {
  const route = useRoute()
  const isPreview = computed(() => '__preview' in route.query)
  const previewBlocks = ref<BlockNode[] | null>(null)
  const selectedId = ref<number | string | null>(null)

  // Node ids are numeric for legacy flat pages but tmp strings ("tmp_3") for the
  // nested-tree pages. Coerce a raw id to a number only when it is purely numeric
  // so tree ids survive the round-trip instead of becoming NaN.
  const normId = (raw: unknown): number | string | null => {
    if (raw == null) return null
    const s = String(raw)
    return /^\d+$/.test(s) ? Number(s) : s
  }

  let ro: ResizeObserver | null = null

  const post = (msg: Record<string, unknown>) => {
    try { window.parent?.postMessage(msg, window.location.origin) } catch { /* ignore */ }
  }

  // When new blocks arrive, the whole tree re-renders; images re-decode and the
  // document height dips below its final value for a few frames. Reporting that
  // transient dip makes the iframe shrink then grow back — visible "shake". So
  // we arm a settle window after each blocks push, during which height dips are
  // suppressed; only a height that *grows* past the last reported value passes,
  // because a shrink is almost always the transient (grow-back is the real one).
  let settleTimer: ReturnType<typeof setTimeout> | null = null
  const armSettle = () => {
    if (settleTimer) clearTimeout(settleTimer)
    settleTimer = setTimeout(() => { settleTimer = null }, 280)
  }

  const onMessage = (e: MessageEvent) => {
    if (e.origin !== window.location.origin) return
    const m = e.data
    if (!m || typeof m !== 'object') return
    if (m.type === 'cdkt:blocks') {
      previewBlocks.value = Array.isArray(m.blocks) ? m.blocks : []
      armSettle()
    } else if (m.type === 'cdkt:select') selectedId.value = normId(m.id)
  }

  // In preview, a click selects the enclosing block instead of navigating.
  const onClick = (e: MouseEvent) => {
    const el = e.target as HTMLElement | null
    if (!el) return
    const blockEl = el.closest('[data-block-id]') as HTMLElement | null
    if (blockEl) {
      e.preventDefault(); e.stopPropagation()
      const id = normId(blockEl.dataset.blockId)
      selectedId.value = id
      post({ type: 'cdkt:select', id })
      return
    }
    // Neutralize navigation/submit so the preview never leaves the page.
    const nav = el.closest('a[href], button[type="submit"], [type="submit"]')
    if (nav) { e.preventDefault(); e.stopPropagation() }
  }

  // Height reporting is coalesced (one report per frame) and only fires when it
  // changes past a threshold. The +8px buffer keeps the iframe a hair taller
  // than its content so a vertical scrollbar never toggles — that toggle is what
  // made the preview "shake" (scrollbar → width change → reflow → new height → …).
  let lastHeight = 0
  let raf = 0
  const reportHeight = () => {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      const h = Math.ceil(document.documentElement.scrollHeight || document.body.scrollHeight) + 8
      if (Math.abs(h - lastHeight) < 4) return
      // During the settle window after a blocks push, the reflow dips short then
      // grows back. A shrink is almost always that transient — suppress it so the
      // iframe never visibly shrinks; only a real grow passes. After the window,
      // both directions report normally (e.g. a deleted block genuinely shrinks).
      const settling = settleTimer != null
      if (settling && h < lastHeight) return
      lastHeight = h
      post({ type: 'cdkt:height', height: h })
    })
  }

  onMounted(() => {
    if (!isPreview.value) return
    window.addEventListener('message', onMessage)
    document.addEventListener('click', onClick, true)
    ro = new ResizeObserver(reportHeight)
    ro.observe(document.documentElement)
    reportHeight()
    post({ type: 'cdkt:ready' })
  })

  onBeforeUnmount(() => {
    window.removeEventListener('message', onMessage)
    document.removeEventListener('click', onClick, true)
    if (raf) cancelAnimationFrame(raf)
    if (settleTimer) clearTimeout(settleTimer)
    ro?.disconnect(); ro = null
  })

  return { isPreview, previewBlocks, selectedId }
}
