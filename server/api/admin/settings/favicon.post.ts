import { promises as fs } from 'node:fs'
import path from 'node:path'

import { activityLogs, settings } from '../../../db/schema'
import { getDb } from '../../../utils/db'
import { buildFaviconSet } from '../../../utils/favicon-image'
import { FAVICON_ICO_SETTING_KEY, clearFaviconSettingCache } from '../../../utils/favicon-setting'
import { detectImageMime, isSharpDecodable } from '../../../utils/image-mime'
import { requireResourcePermission } from '../../../utils/permissions'

/**
 * Đặt favicon từ một ảnh — **sinh** bộ đúng cỡ thay vì lưu thẳng tệp cán bộ đưa.
 *
 * Vì sao không dùng luôn `/api/admin/media/upload` rồi dán URL vào ô `favicon_url`:
 * ảnh cán bộ có trong tay là logo của cơ quan, thường 1200×800 và vài trăm KB. Dán
 * thẳng nó vào thẻ `<link rel="icon">` nghĩa là **cả mấy trăm KB đó tải trên mọi
 * trang** của cổng, và tỉ lệ không vuông thì trình duyệt bóp méo. Không có gì báo,
 * ở cả hai chuyện.
 *
 * Sinh ra ba tệp:
 *  - `*-32.png`  → thẻ `rel="icon"`
 *  - `*-180.png` → `apple-touch-icon`
 *  - `*.ico`     → tuyến `/favicon.ico`, nơi máy quét gọi trực tiếp
 *
 * **JPG nhận được, nhưng đầu ra luôn là PNG.** JPEG không có kênh alpha nên giữ
 * nguyên định dạng sẽ biến nền trong suốt thành nền đen — trên một icon 32px đó là
 * một ô vuông đen ở mọi tab. Trang cài đặt nói rõ điều này: âm thầm đổi định dạng
 * là thứ cán bộ sẽ phát hiện sau, ở chỗ khác.
 *
 * **`.ico` tải lên thì KHÔNG sinh lại**: sharp không giải mã được định dạng đó, nên
 * tệp đi thẳng vào và bản 180px lùi về mặc định. Cố decode là một nhánh thất bại im
 * lặng (khối `try/catch` quanh sharp sẽ nuốt lỗi).
 *
 * Ô nhập URL thủ công ở `/admin/settings/general` **vẫn dùng được** cho trường hợp
 * trỏ sang CDN ngoài — đây là đường thêm, không phải đường thay.
 */

/** 20 MB, cùng trần với `/api/admin/media/upload` — một trần thứ hai khác số là chỗ
 *  để hai giá trị lệch nhau. */
const MAX_SIZE = 20 * 1024 * 1024

/**
 * Bộ favicon **luôn** ghi xuống đĩa cục bộ, kể cả khi Thư viện Media đang dùng R2.
 *
 * Tuyến `server/routes/favicon.ico.ts` đọc tệp **từ đĩa**, nên một bản `.ico` nằm
 * trên R2 sẽ làm `/favicon.ico` lùi về bộ mặc định trong khi thẻ `<link>` trỏ sang
 * CDN — hai địa chỉ của cùng một cổng trả về hai logo khác nhau. Ba tệp này tổng
 * cộng chưa tới 40 KB và được yêu cầu đúng một lần mỗi khách, nên đưa chúng lên CDN
 * không đổi được gì đáng kể, còn sự lệch kia thì thật.
 */
const FAVICON_DIR = 'uploads/favicon'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  const form = await readMultipartFormData(event)
  const fileItem = form?.find(item => item.name === 'file' && item.data?.length)
  if (!fileItem?.data) {
    throw createError({ statusCode: 400, statusMessage: 'Không tìm thấy tệp ảnh.' })
  }

  if (fileItem.data.length > MAX_SIZE) {
    throw createError({ statusCode: 413, statusMessage: 'Tệp vượt quá giới hạn 20 MB.' })
  }

  // Magic byte là thẩm quyền, không phải tên tệp hay `Content-Type` client khai.
  // Cùng bộ nhận diện mà Thư viện Media dùng, nên hai đường không thể lệch nhau về
  // danh sách định dạng.
  const mime = detectImageMime(fileItem.data)
  if (!mime) {
    throw createError({
      statusCode: 415,
      statusMessage: 'Tệp không phải là ảnh hợp lệ (PNG/JPG/GIF/WebP/ICO).',
    })
  }

  const publicRoot = path.resolve(process.cwd(), 'public')
  const targetDir = path.join(publicRoot, FAVICON_DIR)
  await fs.mkdir(targetDir, { recursive: true })

  /**
   * Dấu thời gian trong **tên tệp**, không phải `?v=` trong query.
   *
   * Một số proxy bỏ query string khi quyết định khoá đệm, và favicon bị trình duyệt
   * đệm rất lâu — nên `?v=` là cách một icon mới không tới được người đã ghé qua.
   * Tên mới thì không có gì để đệm sai.
   */
  const stamp = Date.now()
  const written: Array<{ file: string, bytes: Buffer }> = []

  let iconUrl: string
  let icoUrl: string

  if (isSharpDecodable(mime)) {
    const { png32, png180, ico } = await buildFaviconSet(fileItem.data)
    written.push(
      { file: `favicon-${stamp}-32.png`, bytes: png32 },
      { file: `favicon-${stamp}-180.png`, bytes: png180 },
      { file: `favicon-${stamp}.ico`, bytes: ico },
    )
    iconUrl = `/${FAVICON_DIR}/favicon-${stamp}-32.png`
    icoUrl = `/${FAVICON_DIR}/favicon-${stamp}.ico`
  } else {
    // ICO: sharp không đọc được, nên tệp đi thẳng vào. Thẻ `rel="icon"` trỏ chính
    // nó (trình duyệt đọc được ICO ở đó), và bản 180px lùi về mặc định — cách xử lý
    // đã ghi trong `buildFaviconTags`.
    written.push({ file: `favicon-${stamp}.ico`, bytes: fileItem.data })
    iconUrl = `/${FAVICON_DIR}/favicon-${stamp}.ico`
    icoUrl = iconUrl
  }

  for (const { file, bytes } of written) {
    await fs.writeFile(path.join(targetDir, file), bytes)
  }

  const db = getDb()

  /**
   * Hai khoá cài đặt và dòng audit commit **cùng nhau**, hoặc không cái nào.
   *
   * Viết rời thì `favicon_url` mới có thể nằm cạnh `favicon_ico_url` **cũ** — thẻ
   * `<link>` trỏ icon mới trong khi `/favicon.ico` phục vụ icon cũ, đúng kiểu lệch
   * mà bộ đọc dùng chung ra đời để chặn. Chạy trên `tx`, không phải `db`: một
   * `db.insert()` đặt trong khối transaction vẫn commit độc lập trên pool.
   */
  await db.transaction(async (tx) => {
    for (const [key, value] of [['favicon_url', iconUrl], [FAVICON_ICO_SETTING_KEY, icoUrl]] as const) {
      await tx.insert(settings).values({ key, value, group: 'general' })
        .onDuplicateKeyUpdate({ set: { value } })
    }

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'update',
      resource: 'settings',
      meta: {
        operation: 'set_favicon',
        sourceMime: mime,
        sourceBytes: fileItem.data.length,
        generated: written.map(item => item.file),
        keysUpdated: ['favicon_url', FAVICON_ICO_SETTING_KEY],
      },
    })
  })

  // Sau khi commit, không phải trong transaction: trạng thái ngoài CSDL không tham
  // gia được vào tính nguyên tử của CSDL, nên nó đợi kết quả thay vì đoán trước.
  clearFaviconSettingCache()

  return {
    ok: true,
    faviconUrl: iconUrl,
    icoUrl,
    /** Cỡ tệp thật, để trang cài đặt nói được "đã giảm từ X xuống Y". */
    sourceBytes: fileItem.data.length,
    iconBytes: written[0]?.bytes.length ?? 0,
    /** JPG vào, PNG ra — trang cài đặt nêu ra thay vì để cán bộ tự phát hiện. */
    convertedToPng: isSharpDecodable(mime) && mime !== 'image/png',
  }
})

// Đường ĐẶT LẠI về bộ mặc định nằm ở `favicon.delete.ts`, không phải một export
// thứ hai trong tệp này: Nitro định tuyến theo **tên tệp** và chỉ lấy default
// export, nên một handler thứ hai xuất khẩu từ đây sẽ không bao giờ được gọi —
// nó trông như đã nối vào mà chưa bao giờ chạy.
