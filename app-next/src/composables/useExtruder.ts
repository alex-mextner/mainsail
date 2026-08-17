import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { usePrinterStore } from '@/stores/printer'
import { useGuiStore } from '@/stores/gui'

/** Klipper's defaults, used when the option is absent from the config. */
const DEFAULT_FILAMENT_DIAMETER = 1.75
const DEFAULT_NOZZLE_DIAMETER = 0.4
const DEFAULT_MIN_EXTRUDE_TEMP = 170
const DEFAULT_MAX_EXTRUDE_ONLY_DISTANCE = 50

const asNumber = (value: unknown, fallback: number): number => {
    const parsed = typeof value === 'string' ? parseFloat(value) : value
    return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : fallback
}

/**
 * Active extruder facts -- Mainsail's `components/mixins/extruder.ts`.
 *
 * The defaults matter more than they look: this machine's printer.cfg sets
 * neither `max_extrude_only_distance` nor `pressure_advance`, so several of
 * these values come from the fallback rather than from the file. 50 mm is
 * Klipper's own default for the extrude-only limit, and it is what bounds the
 * feed-amount field.
 */
export function useExtruder() {
    const printer = usePrinterStore()
    const gui = useGuiStore()

    const { activeExtruder, activeExtruderSettings, extrudePossible, extruders, gcodeMove } = storeToRefs(printer)

    const settings = computed(() => gui.state.control.extruder)

    const filamentDiameter = computed(() =>
        asNumber(activeExtruderSettings.value?.filament_diameter, DEFAULT_FILAMENT_DIAMETER)
    )
    const nozzleDiameter = computed(() =>
        asNumber(activeExtruderSettings.value?.nozzle_diameter, DEFAULT_NOZZLE_DIAMETER)
    )
    const minExtrudeTemp = computed(() =>
        asNumber(activeExtruderSettings.value?.min_extrude_temp, DEFAULT_MIN_EXTRUDE_TEMP)
    )
    const maxExtrudeOnlyDistance = computed(() =>
        asNumber(activeExtruderSettings.value?.max_extrude_only_distance, DEFAULT_MAX_EXTRUDE_ONLY_DISTANCE)
    )

    const feedamount = computed(() => asNumber(settings.value.feedamount, 25))
    const feedrate = computed(() => asNumber(settings.value.feedrate, 5))

    const extrudeFactor = computed(() => gcodeMove.value?.extrude_factor ?? 1)
    const speedFactor = computed(() => gcodeMove.value?.speed_factor ?? 1)

    /**
     * Klipper rejects a single extrude-only move longer than
     * `max_extrude_only_distance`, and the flow multiplier counts toward it --
     * so 25 mm at 200 % flow is a 50 mm request. Checked here so the button can
     * explain itself rather than the command just failing.
     */
    const tooLargeExtrusion = computed(() => feedamount.value * extrudeFactor.value > maxExtrudeOnlyDistance.value)

    const setFeedamount = (value: number) => gui.saveSetting('control.extruder.feedamount', value)
    const setFeedrate = (value: number) => gui.saveSetting('control.extruder.feedrate', value)

    return {
        extruders,
        activeExtruder,
        activeExtruderSettings,
        extrudePossible,
        filamentDiameter,
        nozzleDiameter,
        minExtrudeTemp,
        maxExtrudeOnlyDistance,
        feedamount,
        feedrate,
        extrudeFactor,
        speedFactor,
        tooLargeExtrusion,
        setFeedamount,
        setFeedrate,
    }
}
