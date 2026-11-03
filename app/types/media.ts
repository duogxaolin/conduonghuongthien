/**
 * One image of the `media` table as the picker, the uploads and the image picker hold it — the
 * common part of `GET /api/admin/media` (`AdminMediaRow`) and `POST /api/admin/media/upload`
 * (`AdminMediaUploadResult['media']`), so both answers are assignable to it (wave3 7.1 batch F:
 * the hand-written `provider: 'local' | 'r2'` and `uploadedBy: number` were narrower than what the
 * handlers send — `varchar` and the uploader's USERNAME; nothing read either field).
 */
export interface MediaItem {
  id: number
  filename: string
  originalName: string
  mimeType: string
  sizeBytes: number
  /** `media.provider`, a `varchar` holding `local` or `r2`. */
  provider: string
  url: string
  width?: number | null
  height?: number | null
  createdAt?: string | null
  /** The list answers the uploader's username (joined); the upload answer has none. */
  uploadedBy?: string | null
}
