import type { RenderableNode } from './types'

/**
 * Does the rendered block tree already contain the page's `<h1>`?
 *
 * Exactly one `<h1>` per public page (spec public-accessibility, design D22).
 * The header brand is no longer a heading, so a page built from blocks needs one
 * from somewhere: the hero block renders its title as `<h1>`; every other block
 * opens with `<h2>` or less. A page whose visible tree has a hero uses that;
 * otherwise the page adds a screen-reader `<h1>` (`index`, `about`, `contact`,
 * `[slug]`). Hidden nodes render nothing, subtree included, so they count as absent.
 */
const BLOCKS_WITH_OWN_H1 = new Set(['hero'])

export function blocksRenderOwnH1(nodes: readonly RenderableNode[] | null | undefined): boolean {
  for (const node of nodes ?? []) {
    if (node.isVisible === false) continue
    if (BLOCKS_WITH_OWN_H1.has(node.blockType)) return true
    if (node.children?.length && blocksRenderOwnH1(node.children)) return true
  }
  return false
}
