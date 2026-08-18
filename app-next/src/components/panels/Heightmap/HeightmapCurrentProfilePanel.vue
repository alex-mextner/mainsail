<script setup lang="ts">
import { ref } from 'vue'
import { mdiInformation, mdiPencil } from '@mdi/js'
import Panel from '@/components/ui/Panel.vue'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import HeightmapRenameDialog from '@/components/panels/Heightmap/HeightmapRenameDialog.vue'
import { useBedmesh } from '@/composables/useBedmesh'

/**
 * What the loaded mesh actually says -- Mainsail's
 * `panels/Heightmap/HeightmapCurrentProfilePanel.vue`.
 *
 * The numbers matter more than the picture: the 3D surface shows the SHAPE, but
 * "range 0.184 mm, worst point at [220, 25]" is what tells you which bed screw
 * to turn.
 */
const { isActive, name, xCount, yCount, min, max, variance, positionMin, positionMax } = useBedmesh()

const renameOpen = ref(false)

const at = (position: { x: number; y: number } | null) =>
    position ? `[${position.x.toFixed(1)}, ${position.y.toFixed(1)}]` : ''
</script>

<template>
    <Panel v-if="isActive" panel-name="heightmap-current-mesh-panel" title="Current mesh" :icon="mdiInformation" collapsible>
        <dl class="divide-border divide-y text-sm">
            <div class="flex items-center justify-between gap-4 py-2">
                <dt class="text-muted-foreground">Name</dt>
                <dd>
                    <!--
                        An adaptive mesh is computed for one print and never
                        saved, so there is no profile to rename. Upstream
                        detects it by the `adaptive-` prefix Klipper gives it;
                        kept, because the alternative is a rename that appears
                        to work and leaves nothing behind.
                    -->
                    <button
                        v-if="!name.startsWith('adaptive-')"
                        type="button"
                        class="text-primary inline-flex items-center gap-1 font-semibold"
                        @click="renameOpen = true">
                        <MdiIcon :path="mdiPencil" class="size-4" />
                        {{ name }}
                    </button>
                    <span v-else class="font-semibold">{{ name }}</span>
                </dd>
            </div>

            <div class="flex items-center justify-between gap-4 py-2">
                <dt class="text-muted-foreground">Size</dt>
                <dd class="font-mono tabular-nums">{{ xCount }}×{{ yCount }}</dd>
            </div>

            <div class="flex items-center justify-between gap-4 py-2">
                <dt class="text-muted-foreground">
                    Max
                    <span class="font-mono text-xs">{{ at(positionMax) }}</span>
                </dt>
                <dd class="font-mono tabular-nums">{{ max.toFixed(3) }} mm</dd>
            </div>

            <div class="flex items-center justify-between gap-4 py-2">
                <dt class="text-muted-foreground">
                    Min
                    <span class="font-mono text-xs">{{ at(positionMin) }}</span>
                </dt>
                <dd class="font-mono tabular-nums">{{ min.toFixed(3) }} mm</dd>
            </div>

            <div class="flex items-center justify-between gap-4 py-2">
                <dt class="text-muted-foreground">Range</dt>
                <dd class="font-mono font-semibold tabular-nums">{{ variance }} mm</dd>
            </div>
        </dl>

        <HeightmapRenameDialog v-model="renameOpen" :name="name" />
    </Panel>
</template>
