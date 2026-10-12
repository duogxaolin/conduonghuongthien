<script setup lang="ts">
import type { AdminDocStep } from '~/utils/docs/types'

defineProps<{ steps: AdminDocStep[] }>()
</script>

<template>
  <ol class="flex flex-col gap-4 m-0 p-0 list-none">
    <li
      v-for="(step, index) in steps"
      :key="index"
      class="flex gap-3"
    >
      <span
        class="shrink-0 w-7 h-7 rounded-full bg-[#1e4620] text-white text-[0.78rem] font-bold flex items-center justify-center"
      >
        {{ index + 1 }}
      </span>
      <div class="flex-1 min-w-0 pt-0.5">
        <h4 class="text-[0.85rem] font-bold text-[#122815] m-0 mb-1">{{ step.title }}</h4>
        <p class="text-[0.82rem] text-[#425845] m-0 leading-relaxed">{{ step.detail }}</p>
        <NuxtLink
          v-if="step.link"
          :to="step.link"
          class="inline-flex items-center gap-1 mt-1.5 text-[0.78rem] font-semibold text-[#2c6e33] hover:underline"
        >
          <i class="fa-solid fa-arrow-right text-[0.65rem]" aria-hidden="true"></i>
          Mở trang
        </NuxtLink>
      </div>
    </li>
  </ol>
</template>
