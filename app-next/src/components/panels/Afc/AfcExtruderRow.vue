<script setup lang="ts">
import { computed } from 'vue'
import { useAfc } from '@/composables/useAfc'
import { usePrinterStore } from '@/stores/printer'

/**
 * The toolhead end of AFC -- Mainsail's `AfcPanelExtruder`.
 *
 * Three readings across one row: the sensors either side of the extruder, the
 * buffer state, and which lane is actually loaded.
 *
 * 🔴 THE PRE-SENSOR DOT MEANS TWO DIFFERENT THINGS, and this is upstream's
 * logic kept rather than simplified. A toolhead with `tool_start: 'buffer'`
 * has NO pre-extruder switch: it detects arrival by the tension buffer going
 * `trailing` while filament is pushed in. So on those machines the dot reports
 * the RAMMING state, and once a lane is loaded it goes neutral instead of
 * green -- because after loading, the buffer says nothing about the sensor.
 * Collapsing the two cases would light a green "filament present" dot on a
 * machine that has no such sensor at all.
 */
const props = defineProps<{ name: string }>()

const afc = useAfc()
const printer = usePrinterStore()

const extruder = computed(() => afc.extruderObject(props.name))
const settings = computed(() => afc.extruderSettings(props.name))

const isPrintingOnly = computed(() => printer.printerState === 'printing')

const useRamming = computed(() => (extruder.value.tool_start ?? '') === 'buffer')
const laneLoaded = computed(() => extruder.value.lane_loaded ?? '')

const hasActiveLane = computed(() => {
    const current = afc.currentLane.value
    if (!current?.name) return false
    return (extruder.value.lanes ?? []).includes(current.name)
})

const rammingState = computed(() => {
    if (!useRamming.value) return false
    const current = afc.currentLane.value
    return current?.extruder === props.name && (afc.currentBuffer.value?.state ?? '').toLowerCase() === 'trailing'
})

const preSensorStatus = computed(() => extruder.value.tool_start_status ?? false)

const preSensorClass = computed(() => {
    if (useRamming.value) {
        if (laneLoaded.value) return 'bg-muted-foreground/40'
        return rammingState.value ? 'bg-primary' : 'bg-destructive'
    }
    return preSensorStatus.value ? 'bg-primary' : 'bg-destructive'
})

const preSensorTitle = computed(() => {
    if (useRamming.value) {
        if (laneLoaded.value) return 'Ramming sensor'
        return `Ramming sensor - ${rammingState.value ? 'Detected' : 'Empty'}`
    }
    return `Pre-extruder sensor - ${preSensorStatus.value ? 'Detected' : 'Empty'}`
})

/** Only machines that declare `pin_tool_end` have a sensor after the gears. */
const hasPostSensor = computed(() => 'pin_tool_end' in settings.value)
const postSensorStatus = computed(() => extruder.value.tool_end_status ?? false)
const postSensorTitle = computed(() => `Post-extruder sensor - ${postSensorStatus.value ? 'Detected' : 'Empty'}`)

const bufferOutput = computed(() => {
    const current = afc.currentLane.value
    if (current?.extruder !== props.name) return 'Buffer disabled'
    return `${current?.buffer ?? '--'}: ${afc.currentBuffer.value?.state ?? '--'}`
})

const state = computed(() => {
    if (afc.currentLane.value?.extruder !== props.name) return 'Idle'
    if (isPrintingOnly.value) return 'Printing'
    return afc.currentState.value || 'Idle'
})

const stateLane = computed(() => {
    if (extruder.value.lane_loaded) return extruder.value.lane_loaded
    if (afc.currentLane.value?.name) return afc.currentLane.value.name
    return 'None'
})

const borderClass = computed(() => {
    if (!hasActiveLane.value) return 'border-border'
    return afc.errorState.value ? 'border-destructive' : 'border-primary'
})

const stateLaneClass = computed(() => {
    if (!hasActiveLane.value) return ''
    return afc.errorState.value ? 'text-destructive' : 'text-primary'
})
</script>

<template>
    <div
        class="bg-muted grid grid-cols-1 gap-1 rounded-lg border px-4 py-3 text-sm sm:grid-cols-3 sm:items-center"
        :class="borderClass"
        :data-afc-extruder="name">
        <div class="flex items-center gap-2 whitespace-nowrap">
            <span class="inline-block size-2.5 shrink-0 rounded-full" :class="preSensorClass" :title="preSensorTitle" />
            <span>{{ name }}</span>
            <span
                v-if="hasPostSensor"
                class="inline-block size-2.5 shrink-0 rounded-full"
                :class="postSensorStatus ? 'bg-primary' : 'bg-destructive'"
                :title="postSensorTitle" />
        </div>
        <div class="text-muted-foreground sm:text-center">{{ bufferOutput }}</div>
        <div class="sm:text-right">
            {{ state }}:
            <span :class="stateLaneClass">{{ stateLane }}</span>
        </div>
    </div>
</template>
