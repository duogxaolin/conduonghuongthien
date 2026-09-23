import { expect, test, type Page } from '@playwright/test'
import { E2E_ADMIN_USERNAME, E2E_PASSWORD_ENV } from './harness'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

async function login(page: Page, username = E2E_ADMIN_USERNAME, password = process.env[E2E_PASSWORD_ENV]!) {
  if (!password) throw new Error('E2E admin password missing')
  await page.goto('/admin/login')
  await page.getByRole('textbox').first().fill(username)
  await page.locator('input[autocomplete="current-password"]').fill(password)
  await page.locator('button[type="submit"]').click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Xin chào', { timeout: 20_000 })
}

test('library links lead to real create/edit forms and persist publishing, archiving and comment controls', async ({ page }) => {
  await login(page)
  await page.goto('/admin/media-portal')
  await page.getByRole('link', { name: 'Đăng video YouTube' }).click()
  await expect(page.getByRole('heading', { name: 'Đăng video YouTube' })).toBeVisible()
  const title = `E2E media ${Date.now()}`
  await page.getByLabel('Tiêu đề', { exact: true }).fill(title)
  await page.getByLabel('Liên kết YouTube hoặc mã video').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  await page.getByLabel('Mô tả', { exact: true }).fill('Kiểm chứng tạo video từ giao diện.')
  await page.getByRole('button', { name: 'Tạo bản nháp' }).click()
  await expect(page).toHaveURL(/\/admin\/media-portal\/\d+$/)
  await expect(page.getByLabel('Tiêu đề', { exact: true })).toHaveValue(title)
  const id = Number(page.url().split('/').pop())
  await page.getByLabel('Cho phép bình luận').check()
  await page.getByLabel('Video nổi bật').check()
  await page.getByLabel('Trạng thái xuất bản').selectOption('published')
  const saved = page.waitForResponse(response => response.url().endsWith(`/api/admin/media-portal/${id}`) && response.request().method() === 'PUT')
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
  expect((await saved).status()).toBe(200)
  const published = await (await page.request.get(`/api/admin/media-portal/${id}`)).json()
  expect(published.item).toMatchObject({ title, status: 'published', commentsEnabled: true, isFeatured: true })
  await expect(page.getByRole('link', { name: 'Xem trang công khai' })).toHaveAttribute('href', `/media/${published.item.shortId}`)
  await page.getByLabel('Trạng thái xuất bản').selectOption('archived')
  const archived = page.waitForResponse(response => response.url().endsWith(`/api/admin/media-portal/${id}`) && response.request().method() === 'PUT')
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
  expect((await archived).status()).toBe(200)
  await page.reload()
  await expect(page.getByLabel('Trạng thái xuất bản')).toHaveValue('archived')
  await expect(page.getByLabel('Cho phép bình luận')).toBeChecked()
})

test('upload switch and direct URLs respect capabilities and read-only roles', async ({ page, context }) => {
  await login(page)
  await page.route('**/api/admin/media-portal/config', route => route.fulfill({ json: { ok: true, uploadEnabled: false, maxUploadSize: 1000000, categories: [] } }))
  await page.goto('/admin/media-portal')
  await expect(page.getByRole('link', { name: 'Tải video lên' })).toHaveCount(0)
  await page.goto('/admin/media-portal/upload')
  await expect(page.getByText('Máy chủ hiện chưa bật tải video.', { exact: false })).toBeVisible()
  await expect(page.locator('input[type="file"]')).toHaveCount(0)
  await page.unroute('**/api/admin/media-portal/config')

  const stamp = Date.now()
  const role = await page.request.post('/api/admin/roles', { data: { name: `media_view_${stamp}`, permissions: [{ resource: 'media_portal', canRead: true }] } })
  expect(role.status()).toBe(200)
  const username = `media_view_${stamp}`
  const password = 'OnlyRead#72Media!'
  const account = await page.request.post('/api/admin/users', { data: { username, password, roleId: (await role.json()).id } })
  expect(account.status()).toBe(200)
  await context.clearCookies()
  await login(page, username, password)
  await page.goto('/admin/media-portal/external')
  await expect(page.getByText('Bạn chưa được cấp quyền tạo video.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Tạo bản nháp' })).toHaveCount(0)
  await page.goto('/admin/media-portal/upload')
  await expect(page.getByText('Bạn cần quyền tạo và xem video', { exact: false })).toBeVisible()
  await expect(page.locator('input[type="file"]')).toHaveCount(0)
})

test('mounted uploader resumes after reload, rejects a different file and keeps the original upload session', async ({ page }) => {
  await login(page)
  // Only upload transport is intercepted: this drives the actual page/component/controller.
  // Backend chunk assembly and transcoding are covered separately by service tests.
  await page.route('**/api/admin/media-portal/config', route => route.fulfill({ json: { ok: true, uploadEnabled: true, maxUploadSize: 1000000, categories: [] } }))
  const uploadId = '12345678-1234-1234-1234-123456789abc'
  const received = new Set<number>()
  let initCalls = 0
  let failNext = true
  const chunkCalls: number[] = []
  await page.route('**/api/admin/media-portal/upload/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/init')) { initCalls++; return route.fulfill({ json: { ok: true, uploadId } }) }
    if (url.pathname.endsWith('/status')) return route.fulfill({ json: {
      ok: true, session: { uploadId, filename: 'video.mp4', declaredSize: 6, chunkSize: 2, totalChunks: 3, receivedParts: [...received], status: 'uploading', mediaItemId: null },
      missing: [0, 1, 2].filter(index => !received.has(index)),
    } })
    if (url.pathname.endsWith('/chunk')) {
      const index = Number(url.searchParams.get('index'))
      chunkCalls.push(index)
      if (index === 1 && failNext) { failNext = false; return route.abort('failed') }
      received.add(index)
      return route.fulfill({ json: { ok: true, receivedParts: [...received] } })
    }
    return route.fulfill({ json: { ok: true, mediaItemId: 987654, slug: 'uploaded' } })
  })
  await page.goto('/admin/media-portal/upload')
  // Construct File in the browser so lastModified remains stable across re-selection.
  async function choose(content: string) {
    await page.locator('input[type="file"]').evaluate((element, value) => {
      const transfer = new DataTransfer()
      transfer.items.add(new File([value], 'video.mp4', { type: 'video/mp4', lastModified: 123 }))
      ;(element as HTMLInputElement).files = transfer.files
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }, content)
  }
  await choose('abcdef')
  await page.getByRole('button', { name: 'Bắt đầu tải lên' }).click()
  await expect(page.getByRole('alert')).toContainText('Tải lên không thành công')
  await page.reload()
  await expect(page.getByText('Lượt tải đang dở:', { exact: false })).toBeVisible()
  await choose('xxxxxx')
  await expect(page.getByRole('alert')).toContainText('không khớp')
  await choose('abcdef')
  await page.getByRole('button', { name: 'Tiếp tục tải lên' }).click()
  await expect(page).toHaveURL(/\/admin\/media-portal\/987654$/)
  expect(initCalls).toBe(1)
  expect(chunkCalls.filter(index => index === 0)).toHaveLength(1)
  expect([...received]).toEqual([0, 1, 2])
})

test('real video upload completes, processes, publishes and plays through the public portal', async ({ page }) => {
  test.setTimeout(90_000)
  const directory = await mkdtemp(path.join(tmpdir(), 'cdkt-browser-media-'))
  try {
    const filename = path.join(directory, 'browser-video.mp4')
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=640x360:r=10',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', '-y', filename], { timeout: 20_000 })
    await login(page)
    const capabilities = await (await page.request.get('/api/admin/media-portal/config')).json()
    expect(capabilities.uploadEnabled, 'Run this media suite with MEDIA_UPLOAD_ENABLED=true and an isolated CDKT_MEDIA_WORKDIR').toBe(true)
    await page.goto('/admin/media-portal')
    await page.getByRole('link', { name: 'Tải video lên' }).click()
    await page.getByLabel('Tệp video', { exact: true }).setInputFiles(filename)
    await page.getByRole('button', { name: 'Bắt đầu tải lên' }).click()
    await expect(page).toHaveURL(/\/admin\/media-portal\/\d+$/, { timeout: 30_000 })
    const id = Number(page.url().split('/').pop())
    await expect(page.getByText('Video đã sẵn sàng.', { exact: true })).toBeVisible({ timeout: 40_000 })
    await page.getByLabel('Trạng thái xuất bản').selectOption('published')
    const saved = page.waitForResponse(response => response.url().endsWith(`/api/admin/media-portal/${id}`) && response.request().method() === 'PUT')
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
    expect((await saved).status()).toBe(200)
    const item = (await (await page.request.get(`/api/admin/media-portal/${id}`)).json()).item
    const manifest = await page.request.get(`/api/public/media/${item.shortId}/stream`)
    expect(manifest.status()).toBe(200)
    expect(await manifest.text()).toContain('#EXTM3U')
    await page.getByRole('link', { name: 'Xem trang công khai' }).click()
    await expect(page.locator('video')).toBeVisible()
    await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).readyState), { timeout: 15_000 }).toBeGreaterThanOrEqual(1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('reprocess recovers a failed item and polling preserves unsaved form values', async ({ page }) => {
  await login(page)
  const id = 987653
  let status = 'failed'
  let publication = 'draft'
  let reads = 0
  let processCalls = 0
  await page.route(`**/api/admin/media-portal/${id}/process`, route => {
    processCalls++
    status = 'processing'
    return route.fulfill({ status: 202, json: { ok: true } })
  })
  await page.route(`**/api/admin/media-portal/${id}`, route => {
    if (route.request().method() === 'PUT') {
      publication = route.request().postDataJSON().status
      return route.fulfill({ json: { ok: true, slug: 'video-can-xu-ly', status: publication } })
    }
    reads++
    if (processCalls && reads >= 3) status = 'ready'
    return route.fulfill({ json: { ok: true, item: {
      id, title: 'Video cần xử lý', slug: 'video-can-xu-ly', shortId: 'vid-xu-ly-01', source: 'upload', description: '',
      categoryId: null, status: publication, processingStatus: status,
      processingError: '/private/server/path/ffmpeg error', commentsEnabled: false, isFeatured: false,
    } } })
  })
  await page.goto(`/admin/media-portal/${id}`)
  await expect(page.getByText('Không xử lý được video.', { exact: false })).toBeVisible()
  await expect(page.getByText('/private/server/path/ffmpeg error')).toHaveCount(0)
  await page.getByRole('button', { name: 'Xử lý lại video' }).click()
  await expect(page.getByText('Có thể xuất bản trong khi xử lý.', { exact: false })).toBeVisible()
  await page.getByLabel('Trạng thái xuất bản').selectOption('published')
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
  await expect(page.getByRole('link', { name: 'Xem trang công khai' })).toBeVisible()
  await page.getByLabel('Tiêu đề', { exact: true }).fill('Tên đang sửa chưa lưu')
  await expect(page.getByText('Video đã sẵn sàng.', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByLabel('Tiêu đề', { exact: true })).toHaveValue('Tên đang sửa chưa lưu')
  expect(processCalls).toBe(1)
  const completedReads = reads
  // A full polling interval after terminal state must not issue another request.
  await page.waitForTimeout(3500)
  expect(reads).toBe(completedReads)
})
