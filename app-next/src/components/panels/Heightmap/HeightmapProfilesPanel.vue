<script setup lang="ts">
import { computed, ref } from 'vue'
import { mdiDelete, mdiPencil, mdiProgressUpload, mdiStackOverflow } from '@mdi/js'
import Panel from '@/components/ui/Panel.vue'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import Dialog from '@/components/ui/Dialog.vue'
import { Button } from '@/components/ui/button'
import HeightmapRenameDialog from '@/components/panels/Heightmap/HeightmapRenameDialog.vue'
import { useBedmesh, profileStats } from '@/composables/useBedmesh'
import { useConnectionStore } from '@/stores/connection'
import { usePrinterStore } from '@/stores/printer'

/**
 * Saved meshes -- Mainsail's `HeightmapProfilesPanel.vue` and its row component,
 * merged into one file.
 *
 * They are separate upstream because the row carries its own two dialogs; here
 * the dialogs are hoisted to the panel and told which profile they act on, so
 * a bed with twelve saved meshes mounts two dialogs instead of twenty-four.
 *
 * The per-row deviation is shown as TEXT, not as upstream's hover tooltip:
 * "which of these meshes is the flat one" is the question this list exists to
 * answer, and the tablet at the machine cannot open a tooltip at all.
 */
const { profiles, profileName } = useBedmesh()
const connection = useConnectionStore()
const printer = usePrinterStore()

/**
 * Loading a profile is disabled during a print, which upstream does not do:
 * `BED_MESH_PROFILE LOAD` swaps the compensation Klipper is applying right now,
 * so the nozzle steps by the difference between the two meshes on the next
 * move. Same reasoning as the Clear button on the chart panel.
 *
 * Delete is NOT gated: it only stages a config change and touches nothing that
 * is being applied.
 */
const canLoad = computed(() => !printer.isPrinting)

const renameOpen = ref(false)
const deleteOpen = ref(false)
const target = ref('')

const rows = computed(() =>
    Object.entries(profiles.value)
        .map(([name, profile]) => ({ name, ...profileStats(profile), active: name === profileName.value }))
        .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
)

function loadProfile(name: string): void {
    void connection.sendGcode(`BED_MESH_PROFILE LOAD="${name}"`, `bedMeshLoad_${name}`)
}

function askRename(name: string): void {
    target.value = name
    renameOpen.value = true
}

function askDelete(name: string): void {
    target.value = name
    deleteOpen.value = true
}

function confirmDelete(): void {
    void connection.sendGcode(`BED_MESH_PROFILE REMOVE="${target.value}"`, `bedMeshRemove_${target.value}`)
    deleteOpen.value = false
}
</script>

<template>
    <Panel panel-name="heightmap-profiles-panel" title="Profiles" :icon="mdiStackOverflow" collapsible>
        <ul v-if="rows.length" class="divide-border divide-y">
            <li v-for="row in rows" :key="row.name" class="flex items-center gap-2 py-1">
                <button
                    type="button"
                    class="min-w-0 flex-1 text-left disabled:opacity-50"
                    :disabled="!row.active && !canLoad"
                    :title="row.active ? 'Rename this profile' : `Load ${row.name}`"
                    @click="row.active ? askRename(row.name) : loadProfile(row.name)">
                    <span class="block truncate text-sm" :class="row.active ? 'text-primary font-semibold' : ''">
                        {{ row.name }}
                    </span>
                    <span class="text-muted-foreground block font-mono text-xs tabular-nums">
                        range {{ row.variance }} · {{ row.min.toFixed(3) }} … {{ row.max.toFixed(3) }} mm
                    </span>
                </button>

                <Button
                    size="icon"
                    variant="ghost"
                    :disabled="(!row.active && !canLoad) || connection.isLoading(`bedMeshLoad_${row.name}`)"
                    :title="
                        row.active
                            ? 'Rename'
                            : canLoad
                              ? 'Load this mesh'
                              : 'Not while printing — swapping the mesh changes Z compensation mid-layer'
                    "
                    @click="row.active ? askRename(row.name) : loadProfile(row.name)">
                    <MdiIcon :path="row.active ? mdiPencil : mdiProgressUpload" class="size-5" />
                </Button>
                <Button
                    size="icon"
                    variant="ghost"
                    class="text-destructive"
                    :disabled="connection.isLoading(`bedMeshRemove_${row.name}`)"
                    title="Delete this profile"
                    @click="askDelete(row.name)">
                    <MdiIcon :path="mdiDelete" class="size-5" />
                </Button>
            </li>
        </ul>

        <p v-else class="text-muted-foreground py-3 text-sm italic">No saved profile.</p>

        <HeightmapRenameDialog v-model="renameOpen" :name="target" />

        <Dialog v-model="deleteOpen" title="Delete bed mesh profile" :description="target">
            <p class="text-sm">
                Stages the removal. Klipper does not rewrite
                <code class="font-mono">printer.cfg</code>
                until
                <code class="font-mono">SAVE_CONFIG</code>
                — which also restarts it. An already loaded mesh stays loaded either way.
            </p>
            <template #footer>
                <Button variant="ghost" @click="deleteOpen = false">Cancel</Button>
                <Button variant="destructive" @click="confirmDelete">Delete</Button>
            </template>
        </Dialog>
    </Panel>
</template>
