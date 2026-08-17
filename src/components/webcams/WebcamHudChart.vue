<template>
    <e-chart
        ref="hudchart"
        :option="chartOptions"
        :init-options="{ renderer: 'svg' }"
        :autoresize="true"
        class="webcam-hud-chart" />
</template>

<script lang="ts">
import Component from 'vue-class-component'
import { Mixins, Ref, Watch } from 'vue-property-decorator'
import { Debounce } from 'vue-debounce-decorator'
import BaseMixin from '@/components/mixins/base'
import type { ECharts } from 'echarts/core'
import type { ECBasicOption } from 'echarts/types/dist/shared.d'
import type { EChartRef } from '@/types/echarts'
import { PrinterTempHistoryStateSourceEntry } from '@/store/printer/tempHistory/types'
import { colorArray, colorHeaterBed } from '@/store/variables'

interface HudChartSerie {
    key: string
    label: string
    color: string
}

// only the last few minutes are interesting while watching the camera
const hudChartTimeWindow = 10 * 60 * 1000

@Component
export default class WebcamHudChart extends Mixins(BaseMixin) {
    @Ref('hudchart') readonly hudchart!: EChartRef | undefined

    // the hud always sits on top of the (dark) camera image, so it does not follow the
    // vuetify light/dark theme. these colors are picked for a dark surface.
    axisColor = 'rgba(255, 255, 255, 0.55)'
    splitLineColor = 'rgba(255, 255, 255, 0.12)'

    resizeObserver: ResizeObserver | null = null
    lastWidth = 0
    lastHeight = 0

    get chart(): ECharts | null {
        return this.hudchart?.chart ?? null
    }

    get source(): PrinterTempHistoryStateSourceEntry[] {
        return this.$store.state.printer.tempHistory.source ?? []
    }

    // the same colors the temperature panel uses for these heaters, so nozzle stays
    // nozzle-colored everywhere in the ui
    get heaters(): HudChartSerie[] {
        const output: HudChartSerie[] = []

        if ('extruder' in this.$store.state.printer) {
            output.push({
                key: 'extruder',
                label: this.$t('Panels.WebcamPanel.Hud.Nozzle').toString(),
                color: this.$store.getters['printer/tempHistory/getDatasetColor']('extruder') ?? colorArray[0],
            })
        }

        if ('heater_bed' in this.$store.state.printer) {
            output.push({
                key: 'heater_bed',
                label: this.$t('Panels.WebcamPanel.Hud.Bed').toString(),
                color: this.$store.getters['printer/tempHistory/getDatasetColor']('heater_bed') ?? colorHeaterBed,
            })
        }

        return output
    }

    // NOTE: this option must not depend on live temperature data. vue-echarts watches the
    // `option` prop and re-applies it on every change, which would overwrite the series data
    // pushed by updateSeriesData() with the empty placeholders below. the y-axis maximum is
    // therefore set from updateSeriesData() as well, not from here.
    get chartOptions(): ECBasicOption {
        return {
            animation: false,
            grid: {
                top: 10,
                right: 10,
                bottom: 20,
                left: 34,
            },
            tooltip: {
                trigger: 'axis',
                animation: false,
                backgroundColor: 'rgba(0, 0, 0, 0.85)',
                borderWidth: 0,
                textStyle: { color: '#fff', fontSize: 12 },
                valueFormatter: (value: number) => `${value?.toFixed(0) ?? '--'} °C`,
            },
            xAxis: {
                type: 'time',
                splitNumber: 4,
                minInterval: 60 * 1000,
                axisTick: { show: false },
                axisLine: { show: false },
                splitLine: { show: false },
                axisLabel: {
                    color: this.axisColor,
                    fontSize: 10,
                    formatter: this.hours12Format ? '{hh}:{mm}' : '{HH}:{mm}',
                },
            },
            yAxis: {
                type: 'value',
                min: 0,
                splitNumber: 2,
                axisLine: { show: false },
                axisTick: { show: false },
                splitLine: { lineStyle: { color: this.splitLineColor } },
                axisLabel: {
                    color: this.axisColor,
                    fontSize: 10,
                    formatter: '{value}°',
                },
            },
            series: this.seriesDefinition,
        }
    }

    get seriesDefinition() {
        const output: unknown[] = []

        this.heaters.forEach((heater) => {
            output.push({
                name: heater.label,
                type: 'line',
                showSymbol: false,
                lineStyle: { color: heater.color, width: 2 },
                itemStyle: { color: heater.color },
                data: [],
            })

            // the target of the same heater: same hue, dashed and dimmed
            output.push({
                name: `${heater.label} ${this.$t('Panels.WebcamPanel.Hud.Target')}`,
                type: 'line',
                showSymbol: false,
                lineStyle: { color: heater.color, width: 1.5, type: 'dashed', opacity: 0.6 },
                itemStyle: { color: heater.color },
                data: [],
            })
        })

        return output
    }

    get seriesData() {
        const limit = Date.now() - hudChartTimeWindow
        const output: [number, number][][] = []

        this.heaters.forEach(() => {
            output.push([], [])
        })

        this.source.forEach((entry) => {
            const timestamp = entry.date instanceof Date ? entry.date.getTime() : 0
            if (timestamp < limit) return

            this.heaters.forEach((heater, index) => {
                const temperature = entry[`${heater.key}-temperature`]
                const target = entry[`${heater.key}-target`]

                if (typeof temperature === 'number') output[index * 2].push([timestamp, temperature])
                if (typeof target === 'number') output[index * 2 + 1].push([timestamp, target])
            })
        })

        return output
    }

    mounted() {
        this.$nextTick(() => this.updateSeriesData())

        // the hud is mounted inside a dialog that is still hidden (and therefore 0x0) at that
        // moment, so echarts cannot lay itself out yet. re-measure once the element really has
        // a size on screen.
        this.resizeObserver = new ResizeObserver(() => this.handleResize())
        this.resizeObserver.observe(this.$el)
    }

    beforeDestroy() {
        this.resizeObserver?.disconnect()

        if (typeof window === 'undefined') return

        this.chart?.dispose()
    }

    @Debounce(100)
    handleResize() {
        const element = this.$el as HTMLElement
        if (!element?.clientWidth || !element?.clientHeight) return
        if (element.clientWidth === this.lastWidth && element.clientHeight === this.lastHeight) return

        this.lastWidth = element.clientWidth
        this.lastHeight = element.clientHeight

        if (!this.chart || this.chart.isDisposed()) return

        this.chart.resize()
        this.updateSeriesData()
    }

    updateSeriesData() {
        if (!this.chart || this.chart.isDisposed()) return

        const seriesData = this.seriesData

        let max = 0
        seriesData.forEach((serie) => {
            serie.forEach(([, value]) => {
                if (value > max) max = value
            })
        })

        this.chart.setOption({
            // round up to the next 50 °C so the hottest line does not touch the top edge
            yAxis: { max: Math.max(100, Math.ceil((max + 10) / 50) * 50) },
            series: seriesData.map((data) => ({ data })),
        })
    }

    @Watch('source')
    sourceChanged() {
        this.updateSeriesData()
    }
}
</script>

<style scoped>
.webcam-hud-chart {
    width: 100%;
    height: 110px;
}
</style>
