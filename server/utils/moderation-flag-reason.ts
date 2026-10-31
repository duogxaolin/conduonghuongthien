/**
 * `flag_reason` that an automatic hide writes on its target row (`applyAutoHide`,
 * `moderation-worker-persist.ts`) — and so the value an approve of the queue row looks for
 * before showing the target again (`restoreAutoHidden`, `server/services/moderated-content.ts`).
 *
 * The hide writes the SAME text the queue row files as `flagged_reason`, cut to the column
 * (VARCHAR(255) — characters, so cut by code point: a UTF-16 cut can end on half an emoji,
 * which the driver stores as U+FFFD and the stored value no longer equals this one). That
 * equality is what tells "hidden by this queue row" apart from an officer's hide
 * (`comments/[id]/visibility.patch.ts` writes the officer's reason or NULL; `removeChatMessage`
 * writes none) — one definition here, so the two sides cannot drift.
 */
export const FLAG_REASON_MAX_LENGTH = 255

export function autoHideFlagReason(flaggedReason: string): string {
  return Array.from(flaggedReason).slice(0, FLAG_REASON_MAX_LENGTH).join('')
}
