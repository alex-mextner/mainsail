<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'
import { useTempHistoryStore } from '@/stores/tempHistory'
import { usePrinterStore } from '@/stores/printer'
import { useSensorColors } from '@/composables/useSensorColors'

/**
 * The temperature chart inside the camera hud.
 *
 * Deliberately NOT the dashboard's TemperatureChart: this one sits on top of a
 * dark camera image (so it ignores the light/dark theme and is always styled
 * for a dark surface), shows only the controllable heaters (nozzle and bed --
 * nobody watches the host CPU while watching a print), carries no legend, and
 * has to stay readable at ~160px wide when docked into a side bar.
 *
 * Only the pieces of echarts used are registered. The library is ~1 MB and this
 * is served off an Orange Pi.
 */
use([LineChart, GridComponent, TooltipComponent, CanvasRenderer])

withDefaults(defineProps<{ height?: number }>(), { height: 110 })

const history = useTempHistoryStore()
const printer = usePrinterStore()
const { colorOf } = useSensorColors()

/** Only the last few minutes are interesting while watching the camera. */
const TIME_WINDOW = 10 * 60 * 1000

const AXIS_COLOR = 'rgba(255, 255, 255, 0.55)'
const SPLIT_COLOR = 'rgba(255, 255, 255, 0.12)'

const heaters = computed(() => printer.heaters.filter((heater) => heater.name in history.series))

const option = computed<EChartsOption>(() => {
    const since = Date.now() - TIME_WINDOW
    const within = (points: { time: number; value: number }[]) => points.filter((point) => point.time >= since)

    let max = 0
    const series = heaters.value.flatMap((heater) => {
        const entry = history.series[heater.name]
        const colour = colorOf(heater.name)

        const temperatures = within(entry.temperatures)
        const targets = within(entry.targets)
        for (const point of temperatures) if (point.value > max) max = point.value
        for (const point of targets) if (point.value > max) max = point.value

        return [
            {
                name: heater.label,
                type: 'line' as const,
                showSymbol: false,
                lineStyle: { width: 2, color: colour },
                itemStyle: { color: colour },
                data: temperatures.map((point) => [point.time, point.value]),
            },
            {
                name: `${heater.label} target`,
                type: 'line' as const,
                showSymbol: false,
                lineStyle: { width: 1.5, type: 'dashed' as const, color: colour, opacity: 0.6 },
                itemStyle: { color: colour },
                data: targets.map((point) => [point.time, point.value]),
            },
        ]
    })

    return {
        animation: false,
        grid: { top: 10, right: 10, bottom: 20, left: 34 },
        tooltip: {
            trigger: 'axis',
            animation: false,
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            borderWidth: 0,
            textStyle: { color: '#fff', fontSize: 12 },
            valueFormatter: (value) => `${Number(value).toFixed(0)} °C`,
        },
        xAxis: {
            type: 'time',
            // The chart is only ~160px wide when docked into a side bar, where
            // five time labels run into each other. `hideOverlap` drops the ones
            // that do not fit rather than letting them collide.
            splitNumber: 3,
            minInterval: 60 * 1000,
            axisTick: { show: false },
            axisLine: { show: false },
            splitLine: { show: false },
            axisLabel: { color: AXIS_COLOR, fontSize: 10, hideOverlap: true, formatter: '{HH}:{mm}' },
        },
        yAxis: {
            type: 'value',
            min: 0,
            // Round up to the next 50 °C so the hottest line never touches the
            // top edge, with a 100 °C floor so an idle machine still has a scale.
            max: Math.max(100, Math.ceil((max + 10) / 50) * 50),
            splitNumber: 2,
            axisLine: { show: false },
            axisTick: { show: false },
            splitLine: { lineStyle: { color: SPLIT_COLOR } },
            axisLabel: { color: AXIS_COLOR, fontSize: 10, formatter: '{value}°' },
        },
        series,
    }
})

const hasData = computed(() => heaters.value.length > 0)
</script>

<template>
    <!--
        `webcam-hud-chart` is a behavioural hook, not styling: the overlay checks
        for it in its pointerdown handler so a drag started on the chart is left
        to echarts' own tooltip instead of moving the card. Do not rename it
        without changing WebcamOverlay.vue.
    -->
    <div class="webcam-hud-chart w-full" :style="{ height: `${height}px` }">
        <VChart v-if="hasData" :option="option" autoresize class="h-full w-full" />
        <p v-else class="grid h-full place-items-center text-[11px] text-white/45">no history yet</p>
    </div>
</template>
