import type { Ref } from 'vue'

// ─── Page builder node types ─────────────────────────────────────────────────
// The shape that travels: builder UI → draft/publish API → MySQL JSON columns →
// PageRenderer. It was previously redeclared as `any` at every one of those
// hops, so a change at one end could not be caught at the other.

/**
 * Editor-supplied field values for one block, keyed by the `key` of the block's
 * registry field.
 *
 * Cố ý mở, nhưng **không phải `any`**. Mỗi block tự khai field của nó lúc chạy
 * (`registry.ts`), nên không có lược đồ tĩnh để khai từng khoá. Nhưng `any` ở
 * đây từng lan ra toàn bộ cây block: nó tắt kiểm kiểu cho **mọi** phép đọc
 * `node.data.<gì cũng được>` ở cả builder, endpoint và renderer — kể cả những
 * phép đọc gõ sai tên field, vốn hiện ra là một ô trống trên trang công khai
 * mà không có lỗi nào.
 *
 * `BlockFieldValue` là **union các kiểu mà một field thật sự mang** (chuỗi cho
 * text/rich-text, số cho `limit`/`colSpan`, boolean cho công tắc, mảng cho
 * gallery/links). Nó vẫn cho phép đọc một khoá bất kỳ, nhưng giá trị nhận về
 * phải được thu hẹp trước khi dùng — đúng bước mà `any` đã bỏ qua.
 */
export type BlockFieldValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | BlockFieldValue[]
  | { [key: string]: BlockFieldValue }

export type BlockData = Record<string, BlockFieldValue>

/**
 * One node of a page's block tree.
 *
 * `id` is numeric for persisted blocks and a temporary `tmp_*` string for
 * blocks the editor has added but not yet saved. Layout containers
 * (section / row / column) carry `children`; only `column` carries `colSpan`,
 * a 1–12 span of the row grid. A legacy flat page is just a list of root nodes
 * with neither field, which stays valid under this type.
 */
export interface BlockNode {
  id?: number | string
  blockType: string
  displayOrder: number
  data: BlockData
  isVisible: boolean
  colSpan?: number
  children?: BlockNode[]
}

/**
 * A node as the builder holds it in memory. Identical to a BlockNode except
 * that `displayOrder` is assigned when the tree is serialised for save, so an
 * in-flight node does not carry one yet — which also applies to its children,
 * hence the recursive override rather than inheriting `children: BlockNode[]`.
 */
export type BuilderNode = Omit<BlockNode, 'displayOrder' | 'children'> & {
  displayOrder?: number
  children?: BuilderNode[]
}

/**
 * Một node đủ để **vẽ**, dùng cho `PageRenderer` / `BlockNode`.
 *
 * `isVisible` và `displayOrder` đều **tuỳ chọn** ở đây, và đó là điểm chính. Cây
 * mà trình dựng trang giữ có cả hai; còn phần tải công khai
 * (`/api/public/pages/[slug]`) **cố ý cắt bỏ** chúng — nó chỉ chứa node đang hiện,
 * nên gửi kèm một cờ luôn bằng `true` là mời phía client đi kiểm lại một điều đã
 * quyết ở máy chủ. Hai nơi gọi đó có hình dạng khác nhau **theo thiết kế**.
 *
 * Kiểu này diễn đạt đúng thứ mà việc vẽ thật sự cần, và nó khớp với cách
 * `BlockNode.vue` đã đọc cờ đó từ đầu: `v-if="node.isVisible !== false"` — vắng
 * mặt thì vẽ, chỉ `false` tường minh mới ẩn. Ép renderer nhận `BuilderNode` (có
 * `isVisible: boolean` **bắt buộc**) là đòi một trường mà chính đường dữ liệu
 * công khai đã bỏ đi, nên bốn trang công khai không thể thoả nó — đó là 4 lỗi
 * `TS2322` mà lượt bật `lang="ts"` làm lộ ra.
 */
export type RenderableNode = Omit<BlockNode, 'displayOrder' | 'isVisible' | 'children'> & {
  displayOrder?: number
  isVisible?: boolean
  children?: RenderableNode[]
}

/** Where a node sits in the tree: its sibling array, its index, its parent. */
export interface NodeLocation {
  siblings: BuilderNode[]
  index: number
  parent: BuilderNode | null
}

/**
 * Đọc một field dạng chữ ra `string`, hoặc `''` nếu nó không phải chữ.
 *
 * `BlockData` mở theo thiết kế (mỗi block tự khai field của nó lúc chạy), nên
 * một khoá bất kỳ có thể mang số, mảng hay `null` — và trước đây `BlockData` là
 * `Record<string, any>` nên **mọi** phép đọc như vậy đều biên dịch trót lọt.
 * `v-model` trên một giá trị không phải chữ không nổ ngay; nó ghi kiểu khác vào
 * đúng khoá đó rồi hỏng ở nơi khác, thường là lúc trang công khai render.
 *
 * Trả `''` thay vì `undefined` vì mọi nơi gọi là ô nhập: một `undefined` biến
 * `<input>` thành uncontrolled và Vue cảnh báo, còn chuỗi rỗng là đúng nghĩa
 * "field này chưa có gì".
 */
export function blockText(data: BlockData, key: string): string {
  const value = data[key]
  return typeof value === 'string' ? value : ''
}

/**
 * Đọc một field dạng danh sách ra mảng, tự khởi tạo nếu chưa có.
 *
 * Ghi **ngược lại vào `data`** là chủ đích, không phải tác dụng phụ lọt lưới:
 * trình lặp (stats / links / gallery) bind hai chiều vào chính mảng này, nên
 * trả về một mảng rời sẽ khiến mọi thao tác thêm/xoá của cán bộ mất khi đóng
 * ngăn kéo.
 */
export function blockArray(data: BlockData, key: string): BlockFieldValue[] {
  const cur = data[key]
  if (Array.isArray(cur)) return cur
  const fresh: BlockFieldValue[] = []
  data[key] = fresh
  return fresh
}

/** Định danh một node: số cho node đã lưu, `tmp_*` cho node mới, null/undefined
 *  cho "không có node nào". */
export type NodeId = number | string | null | undefined

/**
 * Hợp đồng mà trang dựng `provide('builderTree', …)` và cây block `inject`.
 *
 * Khai ở đây, không ở một trong hai đầu, vì `inject<any>` là một hợp đồng
 * **không được kiểm ở cả hai phía cùng lúc**: đổi tên `select` thành `selectNode`
 * ở trang cha thì `tree.select(...)` ở cây con vẫn biên dịch, rồi ném
 * "not a function" khi cán bộ bấm vào một khối. Provide/inject không có kiểu
 * chung thì lỗi đó chỉ hiện lúc chạy, ở một cú bấm cụ thể.
 */
export interface BuilderTreeApi {
  selectedId: Ref<number | string | null>
  select: (id: NodeId) => void
  openPalette: (parentId?: NodeId) => void
}
