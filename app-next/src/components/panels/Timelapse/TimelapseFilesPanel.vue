<script setup lang="ts">
import { ref, computed } from 'vue'
import {
    mdiFileVideo,
    mdiFolderZipOutline,
    mdiMagnify,
    mdiRefresh,
    mdiCloudDownload,
    mdiDelete,
    mdiPlayCircleOutline,
} from '@mdi/js'
import Panel from '@/components/ui/Panel.vue'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import Dialog from '@/components/ui/Dialog.vue'
import { Button } from '@/components/ui/button'
import { useTimelapseStore, type TimelapseFile } from '@/stores/timelapse'
import { formatFilesize, formatDateTime } from '@/lib/format'

/**
 * The rendered timelapses -- Mainsail's `Timelapse/TimelapseFilesPanel.vue`.
 *
 * Ported: the list with size and date, sorting, search, multi-select with a
 * delete-selected action, per-row download and delete, and playing an .mp4 in
 * place. See the store for why this reads the root FLAT instead of walking
 * directories, and what is given up for it.
 *
 * NOT ported, deliberately: creating, renaming and moving directories inside
 * the timelapse root, and uploading into it. moonraker-timelapse names its own
 * output from `time_format_code`, so a renamed file stops matching the pattern
 * the component wrote it under; and this panel is for watching and clearing
 * out videos, not for filing them. Deleting is here because a 512 MB Orange Pi
 * with everything on one SD card genuinely needs it.
 */
const timelapse = useTimelapseStore()

const search = ref('')
const selected = ref<string[]>([])
const playing = ref<TimelapseFile | null>(null)
const confirmDelete = ref<TimelapseFile[] | null>(null)
const sortDesc = ref(true)

const visible = computed(() => {
    const needle = search.value.trim().toLowerCase()

    return [...timelapse.files]
        .filter((file) => !needle || file.path.toLowerCase().includes(needle))
        .sort((a, b) => (sortDesc.value ? b.modified - a.modified : a.modified - b.modified))
})

const allSelected = computed(() => visible.value.length > 0 && selected.value.length === visible.value.length)

function toggleAll(): void {
    selected.value = allSelected.value ? [] : visible.value.map((file) => file.path)
}

function toggle(path: string): void {
    selected.value = selected.value.includes(path)
        ? selected.value.filter((entry) => entry !== path)
        : [...selected.value, path]
}

/** `2026-08-18/print.mp4` -> `2026-08-18/`, or '' when it sits in the root. */
const directoryOf = (file: TimelapseFile) => file.path.slice(0, file.path.length - file.filename.length)

const isVideo = (file: TimelapseFile) => file.path.endsWith('.mp4')

async function runDelete(): Promise<void> {
    const targets = confirmDelete.value ?? []
    confirmDelete.value = null

    for (const file of targets) await timelapse.deleteFile(file.path)

    selected.value = selected.value.filter((path) => !targets.some((file) => file.path === path))
}

const selectedFiles = computed(() => visible.value.filter((file) => selected.value.includes(file.path)))
</script>

<template>
    <Panel panel-name="timelapse-files" title="Timelapses" :icon="mdiFileVideo">
        <template #buttons>
            <button
                v-if="selected.length"
                type="button"
                class="text-destructive hover:bg-accent focus-visible:ring-ring inline-flex size-8 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
                :aria-label="`Delete ${selected.length} selected`"
                @click="confirmDelete = selectedFiles">
                <MdiIcon :path="mdiDelete" class="size-5" />
            </button>
            <button
                type="button"
                class="text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring inline-flex size-8 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
                aria-label="Refresh"
                @click="timelapse.loadFiles()">
                <MdiIcon :path="mdiRefresh" class="size-5" />
            </button>
        </template>

        <div class="gap-dgap flex flex-col">
            <div class="relative">
                <MdiIcon
                    :path="mdiMagnify"
                    class="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2" />
                <input
                    v-model="search"
                    type="search"
                    placeholder="Search"
                    aria-label="Search timelapses"
                    class="border-input bg-background focus-visible:ring-ring h-(--density-control) w-full rounded-md border pr-2 pl-8 text-sm focus-visible:ring-2 focus-visible:outline-none" />
            </div>

            <div class="overflow-x-auto">
                <table class="w-full min-w-0 text-sm">
                    <thead>
                        <tr class="text-muted-foreground border-b text-left">
                            <th class="w-8 py-2">
                                <input
                                    type="checkbox"
                                    :checked="allSelected"
                                    aria-label="Select all"
                                    class="accent-primary size-4 align-middle"
                                    @change="toggleAll" />
                            </th>
                            <th class="py-2 font-medium">Name</th>
                            <th class="py-2 text-right font-medium">Size</th>
                            <th
                                class="hover:text-foreground cursor-pointer py-2 text-right font-medium"
                                @click="sortDesc = !sortDesc">
                                Modified {{ sortDesc ? '↓' : '↑' }}
                            </th>
                            <th class="w-20 py-2" />
                        </tr>
                    </thead>
                    <tbody class="divide-border divide-y">
                        <tr v-for="file in visible" :key="file.path" class="hover:bg-accent/40">
                            <td class="py-2">
                                <input
                                    type="checkbox"
                                    :checked="selected.includes(file.path)"
                                    :aria-label="`Select ${file.filename}`"
                                    class="accent-primary size-4 align-middle"
                                    @change="toggle(file.path)" />
                            </td>
                            <td class="min-w-0 py-2">
                                <button
                                    v-if="isVideo(file)"
                                    type="button"
                                    class="hover:text-primary flex min-w-0 items-center gap-2 text-left"
                                    :aria-label="`Play ${file.filename}`"
                                    @click="playing = file">
                                    <MdiIcon :path="mdiPlayCircleOutline" class="text-muted-foreground size-4 shrink-0" />
                                    <span class="truncate">
                                        <span v-if="directoryOf(file)" class="text-muted-foreground">
                                            {{ directoryOf(file) }}
                                        </span>{{ file.filename }}
                                    </span>
                                </button>
                                <span v-else class="flex min-w-0 items-center gap-2">
                                    <MdiIcon :path="mdiFolderZipOutline" class="text-muted-foreground size-4 shrink-0" />
                                    <span class="truncate">
                                        <span v-if="directoryOf(file)" class="text-muted-foreground">
                                            {{ directoryOf(file) }}
                                        </span>{{ file.filename }}
                                    </span>
                                </span>
                            </td>
                            <td class="tabular text-muted-foreground py-2 text-right whitespace-nowrap">
                                {{ formatFilesize(file.size) }}
                            </td>
                            <td class="tabular text-muted-foreground py-2 text-right whitespace-nowrap">
                                <!-- Moonraker reports seconds; the formatter takes ms. -->
                                {{ formatDateTime(file.modified * 1000) }}
                            </td>
                            <td class="py-2">
                                <div class="flex justify-end gap-1">
                                    <a
                                        :href="timelapse.fileUrl(file.path)"
                                        download
                                        class="text-muted-foreground hover:text-foreground inline-flex size-8 items-center justify-center rounded-md"
                                        :aria-label="`Download ${file.filename}`">
                                        <MdiIcon :path="mdiCloudDownload" class="size-4" />
                                    </a>
                                    <button
                                        type="button"
                                        class="text-muted-foreground hover:text-destructive inline-flex size-8 items-center justify-center rounded-md"
                                        :aria-label="`Delete ${file.filename}`"
                                        @click="confirmDelete = [file]">
                                        <MdiIcon :path="mdiDelete" class="size-4" />
                                    </button>
                                </div>
                            </td>
                        </tr>
                        <tr v-if="!visible.length">
                            <td colspan="5" class="text-muted-foreground py-6 text-center text-sm italic">
                                {{ search ? 'Nothing matches that search.' : 'No timelapses have been rendered yet.' }}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <Dialog
            :model-value="playing !== null"
            :title="playing?.filename ?? ''"
            description="Rendered timelapse"
            content-class="w-[min(94vw,56rem)]"
            @update:model-value="playing = null">
            <!-- `controls` and nothing else: no autoplay, because this is served
                 from the printer's own SD card over the same Wi-Fi the print is
                 streaming through. -->
            <video v-if="playing" :src="timelapse.fileUrl(playing.path)" controls class="max-h-[70vh] w-full rounded-lg" />
        </Dialog>

        <Dialog
            :model-value="confirmDelete !== null"
            title="Delete"
            :description="
                confirmDelete?.length === 1
                    ? `Delete ${confirmDelete[0].filename}?`
                    : `Delete ${confirmDelete?.length ?? 0} files?`
            "
            @update:model-value="confirmDelete = null">
            <template #footer>
                <Button variant="ghost" @click="confirmDelete = null">Cancel</Button>
                <Button variant="destructive" @click="runDelete">Delete</Button>
            </template>
        </Dialog>
    </Panel>
</template>
