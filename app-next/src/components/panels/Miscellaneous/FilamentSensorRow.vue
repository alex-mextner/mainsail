<script setup lang="ts">
import { computed } from 'vue'
import { mdiPrinter3dNozzleAlert, mdiToggleSwitch, mdiToggleSwitchOffOutline } from '@mdi/js'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import { useConnectionStore } from '@/stores/connection'
import { convertName } from '@/lib/format'
import type { FilamentSensorEntry } from '@/composables/useMiscellaneous'

/**
 * A runout / motion / width sensor -- Mainsail's `inputs/FilamentSensor.vue`.
 *
 * This machine has none fitted (`[filament_switch_sensor]` is planned on D4,
 * see the AUX pin map in printer-status.md), so everything below is exercised
 * by the rig fixture rather than by the printer.
 */
const props = defineProps<{ sensor: FilamentSensorEntry }>()

const connection = useConnectionStore()

const status = computed(() => {
    if (props.sensor.diameter !== null && props.sensor.filamentDetected) {
        return { text: `${props.sensor.diameter.toPrecision(3)} mm`, tone: 'text-ok' }
    }
    if (!props.sensor.enabled) return { text: 'Disabled', tone: 'text-muted-foreground' }
    if (props.sensor.filamentDetected) return { text: 'Detected', tone: 'text-ok' }
    return { text: 'Empty', tone: 'text-warn' }
})

function toggle(): void {
    const enable = props.sensor.enabled ? 0 : 1
    const lines = [`SET_FILAMENT_SENSOR SENSOR=${props.sensor.name} ENABLE=${enable}`]

    // A width sensor has a second, separate switch of its own; upstream sends
    // both, and sending only the first leaves the two halves disagreeing.
    if (props.sensor.type === 'hall_filament_width_sensor') {
        lines.push(props.sensor.enabled ? 'DISABLE_FILAMENT_WIDTH_SENSOR' : 'ENABLE_FILAMENT_WIDTH_SENSOR')
    }

    for (const line of lines) void connection.sendGcode(line)
}
</script>

<template>
    <div class="py-drow flex items-center gap-2">
        <MdiIcon :path="mdiPrinter3dNozzleAlert" class="text-muted-foreground size-4 shrink-0" />
        <span class="truncate text-sm">{{ convertName(sensor.name) }}</span>

        <span class="grow" />

        <small class="text-xs" :class="status.tone">{{ status.text }}</small>

        <button
            type="button"
            class="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-md focus-visible:ring-2 focus-visible:outline-none"
            :aria-label="`Toggle ${sensor.name}`"
            :aria-pressed="sensor.enabled"
            @click="toggle">
            <MdiIcon
                :path="sensor.enabled ? mdiToggleSwitch : mdiToggleSwitchOffOutline"
                class="size-6"
                :class="sensor.enabled ? 'text-primary' : ''" />
        </button>
    </div>
</template>
