import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { usePrinterStore } from './printer'

export interface TempSample {
    /** Epoch milliseconds, so echarts can use a real time axis. */
    time: number
    value: number
}

export interface TempSeries {
    name: string
    temperatures: TempSample[]
    targets: TempSample[]
    powers: TempSample[]
}

/** Moonraker keeps roughly 20 minutes at 1 Hz; match it rather than inventing. */
const MAX_POINTS = 1200

/**
 * Temperature history for the chart.
 *
 * Seeded from Moonraker's `server.temperature_store`, which already holds the
 * last ~20 minutes. Without that seed the chart would open empty and only fill
 * in as you watch it, which is exactly the moment you want history -- when you
 * come back to see what the printer did while you were away.
 */
export const useTempHistoryStore = defineStore('tempHistory', () => {
    const printer = usePrinterStore()
    const series = ref<Record<string, TempSeries>>({})
    const seeded = ref(false)

    const ensure = (name: string): TempSeries => {
        if (!series.value[name]) {
            series.value[name] = { name, temperatures: [], targets: [], powers: [] }
        }
        return series.value[name]
    }

    const trim = (list: TempSample[]) => {
        if (list.length > MAX_POINTS) list.splice(0, list.length - MAX_POINTS)
    }

    /**
     * `server.temperature_store` returns parallel arrays sampled at 1 Hz,
     * newest last, with no timestamps -- so timestamps are reconstructed
     * backwards from now.
     */
    function seed(store: Record<string, Record<string, number[]>>) {
        const now = Date.now()

        for (const [name, fields] of Object.entries(store)) {
            const temps = fields.temperatures ?? []
            if (!temps.length) continue

            const entry = ensure(name)
            const startTime = now - (temps.length - 1) * 1000

            entry.temperatures = temps.map((value, i) => ({ time: startTime + i * 1000, value }))
            entry.targets = (fields.targets ?? []).map((value, i) => ({ time: startTime + i * 1000, value }))
            entry.powers = (fields.powers ?? []).map((value, i) => ({ time: startTime + i * 1000, value }))
        }

        seeded.value = true
    }

    /** Append one sample per known temperature source. */
    function record() {
        const time = Date.now()

        for (const item of printer.allTemperatures) {
            const entry = ensure(item.name)
            entry.temperatures.push({ time, value: item.temperature })
            trim(entry.temperatures)

            if (item.kind !== 'sensor') {
                entry.targets.push({ time, value: item.target })
                entry.powers.push({ time, value: item.power })
                trim(entry.targets)
                trim(entry.powers)
            }
        }
    }

    function reset() {
        series.value = {}
        seeded.value = false
    }

    const names = computed(() => Object.keys(series.value))

    return { series, names, seeded, seed, record, reset }
})
