// Nguồn thật: shared/blocks/types.ts (máy chủ import thẳng từ đó). Tệp này chỉ
// giữ đường `~/utils/blocks/types` cũ cho phía app. Alias `~~/shared/…`, không
// đường tương đối: Nuxt để shared/ là external trong bản build SSR (vite-builder
// `ssrEnvironment`), và rolldown in re-export tương đối của external đó thành một
// đường hỏng — Nitro build đỏ. Liệt kê tên như app/utils/submission-status.ts;
// tests/server-no-app-imports.test.ts canh danh sách này khớp đủ module gốc.
export {
  blockText,
  blockArray,
} from '~~/shared/blocks/types'
export type {
  BlockFieldValue,
  BlockData,
  BlockNode,
  BuilderNode,
  RenderableNode,
  NodeLocation,
  NodeId,
  BuilderTreeApi,
} from '~~/shared/blocks/types'
