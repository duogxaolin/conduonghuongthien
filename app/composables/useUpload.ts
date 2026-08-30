import type { MediaItem } from '~/types/media'

export type UploadStatus = 'pending' | 'uploading' | 'success' | 'error'

export interface UploadTask {
  id: string
  file: File
  progress: number
  status: UploadStatus
  media: MediaItem | null
  error: string
}

let taskSeq = 0

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
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Upload thất bại'))
      return null
    } finally {
      uploading.value = false
    }
  }

  /**
   * Upload many files in parallel with per-file progress and status.
   * Bounded concurrency: at most `concurrency` requests run at once so a large
   * batch does not hammer the server (multipart + sharp resize) or the browser.
   *
   * `tasks` is exposed reactively so the caller can render a live progress list;
   * it is reset at the start of every batch.
   */
  const tasks = ref<UploadTask[]>([])
  const uploadingBatch = ref(false)

  const uploadBatch = async (
    files: File[] | FileList,
    concurrency = 4,
  ): Promise<MediaItem[]> => {
    const list = Array.from(files)
    uploadingBatch.value = true
    uploading.value = true
    tasks.value = list.map((file) => ({
      // Task ids only need to be unique within a batch; the counter avoids
      // collisions when two batches share a render frame (Math.random is off-limits).
      id: `up-${++taskSeq}`,
      file,
      progress: 0,
      status: 'pending',
      media: null,
      error: '',
    }))

    let cursor = 0
    const failed: string[] = []

    const runOne = async (task: UploadTask) => {
      task.status = 'uploading'
      task.progress = 5
      try {
        const formData = new FormData()
        formData.append('file', task.file)
        // $fetch (ofetch) does not expose byte-level upload progress, so per-file
        // progress jumps to a small "uploading" marker then to 100% on success.
        // The real UX win here is *parallelism* + status, not a byte count.
        const res = await $fetch<{ ok: boolean; media: MediaItem }>('/api/admin/media/upload', {
          method: 'POST',
          body: formData,
        })
        if (res.ok && res.media) {
          task.progress = 100
          task.status = 'success'
          task.media = res.media
        } else {
          task.status = 'error'
          task.error = 'Upload thất bại'
          failed.push(task.file.name)
        }
      } catch (err: unknown) {
        task.status = 'error'
        task.error = errorMessage(err, 'Upload thất bại')
        task.progress = 0
        failed.push(task.file.name)
      }
    }

    // Worker pool: each worker pulls the next pending task off the queue.
    const workers: Promise<void>[] = []
    const next = (): UploadTask | undefined => tasks.value[cursor++]
    const worker = async () => {
      let task: UploadTask | undefined
      while ((task = next())) await runOne(task)
    }
    for (let i = 0; i < Math.min(concurrency, list.length); i++) workers.push(worker())
    await Promise.all(workers)

    uploadingBatch.value = false
    uploading.value = false

    const uploaded = tasks.value
      .filter((t) => t.media)
      .map((t) => t.media) as MediaItem[]

    const okCount = uploaded.length
    const failCount = failed.length
    if (okCount > 0 && failCount === 0) {
      toast.success(`Đã tải lên ${okCount} file thành công!`)
    } else if (okCount > 0 && failCount > 0) {
      toast.error(`Tải lên ${okCount} file, thất bại ${failCount} file.`)
    } else if (failCount > 0) {
      toast.error(`Tải lên thất bại (${failCount} file).`)
    }
    return uploaded
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

  return { uploading, uploadFile, pickAndUpload, uploadBatch, tasks, uploadingBatch }
}
