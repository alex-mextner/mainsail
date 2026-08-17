<script setup lang="ts">
import { computed } from 'vue'
import PressureAdvanceSettings from './PressureAdvanceSettings.vue'
import { usePrinterStore } from '@/stores/printer'

/**
 * Pressure advance for one `[extruder_stepper]` -- Mainsail's
 * `Extruder/ExtruderStepperPressureAdvanceSettings.vue`.
 *
 * An extruder_stepper has its own pressure advance but no temperature of its
 * own; when synced to an extruder via `motion_queue` it follows that extruder's
 * moves, so the heading says which one -- otherwise a row of identically-named
 * fields gives no clue what it belongs to.
 */
const props = defineProps<{ extruderStepper: string }>()

const printer = usePrinterStore()

const name = computed(() => props.extruderStepper.slice('extruder_stepper '.length))

const motionQueue = computed(
    () => (printer.objects[props.extruderStepper] as { motion_queue?: string } | undefined)?.motion_queue ?? ''
)

const capitalise = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

const heading = computed(() =>
    motionQueue.value ? `${capitalise(name.value)} (synced with ${motionQueue.value})` : capitalise(name.value)
)
</script>

<template>
    <div class="flex flex-col gap-2">
        <p class="text-muted-foreground text-dlabel font-medium">{{ heading }}</p>
        <PressureAdvanceSettings :extruder="extruderStepper" />
    </div>
</template>
