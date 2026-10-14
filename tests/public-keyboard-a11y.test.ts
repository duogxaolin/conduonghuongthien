import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@vue/compiler-sfc'

/**
 * STRUCTURAL guards (đọc AST của <template>, không mount): không có DOM/JS client
 * trong runner này nên không thể bấm Tab thật. AST chứng minh được điều quan trọng
 * nhất ở đây — phần tử nhận click là phần tử bàn phím với tới được, và không có
 * <button> lồng <button> (HTML không hợp lệ → hydration lệch).
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8')

interface AstNode {
  type: number
  tag?: string
  props?: Array<{ type: number; name: string; rawName?: string; arg?: { content?: string }; value?: { content?: string } }>
  children?: AstNode[]
}

const ELEMENT = 1

function templateAst(rel: string): AstNode {
  const { descriptor } = parse(read(rel), { filename: rel })
  assert.ok(descriptor.template?.ast, `${rel} phải có <template>`)
  return descriptor.template.ast as unknown as AstNode
}

function elements(node: AstNode, acc: Array<{ node: AstNode; ancestors: AstNode[] }> = [], ancestors: AstNode[] = []) {
  for (const child of node.children ?? []) {
    if (child.type === ELEMENT) {
      acc.push({ node: child, ancestors })
      elements(child, acc, [...ancestors, child])
    }
  }
  return acc
}

const attrValue = (n: AstNode, name: string) => (n.props ?? []).find((p) => p.name === name || (p.type === 7 && p.arg?.content === name))
const classOf = (n: AstNode) => (n.props ?? []).find((p) => p.type === 6 && p.name === 'class')?.value?.content ?? ''

describe('không có <button> lồng <button>', () => {
  for (const file of [
    'app/pages/assistant.vue',
    'app/components/SocialBubble.client.vue',
    'app/components/layout/DefaultMobileDrawer.vue',
  ]) {
    it(file, () => {
      const nested = elements(templateAst(file)).filter(({ node, ancestors }) => node.tag === 'button' && ancestors.some((a) => a.tag === 'button'))
      assert.equal(nested.length, 0)
    })
  }
})

describe('assistant.vue — danh sách cuộc trò chuyện dùng được bằng bàn phím', () => {
  const els = elements(templateAst('app/pages/assistant.vue'))

  it('chuyển cuộc trò chuyện là <button type="button">, không còn <div @click>', () => {
    const switchers = els.filter(({ node }) => (node.props ?? []).some((p) => p.type === 7 && p.name === 'on' && p.arg?.content === 'click' && JSON.stringify(p).includes('onSwitchConversation')))
    assert.equal(switchers.length, 1)
    assert.equal(switchers[0]!.node.tag, 'button')
    assert.equal(attrValue(switchers[0]!.node, 'type')?.value?.content, 'button')
  })

  it('cuộc trò chuyện đang mở được công bố bằng aria-current', () => {
    const src = read('app/pages/assistant.vue')
    assert.match(src, /:aria-current="conversation\.id === activeId \? 'true' : undefined"/)
  })

  it('nút xoá có vòng focus thấy được (không chỉ focus-visible:outline-none)', () => {
    const del = els.find(({ node }) => node.tag === 'button' && classOf(node).includes('hover:bg-[#fee2e2]'))
    assert.ok(del, 'không tìm thấy nút xoá')
    const cls = classOf(del.node)
    assert.match(cls, /focus-visible:ring-2/)
    assert.match(cls, /group-has-\[:focus-visible\]:opacity-100/, 'nút xoá ẩn mặc định phải hiện khi bàn phím tới hàng')
  })

  it('nút chuyển cuộc trò chuyện có vòng focus', () => {
    const sw = els.find(({ node }) => node.tag === 'button' && JSON.stringify(node.props).includes('onSwitchConversation'))
    assert.match(classOf(sw!.node), /focus-visible:ring-2/)
  })
})

describe('SocialBubble.client.vue — nút mở/thu gọn là <button> có tên truy cập', () => {
  const els = elements(templateAst('app/components/SocialBubble.client.vue'))
  const toggles = els.filter(({ node }) => JSON.stringify(node.props).includes('toggleExpand'))

  it('mọi phần tử gắn toggleExpand là <button type="button"> có :aria-label, trừ wrapper chuột của launcher desktop', () => {
    const nonButtons = toggles.filter(({ node }) => node.tag !== 'button')
    // Ngoại lệ có tên: <div class="hidden md:flex … group"> bọc nút launcher desktop chỉ để
    // vùng nhãn chữ cũng bấm được bằng chuột; nút bên trong (đã là <button>) mới là
    // đích bàn phím — click của nó nổi bọt lên wrapper.
    assert.equal(nonButtons.length, 1)
    assert.match(classOf(nonButtons[0]!.node), /hidden md:flex .*group/)
    assert.ok(nonButtons[0]!.node.children?.some((c) => c.type === ELEMENT && c.tag === 'button'), 'wrapper ngoại lệ phải chứa một <button> thật')

    const buttons = toggles.filter(({ node }) => node.tag === 'button')
    assert.equal(buttons.length, 3, 'nút X thu gọn (desktop, đã là button từ trước) + pill thu gọn (mobile) + capsule mở (mobile)')
    for (const { node } of buttons) {
      assert.equal(attrValue(node, 'type')?.value?.content, 'button')
      assert.ok(attrValue(node, 'aria-label'), 'nút phải có aria-label')
      assert.match(classOf(node), /focus-visible:ring-2/)
    }
    // Hai nút mobile vừa được đổi từ <div @click> sang <button> phải công bố trạng thái.
    const mobile = buttons.filter(({ node }) => classOf(node).includes('md:hidden'))
    assert.equal(mobile.length, 2)
    for (const { node } of mobile) assert.ok(attrValue(node, 'aria-expanded'), 'nút mobile phải công bố aria-expanded')
  })

  it('nút launcher desktop (thu gọn) công bố aria-expanded', () => {
    const inner = els.find(({ node }) => node.tag === 'button' && classOf(node).includes('zalo-pulse-btn'))
    assert.ok(inner && attrValue(inner.node, 'aria-expanded'))
  })

  it('mọi animate-pulse kèm motion-reduce:animate-none; vòng sáng zalo tắt khi giảm chuyển động', () => {
    const src = read('app/components/SocialBubble.client.vue')
    for (const tag of src.match(/<[^>]*animate-pulse[^>]*>/g) ?? []) {
      assert.ok(tag.includes('motion-reduce:animate-none'), tag.slice(0, 120))
    }
    assert.match(src, /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.zalo-pulse-btn[^}]*animation: none/)
  })
})

describe('search.vue — "xoá/nhập từ khoá mới" focus đúng ô tìm kiếm của trang', () => {
  const src = read('app/pages/search.vue')

  it('không còn truy vấn toàn tài liệu document.querySelector(input[type=text])', () => {
    // Bỏ chú thích `//` trước khi kiểm: chú thích giải thích lỗi cũ có nhắc lại câu truy vấn.
    const code = src.replace(/^\s*\/\/.*$/gm, '')
    assert.doesNotMatch(code, /document\.querySelector\(\s*['"]input\[type=/)
  })

  it('ô tìm kiếm có ref + tên truy cập; inputFocus dùng ref', () => {
    assert.match(src, /<input\s+ref="searchInputEl"/)
    assert.match(src, /aria-label="Từ khóa tìm kiếm"/)
    assert.match(src, /const searchInputEl = ref<HTMLInputElement \| null>\(null\)/)
    assert.match(src, /searchInputEl\.value\?\.focus\(\)/)
  })

  it('cả nút X trong ô và nút "Nhập từ khóa mới" đều đưa focus về ô', () => {
    const matches = src.match(/@click="inputQuery = ''; inputFocus\(\)"/g) ?? []
    assert.equal(matches.length, 2)
  })
})

describe('tương phản chữ phụ: #7A8A76 (3.67:1 trên trắng) không còn ở bất kỳ tệp nào trong app/', () => {
  // Mọi tệp mã nguồn dưới app/ — kể cả các trang danh sách (news/documents/…,
  // ModelArticlesListPage, ContentTypeListSection, DocumentsBlock) đã đổi sang
  // #5A6C58 sau khi gộp PR danh sách. Tệp mới thêm vào app/ tự được canh.
  const owned = (readdirSync(path.join(root, 'app'), { recursive: true }) as string[])
    .filter((rel) => /\.(vue|ts|js|css)$/.test(rel))
    .map((rel) => path.join('app', rel).split(path.sep).join('/'))
    .sort()
  it('quét được các tệp app/ (không phải danh sách rỗng)', () => {
    assert.ok(owned.length > 100, `chỉ thấy ${owned.length} tệp`)
    assert.ok(owned.includes('app/components/ModelArticlesListPage.vue'))
  })
  for (const file of owned) {
    it(file, () => {
      assert.doesNotMatch(read(file), /#7A8A76/i)
    })
  }

  it('màu thay thế #5A6C58 đạt ≥4.5:1 trên mọi nền chữ phụ đang dùng', () => {
    const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
    const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255) }
    const ratio = (a: string, b: string) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi! + 0.05) / (lo! + 0.05) }
    // Năm nền đầu: các trang của PR a11y; phần sau: nền nhạt của các trang danh sách
    // (thẻ, ô tìm kiếm nhanh, thanh lọc) — #E2EBE0 là nền tối nhất, 4.62:1.
    for (const bg of ['#ffffff', '#F8FAF7', '#f0f6ef', '#f0f7f1', '#E8EEE6', '#EEF2EC', '#E5EDE3', '#EEF4EC', '#EBF3E8', '#F2F7F0', '#F7FAF6', '#E4EEE2', '#F0F5EE', '#EBF1EA', '#E2EBE0']) {
      assert.ok(ratio('#5A6C58', bg) >= 4.5, `#5A6C58 trên ${bg} = ${ratio('#5A6C58', bg).toFixed(2)}`)
    }
    assert.ok(ratio('#7A8A76', '#ffffff') < 4.5, 'màu cũ phải đúng là không đạt (kiểm chính công thức)')
  })
})
