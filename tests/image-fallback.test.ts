import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULT_FALLBACK_IMAGE, handleImageError, onImageError, type ImageFallbackTarget } from '../app/utils/image-fallback.ts'

function createFakeImg(initialSrc: string, dataset: Record<string, string> = {}): ImageFallbackTarget {
  return {
    tagName: 'IMG',
    src: initialSrc,
    dataset: { ...dataset },
    getAttribute(name: string) {
      if (name === 'src') return this.src || ''
      return null
    },
  }
}

describe('image-fallback utility', () => {
  it('tự động thay thế ảnh chết bằng ảnh mặc định', () => {
    const fakeImg = createFakeImg('https://cdn.example.com/dead-image.jpg')
    const event = { target: fakeImg }

    const replaced = handleImageError(event)
    assert.equal(replaced, true)
    assert.equal(fakeImg.src, DEFAULT_FALLBACK_IMAGE)
    assert.equal(fakeImg.dataset?.fallbackApplied, 'true')
  })

  it('ngăn chặn vòng lặp vô hạn nếu ảnh fallback cũng không tải được', () => {
    const fakeImg = createFakeImg(DEFAULT_FALLBACK_IMAGE, { fallbackApplied: 'true' })
    const event = { target: fakeImg }

    const replaced = handleImageError(event)
    assert.equal(replaced, false)
    assert.equal(fakeImg.src, DEFAULT_FALLBACK_IMAGE)
  })

  it('tôn trọng ảnh fallback tùy chỉnh qua dataset.fallback', () => {
    const customFallback = '/assets/news_quangninh.jpg'
    const fakeImg = createFakeImg('https://cdn.example.com/broken.png', { fallback: customFallback })
    const event = { target: fakeImg }

    const replaced = handleImageError(event)
    assert.equal(replaced, true)
    assert.equal(fakeImg.src, customFallback)
    assert.equal(fakeImg.dataset?.fallbackApplied, 'true')
  })

  it('tôn trọng ảnh fallback truyền trực tiếp qua tham số', () => {
    const customFallback = '/assets/news_danang.jpg'
    const fakeImg = createFakeImg('https://cdn.example.com/broken.png')
    const event = { target: fakeImg }

    const replaced = handleImageError(event, customFallback)
    assert.equal(replaced, true)
    assert.equal(fakeImg.src, customFallback)
  })

  it('bỏ qua các thẻ không phải ảnh (script, link, div...)', () => {
    const fakeScript = { tagName: 'SCRIPT', src: 'https://cdn.example.com/script.js' }
    const event = { target: fakeScript }

    const replaced = handleImageError(event)
    assert.equal(replaced, false)
    assert.equal(fakeScript.src, 'https://cdn.example.com/script.js')
  })

  it('hàm onImageError gọi an toàn mà không ném ngoại lệ', () => {
    const fakeImg = createFakeImg('https://local.uploads/missing.jpg')
    assert.doesNotThrow(() => {
      onImageError({ target: fakeImg } as unknown as Event)
    })
    assert.equal(fakeImg.src, DEFAULT_FALLBACK_IMAGE)
  })
})
