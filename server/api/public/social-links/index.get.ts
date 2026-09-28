import { listVisibleSocialLinks } from '../../../services/social-links'

/**
 * Danh sách MXH hiển thị công khai (popup góc trái). Không cần auth.
 * SWR 60s qua routeRules.
 */
export default defineEventHandler(async () => {
  const items = await listVisibleSocialLinks()
  return { ok: true, items }
})
