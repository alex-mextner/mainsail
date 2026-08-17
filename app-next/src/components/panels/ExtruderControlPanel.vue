<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { mdiDotsVertical, mdiPrinter3dNozzle, mdiPrinter3dNozzleOutline } from '@mdi/js'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import Panel from '@/components/ui/Panel.vue'
import ToolSlider from '@/components/ui/ToolSlider.vue'
import { Menu, MenuItem } from '@/components/ui/menu'
import ExtruderPanelSettings from './Extruder/ExtruderPanelSettings.vue'
import ExtruderControlPanelTools from './Extruder/ExtruderControlPanelTools.vue'
import ExtruderPressureAdvanceSettings from './Extruder/ExtruderPressureAdvanceSettings.vue'
import ExtruderStepperPressureAdvanceSettings from './Extruder/ExtruderStepperPressureAdvanceSettings.vue'
import FirmwareRetractionSettings from './Extruder/FirmwareRetractionSettings.vue'
import ExtruderControlPanelControl from './Extruder/ExtruderControlPanelControl.vue'
import { usePrinterStore } from '@/stores/printer'
import { useConnectionStore } from '@/stores/connection'
import { useGuiStore } from '@/stores/gui'
import { useExtruder } from '@/composables/useExtruder'

/**
 * Extruder -- Mainsail's `panels/ExtruderControlPanel.vue`.
 *
 * Sections in upstream's order: tool selector, extrusion factor, pressure
 * advance, firmware retraction, extrude/retract controls. Each is individually
 * hideable from the cog, and each also disappears when the machine cannot
 * support it at all.
 *
 * On THIS machine that means: no tools (no T0/T1 macros), no firmware
 * retraction (section not declared). Load and unload filament DO appear, since
 * LOAD_FILAMENT / UNLOAD_FILAMENT exist in filament-load.cfg.
 */
const printer = usePrinterStore()
const connection = useConnectionStore()
const gui = useGuiStore()
const { extruders } = useExtruder()

const { klippyState } = storeToRefs(connection)
const { capabilities, extruderSteppers, toolchangeMacros, macros, extrudePossible, gcodeMove } = storeToRefs(printer)

const { minExtrudeTemp } = useExtruder()

const view = computed(() => gui.state.view.extruder)
const extrudeFactor = computed(() => gcodeMove.value?.extrude_factor ?? 1)
const isPrintingOnly = computed(() => printer.printerState === 'printing')

const showPanel = computed(() => klippyState.value === 'ready' && extruders.value.length > 0)

/**
 * Filament macros are matched by NAME, against both spellings each community
 * config uses. Upstream does the same -- there is no Klipper-level convention
 * for these, so name matching is the only handle available.
 */
const findMacro = (names: string[]) =>
    macros.value.find((macro) => names.includes(macro.name.toUpperCase())) ?? undefined

const loadFilamentMacro = computed(() => findMacro(['LOAD_FILAMENT', 'FILAMENT_LOAD']))
const unloadFilamentMacro = computed(() => findMacro(['UNLOAD_FILAMENT', 'FILAMENT_UNLOAD']))
const purgeFilamentMacro = computed(() => findMacro(['PURGE_FILAMENT', 'FILAMENT_PURGE']))
const cleanNozzleMacro = computed(() => findMacro(['CLEAN_NOZZLE', 'NOZZLE_CLEAN', 'WIPE_NOZZLE', 'NOZZLE_WIPE']))

/**
 * A filament macro that heats the nozzle itself may run while cold; one that
 * just extrudes may not. Upstream detects this by looking for a heat-and-wait
 * in the macro body, which is a heuristic but a good one -- it is the only
 * evidence available without executing the macro.
 *
 * Worth knowing for this machine: LOAD_FILAMENT / UNLOAD_FILAMENT here do NOT
 * heat, they rely on Klipper's own G1 E refusal below min_extrude_temp. So both
 * are correctly offered only once the hotend is up to temperature.
 */
const HEAT_AND_WAIT = ['printer.extruder.can_extrude', 'TEMPERATURE_WAIT', 'M109']

const canExecute = (macro: { gcode: string } | undefined) => {
    if (extrudePossible.value) return true
    if (!macro) return false
    return HEAT_AND_WAIT.some((needle) => macro.gcode.includes(needle))
}

const filamentActions = computed(() =>
    [
        { macro: unloadFilamentMacro.value, label: 'Unload filament' },
        { macro: loadFilamentMacro.value, label: 'Load filament' },
        { macro: purgeFilamentMacro.value, label: 'Purge filament' },
        // Nozzle cleaning is a movement macro, not an extrusion one, so it is
        // never gated on temperature -- upstream makes the same exception.
        { macro: cleanNozzleMacro.value, label: 'Clean nozzle', alwaysAllowed: true },
    ]
        .filter((action) => action.macro !== undefined)
        .map((action) => ({
            name: action.macro!.name,
            label: action.label,
            disabled: (!action.alwaysAllowed && !canExecute(action.macro)) || isPrintingOnly.value,
        }))
)

const showFilamentMacros = computed(() => filamentActions.value.length > 0)

const showTools = computed(() => toolchangeMacros.value.length > 0 && view.value.showTools)
const showFirmwareRetraction = computed(
    () => capabilities.value.firmwareRetraction && view.value.showFirmwareRetraction
)

/** Divider only between two sections that are both actually showing. */
const dividerBefore = computed(() => ({
    extrusionFactor: showTools.value,
    pressureAdvance: showTools.value || view.value.showExtrusionFactor,
    firmwareRetraction: showTools.value || view.value.showExtrusionFactor || view.value.showPressureAdvance,
    control:
        showTools.value ||
        view.value.showExtrusionFactor ||
        view.value.showPressureAdvance ||
        showFirmwareRetraction.value,
}))

const runMacro = (name: string) => connection.sendGcode(name)
</script>

<template>
    <Panel
        v-if="showPanel"
        panel-name="extruder-control"
        title="Extruder"
        :icon="mdiPrinter3dNozzle"
        collapsible
        content-class="flex flex-col gap-dgap">
        <template #buttons>
            <Menu v-if="showFilamentMacros">
                <template #trigger>
                    <button
                        type="button"
                        class="text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring inline-flex size-8 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
                        aria-label="Filament macros">
                        <MdiIcon :path="mdiDotsVertical" class="size-4" />
                    </button>
                </template>

                <MenuItem
                    v-for="action in filamentActions"
                    :key="action.name"
                    :disabled="action.disabled"
                    :title="action.disabled && !isPrintingOnly ? `Extruder is below ${minExtrudeTemp} °C` : undefined"
                    @select="runMacro(action.name)">
                    {{ action.label }}
                </MenuItem>
            </Menu>

            <ExtruderPanelSettings />
        </template>

        <ExtruderControlPanelTools v-if="showTools" />

        <template v-if="view.showExtrusionFactor">
            <hr v-if="dividerBefore.extrusionFactor" class="border-border" />
            <ToolSlider
                label="Extrusion factor"
                :icon="mdiPrinter3dNozzleOutline"
                :target="extrudeFactor"
                :min="1"
                :max="200"
                :multi="100"
                :step="1"
                has-input-field
                command="M221"
                attribute-name="S" />
        </template>

        <template v-if="view.showPressureAdvance">
            <hr v-if="dividerBefore.pressureAdvance" class="border-border" />
            <ExtruderPressureAdvanceSettings v-if="extruderSteppers.length === 0" />
            <ExtruderStepperPressureAdvanceSettings
                v-for="stepper in extruderSteppers"
                v-else
                :key="stepper"
                :extruder-stepper="stepper" />
        </template>

        <template v-if="showFirmwareRetraction">
            <hr v-if="dividerBefore.firmwareRetraction" class="border-border" />
            <FirmwareRetractionSettings />
        </template>

        <template v-if="view.showExtruderControl">
            <hr v-if="dividerBefore.control" class="border-border" />
            <ExtruderControlPanelControl />
        </template>
    </Panel>
</template>
