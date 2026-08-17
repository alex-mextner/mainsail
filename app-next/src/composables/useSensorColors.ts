import { computed } from 'vue'
import { usePrinterStore } from '@/stores/printer'
import { useTempHistoryStore } from '@/stores/tempHistory'
import { assignSensorColors, sensorColor } from '@/lib/sensorColors'
import { useTheme } from '@/composables/useTheme'

/**
 * One colour per temperature series, shared by the chart and the rows so the
 * legend and the list can never disagree.
 *
 * The palette is keyed on the FULL Klipper object name and assigned over the
 * union of everything known -- live objects plus anything still in history.
 * Using only the currently-present sensors would let a colour shift the moment
 * a `temperature_fan` dropped out of the status payload.
 */
export function useSensorColors() {
    const printer = usePrinterStore()
    const history = useTempHistoryStore()
    const { resolved: theme } = useTheme()

    const names = computed(() =>
        Array.from(new Set([...printer.allTemperatures.map((item) => item.name), ...Object.keys(history.series)]))
    )

    const palette = computed(() => assignSensorColors(names.value))

    const colorOf = (name: string) => sensorColor(name, palette.value, theme.value === 'dark')

    return { palette, colorOf }
}
