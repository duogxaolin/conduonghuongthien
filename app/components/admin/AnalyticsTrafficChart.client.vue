<script setup lang="ts">
type TrafficPoint = { day: string; pageViews: number; dailyUniqueVisitors: number }

const props = defineProps<{
  points: TrafficPoint[]
  selectedDay?: string | null
}>()
const emit = defineEmits<{ select: [day: string] }>()

const width = 800
const height = 260
const padding = 34
const maximum = computed(() => Math.max(1, ...props.points.flatMap(point => [point.pageViews, point.dailyUniqueVisitors])))
const coordinate = (value: number, index: number) => ({
  x: props.points.length === 1 ? width / 2 : padding + index * (width - padding * 2) / (props.points.length - 1),
  y: height - padding - value / maximum.value * (height - padding * 2),
})
const pageViewsLine = computed(() => props.points.map((point, index) => {
  const position = coordinate(point.pageViews, index)
  return `${position.x},${position.y}`
}).join(' '))
const visitorsLine = computed(() => props.points.map((point, index) => {
  const position = coordinate(point.dailyUniqueVisitors, index)
  return `${position.x},${position.y}`
}).join(' '))
const formatNumber = (value: number) => new Intl.NumberFormat('vi-VN').format(value)
const formatDay = (day: string) => new Intl.DateTimeFormat('vi-VN', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${day}T00:00:00Z`))
</script>

<template>
  <div>
    <div class="mb-3 flex flex-wrap gap-4 text-xs font-semibold text-[#425845]" aria-label="Chú giải biểu đồ">
      <span class="inline-flex items-center gap-2"><span class="h-1 w-7 rounded bg-[#2c6e33]"></span>Lượt xem — nét liền</span>
      <span class="inline-flex items-center gap-2"><span class="w-7 border-t-2 border-dashed border-[#997422]"></span>Khách duy nhất/ngày — nét đứt</span>
    </div>
    <div class="overflow-x-auto rounded-lg border border-[#e2ece3] bg-[#fbfdfb] p-2">
      <svg class="h-auto min-w-[640px] w-full" :viewBox="`0 0 ${width} ${height}`" role="img" aria-labelledby="traffic-chart-title traffic-chart-description">
        <title id="traffic-chart-title">Xu hướng truy cập theo ngày</title>
        <desc id="traffic-chart-description">Đường liền biểu diễn lượt xem; đường đứt biểu diễn khách duy nhất trong từng ngày. Dùng bảng bên dưới để xem và chọn dữ liệu.</desc>
        <line :x1="padding" :x2="width - padding" :y1="height - padding" :y2="height - padding" stroke="#a9b9aa" />
        <polyline :points="pageViewsLine" fill="none" stroke="#2c6e33" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
        <polyline :points="visitorsLine" fill="none" stroke="#997422" stroke-width="3" stroke-dasharray="8 6" stroke-linecap="round" stroke-linejoin="round" />
        <g v-for="(point, index) in points" :key="point.day">
          <circle :cx="coordinate(point.pageViews, index).x" :cy="coordinate(point.pageViews, index).y" r="5" fill="#fff" stroke="#2c6e33" stroke-width="3"><title>{{ `${formatDay(point.day)}: ${formatNumber(point.pageViews)} lượt xem` }}</title></circle>
          <rect :x="coordinate(point.dailyUniqueVisitors, index).x - 4" :y="coordinate(point.dailyUniqueVisitors, index).y - 4" width="8" height="8" fill="#fff" stroke="#997422" stroke-width="2"><title>{{ `${formatDay(point.day)}: ${formatNumber(point.dailyUniqueVisitors)} khách duy nhất trong ngày` }}</title></rect>
        </g>
      </svg>
    </div>

    <div class="mt-4 overflow-x-auto">
      <table class="w-full min-w-[520px] border-collapse text-left text-sm">
        <caption class="sr-only">Bảng dữ liệu xu hướng truy cập; chọn một ngày để xem chi tiết</caption>
        <thead><tr class="border-b border-[#dbe7dc] text-xs uppercase tracking-wide text-[#667768]"><th class="px-3 py-2" scope="col">Ngày</th><th class="px-3 py-2 text-right" scope="col">Lượt xem</th><th class="px-3 py-2 text-right" scope="col">Khách duy nhất/ngày</th><th class="px-3 py-2" scope="col">Chi tiết</th></tr></thead>
        <tbody>
          <tr v-for="point in points" :key="point.day" class="border-b border-[#edf3ed]" :class="selectedDay === point.day ? 'bg-[#edf7ee]' : ''">
            <th class="px-3 py-2 font-semibold text-[#233c26]" scope="row">{{ formatDay(point.day) }}</th>
            <td class="px-3 py-2 text-right tabular-nums">{{ formatNumber(point.pageViews) }}</td>
            <td class="px-3 py-2 text-right tabular-nums">{{ formatNumber(point.dailyUniqueVisitors) }}</td>
            <td class="px-3 py-2"><button type="button" class="rounded-md px-3 py-2 font-semibold text-[#2c6e33] underline decoration-dotted underline-offset-4 focus:outline-none focus:ring-2 focus:ring-[#2c6e33]" @click="emit('select', point.day)">Xem ngày</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
