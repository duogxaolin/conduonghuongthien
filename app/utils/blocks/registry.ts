// Nguồn thật: shared/blocks/registry.ts (máy chủ import thẳng từ đó). Tệp này chỉ
// giữ đường `~/utils/blocks/registry` cũ cho phía app. Alias `~~/shared/…`, không
// đường tương đối: Nuxt để shared/ là external trong bản build SSR (vite-builder
// `ssrEnvironment`), và rolldown in re-export tương đối của external đó thành một
// đường hỏng — Nitro build đỏ. Liệt kê tên như app/utils/submission-status.ts;
// tests/server-no-app-imports.test.ts canh danh sách này khớp đủ module gốc.
export {
  GRID_COLUMNS,
  MIN_COL_SPAN,
  MAX_COL_SPAN,
  DEFAULT_COL_SPAN,
  clampColSpan,
  BLOCK_REGISTRY,
  BLOCK_TYPES,
  isValidBlockType,
  CONTAINER_TYPES,
  isContainerType,
  getDefaultData,
  blocksByCategory,
} from '~~/shared/blocks/registry'
export type {
  EditorFieldType,
  EditorField,
  BlockDefinition,
} from '~~/shared/blocks/registry'
