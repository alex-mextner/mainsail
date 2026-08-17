<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { mdiCrosshairsGps, mdiGrid } from '@mdi/js'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import { usePrinterStore } from '@/stores/printer'
import { useConnectionStore } from '@/stores/connection'
import { useGuiStore } from '@/stores/gui'
import { useControl } from '@/composables/useControl'

/**
 * Position readout and absolute "move to" fields -- Mainsail's
 * `ToolheadControls/MoveToControl.vue`.
 *
 * Two distinct readings, kept distinct as upstream does:
 *   - `motion_report.live_position` -- where the toolhead physically is now,
 *     shown as the field's placeholder/label.
 *   - `gcode_move.gcode_position`   -- where g-code thinks it is, which is what
 *     the input is seeded with and compared against, because that is the frame
 *     a G1 will be interpreted in.
 * Showing only one of them would be wrong during a print, when they differ by
 * the whole look-ahead queue.
 */
const printer = usePrinterStore()
const connection = useConnectionStore()
const gui = useGuiStore()
const { feedrateXY, feedrateZ, xAxisHomed, yAxisHomed, zAxisHomed, isPrinting, capabilities } = useControl()

const { gcodeMove, motionReport, bedMeshProfile } = storeToRefs(printer)

const view = computed(() => gui.state.view.toolhead)

const positionAbsolute = computed(() => gcodeMove.value?.absolute_coordinates ?? true)

const format = (values: number[] | undefined) => ({
    x: values?.[0] !== undefined ? values[0].toFixed(2) : '--',
    y: values?.[1] !== undefined ? values[1].toFixed(2) : '--',
    z: values?.[2] !== undefined ? values[2].toFixed(3) : '--',
})

const livePositions = computed(() => format(motionReport.value?.live_position))
const gcodePositions = computed(() => format(gcodeMove.value?.gcode_position))

const input = ref({ x: '', y: '', z: '' })

// Follow the printer, except in the field the user is currently editing --
// otherwise typing a target during a move gets overwritten several times a
// second.
const focused = ref<'x' | 'y' | 'z' | null>(null)
watch(
    gcodePositions,
    (next) => {
        if (focused.value !== 'x') input.value.x = next.x
        if (focused.value !== 'y') input.value.y = next.y
        if (focused.value !== 'z') input.value.z = next.z
    },
    { immediate: true }
)

const axes = computed(() => [
    { key: 'x' as const, label: 'X', homed: xAxisHomed.value, live: livePositions.value.x },
    { key: 'y' as const, label: 'Y', homed: yAxisHomed.value, live: livePositions.value.y },
    { key: 'z' as const, label: 'Z', homed: zAxisHomed.value, live: livePositions.value.z },
])

/**
 * Build the move. Z first and on its own line, so a large XY travel cannot drag
 * the nozzle across the bed at the old height -- upstream orders it the same way.
 */
function sendCmd(): void {
    const current = gcodePositions.value
    const gcode: string[] = []
    const useMacro = capabilities.value.clientLinearMove

    if (!useMacro) {
        gcode.push('SAVE_GCODE_STATE NAME=_ui_movement')
        gcode.push('G90')
    }

    if (input.value.z !== current.z) {
        gcode.push(
            useMacro
                ? `_CLIENT_LINEAR_MOVE Z=${input.value.z} F=${feedrateZ.value * 60} ABSOLUTE=1`
                : `G1 Z${input.value.z} F${feedrateZ.value * 60}`
        )
    }

    if (input.value.x !== current.x || input.value.y !== current.y) {
        const x = input.value.x !== current.x ? input.value.x : null
        const y = input.value.y !== current.y ? input.value.y : null

        if (useMacro) {
            const args = [x !== null ? ` X=${x}` : '', y !== null ? ` Y=${y}` : ''].join('')
            gcode.push(`_CLIENT_LINEAR_MOVE${args} F=${feedrateXY.value * 60} ABSOLUTE=1`)
        } else {
            const args = [x !== null ? ` X${x}` : '', y !== null ? ` Y${y}` : ''].join('')
            gcode.push(`G1${args} F${feedrateXY.value * 60}`)
        }
    }

    if (!useMacro) gcode.push('RESTORE_GCODE_STATE NAME=_ui_movement')

    // Nothing but the bookkeeping lines: no axis actually changed.
    if (gcode.every((line) => !line.startsWith('G1') && !line.startsWith('_CLIENT_LINEAR_MOVE'))) return

    void connection.sendGcode(gcode.join('\n'))
}
</script>

<template>
    <div v-if="view.showCoordinates || view.showPosition" class="flex flex-col gap-2">
        <div v-if="view.showPosition" class="text-muted-foreground flex items-center gap-2 text-xs">
            <MdiIcon :path="mdiCrosshairsGps" class="size-4 shrink-0" />
            <span class="truncate">Position: {{ positionAbsolute ? 'absolute' : 'relative' }}</span>

            <span class="grow" />

            <template v-if="bedMeshProfile">
                <MdiIcon :path="mdiGrid" class="size-4 shrink-0" />
                <span class="truncate">{{ bedMeshProfile }}</span>
            </template>
        </div>

        <!--
            Stacked field, following upstream's MoveToInput: the LIVE position is
            the caption above and the editable g-code target is the field below.
            An earlier single-line version put both side by side and the Z value
            was clipped to "12," at panel width -- two numbers plus an axis letter
            simply do not fit on one line in a dashboard column.
        -->
        <form v-if="view.showCoordinates" class="@xs:grid-cols-3 grid grid-cols-1 gap-2" @submit.prevent="sendCmd">
            <label v-for="axis in axes" :key="axis.key" class="flex flex-col gap-0.5">
                <span class="text-muted-foreground flex items-baseline gap-1 text-[11px]">
                    <span class="text-foreground font-semibold">{{ axis.label }}</span>
                    <span class="tabular truncate">{{ axis.live }}</span>
                </span>
                <input
                    v-model="input[axis.key]"
                    type="number"
                    :step="axis.key === 'z' ? 0.001 : 0.01"
                    :readonly="isPrinting"
                    :disabled="!axis.homed"
                    :aria-label="`Move to ${axis.label}`"
                    class="tabular border-input bg-background focus-visible:ring-ring w-full min-w-0 rounded-md border px-2 py-1.5 text-sm outline-none focus-visible:ring-2 disabled:opacity-40"
                    @focus="focused = axis.key"
                    @blur="focused = null" />
            </label>
            <!-- Submit lives on Enter in any field, exactly as upstream. -->
            <button type="submit" class="sr-only">Move</button>
        </form>
    </div>
</template>
