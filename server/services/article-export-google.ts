/**
 * Export bài viết → Google Sheets + Google Docs.
 *
 * Tạo 1 folder trên Drive → 1 Google Sheets (list bài: ID, title, thumbnail,
 * link "Xem bài") → mỗi bài 1 Google Docs (nội dung full rich). Trả link Sheets +
 * folder. Tái use backup Drive OAuth (`getUsableDriveLink` +
 * `getUsableDriveOauthConfig`) — refresh token + clientId/secret.
 *
 * Phân tách khỏi endpoint (`export-google.post.ts`) theo quy ước CLAUDE.md:
 * nghiệp vụ + ≥2 lệnh ghi Google API + có thể tái use. Endpoint chỉ validate +
 * permission; service sở hữu luồng Google.
 *
 * Rate limit: 50 bài × (1 create Doc + 1 batchUpdate) ≈ 50-100 requests. Chạy
 * tuần tự (không song song — tránh 429). Endpoint mong đợi 1-2 phút cho 50 bài,
 * toast "đang tạo..." ở UI.
 */
import { OAuth2Client } from 'google-auth-library'
import { drive as createDriveClient } from '@googleapis/drive'
import { sheets as createSheetsClient } from '@googleapis/sheets'
import { docs as createDocsClient } from '@googleapis/docs'
import { htmlToDocs } from '../utils/html-to-docs'
import { neutralizeSpreadsheetText } from '../utils/spreadsheet-cell'
import { vietnamDateString } from '../utils/vn-day-range'
import { loadOwnThumbnail } from './article-export-thumbnail'
import { loadR2Config } from './media'

/** Một bài viết đầu vào cho export (subset của articles row). */
export interface ExportArticleInput {
  id: number
  title: string
  slug: string
  excerpt: string | null
  content: string | null
  thumbnailUrl: string | null
  authorName: string | null
  categoryName: string | null
  publishedAt: Date | null
  createdAt: Date | null
}

/** Kết quả export. */
export interface ExportGoogleResult {
  sheetUrl: string
  folderUrl: string
  count: number
}

export const EXPORT_GOOGLE_MAX = 50

/**
 * Tạo folder trên Drive chứa tất cả file export.
 * Trả folderId. Nếu folder tồn tại (theo tên + parent), tái use.
 */
async function createExportFolder(drive: ReturnType<typeof createDriveClient>, stamp: string): Promise<string> {
  const folderName = `bai-viet-${stamp}`
  // Tìm folder tồn tại (tránh flood folder khi re-export cùng ngày).
  const existing = await drive.files.list({
    q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name)',
    pageSize: 1,
  })
  if (existing.data.files?.[0]?.id) return existing.data.files[0].id
  const res = await drive.files.create({
    requestBody: { name: folderName, mimeType: 'application/vnd.google-apps.folder' },
    fields: 'id',
  })
  if (!res.data.id) throw new Error('Google Drive không trả folder ID.')
  return res.data.id
}

/**
 * Công thức `=IMAGE("…")` cho ảnh bìa, hoặc `''` khi URL không phải https thuần.
 * Dấu nháy kép được nhân đôi (cách thoát chuỗi của Sheets) — một URL không thể
 * đóng chuỗi rồi nối công thức của riêng nó (`")&HYPERLINK(…`). `=IMAGE` do máy
 * chủ Google tải, không phải máy chủ này, nên không cần giới hạn host ở đây.
 */
export function sheetsImageFormula(url: string | null | undefined): string {
  if (!url) return ''
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return ''
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return ''
  return `=IMAGE("${parsed.href.replace(/"/g, '""')}")`
}

/**
 * Các hàng ghi vào Sheets (header + mỗi bài một hàng). Sheets ghi với
 * `USER_ENTERED`, tức chữ bắt đầu bằng `=`/`+`/`-`/`@` thành công thức — tiêu đề
 * bài là chữ do biên tập viên gõ nên phải qua `neutralizeSpreadsheetText`. Ô ảnh
 * là công thức DUY NHẤT được phép, và chỉ do `sheetsImageFormula` dựng.
 */
export function buildExportSheetValues(
  articles: { id: number; title: string; thumbnailUrl: string | null; docUrl: string }[],
): (string | number)[][] {
  return [
    ['ID', 'Tiêu đề', 'Thumbnail', 'Xem bài'],
    ...articles.map(a => [
      a.id,
      neutralizeSpreadsheetText(a.title),
      sheetsImageFormula(a.thumbnailUrl),
      neutralizeSpreadsheetText(a.docUrl),
    ]),
  ]
}

/**
 * Tạo Google Sheets trong folder + viết header + data rows.
 * Cột: ID | Tiêu đề | Thumbnail | Xem bài.
 * Thumbnail dùng `=IMAGE(url)` formula. "Xem bài" là hyperlink tới Docs.
 */
async function createExportSheets(
  drive: ReturnType<typeof createDriveClient>,
  sheets: ReturnType<typeof createSheetsClient>,
  folderId: string,
  articles: { id: number; title: string; thumbnailUrl: string | null; docUrl: string }[],
): Promise<string> {
  // Tạo file Sheets trống trong folder.
  const createRes = await drive.files.create({
    requestBody: {
      name: `danh-sach-bai-viet`,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: [folderId],
    },
    fields: 'id',
  })
  const spreadsheetId = createRes.data.id
  if (!spreadsheetId) throw new Error('Google Sheets không trả ID.')

  const values = buildExportSheetValues(articles)
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  })

  // Format header bold + freeze row 1.
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: 'userEnteredFormat.textFormat.bold',
          },
        },
        { updateSheetProperties: { properties: { sheetId: 0, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
      ],
    },
  })

  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
}

/**
 * Chép ảnh bìa vào thư mục xuất trên Drive, trả fileId (hoặc null nếu bỏ ảnh).
 *
 * Chỉ media của chính cổng (`loadOwnThumbnail`: `/uploads/…` trên đĩa hoặc host
 * R2 đã cấu hình) — URL bất kỳ trong `thumbnail_url` không bao giờ được máy chủ
 * này tải (SSRF). Tệp KHÔNG được chia sẻ "bất kỳ ai có link": Doc chỉ chèn một
 * liên kết tới bản trên Drive, nên quyền của thư mục xuất (chủ tài khoản đã liên
 * kết) là đủ; chia sẻ công khai chỉ làm lộ tệp ra ngoài.
 */
async function uploadImageToDrive(
  drive: ReturnType<typeof createDriveClient>,
  thumbnailUrl: string,
  r2PublicUrl: string,
  folderId: string,
  index: number,
): Promise<string | null> {
  const image = await loadOwnThumbnail(thumbnailUrl, r2PublicUrl)
  if (!image) return null
  try {
    const uploadRes = await drive.files.create({
      requestBody: { name: `thumb-${index}.${image.ext}`, parents: [folderId] },
      media: { mimeType: image.mimeType, body: image.buffer },
      fields: 'id',
    })
    return uploadRes.data.id ?? null
  } catch {
    return null
  }
}

/**
 * Tạo 1 Google Docs + ghi nội dung bài (title heading + meta + thumbnail +
 * content HTML → Docs API requests).
 */
async function createArticleDoc(
  docs: ReturnType<typeof createDocsClient>,
  drive: ReturnType<typeof createDriveClient>,
  article: ExportArticleInput,
  folderId: string,
  r2PublicUrl: string,
): Promise<string> {
  // Tạo Doc trống.
  const createRes = await docs.documents.create({
    requestBody: { title: article.title.slice(0, 100) },
  })
  const documentId = createRes.data.documentId
  if (!documentId) throw new Error(`Google Docs không trả ID cho bài ${article.id}.`)

  // Chép ảnh bìa (chỉ media của cổng) vào thư mục xuất để Doc liên kết tới.
  let thumbFileId: string | null = null
  if (article.thumbnailUrl) {
    thumbFileId = await uploadImageToDrive(drive, article.thumbnailUrl, r2PublicUrl, folderId, article.id)
  }

  // Build content requests: title (heading) + meta + thumbnail + content.
  const dateStr = vietnamDateString(article.publishedAt ?? article.createdAt ?? new Date())
  const meta = [
    article.categoryName ? `Danh mục: ${article.categoryName}` : '',
    article.authorName ? `Tác giả: ${article.authorName}` : '',
    `Ngày: ${dateStr}`,
  ].filter(Boolean).join(' · ')

  const conversion = htmlToDocs(article.content ?? '')

  // Requests: title heading + meta paragraph + thumbnail (nếu có) + content.
  const requests: unknown[] = []

  // Title — Doc mới có 1 newline ở index 0. Chèn title tại index 1.
  const titleText = article.title + '\n'
  requests.push({ insertText: { location: { index: 1 }, text: titleText } })
  requests.push({
    updateParagraphStyle: {
      range: { startIndex: 1, endIndex: 1 + titleText.length },
      paragraphStyle: { headingType: 'TITLE' },
      fields: 'headingType',
    },
  })
  let idx = 1 + titleText.length

  // Meta paragraph.
  if (meta) {
    const metaText = meta + '\n'
    requests.push({ insertText: { location: { index: idx }, text: metaText } })
    requests.push({
      updateTextStyle: {
        range: { startIndex: idx, endIndex: idx + metaText.length },
        textStyle: { italic: true, foregroundColor: { color: { rgbColor: { red: 0.35, green: 0.42, blue: 0.35 } } } },
        fields: 'italic,foregroundColor',
      },
    })
    idx += metaText.length
    // Blank line.
    requests.push({ insertText: { location: { index: idx }, text: '\n' } })
    idx += 1
  }

  // Thumbnail inline image.
  if (thumbFileId) {
    // Docs API InsertInlineImage cần objectId (media upload) — dùng drive.files
    // upload trả fileId, nhưng Docs API dùng URI khác. Đơn giản: chèn link ảnh text.
    // (Full inline image cần 1-lần upload qua Docs media, phức tạp — MVP chèn link.)
    // Liên kết trỏ tới bản chép trên Drive (cùng thư mục xuất), không trỏ tới
    // `thumbnail_url` gốc: URL gốc có thể là đường dẫn tương đối `/uploads/…`
    // (Docs từ chối link không tuyệt đối → cả batchUpdate hỏng) và là chữ do biên
    // tập viên gõ.
    const imgText = '[Ảnh bìa]\n'
    requests.push({ insertText: { location: { index: idx }, text: imgText } })
    requests.push({
      updateTextStyle: {
        range: { startIndex: idx, endIndex: idx + imgText.length - 1 },
        textStyle: { link: { url: `https://drive.google.com/file/d/${encodeURIComponent(thumbFileId)}/view` } },
        fields: 'link',
      },
    })
    idx += imgText.length
  }

  // Excerpt.
  if (article.excerpt) {
    const excerptText = article.excerpt + '\n'
    requests.push({ insertText: { location: { index: idx }, text: excerptText } })
    requests.push({
      updateTextStyle: {
        range: { startIndex: idx, endIndex: idx + excerptText.length },
        textStyle: { italic: true },
        fields: 'italic',
      },
    })
    idx += excerptText.length
  }

  // Content requests từ converter (index tiếp tục từ idx).
  for (const req of conversion.requests) {
    // Shift location index trong request by (idx - 1) vì converter bắt đầu tại 1.
    requests.push(shiftRequestIndex(req, idx - 1))
  }

  await docs.documents.batchUpdate({ documentId, requestBody: { requests: requests as Record<string, unknown>[] } })

  return `https://docs.google.com/document/d/${documentId}/edit`
}

/** Shift location.index trong một Docs API request by offset. */
function shiftRequestIndex(req: unknown, offset: number): unknown {
  const r = req as Record<string, Record<string, unknown>>
  // insertText.location.index
  const insertTextLoc = r.insertText?.location as Record<string, number> | undefined
  if (insertTextLoc && typeof insertTextLoc.index === 'number') insertTextLoc.index += offset
  // updateTextStyle.range / updateParagraphStyle.range
  for (const key of ['updateTextStyle', 'updateParagraphStyle']) {
    const range = r[key]?.range as Record<string, number> | undefined
    if (range) {
      if (typeof range.startIndex === 'number') range.startIndex += offset
      if (typeof range.endIndex === 'number') range.endIndex += offset
    }
  }
  // createParagraphBullets.range
  const bulletsRange = r.createParagraphBullets?.range as Record<string, number> | undefined
  if (bulletsRange) {
    if (typeof bulletsRange.startIndex === 'number') bulletsRange.startIndex += offset
    if (typeof bulletsRange.endIndex === 'number') bulletsRange.endIndex += offset
  }
  // insertTable.location
  const tableLoc = r.insertTable?.location as Record<string, number> | undefined
  if (tableLoc && typeof tableLoc.index === 'number') tableLoc.index += offset
  return req
}

/**
 * Export nhiều bài viết → Google Sheets + Docs. Trả link Sheets + folder.
 * Chạy tuần tự (rate limit). Bỏ bài lỗi (tiếp tục batch).
 */
export async function exportArticlesToGoogle(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
  articles: ExportArticleInput[],
  stamp: string,
): Promise<ExportGoogleResult> {
  const oauth2Client = new OAuth2Client(clientId, clientSecret)
  oauth2Client.setCredentials({ refresh_token: refreshToken })

  const drive = createDriveClient({ version: 'v3', auth: oauth2Client })
  const sheets = createSheetsClient({ version: 'v4', auth: oauth2Client })
  const docs = createDocsClient({ version: 'v1', auth: oauth2Client })

  const folderId = await createExportFolder(drive, stamp)

  // Host R2 công khai của thư viện ảnh — nguồn ảnh bìa từ xa DUY NHẤT được tải.
  // Đọc không được → chỉ còn ảnh `/uploads/…` trên đĩa; bản xuất vẫn tiếp tục.
  let r2PublicUrl = ''
  try {
    r2PublicUrl = (await loadR2Config()).publicUrl
  } catch {
    r2PublicUrl = ''
  }

  // Tạo Doc tuần tự — bỏ bài lỗi.
  const results: { id: number; title: string; thumbnailUrl: string | null; docUrl: string }[] = []
  for (const article of articles) {
    try {
      const docUrl = await createArticleDoc(docs, drive, article, folderId, r2PublicUrl)
      results.push({ id: article.id, title: article.title, thumbnailUrl: article.thumbnailUrl, docUrl })
    } catch {
      // Bỏ bài lỗi — tiếp tục batch.
    }
  }

  if (results.length === 0) throw new Error('Không tạo được bài Google Docs nào.')

  const sheetUrl = await createExportSheets(drive, sheets, folderId, results)
  const folderUrl = `https://drive.google.com/drive/folders/${folderId}`
  return { sheetUrl, folderUrl, count: results.length }
}
