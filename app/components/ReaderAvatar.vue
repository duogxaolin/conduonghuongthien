<!--
  Reader avatar: initials in a tinted circle, drawn locally.

  There is no `img` here and that is the whole point (design.md D7,
  reader-google-login-comments). Google hands back a `picture` URL on
  lh3.googleusercontent.com; hotlinking it would send every visitor's IP address
  and referrer to Google on every article page that carries a comment thread.
  This project already self-hosts the Inter webfont for exactly that reason, and
  adding comments must not quietly undo it on the pages citizens actually read.
  The URL is not stored either, so there is nothing here to render even if a
  future edit wanted to.

  Every class is a literal string. Tailwind v3 scans SOURCE TEXT at build time,
  so an interpolated `bg-[${tone}]` produces no CSS at all — the circle would
  silently lose its colour with no error anywhere.
-->
<template>
  <span
    class="inline-flex shrink-0 items-center justify-center rounded-full font-bold uppercase leading-none select-none"
    :class="[sizeClass, toneClass]"
    aria-hidden="true"
  >{{ initials || '?' }}</span>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  initials: { type: String, default: '?' },
  /** 'sm' for inline use in the header, 'md' for a comment row. */
  size: { type: String, default: 'md' },
  /** The portal speaking, rather than a member of the public. */
  isAdmin: { type: Boolean, default: false },
})

const sizeClass = computed(() => (props.size === 'sm' ? 'w-7 h-7 text-[0.7rem]' : 'w-9 h-9 text-[0.8rem]'))

// Deep forest green for the portal, pale leaf green for readers: an official
// reply has to be distinguishable at a glance, and the "Ban quản trị" label
// alone does not survive being skimmed.
const toneClass = computed(() => (props.isAdmin
  ? 'bg-[#4A6741] text-white'
  : 'bg-[#EEF2EC] text-[#385130] border border-[#E2E8DF]'))
</script>
