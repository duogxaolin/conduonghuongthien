#!/usr/bin/env node
// Dump raw SSE stream từ /api/public/chatbot để tìm chỗ hụt chữ.
//
// Cách dùng:
//   node scripts/debug-chatbot-stream.mjs "cho tôi hỏi thủ tục tái hòa nhập"
//
// Server phải đang chạy (npm run dev hoặc build). Script in:
//   1. Raw bytes mỗi SSE event (data: ...) hex + utf8
//   2. accumulator.text đầy đủ ghép từ content
//   3. So accumulator cuối với bước nhảy typewriter từng ký tự
//
// Mục đích: bắt lỗi "Chàochị tôi cóợanh" — kiểu SSE cắt giữa ký tự UTF-8
// multi-byte (tiế Việt có dấu) — chunk không align theo codepoint boundary.

const url = process.env.CHATBOT_URL || 'http://localhost:3000/api/public/chatbot'
const query = process.argv[2] || 'cho tôi hỏi thủ tục tái hòa nhập cộng đồng'

const body = {
  messages: [{ role: 'user', content: query }],
}

const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
  },
  body: JSON.stringify(body),
})

console.log(`[status] ${res.status} ${res.statusText}`)
if (!res.ok || !res.body) {
  console.log('[error] không phải 200/stream:', await res.text().catch(() => '<no body>'))
  process.exit(1)
}

const reader = res.body.getReader()
const decoder = new TextDecoder('utf-8', { fatal: false })
let buffer = ''
let fullText = ''
let eventCount = 0
const chunks = []

// SSE: các dòng "data: ...\n\n". Buffer ráp tới khi thấy \n\n.
function handleEvent(rawData) {
  eventCount++
  const lines = rawData.split('\n')
  for (const line of lines) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') {
      console.log(`[event ${eventCount}] [DONE]`)
      return
    }
    let obj
    try { obj = JSON.parse(payload) } catch {
      console.log(`[event ${eventCount}] parse-fail: ${payload.slice(0, 80)}`)
      return
    }
    // Log mọi trường content/delta/answer/text
    const content =
      obj.content ?? obj.delta ?? obj.answer ?? obj.text ?? obj.chunk ?? ''
    if (typeof content === 'string' && content) {
      chunks.push(content)
      fullText += content
      // Hex của content để bắt byte sai
      const hex = Buffer.from(content, 'utf8').toString('hex')
      console.log(`[event ${eventCount}] content(${content.length} chars, ${Buffer.byteLength(content)} bytes): ${JSON.stringify(content)}`)
      if (Buffer.byteLength(content) > content.length) {
        console.log(`           hex: ${hex}`)
      }
    } else {
      console.log(`[event ${eventCount}] meta: ${JSON.stringify(obj).slice(0, 200)}`)
    }
  }
}

while (true) {
  const { done, value } = await reader.read()
  if (done) break
  buffer += decoder.decode(value, { stream: true })
  let idx
  while ((idx = buffer.indexOf('\n\n')) >= 0) {
    const evt = buffer.slice(0, idx)
    buffer = buffer.slice(idx + 2)
    handleEvent(evt)
  }
}

console.log('\n─────────── SUMMARY ───────────')
console.log(`events: ${eventCount}`)
console.log(`content chunks: ${chunks.length}`)
console.log(`accumulator.text length: ${fullText.length} chars / ${Buffer.byteLength(fullText, 'utf8')} bytes`)
console.log(`accumulator.text: ${JSON.stringify(fullText)}`)
console.log()

// Kiểm tra: typewriter dùng fullText.match(/\S+\s*/g) — chia theo "từ + khoảng
// trắng theo sau". Nếu ghép lại != fullText thì có chữ bị mất ở ranh giới.
const words = fullText.match(/\S+\s*/g) || []
const rejoined = words.join('')
console.log(`typewriter chunks (\\S+\\s*): ${words.length}`)
console.log(`rejoined == fullText? ${rejoined === fullText}`)
if (rejoined !== fullText) {
  console.log(`  rejoined:  ${JSON.stringify(rejoined)}`)
  console.log(`  fullText:  ${JSON.stringify(fullText)}`)
  // Tìm điểm lệch đầu tiên
  for (let i = 0; i < Math.max(rejoined.length, fullText.length); i++) {
    if (rejoined[i] !== fullText[i]) {
      console.log(`  lệch tại ${i}: rejoined[${i}]=${JSON.stringify(rejoined[i])} fullText[${i}]=${JSON.stringify(fullText[i])}`)
      break
    }
  }
}

// Có byte 0xFFFE/0xDD thay thế (replacement char U+FFFD) → SSE đã cắt giữa
// codepoint multi-byte.
if (fullText.includes('�')) {
  console.log(`\n⚠️  PHÁT HIỆN U+FFFD (replacement char) → SSE cắt giữa byte UTF-8 multi-byte!`)
  const positions = []
  for (let i = 0; i < fullText.length; i++) if (fullText[i] === '�') positions.push(i)
  console.log(`   tại: ${positions.join(', ')}`)
}
