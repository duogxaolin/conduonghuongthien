import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { renderChatMarkdown } from '../app/utils/markdown.ts'

describe('renderChatMarkdown multimedia support', () => {
  it('renders standard image card for image markdown', () => {
    const input = 'Dưới đây là hình ảnh mô hình:\n![Mô hình chăn nuôi](/uploads/2026/09/mo-hinh.jpg)'
    const html = renderChatMarkdown(input)

    assert.ok(html.includes('chat-image-card'), 'Should include chat-image-card class')
    assert.ok(html.includes('src="/uploads/2026/09/mo-hinh.jpg"'), 'Should render safe image src')
    assert.ok(html.includes('Mô hình chăn nuôi'), 'Should render caption/alt')
  })

  it('renders video card with play icon for video link or video alt', () => {
    const input = 'Xem phóng sự truyền hình tại đây:\n![Video phóng sự hoàn lương](/media/aB3x9zK1234)'
    const html = renderChatMarkdown(input)

    assert.ok(html.includes('chat-video-card'), 'Should include chat-video-card class')
    assert.ok(html.includes('fa-play'), 'Should render play icon')
    assert.ok(html.includes('href="/media/aB3x9zK1234"'), 'Should render video link')
  })

  it('rejects unsafe schemes like javascript: or data:', () => {
    const dangerous1 = '![Hacker](javascript:alert(1))'
    const html1 = renderChatMarkdown(dangerous1)
    assert.ok(!html1.includes('<img'), 'Should NOT render img for javascript: scheme')

    const dangerous2 = '![Hacker](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)'
    const html2 = renderChatMarkdown(dangerous2)
    assert.ok(!html2.includes('<img'), 'Should NOT render img for data: scheme')
  })

  it('preserves regular links alongside images', () => {
    const input = 'Xem bài viết [Tấm gương Nguyễn Văn A](/news/nguyen-van-a) và ảnh:\n![Chân dung](/uploads/2026/09/avatar.jpg)'
    const html = renderChatMarkdown(input)

    assert.ok(html.includes('<a href="/news/nguyen-van-a"'), 'Should render regular article link')
    assert.ok(html.includes('chat-image-card'), 'Should render image card')
  })
})
