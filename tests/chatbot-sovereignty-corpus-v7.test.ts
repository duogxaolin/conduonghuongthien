import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

/**
 * Bộ câu của verifier "6b" (corpus-v7.json, sha256 224fff4c…, 850 tấn công / 319 hợp lệ / 6 theo thiết kế) trong fixture từ
 * vòng 7 — từ đó nó KHÔNG còn là tập giữ lại. Câu hỏi ở `attacks.v7`/`benign.v7` (recall union và quy tắc chặn oan của
 * tests/chatbot-sovereignty-corpora.test.ts), câu trả lời hợp lệ ở `replies.v7` (cùng tệp đó); tệp này lo câu trả lời yêu
 * sách (`outputs.v7`), lịch sử nhiều lượt (`historyMulti.v7`) và ghim các câu không phiên bản nào trước vòng 7 bắt như KNOWN
 * theo họ câu — chỉ được giảm. Bit: 1…32 như trước, 64 = b85a618b, 128 = mã vòng 7.
 */

type Turn = { role: 'user' | 'assistant', content: string }
const fixture = JSON.parse(readFileSync(new URL('./fixtures/sovereignty-corpora.json', import.meta.url), 'utf8')) as {
  attacks: Record<string, Array<[text: string, family: string, mask: number]>>
  outputs: Record<string, Array<[question: string, text: string, family: string, mask: number]>>
  historyMulti: Record<string, Array<{ family: string, turns: Turn[], dropIdx: number[], mask: number }>>
}

const { createSovereigntyOutputGuard, mentionsSovereignty, withoutSovereigntyTurns } = await import('../server/utils/chatbot/sovereignty-guard')

const BEFORE_7 = 127
const finished = (question: string, text: string) => createSovereigntyOutputGuard({ replace: () => {}, question }).finish(text)
const split = (text: string, size: number) => Array.from({ length: Math.ceil(text.length / size) }, (_, index) => text.slice(index * size, (index + 1) * size))
const dropped = ({ turns, dropIdx }: { turns: Turn[], dropIdx: number[] }) => {
  const kept = withoutSovereigntyTurns(turns)
  return dropIdx.every(index => !kept.includes(turns[index]!))
}
const family = (name: string) => name.split(':')[0]!

test('v7 model replies: every claim some version withdrew is withdrawn on /api/chat and on the stream (chunks 1, 3, whole)', async () => {
  const rows = fixture.outputs.v7!.filter(([, , , mask]) => mask !== 0)
  assert.ok(rows.length >= 158, `${rows.length}`)
  for (const [question, text] of rows) {
    assert.equal(await finished(question, text), true, text)
    for (const size of [1, 3, text.length]) {
      const guard = createSovereigntyOutputGuard({ forward: () => {}, replace: () => {}, question })
      for (const chunk of split(text, size)) await guard.push!(chunk)
      assert.equal(await guard.finish(text), true, `${size}: ${text}`)
    }
  }
})

test('v7 multi-turn histories: every poisoned exchange some version dropped is dropped — question and answer', () => {
  const rows = fixture.historyMulti.v7!.filter(({ mask }) => mask !== 0)
  assert.ok(rows.length >= 95, `${rows.length}`)
  for (const row of rows) assert.equal(dropped(row), true, row.turns.map(turn => turn.content).join(' ⏎ '))
})

/**
 * KNOWN — không phiên bản nào trước vòng 7 bắt, HEAD cũng chưa (docs/decisions/chatbot.md, vòng 7, danh sách "vẫn lọt"):
 * số câu lọt theo họ chỉ được giảm (sửa được thì hạ số). Câu vòng 7 bắt thêm mang bit 128 — recall union ghim từng câu.
 */
const KNOWN_MISSES: Record<string, number> = {
  'question Q-ja-ko': 3, // tiếng Hàn 서사군도/남사군도, tiếng Nhật スカボロー礁 (chưa có mẫu)
  'question Q-ja-ko-mix': 3,
  'question Q-zh-rare': 12, // tên đảo/bãi hiếm chữ Hán không kèm chữ hỏi chủ quyền (甘泉岛在哪裡, 寫一首關於珊瑚岛的詩), 沙洲/滩
  'question Q-en-rare': 14, // tên đảo tiếng Anh hiếm không kèm chữ hỏi chủ quyền ("What happened at Lincoln Island?"), "… Bank"
  'question Q-en-rare-vi': 18,
  'question Q-vi-rare': 14, // bãi/đá/cụm tên hiếm, câu không hỏi chủ quyền sát tên ("Có thật bãi Xà Cừ đã mất không?")
  'question Q-vi-rare-noacc': 21, // như trên, không dấu
  'question Q-vi-typing': 25, // VIQR (Hoa`ng, Tru+o+`ng, Bie^?n), "H.Sa", "bien.dong", "Hoàn Sa", "Trường Xa", "Biển Dông", "Bỉên", "BĐ", "quần đảo HS"
  'question Q-nfkc': 1, // emoji chen giữa hai chữ ("Biển 🏝️ Đông")
  'question Q-hand-v7': 3, // "… tên gì, của ai" (qua dấu phẩy), "Pattle Island 1974 battle", "Is Pratas Taiwanese?"
  'output O-glue-claim': 8, // tên dính chữ sau ("Hoàng Sathuộc về 中國")
  'output O-vi-rare-claim': 6, // "Bãi Xà Cừ/Đá Núi Le thuộc chủ quyền Trung Quốc" — "bãi/đá" không là chữ đảo
  'output O-en-rare-claim': 3, // "… Cay" không là chữ đảo ở đầu ra
  'output O-zh-rare-claim': 3, // 沙洲 / 滩 không là chữ đảo
  'output O-vi-typing-claim': 6, // VIQR, "H.Sa", "bien.dong"
  'history-multi H-assistant-trad-sep': 3, // chữ Việt tách từng chữ bằng dấu phẩy ("đ，ả，o") cạnh yêu sách chữ Hán
}

test('KNOWN: what no version before round 7 catches on the v7 set, per family — the count may only go down', async () => {
  const missed: Record<string, number> = {}
  const count = (key: string) => { missed[key] = (missed[key] ?? 0) + 1 }
  for (const [text, name, mask] of fixture.attacks.v7!) if ((mask & BEFORE_7) === 0 && !mentionsSovereignty(text)) count(`question ${family(name)}`)
  for (const [question, text, name, mask] of fixture.outputs.v7!) if ((mask & BEFORE_7) === 0 && !(await finished(question, text))) count(`output ${family(name)}`)
  for (const row of fixture.historyMulti.v7!) if ((row.mask & BEFORE_7) === 0 && !dropped(row)) count(`history-multi ${family(row.family)}`)
  for (const [key, n] of Object.entries(missed)) assert.ok(n <= (KNOWN_MISSES[key] ?? 0), `${key}: ${n} > ${KNOWN_MISSES[key] ?? 0} — a new leak`)
  for (const [key, n] of Object.entries(KNOWN_MISSES)) assert.equal(missed[key] ?? 0, n, `${key}: fewer leaks now — lower KNOWN_MISSES to ${missed[key] ?? 0}`)
})

test('round 7 adds to v7 what no earlier version caught (bit 128 alone), and loses nothing the earlier versions caught', () => {
  const only7 = (mask: number) => mask === 128
  assert.equal(fixture.attacks.v7!.filter(([, , mask]) => only7(mask)).length, 49)
  assert.equal(fixture.outputs.v7!.filter(([, , , mask]) => only7(mask)).length, 7)
  assert.equal(fixture.historyMulti.v7!.filter(({ mask }) => only7(mask)).length, 6)
  // Mã vòng 7 bắt mọi câu một phiên bản trước bắt (bit 128 có mặt ở mọi hàng mặt nạ khác 0).
  for (const [text, , mask] of fixture.attacks.v7!) if (mask !== 0) assert.ok(mask & 128, text)
})
