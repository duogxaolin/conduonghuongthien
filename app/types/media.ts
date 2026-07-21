export interface MediaItem {
  id: number
  filename: string
  originalName: string
  mimeType: string
  sizeBytes: number
  provider: 'local' | 'r2'
  url: string
  width?: number | null
  height?: number | null
  createdAt?: string
  uploadedBy?: number | null
}
