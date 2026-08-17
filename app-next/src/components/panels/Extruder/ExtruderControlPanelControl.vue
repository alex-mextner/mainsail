<script setup lang="ts">
import { computed, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { mdiArrowDownBold, mdiArrowUpBold } from '@mdi/js'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import NumberInput from '@/components/ui/NumberInput.vue'
import { Button } from '@/components/ui/button'
import EstimatedExtrusionOutput from './EstimatedExtrusionOutput.vue'
import { usePrinterStore } from '@/stores/printer'
import { useConnectionStore } from '@/stores/connection'
import { useGuiStore } from '@/stores/gui'
import { useExtruder } from '@/composables/useExtruder'

/**
 * Feed amount / feed rate and the extrude & retract buttons -- Mainsail's
 * `Extruder/ExtruderControlPanelControl.vue`.
 *
 * Both buttons are blocked for two independent reasons, and the tooltip says
 * WHICH, because they need different remedies:
 *   - the extruder is below `min_extrude_temp` (heat it), or
 *   - amount x flow exceeds `max_extrude_only_distance` (ask for less).
 * Upstream shows the same two, and the second one quotes the numbers, so
 * "requested vs allowed" is visible rather than something to work out.
 */
const printer = usePrinterStore()
const connection = useConnectionStore()
const gui = useGuiStore()

const {
    feedamount,
    feedrate,
    extrudeFactor,
    extrudePossible,
    minExtrudeTemp,
    maxExtrudeOnlyDistance,
    tooLargeExtrusion,
    setFeedamount,
    setFeedrate,
} = useExtruder()

const { capabilities, printerState } = storeToRefs(printer)

const isPrintingOnly = computed(() => printerState.value === 'printing')

const descending = (values: number[]) => [...values].sort((a, b) => b - a)
const feedamounts = computed(() => descending(gui.state.control.extruder.feedamounts ?? []))
const feedrates = computed(() => descending(gui.state.control.extruder.feedrates ?? []))

/**
 * A tool change can lower the limit below the amount currently selected. Clamp
 * rather than let the buttons sit permanently disabled with no explanation --
 * upstream does the same on this watcher.
 */
watch(
    maxExtrudeOnlyDistance,
    (limit) => {
        if (feedamount.value > limit) setFeedamount(limit)
    },
    { immediate: true }
)

const blockedReason = computed(() => {
    if (!extrudePossible.value) return `Extruder is below the minimum extrude temperature of ${minExtrudeTemp.value} °C`
    if (tooLargeExtrusion.value) {
        const requested = Math.round(feedamount.value * extrudeFactor.value * 100) / 100
        return `Too large an extrusion — requested ${requested} mm, allowed ${maxExtrudeOnlyDistance.value} mm`
    }
    return ''
})

const disabled = computed(() => blockedReason.value !== '' || isPrintingOnly.value)

/**
 * `_CLIENT_LINEAR_MOVE` (mainsail.cfg, present here) handles the relative-mode
 * bookkeeping itself; without it the move has to be bracketed in
 * SAVE/RESTORE_GCODE_STATE so a manual extrude cannot leave the machine in M83.
 */
function sendCommand(length: number, loadingKey: string): void {
    const gcode = capabilities.value.clientLinearMove
        ? `_CLIENT_LINEAR_MOVE E=${length} F=${feedrate.value * 60}`
        : [
              'SAVE_GCODE_STATE NAME=_ui_extrude',
              'M83',
              `G1 E${length} F${feedrate.value * 60}`,
              'RESTORE_GCODE_STATE NAME=_ui_extrude',
          ].join('\n')

    void connection.sendGcode(gcode, loadingKey)
}

const sendRetract = () => sendCommand(feedamount.value * -1, 'btnRetract')
const sendExtrude = () => sendCommand(feedamount.value, 'btnExtrude')
</script>

<template>
    <div class="flex flex-col gap-3">
        <div class="@lg:grid-cols-[1fr_1fr_auto] grid grid-cols-1 gap-3 @sm:grid-cols-2">
            <div class="flex flex-col gap-2">
                <NumberInput
                    label="Filament length"
                    param="feedamount"
                    :target="feedamount"
                    :min="0.01"
                    :max="maxExtrudeOnlyDistance"
                    :step="0.01"
                    :dec="2"
                    has-spinner
                    :spinner-factor="100"
                    unit="mm"
                    submit-on-blur
                    :disabled="isPrintingOnly"
                    @submit="setFeedamount($event.value)" />

                <div class="seg-group">
                    <button
                        v-for="value in feedamounts"
                        :key="`amount-${value}`"
                        type="button"
                        class="seg-btn tabular"
                        :data-state="value === feedamount ? 'homed' : undefined"
                        :disabled="isPrintingOnly"
                        @click="setFeedamount(value)">
                        {{ value }}
                    </button>
                </div>
            </div>

            <div class="flex flex-col gap-2">
                <NumberInput
                    label="Extrusion feedrate"
                    param="feedrate"
                    :target="feedrate"
                    :min="0.01"
                    :max="null"
                    :step="0.01"
                    :dec="2"
                    has-spinner
                    :spinner-factor="100"
                    unit="mm/s"
                    submit-on-blur
                    :disabled="isPrintingOnly"
                    @submit="setFeedrate($event.value)" />

                <div class="seg-group">
                    <button
                        v-for="value in feedrates"
                        :key="`rate-${value}`"
                        type="button"
                        class="seg-btn tabular"
                        :data-state="value === feedrate ? 'homed' : undefined"
                        :disabled="isPrintingOnly"
                        @click="setFeedrate(value)">
                        {{ value }}
                    </button>
                </div>
            </div>

            <!--
                Wide panels get the two commands as a column beside the fields,
                narrow ones as a centred row below. Container-width, so a panel
                in a narrow dashboard column behaves like a narrow panel.
            -->
            <div
                class="@lg:flex-col @lg:justify-center flex flex-row justify-center gap-2 @sm:col-span-2 @lg:col-span-1">
                <Button
                    variant="secondary"
                    size="sm"
                    class="min-w-[130px]"
                    :disabled="disabled || connection.isLoading('btnRetract')"
                    :title="blockedReason || undefined"
                    @click="sendRetract">
                    <MdiIcon :path="mdiArrowUpBold" class="size-4" />
                    Retract
                </Button>

                <Button
                    variant="secondary"
                    size="sm"
                    class="min-w-[130px]"
                    :disabled="disabled || connection.isLoading('btnExtrude')"
                    :title="blockedReason || undefined"
                    @click="sendExtrude">
                    <MdiIcon :path="mdiArrowDownBold" class="size-4" />
                    Extrude
                </Button>
            </div>
        </div>

        <!-- Why the buttons are dead, in words. Upstream hides this in a tooltip
             that a touch device cannot show at all. -->
        <p v-if="blockedReason" class="text-warn text-center text-[11px]">{{ blockedReason }}</p>

        <EstimatedExtrusionOutput />
    </div>
</template>
