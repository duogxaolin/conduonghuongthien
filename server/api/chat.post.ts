import { defineEventHandler, readBody, setHeader, createError } from 'h3'

const SYSTEM_PROMPT = `Bạn là "Trợ lý ảo Hướng Thiện" - Chuyên gia tư vấn pháp lý và tái hòa nhập cộng đồng thuộc Cục Cảnh sát quản lý tạm giữ, tạm giam và thi hành án hình sự tại cộng đồng (C11 - Bộ Công an Việt Nam).

MỤC TIÊU VÀ PHẠM VI HỖ TRỢ CHÍNH:
1. **Chính sách Tín dụng ưu đãi (Quyết định 22/2023/QĐ-TTg của Thủ tướng Chính phủ)**:
   - Cá nhân chấp hành xong án phạt tù được vay tối đa 100 triệu đồng để sản xuất, kinh doanh, tạo việc làm tại Ngân hàng Chính sách Xã hội.
   - Vay vốn học nghề tối đa 4 triệu đồng/tháng/người.
   - Thẩm định qua UBND cấp xã và Hội đoàn thể (Phụ nữ, Nông dân, Cựu chiến binh, Đoàn thanh niên...).

2. **Các chính sách Hỗ trợ Tái hòa nhập (Nghị định 49/2020/NĐ-CP)**:
   - Đào tạo nghề miễn phí/giảm chi phí tại các trung tâm dạy nghề địa phương.
   - Giới thiệu việc làm qua Trung tâm dịch vụ việc làm Sở LĐ-TB&XH và các doanh nghiệp liên kết.
   - Hỗ trợ làm thủ tục cấp Căn cước công dân, đăng ký thường trú/tạm trú.

3. **Thủ tục Pháp lý & Xóa án tích (Bộ luật Hình sự & Bộ luật Tố tụng hình sự)**:
   - Hướng dẫn điều kiện đương nhiên xóa án tích khi hết thời gian thử thách và thi hành xong các bản án dân sự/án phí.
   - Hướng dẫn hồ sơ xin cấp Phiếu lý lịch tư pháp số 2 tại Sở Tư pháp tỉnh/thành phố hoặc Cổng Dịch vụ công Quốc gia.

4. **Tư vấn Động viên Tâm lý & Nhân văn**:
   - Lắng nghe, động viên tinh thần, giúp người chấp hành xong án phạt tù vượt qua mặc cảm tự tin, hướng tới lối sống lành mạnh, lương thiện.

5. **Thông tin Đường dây nóng**:
   - Hotline hỗ trợ 24/7 của Đề án: **0903.480.985**.

PHONG CÁCH VÀ QUY TẮC ỨNG XỬ:
- Đảm bảo tính chính xác 100% về mặt pháp luật Việt Nam.
- Ngôn từ trang trọng nhưng ấm áp, nhân văn, thấu hiểu, khích lệ.
- Trình bày ngắn gọn, dễ hiểu, sử dụng danh sách gạch đầu dòng rõ ràng.
- Nếu câu hỏi quá phức tạp hoặc vượt quá thẩm quyền tư vấn trực tuyến, nhẹ nhàng khuyên người dân liên hệ Hotline 0903.480.985 hoặc Công an xã/phường gần nhất.`

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const body = await readBody(event)
  const userMessages = body.messages || []

  // Clean and prepare message list
  const formattedMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...userMessages.map((msg: any) => ({
      role: msg.sender === 'user' ? 'user' : 'assistant',
      content: msg.text
    }))
  ]

  const apiKey = config.aiApiKey
  const baseUrl = config.aiBaseUrl.replace(/\/$/, '')
  const model = config.aiModel || 'gpt-4o-mini'

  // If no API Key configured, fallback to offline notice + smart response
  if (!apiKey || apiKey.trim() === '' || apiKey === 'your_api_key_here') {
    const lastUserMsg = [...userMessages].reverse().find((m: any) => m.sender === 'user')?.text || ''
    const cleanText = lastUserMsg.toLowerCase()

    let reply = "Xin chào! Hiện tại hệ thống đang chạy ở chế độ Dữ liệu Pháp lý Nội bộ C11. (Để kích hoạt AI Real-time, vui lòng bổ sung AI_API_KEY trong file .env)."

    if (cleanText.includes('vay') || cleanText.includes('vốn') || cleanText.includes('tiền')) {
      reply = "Theo Quyết định 22/2023/QĐ-TTg của Thủ tướng Chính phủ, người chấp hành xong án phạt tù được Ngân hàng Chính sách Xã hội cho vay ưu đãi tối đa 100 triệu đồng để làm kinh tế, sản xuất kinh doanh và tối đa 4 triệu đồng/tháng để học nghề.\n\nĐơn đề nghị vay vốn cần có xác nhận của UBND cấp xã nơi cư trú."
    } else if (cleanText.includes('xóa') || cleanText.includes('án tích') || cleanText.includes('lý lịch')) {
      reply = "Thủ tục xóa án tích được quy định chi tiết tại Bộ luật Hình sự. Khi hết thời hạn thử thách và thi hành xong hình phạt bổ sung (án phí, bồi thường dân sự), bạn nộp hồ sơ xin cấp Phiếu lý lịch tư pháp số 2 tại Sở Tư pháp địa phương để làm căn cứ xác nhận xóa án tích."
    } else if (cleanText.includes('nghề') || cleanText.includes('học') || cleanText.includes('việc làm')) {
      reply = "Theo Nghị định 49/2020/NĐ-CP, người hoàn lương được chính quyền địa phương tư vấn hướng nghiệp, đào tạo nghề miễn phí và hỗ trợ bao tiêu việc làm thông qua Trung tâm dịch vụ việc làm của Sở LĐ-TB&XH."
    } else if (cleanText.includes('hotline') || cleanText.includes('liên hệ') || cleanText.includes('điện thoại')) {
      reply = "Đường dây nóng hỗ trợ 24/7 của Đề án tái hòa nhập cộng đồng C11 - Bộ Công an là: **0903.480.985**."
    }

    // Set Server-Sent Events headers for streaming
    setHeader(event, 'Content-Type', 'text/event-stream')
    setHeader(event, 'Cache-Control', 'no-cache')
    setHeader(event, 'Connection', 'keep-alive')

    return new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        for (let i = 0; i < reply.length; i += 3) {
          const chunk = reply.slice(i, i + 3)
          const data = JSON.stringify({ choices: [{ delta: { content: chunk } }] })
          controller.enqueue(encoder.encode(`data: ${data}\n\n`))
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      }
    })
  }

  // Real AI API Call with OpenAI Compatible Stream
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: formattedMessages,
        stream: true,
        temperature: 0.7,
        max_tokens: 1000
      })
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('AI Provider Error:', errText)
      throw createError({ statusCode: response.status, statusMessage: `AI Provider Error: ${errText}` })
    }

    setHeader(event, 'Content-Type', 'text/event-stream')
    setHeader(event, 'Cache-Control', 'no-cache')
    setHeader(event, 'Connection', 'keep-alive')

    return response.body
  } catch (error: any) {
    console.error('AI Proxy Error:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Lỗi kết nối tới AI Service'
    })
  }
})
