import { ref, watch, onScopeDispose } from 'vue'
import type { Ref } from 'vue'
import type { Heater } from '@/store/printer/types'

/**
 * Keeps a short rolling window of temperature samples per object, so each row
 * can draw a sparkline without pulling in a charting library.
 *
 * Upstream Mainsail keeps a much longer series in `store/printer/tempHistory`
 * and renders it with echarts. That is the right tool for the full-size chart,
 * but a 120-point inline SVG is enough to show trend next to the number, and it
 * costs no dependency and no canvas.
 */
export function useTemperatureHistory(heaters: Ref<Heater[]>, maxSamples = 120) {
    const history = ref<Record<string, number[]>>({})

    const stop = watch(
        heaters,
        (list) => {
            for (const heater of list) {
                const series = history.value[heater.name] ?? []
                series.push(heater.temperature)
                if (series.length > maxSamples) series.shift()
                history.value[heater.name] = series
            }
        },
        { deep: true }
    )

    onScopeDispose(stop)

    return { history }
}

/**
 * Turn a series into an SVG polyline over a fixed viewBox.
 *
 * The vertical range is padded and never collapses to zero height, so a flat
 * series draws a centred flat line instead of clipping to the edge. Nothing is
 * ever cropped out of the box: the whole series is always inside the frame.
 */
export function sparklinePoints(series: number[], width = 100, height = 24): string {
    if (series.length < 2) return ''

    const min = Math.min(...series)
    const max = Math.max(...series)
    const span = max - min < 1 ? 1 : max - min
    const mid = (min + max) / 2
    const lo = mid - span / 2
    const step = width / (series.length - 1)
    const pad = 2

    return series
        .map((value, index) => {
            const x = index * step
            const normalised = (value - lo) / span
            const y = height - pad - normalised * (height - pad * 2)
            return `${x.toFixed(1)},${y.toFixed(1)}`
        })
        .join(' ')
}
