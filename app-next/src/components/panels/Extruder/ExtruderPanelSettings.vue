<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { mdiCog } from '@mdi/js'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import { Menu, MenuCheckboxItem } from '@/components/ui/menu'
import { useGuiStore } from '@/stores/gui'
import { usePrinterStore } from '@/stores/printer'

/**
 * The cog in the extruder panel header -- Mainsail's
 * `Extruder/ExtruderPanelSettings.vue`.
 *
 * Rows appear only when the corresponding section could render at all: no
 * tool-change macros means no "Tools" toggle, no `[firmware_retraction]` means
 * no retraction toggle. A switch that controls nothing is worse than a missing
 * one -- it implies the feature exists and is merely off.
 */
const gui = useGuiStore()
const printer = usePrinterStore()

const { capabilities, toolchangeMacros } = storeToRefs(printer)

const view = computed(() => gui.state.view.extruder)

const toggles = computed(() =>
    [
        { key: 'showTools' as const, label: 'Tools', visible: toolchangeMacros.value.length > 0 },
        { key: 'showExtrusionFactor' as const, label: 'Extrusion factor', visible: true },
        { key: 'showPressureAdvance' as const, label: 'Pressure advance', visible: true },
        {
            key: 'showFirmwareRetraction' as const,
            label: 'Firmware retraction',
            visible: capabilities.value.firmwareRetraction,
        },
        { key: 'showExtruderControl' as const, label: 'Extruder control', visible: true },
    ].filter((toggle) => toggle.visible)
)
</script>

<template>
    <Menu>
        <template #trigger>
            <button
                type="button"
                class="text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring inline-flex size-8 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
                aria-label="Extruder panel settings">
                <MdiIcon :path="mdiCog" class="size-4" />
            </button>
        </template>

        <MenuCheckboxItem
            v-for="toggle in toggles"
            :key="toggle.key"
            :model-value="view[toggle.key]"
            :label="toggle.label"
            @update:model-value="gui.saveSetting(`view.extruder.${toggle.key}`, $event)" />
    </Menu>
</template>
