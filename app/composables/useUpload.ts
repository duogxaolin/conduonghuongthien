import type { MediaItem } from '~/types/media'

export const useUpload = () => {
  const toast = useToast()
  const uploading = ref(false)

  /**
   * Upload a single file to the media library.
   * Returns the created MediaItem or null on failure.
   */
  const uploadFile = async (file: File): Promise<MediaItem | null> => {
    uploading.value = true
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await $fetch<{ ok: boolean; media: MediaItem }>('/api/admin/media/upload', {
        method: 'POST',
        body: formData,
      })
      if (res.ok && res.media) return res.media
      toast.error('Upload thất bại')
      return null
    } catch (err: any) {
      toast.error(err?.data?.statusMessage || 'Upload thất bại')
      return null
    } finally {
      uploading.value = false
    }
  }

  /**
   * Trigger a file input click and upload the chosen file.
   * Useful for "Upload" buttons that don't have a visible <input>.
   */
  const pickAndUpload = (accept = 'image/*'): Promise<MediaItem | null> => {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = accept
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) return resolve(null)
        const result = await uploadFile(file)
        resolve(result)
      }
      input.click()
    })
  }

  return { uploading, uploadFile, pickAndUpload }
}
