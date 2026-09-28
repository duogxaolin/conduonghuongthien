import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { truncateTitle } from '../app/utils/truncate.ts'

describe('truncateTitle', () => {
  it('giữ nguyên khi chuỗi rỗng hoặc ngắn hơn maxChars', () => {
    assert.equal(truncateTitle(''), '')
    assert.equal(truncateTitle(null), '')
    assert.equal(truncateTitle(undefined), '')
    assert.equal(truncateTitle('Tin tức ngắn', 50), 'Tin tức ngắn')
    assert.equal(truncateTitle('Exact length', 12), 'Exact length')
  })

  it('cắt gọn và thêm dấu ba chấm khi chuỗi vượt quá maxChars', () => {
    const longTitle = 'NINH BÌNH: Hội nghị tăng cường kiểm tra, đánh giá, nâng cao hiệu quả công tác quản lý'
    const result = truncateTitle(longTitle, 40)
    assert.ok(result.length <= 41, `Độ dài không được vượt quá 41 (kèm '…'): ${result.length}`)
    assert.ok(result.endsWith('…'), 'Phải kết thúc bằng dấu ba chấm')
    // Cắt tại ranh giới từ "kiểm", không bị chém ngang từ "tra"
    assert.equal(result, 'NINH BÌNH: Hội nghị tăng cường kiểm…')
  })

  it('hoạt động tốt với tiếng Anh dài', () => {
    const enTitle = 'DONG THAP: Organizing a Conference to Implement the Law on Execution of Criminal Judgments and the Law on Execution'
    const result = truncateTitle(enTitle, 65)
    assert.ok(result.length <= 66)
    assert.ok(result.endsWith('…'))
    assert.ok(result.includes('Conference'))
  })

  it('xử lý chuỗi dài không có khoảng trắng mà không lỗi', () => {
    const noSpace = 'A'.repeat(80)
    const result = truncateTitle(noSpace, 50)
    assert.equal(result.length, 51)
    assert.ok(result.endsWith('…'))
  })
})
