<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'
import { useTempHistoryStore } from '@/stores/tempHistory'
import { usePrinterStore } from '@/stores/printer'
import { useTheme } from '@/composables/useTheme'

/**
 * The real temperature chart: every heater and sensor as its own series, dashed
 * target lines, a clickable legend, a shared-axis tooltip and a time axis over
 * the ~20 minutes of history Moonraker keeps.
 *
 * echarts is registered tree-shaken (only the pieces used) rather than via the
 * `echarts` barrel -- the whole library is ~1 MB, and this is served off an
 * Orange Pi.
 */
use([LineChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, CanvasRenderer])

const history = useTempHistoryStore()
const printer = usePrinterStore()
const { resolved: theme } = useTheme()

const chart = shallowRef<InstanceType<typeof VChart> | null>(null)

/** Same role-based colours as the rest of the UI, read from the CSS tokens so
 *  the chart cannot drift from the panel next to it. */
const colourFor = (name: string): string => {
    const item = printer.allTemperatures.find((entry) => entry.name === name)
    const token = item?.kind === 'bed' ? '--heater-bed' : item?.kind === 'hotend' ? '--heater-hot' : '--sensor'
    return getComputedStyle(document.documentElement).getPropertyValue(token).trim() || '#888'
}

const labelFor = (name: string): string => printer.allTemperatures.find((entry) => entry.name === name)?.label ?? name

const option = computed<EChartsOption>(() => {
    const isDark = theme.value === 'dark'
    const axis = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)'
    const split = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'

    // Heaters first, sensors after: with a scrolling legend the first page
    // should hold the things you actually control, not the host thermometer.
    const ordered = printer.allTemperatures.map((item) => item.name).filter((name) => name in history.series)
    const names = [...ordered, ...Object.keys(history.series).filter((name) => !ordered.includes(name))]

    const series = names.flatMap((name) => {
        const entry = history.series[name]
        const colour = colourFor(name)
        const kind = printer.allTemperatures.find((item) => item.name === name)?.kind

        const lines: EChartsOption['series'] = [
            {
                name: labelFor(name),
                type: 'line',
                showSymbol: false,
                smooth: 0.2,
                lineStyle: { width: 2, color: colour },
                itemStyle: { color: colour },
                data: entry.temperatures.map((point) => [point.time, point.value]),
            },
        ]

        // Targets only for controllable heaters, and only when actually set.
        // Moonraker's temperature_store also reports a `targets` array for
        // temperature_fans, which drew dashed step lines for the host and
        // hotend fans -- noise, since you cannot command those from here.
        if (kind !== 'sensor' && entry.targets.some((point) => point.value > 0)) {
            lines.push({
                name: `${labelFor(name)} target`,
                type: 'line',
                showSymbol: false,
                lineStyle: { width: 1, type: 'dashed', color: colour, opacity: 0.7 },
                itemStyle: { color: colour },
                data: entry.targets.map((point) => [point.time, point.value]),
            })
        }

        return lines
    })

    return {
        animation: false,
        grid: { top: 8, right: 12, bottom: 48, left: 44 },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'line' },
            valueFormatter: (value) => `${Number(value).toFixed(1)} °C`,
        },
        legend: {
            type: 'scroll',
            bottom: 0,
            textStyle: { color: axis, fontSize: 11 },
            inactiveColor: split,
        },
        xAxis: {
            type: 'time',
            axisLabel: { color: axis, fontSize: 10, hideOverlap: true },
            axisLine: { lineStyle: { color: split } },
            splitLine: { show: false },
        },
        yAxis: {
            type: 'value',
            min: 0,
            axisLabel: { color: axis, fontSize: 10, formatter: '{value}°' },
            splitLine: { lineStyle: { color: split } },
        },
        series,
    }
})

const hasData = computed(() => Object.keys(history.series).length > 0)
</script>

<template>
    <div class="h-56 w-full sm:h-64">
        <VChart v-if="hasData" ref="chart" :option="option" autoresize class="h-full w-full" />
        <p v-else class="text-muted-foreground grid h-full place-items-center text-sm">Waiting for history…</p>
    </div>
</template>
