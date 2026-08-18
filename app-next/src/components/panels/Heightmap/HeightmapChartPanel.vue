<script setup lang="ts">
import { computed, ref } from 'vue'
import { SliderRoot, SliderTrack, SliderRange, SliderThumb } from 'reka-ui'
import { mdiGrid, mdiHome } from '@mdi/js'
import Panel from '@/components/ui/Panel.vue'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import { Button } from '@/components/ui/button'
import HeightmapChart from '@/components/panels/Heightmap/HeightmapChart.vue'
import HeightmapCalibrateDialog from '@/components/panels/Heightmap/HeightmapCalibrateDialog.vue'
import { useGuiStore } from '@/stores/gui'
import { usePrinterStore } from '@/stores/printer'
import { useConnectionStore } from '@/stores/connection'
import { useBedmesh } from '@/composables/useBedmesh'

/**
 * The heightmap panel -- Mainsail's `panels/Heightmap/HeightmapChartPanel.vue`.
 *
 * 🔴 THE BUTTONS ARE GATED ON THE MACHINE HAVING A `[bed_mesh]` SECTION
 * --------------------------------------------------------------------
 * Upstream offers Calibrate and Clear unconditionally. On a printer with no
 * `[bed_mesh]` in its config -- which is this machine today, because the
 * CR-Touch burnt out and `[include cr-touch.cfg]` is commented out -- those
 * buttons send commands Klipper does not have and answers with "Unknown
 * command". This repository already settled that question for the bed-levelling
 * menu on the toolhead panel: capabilities come from the live config, and a
 * command the machine cannot run is not offered.
 *
 * The difference from upstream is stated on screen rather than left as a
 * mystery gap, because "the heightmap page is empty" is a symptom the user will
 * see today and needs an explanation for.
 */
const gui = useGuiStore()
const printer = usePrinterStore()
const connection = useConnectionStore()
const { isActive, min, max } = useBedmesh()

const calibrateOpen = ref(false)

const view = computed(() => gui.state.view.heightmap)

/** Whether this printer can mesh at all. */
const hasBedMesh = computed(() => printer.hasConfigSection('bed_mesh'))

const homed = computed(() => printer.homedAxes.includes('x') && printer.homedAxes.includes('y') && printer.homedAxes.includes('z'))

function set(key: keyof typeof view.value, value: boolean | number): void {
    gui.saveSetting(`view.heightmap.${key}`, value)
}

/**
 * Z-axis half-height range for the slider.
 *
 * The floor is the mesh's own worst deviation rounded up to 0.1 mm, so the
 * surface can never be scaled until it leaves the box; the ceiling is at least
 * 1 mm so there is always something to drag even on a near-perfect bed.
 */
const zMaxRange = computed(() => {
    const floor = Math.round(Math.max(Math.abs(min.value), Math.abs(max.value)) * 10) / 10
    return [floor, Math.max(floor, 1)]
})

const zMax = computed({
    get: () => [Math.min(Math.max(view.value.scaleZMax, zMaxRange.value[0]), zMaxRange.value[1])],
    set: (value: number[]) => set('scaleZMax', value[0]),
})

const toggles = [
    { key: 'probed', label: 'Probed' },
    { key: 'mesh', label: 'Mesh' },
    { key: 'flat', label: 'Flat' },
    { key: 'wireframe', label: 'Wireframe' },
] as const

function homeAll(): void {
    void connection.sendGcode('G28', 'homeAll')
}

function clearMesh(): void {
    void connection.sendGcode('BED_MESH_CLEAR', 'bedMeshClear')
}
</script>

<template>
    <Panel panel-name="heightmap-map-panel" title="Heightmap" :icon="mdiGrid" content-class="flex flex-col gap-dgap">
        <template #buttons>
            <!--
                Home is offered whatever the config says: G28 always exists, and
                a mesh cannot be probed on an unhomed machine anyway. Amber
                while the axes are not homed, which is the state that makes
                every other button here pointless.
            -->
            <Button
                size="icon"
                :variant="homed ? 'ghost' : 'outline'"
                :class="homed ? 'text-primary' : 'text-amber-500 border-amber-500/60'"
                :disabled="printer.isPrinting || connection.isLoading('homeAll')"
                title="Home all axes (G28)"
                @click="homeAll">
                <MdiIcon :path="mdiHome" class="size-5" />
            </Button>
            <!--
                🔴 Disabled during a print, which upstream does NOT do.
                BED_MESH_CLEAR takes Z compensation away mid-layer: the mesh is
                applied continuously, so clearing it while printing does not
                "take effect next time", it steps the nozzle by the local
                deviation on the very next move. Same reasoning that already
                gated the endstop query on the Machine page.
            -->
            <Button
                v-if="hasBedMesh && isActive"
                size="sm"
                variant="ghost"
                :disabled="printer.isPrinting || connection.isLoading('bedMeshClear')"
                :title="
                    printer.isPrinting
                        ? 'Not while printing — clearing the mesh removes Z compensation mid-layer'
                        : 'Unload the current mesh (BED_MESH_CLEAR)'
                "
                @click="clearMesh">
                Clear
            </Button>
            <Button
                v-if="hasBedMesh"
                size="sm"
                variant="ghost"
                :disabled="printer.isPrinting || connection.isLoading('bedMeshCalibrate')"
                title="Probe a new mesh (BED_MESH_CALIBRATE)"
                @click="calibrateOpen = true">
                Calibrate
            </Button>
        </template>

        <!--
            No [bed_mesh] section at all. Said in words, because an empty page
            with no buttons reads as a broken port rather than as a machine that
            cannot do this yet.
        -->
        <p v-if="!hasBedMesh" class="text-muted-foreground py-3 text-sm leading-relaxed">
            This printer has no
            <code class="font-mono text-xs">[bed_mesh]</code>
            section, so there is nothing to probe, load or draw. Bed meshing needs a Z probe; add the section to the
            config and this page fills itself in. Calibrate and Clear are hidden rather than greyed out because Klipper
            would answer them with “Unknown command”.
        </p>

        <p v-else-if="!isActive" class="text-muted-foreground py-3 text-center text-sm italic">
            No bed mesh has been loaded yet.
        </p>

        <template v-else>
            <HeightmapChart />

            <div class="gap-dgap flex flex-wrap items-center justify-between">
                <label class="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                        type="checkbox"
                        class="accent-primary size-4"
                        :checked="view.scaleGradient"
                        @change="set('scaleGradient', ($event.target as HTMLInputElement).checked)" />
                    <span>Scale gradient</span>
                </label>

                <div class="gap-dgap flex flex-wrap items-center">
                    <label v-for="toggle in toggles" :key="toggle.key" class="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            class="accent-primary size-4"
                            :checked="view[toggle.key]"
                            @change="set(toggle.key, ($event.target as HTMLInputElement).checked)" />
                        <span>{{ toggle.label }}</span>
                    </label>
                </div>
            </div>

            <!--
                Written out rather than left to a tooltip: the tablet at the
                machine cannot open one, and "scale gradient" is not
                self-explanatory -- it changes what a colour MEANS.
            -->
            <p class="text-muted-foreground text-xs leading-snug">
                With the gradient scaled, the colour ramp is stretched over this mesh’s own extremes, which shows its
                shape but makes two meshes incomparable. Off, the ramp is a fixed ±0.1&nbsp;mm, so the same colour always
                means the same deviation.
            </p>

            <div class="border-border flex items-center gap-4 border-t pt-3">
                <span class="text-muted-foreground shrink-0 text-sm">Z scale</span>
                <SliderRoot
                    v-model="zMax"
                    class="relative flex h-5 w-full flex-1 touch-none items-center select-none"
                    :min="zMaxRange[0]"
                    :max="zMaxRange[1]"
                    :step="0.1">
                    <SliderTrack class="bg-secondary relative h-1.5 w-full grow rounded-full">
                        <SliderRange class="bg-primary absolute h-full rounded-full" />
                    </SliderTrack>
                    <SliderThumb
                        class="border-primary bg-background focus-visible:ring-ring block size-4 rounded-full border-2 focus-visible:ring-2 focus-visible:outline-none"
                        aria-label="Z axis scale" />
                </SliderRoot>
                <span class="w-16 shrink-0 text-right font-mono text-sm tabular-nums">
                    ±{{ view.scaleZMax.toFixed(1) }}
                </span>
            </div>
        </template>

        <HeightmapCalibrateDialog v-model="calibrateOpen" />
    </Panel>
</template>
