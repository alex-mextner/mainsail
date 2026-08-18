<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { PieChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'
import { formatFilamentLength, formatPrintTime } from '@/lib/format'
import { useTheme } from '@/composables/useTheme'
import { groupSmallSlices, statusSlices, type StatsValue } from './historyStats'
import type { HistoryJob } from '@/stores/history'

/**
 * Print outcomes as a donut -- upstream's `HistoryAllPrintStatusChart`.
 *
 * Registered tree-shaken like the temperature chart: the `echarts` barrel is
 * about a megabyte and this is served off an Orange Pi. `PieChart` is the only
 * addition, the canvas renderer is already in the bundle.
 */
use([PieChart, TooltipComponent, CanvasRenderer])

const props = defineProps<{ jobs: HistoryJob[]; value: StatsValue }>()

const { resolved: theme } = useTheme()

const slices = computed(() => groupSmallSlices(statusSlices(props.jobs, props.value)))

const formatValue = (amount: number): string => {
    if (props.value === 'filament') return formatFilamentLength(amount)
    if (props.value === 'time') return formatPrintTime(amount)
    return String(amount)
}

const option = computed<EChartsOption>(() => {
    // Read inside the computed so a runtime theme flip re-resolves the label
    // colour; echarts paints to a canvas and cannot inherit a CSS class.
    const label = theme.value === 'dark' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.75)'

    return {
        animation: false,
        tooltip: {
            trigger: 'item',
            borderWidth: 0,
            valueFormatter: (raw: unknown) => formatValue(Number(Array.isArray(raw) ? raw[0] : raw) || 0),
        },
        series: [
            {
                type: 'pie',
                radius: ['40%', '68%'],
                /**
                 * `true`, where upstream has `false`.
                 *
                 * Found by screenshot: with four statuses of which two are tiny
                 * (1 in-progress and 2 klippy-shutdown out of 24), the labels
                 * for the two small wedges were drawn on top of each other and
                 * neither was readable. Upstream can afford `false` because its
                 * small wedges are folded into "Others" more often -- but that
                 * folding is a 5% threshold, and 2/24 is over it.
                 */
                avoidLabelOverlap: true,
                // A status with one job out of hundreds would otherwise be a
                // hairline nobody can point at. Upstream's value.
                minAngle: 5,
                data: slices.value.map((slice) => ({
                    name: slice.label,
                    value: slice.value,
                    itemStyle: { color: slice.color, opacity: 0.9 },
                })),
                label: { color: label, formatter: '{b}' },
                labelLine: { length: 8, length2: 8 },
                emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' } },
            },
        ],
    }
})
</script>

<template>
    <VChart v-if="slices.length" :option="option" autoresize class="h-52 w-full" />
    <p v-else class="text-muted-foreground py-12 text-center text-sm italic">Nothing to chart yet.</p>
</template>
