<script setup lang="ts">
import { computed, onUnmounted } from 'vue'
import NumberInput from '@/components/ui/NumberInput.vue'
import { usePrinterStore } from '@/stores/printer'
import { useConnectionStore } from '@/stores/connection'

/**
 * `[firmware_retraction]` tuning -- Mainsail's
 * `Extruder/FirmwareRetractionSettings.vue`.
 *
 * Ported for completeness; it renders on no machine that lacks the section, and
 * THIS machine does not declare `[firmware_retraction]`, so it stays hidden
 * until someone adds it. That is the intended behaviour, not a stub: the panel
 * asks the live config rather than assuming.
 *
 * Live values come from the `firmware_retraction` object, defaults from the
 * config, so the reset arrow restores what printer.cfg says rather than a
 * hardcoded guess.
 */
const printer = usePrinterStore()
const connection = useConnectionStore()

const object = computed(() => (printer.objects.firmware_retraction ?? {}) as Record<string, number>)
const config = computed(() => (printer.config.firmware_retraction ?? {}) as Record<string, number>)

/** Lengths floor to 2 dp, speeds truncate to whole mm/s -- upstream's split. */
const floor2 = (value: number) => Math.floor(value * 100) / 100

const fields = computed(() => [
    {
        label: 'Retract length',
        param: 'RETRACT_LENGTH',
        target: floor2(object.value.retract_length ?? 0),
        defaultValue: floor2(config.value.retract_length ?? 0),
        min: 0,
        step: 0.01,
        dec: 2,
        spinnerFactor: 10,
        unit: 'mm',
    },
    {
        label: 'Retract speed',
        param: 'RETRACT_SPEED',
        target: Math.trunc(object.value.retract_speed ?? 20),
        defaultValue: Math.trunc(config.value.retract_speed ?? 20),
        min: 1,
        step: 1,
        dec: 0,
        spinnerFactor: 5,
        unit: 'mm/s',
    },
    {
        label: 'Unretract extra length',
        param: 'UNRETRACT_EXTRA_LENGTH',
        target: floor2(object.value.unretract_extra_length ?? 0),
        defaultValue: floor2(config.value.unretract_extra_length ?? 0),
        min: 0,
        step: 0.01,
        dec: 2,
        spinnerFactor: 10,
        unit: 'mm',
    },
    {
        label: 'Unretract speed',
        param: 'UNRETRACT_SPEED',
        target: Math.trunc(object.value.unretract_speed ?? 10),
        defaultValue: Math.trunc(config.value.unretract_speed ?? 0),
        min: 1,
        step: 1,
        dec: 0,
        spinnerFactor: 5,
        unit: 'mm/s',
    },
])

let timer: ReturnType<typeof setTimeout> | null = null
onUnmounted(() => {
    if (timer) clearTimeout(timer)
})

function sendCmd(params: { name: string; value: number }): void {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
        void connection.sendGcode(`SET_RETRACTION ${params.name}=${params.value}`)
    }, 500)
}
</script>

<template>
    <div class="@sm:grid-cols-2 grid grid-cols-1 gap-2">
        <NumberInput
            v-for="field in fields"
            :key="field.param"
            :label="field.label"
            :param="field.param"
            :target="field.target"
            :default-value="field.defaultValue"
            :min="field.min"
            :max="null"
            :step="field.step"
            :dec="field.dec"
            has-spinner
            :spinner-factor="field.spinnerFactor"
            :unit="field.unit"
            @submit="sendCmd" />
    </div>
</template>
