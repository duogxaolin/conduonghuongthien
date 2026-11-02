<script setup lang="ts">
import type { AdminUserMfaResetResponse } from '~/types/admin-users-api'
import type { MfaResetTarget } from '~/utils/admin-user-mfa-reset'
import { canResetUserMfa, resetUserMfa } from '~/utils/admin-user-mfa-reset'

/**
 * "Xoá xác thực hai bước" on a row of /admin/users — the break-glass reset of ANOTHER
 * administrator's second factors (`DELETE /api/admin/users/:id/mfa`, SuperAdmin only).
 * Who sees it, the confirmation and the request: `app/utils/admin-user-mfa-reset.ts`.
 *
 * Nothing is loaded here and the list shows no MFA state, so there is nothing to reload
 * after it: the result is the server's sentence in a toast, and the button is the retry.
 * `compact` is the desktop table's icon button (its cell carries no text); otherwise the
 * mobile card's text link.
 */
const props = defineProps<{ user: MfaResetTarget, compact?: boolean }>()

const { user: actor } = useAdminAuth()
const { prompt } = useConfirm()
const toast = useToast()

const visible = computed(() => canResetUserMfa(actor.value, props.user))
const label = computed(() => `Xoá xác thực hai bước của ${props.user.username}`)
// One reset at a time: a second click while the first is asking or sending does nothing.
const busy = ref(false)

async function reset() {
  if (busy.value) return
  busy.value = true
  try {
    await resetUserMfa(props.user, {
      prompt,
      request: (url, options) => adminFetch<AdminUserMfaResetResponse>(url, options),
      toast,
    })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <button
    v-if="visible && compact"
    type="button"
    class="w-8 h-8 flex items-center justify-center rounded-md bg-surface border border-line text-ink-admin cursor-pointer hover:bg-danger-bg hover:text-danger hover:border-danger transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
    :title="label"
    :aria-label="label"
    :disabled="busy"
    :aria-busy="busy"
    @click="reset"
  ><i class="fa-solid fa-shield-halved text-xs" aria-hidden="true"></i></button>
  <button
    v-else-if="visible"
    type="button"
    class="inline-flex items-center gap-1 text-danger font-bold text-[0.8rem] bg-transparent border-0 cursor-pointer p-0 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
    :title="label"
    :disabled="busy"
    :aria-busy="busy"
    @click="reset"
  ><i class="fa-solid fa-shield-halved" aria-hidden="true"></i> Xoá xác thực hai bước</button>
</template>
