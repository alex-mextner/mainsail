<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'
import { useTheme } from '@/composables/useTheme'
import { filamentPerDay, printtimeDistribution, PRINTTIME_BUCKETS } from './historyStats'
import type { HistoryJob } from '@/stores/history'

/**
 * Two of upstream's charts in one component: `HistoryFilamentUsage` (metres per
 * day over the last two weeks) and `HistoryPrinttimeAvg` (completed jobs by
 * duration bucket).
 *
 * They are merged because they are the same chart with a different fold of the
 * same array -- a bar series, one axis of labels, one axis of counts. Upstream
 * keeps them as two files that differ in about fifteen lines, and two files
 * that must stay visually identical are two files that drift.
 */
use([BarChart, GridComponent, TooltipComponent, CanvasRenderer])

const props = defineProps<{ jobs: HistoryJob[]; kind: 'filament_usage' | 'printtime_avg' }>()

const { resolved: theme } = useTheme()

const option = computed<EChartsOption>(() => {
    const isDark = theme.value === 'dark'
    const axis = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)'
    const split = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
    // The bars carry no categorical meaning -- one series, one colour. `primary`
    // rather than upstream's fixed #BDBDBD, which is a mid grey chosen for a
    // dark card and reads as "disabled" on the light one.
    const bar = isDark ? 'oklch(0.7 0.16 250)' : 'oklch(0.48 0.16 255)'

    const common = {
        animation: false,
        grid: { top: 24, right: 12, bottom: 24, left: 44 },
        tooltip: { trigger: 'axis' as const, borderWidth: 0 },
    }

    if (props.kind === 'printtime_avg') {
        return {
            ...common,
            xAxis: {
                type: 'category',
                data: PRINTTIME_BUCKETS,
                axisLabel: { color: axis },
                axisLine: { lineStyle: { color: split } },
            },
            yAxis: {
                type: 'value',
                name: 'jobs',
                nameLocation: 'end',
                nameGap: 8,
                nameTextStyle: { color: axis, align: 'left' },
                // Counts are whole jobs; without this echarts happily labels
                // the axis 0.5, 1.5 when the tallest bar is 2.
                minInterval: 1,
                axisLabel: { color: axis },
                splitLine: { lineStyle: { color: split } },
            },
            series: [{ type: 'bar', data: printtimeDistribution(props.jobs), itemStyle: { color: bar } }],
        }
    }

    const data = filamentPerDay(props.jobs)

    return {
        ...common,
        xAxis: {
            type: 'time',
            axisLabel: { color: axis, formatter: '{d}.{MM}' },
            axisLine: { lineStyle: { color: split } },
        },
        yAxis: {
            type: 'value',
            name: 'm',
            nameLocation: 'end',
            nameGap: 8,
            nameTextStyle: { color: axis, align: 'left' },
            axisLabel: { color: axis },
            splitLine: { lineStyle: { color: split } },
        },
        series: [
            {
                type: 'bar',
                data,
                itemStyle: { color: bar },
                // 15 daily buckets across ~300px: without a cap echarts sizes
                // bars to the category width and they merge into a block.
                barMaxWidth: 18,
            },
        ],
    }
})
</script>

<template>
    <VChart :option="option" autoresize class="h-44 w-full" />
</template>
