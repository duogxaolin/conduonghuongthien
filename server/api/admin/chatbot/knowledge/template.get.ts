import { requireChatbotKnowledgePermission } from '../../../../utils/permissions'
import { writeXlsx } from '../../../../utils/xlsx-writer'

/**
 * Download the import template as a real .xlsx.
 *
 * The header names here are the ones the reader matches on, so an operator who
 * starts from this file cannot get the columns wrong. The sample rows are not
 * filler: each one demonstrates a shape the import has to survive — an answer
 * with numbered lines inside one cell, an answer continued on the following rows
 * with the question column left blank, and a row with no note.
 */
const TEMPLATE_ROWS: string[][] = [
  ['STT', 'Câu hỏi', 'Trả lời', 'Ghi chú'],
  [
    '1',
    'Biện pháp thông tin, truyền thông, giáo dục về tái hòa nhập cộng đồng được quy định như thế nào?',
    [
      'Biện pháp thông tin, truyền thông, giáo dục về tái hòa nhập cộng đồng được quy định tại Điều 9 Nghị định số 49/2020/NĐ-CP như sau:',
      '1. Thông tin, truyền thông trên các phương tiện thông tin đại chúng.',
      '2. Tổ chức phổ biến, giáo dục pháp luật tại cộng đồng.',
      '3. Tư vấn, hướng dẫn trực tiếp cho người chấp hành xong án phạt tù.',
    ].join('\n'),
    'Điều 9 Nghị định 49/2020/NĐ-CP',
  ],
  [
    '2',
    'Người chấp hành xong án phạt tù được vay vốn để sản xuất, kinh doanh không?',
    'Được. Chính sách tín dụng đối với người chấp hành xong án phạt tù thực hiện theo Quyết định số 22/2023/QĐ-TTg, gồm các nội dung sau:',
    'Quyết định 22/2023/QĐ-TTg',
  ],
  // A continuation of row 2: the question column is blank on purpose. The reader
  // appends these lines to the answer above instead of discarding them.
  ['', '', '1. Vay vốn để học nghề.', ''],
  ['', '', '2. Vay vốn để sản xuất, kinh doanh, tạo việc làm.', ''],
  [
    '3',
    'Thủ tục xóa án tích được thực hiện ở đâu?',
    'Người có yêu cầu nộp hồ sơ đề nghị cấp Phiếu lý lịch tư pháp tại Sở Tư pháp nơi thường trú hoặc tạm trú.',
    '',
  ],
]

const GUIDE_ROWS: string[][] = [
  ['Hướng dẫn sử dụng tệp mẫu'],
  [''],
  ['1. Giữ nguyên 4 tiêu đề ở dòng đầu: STT, Câu hỏi, Trả lời, Ghi chú.'],
  ['   Thứ tự các cột không quan trọng — hệ thống nhận cột theo tên tiêu đề.'],
  [''],
  ['2. Mỗi câu hỏi là một dòng. Câu trả lời dài có thể trình bày theo hai cách:'],
  ['   • Xuống dòng trong cùng một ô (nhấn Alt + Enter). Cách này được khuyến nghị.'],
  ['   • Viết tiếp ở các dòng bên dưới và để trống ô Câu hỏi. Hệ thống sẽ tự nối'],
  ['     những dòng đó vào câu trả lời phía trên.'],
  [''],
  ['3. Cột Ghi chú dùng để lưu căn cứ pháp lý (số hiệu văn bản, điều khoản).'],
  [''],
  ['4. Sau khi nhập, các mục được lưu ở trạng thái Bản nháp để cán bộ soát lại'],
  ['   trước khi xuất bản. Tích "Xuất bản ngay" nếu nội dung đã được duyệt.'],
  [''],
  ['5. Tối đa 2000 dòng và 8 MB cho mỗi tệp. Hỗ trợ cả .xlsx và .csv.'],
]

export default defineEventHandler((event) => {
  // Reading the template is part of authoring knowledge, so it takes the same
  // permission as creating an entry rather than being open to any admin.
  requireChatbotKnowledgePermission(event, 'create')

  const workbook = writeXlsx({
    sheets: [
      {
        name: 'Hỏi - Đáp',
        rows: TEMPLATE_ROWS,
        columns: [{ width: 6 }, { width: 44 }, { width: 78 }, { width: 26 }],
      },
      {
        name: 'Hướng dẫn',
        rows: GUIDE_ROWS,
        columns: [{ width: 96 }],
      },
    ],
  })

  setHeader(event, 'Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  setHeader(event, 'Content-Disposition', 'attachment; filename="mau-nhap-kho-kien-thuc.xlsx"')
  setHeader(event, 'Content-Length', workbook.length)
  // A template is generated per request and carries no caching value.
  setHeader(event, 'Cache-Control', 'no-store')
  return workbook
})
