<script setup lang="ts">
import { computed, onUnmounted } from 'vue'
import NumberInput from '@/components/ui/NumberInput.vue'
import { usePrinterStore } from '@/stores/printer'
import { useConnectionStore } from '@/stores/connection'

/**
 * Pressure advance and smooth time for one extruder -- Mainsail's
 * `Extruder/PressureAdvanceSettings.vue`.
 *
 * Two values from two different places, and the distinction is the point:
 *   - `printer.<extruder>.pressure_advance` is what is in force NOW, including
 *     anything a slicer or macro set for this print;
 *   - `configfile.settings.<extruder>.pressure_advance` is what the config says,
 *     and is what the reset button restores.
 * This machine sets neither in printer.cfg, so both read 0 until calibration
 * (task K5) gives it a value -- that zero is honest, not a failure to load.
 */
const props = defineProps<{ extruder: string }>()

const printer = usePrinterStore()
const connection = useConnectionStore()

const PRECISION = 1000
const DEFAULT_SMOOTH_TIME = 0.04

/** Upstream floors rather than rounds, so a displayed value never claims a
 *  precision Klipper would not accept back. */
const floor3 = (value: number) => Math.floor(value * PRECISION) / PRECISION

const object = computed(() => (printer.objects[props.extruder] ?? {}) as Record<string, number>)
const config = computed(() => (printer.config[props.extruder] ?? {}) as Record<string, number>)

const pressureAdvance = computed(() => floor3(object.value.pressure_advance ?? 0))
const smoothTime = computed(() => floor3(object.value.smooth_time ?? DEFAULT_SMOOTH_TIME))

const defaultPressureAdvance = computed(() => floor3(config.value.pressure_advance ?? 0))
const defaultSmoothTime = computed(() =>
    floor3(config.value.pressure_advance_smooth_time ?? config.value.smooth_time ?? DEFAULT_SMOOTH_TIME)
)

/**
 * `SET_PRESSURE_ADVANCE` names an extruder_stepper WITHOUT its section prefix,
 * unlike every other command in this panel.
 */
const targetName = computed(() =>
    props.extruder.startsWith('extruder_stepper ') ? props.extruder.slice('extruder_stepper '.length) : props.extruder
)

// Debounced: the spinner chevrons are held down, and each tick would otherwise
// be its own g-code round trip.
let timer: ReturnType<typeof setTimeout> | null = null
onUnmounted(() => {
    if (timer) clearTimeout(timer)
})

function sendCmd(params: { name: string; value: number }): void {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
        void connection.sendGcode(`SET_PRESSURE_ADVANCE EXTRUDER=${targetName.value} ${params.name}=${params.value}`)
    }, 500)
}
</script>

<template>
    <div class="@sm:grid-cols-2 grid grid-cols-1 gap-2">
        <NumberInput
            label="Pressure advance"
            param="ADVANCE"
            :target="pressureAdvance"
            :default-value="defaultPressureAdvance"
            :min="0"
            :max="null"
            :step="0.001"
            :dec="3"
            has-spinner
            :spinner-factor="10"
            unit="s"
            @submit="sendCmd" />

        <NumberInput
            label="Smooth time"
            param="SMOOTH_TIME"
            :target="smoothTime"
            :default-value="defaultSmoothTime"
            :min="0"
            :max="0.2"
            :step="0.001"
            :dec="3"
            has-spinner
            :spinner-factor="10"
            unit="s"
            @submit="sendCmd" />
    </div>
</template>
