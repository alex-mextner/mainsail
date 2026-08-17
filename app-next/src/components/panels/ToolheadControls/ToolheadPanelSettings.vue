<script setup lang="ts">
import { computed } from 'vue'
import { mdiCog } from '@mdi/js'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import { Menu, MenuCheckboxItem, MenuLabel, MenuSeparator } from '@/components/ui/menu'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import { useGuiStore } from '@/stores/gui'
import type { ControlStyle } from '@/stores/gui'

/**
 * The cog in the toolhead panel header -- Mainsail's
 * `ToolheadControls/ToolheadPanelSettings.vue`.
 *
 * Upstream's five view toggles, plus the control-style picker. Upstream buries
 * the style choice in Settings -> Interface -> Control, two navigations away
 * from the thing it changes; putting it here as well costs one row and makes
 * the three styles discoverable at all. The settings page remains the canonical
 * place for step sizes and feedrates.
 */
const gui = useGuiStore()

const view = computed(() => gui.state.view.toolhead)

const toggles = [
    { key: 'showPosition', label: 'Position output' },
    { key: 'showCoordinates', label: 'Coordinate fields' },
    { key: 'showControl', label: 'Control buttons' },
    { key: 'showZOffset', label: 'Z offset' },
    { key: 'showSpeedFactor', label: 'Speed factor' },
] as const

const styleOptions: { value: ControlStyle; label: string }[] = [
    { value: 'bars', label: 'Bars' },
    { value: 'cross', label: 'Cross' },
    { value: 'circle', label: 'Circle' },
]

const style = computed({
    get: () => gui.state.control.style,
    set: (value: ControlStyle) => gui.saveSetting('control.style', value),
})
</script>

<template>
    <Menu content-class="min-w-[14rem]">
        <template #trigger>
            <button
                type="button"
                class="text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring inline-flex size-8 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
                aria-label="Toolhead panel settings">
                <MdiIcon :path="mdiCog" class="size-4" />
            </button>
        </template>

        <MenuLabel class="text-muted-foreground px-2 py-1.5 text-xs font-medium">Control style</MenuLabel>
        <div class="px-2 pb-1.5" @click.stop>
            <SegmentedControl v-model="style" :options="styleOptions" class="w-full" />
        </div>

        <MenuSeparator class="bg-border -mx-1 my-1 h-px" />

        <MenuCheckboxItem
            v-for="toggle in toggles"
            :key="toggle.key"
            :model-value="view[toggle.key]"
            :label="toggle.label"
            @update:model-value="gui.saveSetting(`view.toolhead.${toggle.key}`, $event)" />
    </Menu>
</template>
