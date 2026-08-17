<script setup lang="ts">
import { computed } from 'vue'
import { mdiDotsVertical, mdiEngineOff, mdiGamepad, mdiRestore, mdiSpeedometer } from '@mdi/js'
import { storeToRefs } from 'pinia'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import Panel from '@/components/ui/Panel.vue'
import ToolSlider from '@/components/ui/ToolSlider.vue'
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/menu'
import BarsControl from './ToolheadControls/BarsControl.vue'
import CrossControl from './ToolheadControls/CrossControl.vue'
import CircleControl from './ToolheadControls/CircleControl.vue'
import MoveToControl from './ToolheadControls/MoveToControl.vue'
import ZoffsetControl from './ToolheadControls/ZoffsetControl.vue'
import ToolheadPanelSettings from './ToolheadControls/ToolheadPanelSettings.vue'
import { usePrinterStore } from '@/stores/printer'
import { useConnectionStore } from '@/stores/connection'
import { useGuiStore } from '@/stores/gui'
import { useControl } from '@/composables/useControl'

/**
 * Toolhead control -- Mainsail's `panels/ToolheadControlPanel.vue`.
 *
 * Structure is upstream's, top to bottom: move-to fields, the axis control in
 * whichever of the three styles is selected, the Z offset row, the speed factor
 * slider. Each section can be hidden from the cog menu, and the 3-dot menu holds
 * the bed-levelling commands the machine actually supports.
 */
const printer = usePrinterStore()
const connection = useConnectionStore()
const gui = useGuiStore()
const { capabilities, actionButton, isPrinting, doSend, doMotorsOff, doQGL, doZtilt } = useControl()

const { klippyState } = storeToRefs(connection)
const { gcodeMove } = storeToRefs(printer)

const control = computed(() => gui.state.control)
const view = computed(() => gui.state.view.toolhead)

const speedFactor = computed(() => gcodeMove.value?.speed_factor ?? 1)

/**
 * Upstream hides the axis controls during a print if the user asked for it --
 * a deliberate guard against nudging the head mid-job from a tablet.
 */
const axisControlVisible = computed(() => {
    if (!view.value.showControl) return false
    return !(isPrinting.value && control.value.hideDuringPrint)
})

/**
 * The 3-dot menu only exists if there is something in it. Its contents are
 * derived from the live config, so on this machine -- no z_tilt, no QGL, no bed
 * screws, no screws-tilt -- it correctly does not render at all, rather than
 * offering commands Klipper would reject.
 */
const showMenu = computed(() => {
    if (control.value.style !== 'bars' && (capabilities.value.zTilt || capabilities.value.qgl)) return true
    return (
        capabilities.value.bedScrews ||
        capabilities.value.bedTilt ||
        capabilities.value.deltaCalibrate ||
        capabilities.value.screwsTilt
    )
})
</script>

<template>
    <Panel
        v-if="klippyState === 'ready'"
        panel-name="toolhead-control"
        title="Tool"
        :icon="mdiGamepad"
        collapsible
        content-class="flex flex-col gap-dgap">
        <template #buttons>
            <Menu v-if="showMenu">
                <template #trigger>
                    <button
                        type="button"
                        class="text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring inline-flex size-8 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-40"
                        :disabled="isPrinting"
                        aria-label="Bed levelling commands">
                        <MdiIcon :path="mdiDotsVertical" class="size-4" />
                    </button>
                </template>

                <MenuItem v-if="control.style !== 'bars' && actionButton !== 'motorsOff'" @select="doMotorsOff">
                    <MdiIcon :path="mdiEngineOff" class="size-4" />
                    Motors off
                </MenuItem>
                <MenuItem
                    v-if="control.style !== 'bars' && capabilities.zTilt && actionButton !== 'ztilt'"
                    @select="doZtilt">
                    Z-Tilt Adjust
                </MenuItem>
                <MenuItem v-if="control.style !== 'bars' && capabilities.qgl && actionButton !== 'qgl'" @select="doQGL">
                    Quad Gantry Level
                </MenuItem>

                <MenuSeparator
                    v-if="capabilities.bedTilt || capabilities.bedScrews"
                    class="bg-border -mx-1 my-1 h-px" />

                <MenuItem v-if="capabilities.bedTilt" @select="doSend('BED_TILT_CALIBRATE')">
                    BED TILT CALIBRATE
                </MenuItem>
                <MenuItem v-if="capabilities.bedScrews" @select="doSend('BED_SCREWS_ADJUST')">
                    BED SCREWS ADJUST
                </MenuItem>
                <MenuItem v-if="capabilities.deltaCalibrate" @select="doSend('DELTA_CALIBRATE')">
                    DELTA CALIBRATE
                </MenuItem>
                <template v-if="capabilities.screwsTilt">
                    <MenuItem @select="doSend('SCREWS_TILT_CALCULATE')">SCREWS TILT CALCULATE</MenuItem>
                    <MenuItem @select="doSend('SCREWS_TILT_CALCULATE DIRECTION=CW')">
                        <MdiIcon :path="mdiRestore" class="size-4 -scale-x-100" />
                        SCREWS TILT &mdash; CW
                    </MenuItem>
                    <MenuItem @select="doSend('SCREWS_TILT_CALCULATE DIRECTION=CCW')">
                        <MdiIcon :path="mdiRestore" class="size-4" />
                        SCREWS TILT &mdash; CCW
                    </MenuItem>
                </template>
            </Menu>

            <ToolheadPanelSettings />
        </template>

        <MoveToControl />

        <template v-if="axisControlVisible">
            <BarsControl v-if="control.style === 'bars'" />
            <CrossControl v-else-if="control.style === 'cross'" />
            <CircleControl v-else-if="control.style === 'circle'" />
        </template>

        <template v-if="view.showZOffset">
            <hr class="border-border" />
            <ZoffsetControl />
        </template>

        <template v-if="view.showSpeedFactor">
            <hr class="border-border" />
            <ToolSlider
                label="Speed factor"
                :icon="mdiSpeedometer"
                :target="speedFactor"
                :min="1"
                :max="200"
                :multi="100"
                :step="5"
                dynamic-range
                has-input-field
                command="M220"
                attribute-name="S" />
        </template>
    </Panel>
</template>
