<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import {
    mdiCloudDownload,
    mdiCog,
    mdiDelete,
    mdiFileDocumentMultipleOutline,
    mdiFolderPlus,
    mdiRefresh,
    mdiUpload,
} from '@mdi/js'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import Panel from '@/components/ui/Panel.vue'
import Dialog from '@/components/ui/Dialog.vue'
import { Menu, MenuCheckboxItem, MenuLabel, MenuSeparator } from '@/components/ui/menu'
import GcodefilesTable from './Gcodefiles/GcodefilesTable.vue'
import { FILE_COLUMNS } from './Gcodefiles/columns'
import { useGcodefiles, type GcodeRow } from '@/composables/useGcodefiles'
import { useFilesStore, VALID_GCODE_EXTENSIONS } from '@/stores/files'
import { useConnectionStore } from '@/stores/connection'
import { usePrinterStore } from '@/stores/printer'
import { useGuiStore } from '@/stores/gui'
import { formatFilesize } from '@/lib/format'

/**
 * G-code files -- Mainsail's `GcodefilesPanel.vue` plus the header, path bar
 * and dialogs that live beside it.
 *
 * What is NOT here, and why, rather than being shipped as permanently greyed
 * menu items:
 *   - "View 3D" needs the g-code viewer, which is its own task (M1b).
 *   - "Edit file" needs the file editor, which belongs with the Machine page.
 * Both are owed to this panel once those land. A disabled item saying "not
 * written yet" is UI debt that has to be hunted down later; an absent item is
 * not.
 */
const files = useFilesStore()
const connection = useConnectionStore()
const printer = usePrinterStore()
const gui = useGuiStore()

const {
    currentPath,
    pathSegments,
    search,
    sortBy,
    sortDesc,
    rows,
    loading,
    error,
    diskUsage,
    canWrite,
    view,
    refresh,
    open,
    goUp,
    toggleSort,
} = useGcodefiles()

const { printerState } = storeToRefs(printer)
const { klippyState } = storeToRefs(connection)
const { upload } = storeToRefs(files)

const selected = ref<string[]>([])

/**
 * Selection is component state, not persisted. Upstream keeps it in the gui
 * store, which means a reload restores a selection of files that may no longer
 * exist -- and the delete button aimed at them.
 */
const clearSelection = () => (selected.value = [])

const visibleColumns = computed(() =>
    FILE_COLUMNS.filter((column) => !view.value.hideMetadataColumns.includes(column.key))
)

function toggleColumn(key: string): void {
    const hidden = view.value.hideMetadataColumns
    const next = hidden.includes(key) ? hidden.filter((entry) => entry !== key) : [...hidden, key]

    gui.saveSetting('view.gcodefiles.hideMetadataColumns', next)
}

const canPrint = computed(
    () => klippyState.value === 'ready' && !['printing', 'paused', 'error'].includes(printerState.value)
)

const hasJobQueue = computed(() => connection.moonrakerComponents.includes('job_queue'))

// --- dialogs --------------------------------------------------------------

const target = ref<GcodeRow | null>(null)
const showPrint = ref(false)
const showDelete = ref(false)
const showRename = ref(false)
const showDuplicate = ref(false)
const showCreateDirectory = ref(false)
const showDeleteSelected = ref(false)
const nameInput = ref('')
const actionError = ref<string | null>(null)

const fileInput = ref<HTMLInputElement | null>(null)

/** Every command goes through here so one place reports a refusal. */
async function run(action: () => Promise<unknown>): Promise<void> {
    actionError.value = null
    try {
        await action()
    } catch (caught) {
        actionError.value = (caught as { message?: string })?.message ?? 'the printer refused that'
    }
}

function onAction({ type, row }: { type: string; row: GcodeRow }): void {
    target.value = row
    actionError.value = null

    switch (type) {
        case 'print':
            showPrint.value = true
            break
        case 'preheat':
            if (row.preheatGcode) void connection.sendGcode(row.preheatGcode)
            break
        case 'queue':
            void run(() => connection.call('server.job_queue.post_job', { filenames: [row.fullPath] }))
            break
        case 'metascan':
            void run(() => files.metascan(currentPath.value, row.filename).then(() => refresh()))
            break
        case 'download':
            window.open(files.downloadUrl(currentPath.value, row.filename), '_blank')
            break
        case 'rename':
            nameInput.value = row.filename
            showRename.value = true
            break
        case 'duplicate':
            nameInput.value = duplicateName(row.filename)
            showDuplicate.value = true
            break
        case 'delete':
            showDelete.value = true
            break
    }
}

/** `cube.gcode` -> `cube (copy).gcode`, keeping the extension printable. */
function duplicateName(filename: string): string {
    const dot = filename.lastIndexOf('.')
    if (dot === -1) return `${filename} (copy)`
    return `${filename.slice(0, dot)} (copy)${filename.slice(dot)}`
}

const absolute = (name: string) => `gcodes/${currentPath.value ? `${currentPath.value}/` : ''}${name}`

async function confirmPrint(): Promise<void> {
    if (!target.value) return
    await run(() => files.startPrint(currentPath.value, target.value!.filename))
    showPrint.value = false
}

async function confirmDelete(): Promise<void> {
    if (!target.value) return
    const row = target.value

    await run(() =>
        row.isDirectory
            ? files.deleteDirectory(currentPath.value, row.filename)
            : files.deleteFile(currentPath.value, row.filename)
    )
    showDelete.value = false
}

async function confirmRename(): Promise<void> {
    if (!target.value || !nameInput.value.trim()) return
    await run(() => files.move(absolute(target.value!.filename), absolute(nameInput.value.trim())))
    showRename.value = false
}

async function confirmDuplicate(): Promise<void> {
    if (!target.value || !nameInput.value.trim()) return
    await run(() => files.copy(absolute(target.value!.filename), absolute(nameInput.value.trim())))
    showDuplicate.value = false
}

async function confirmCreateDirectory(): Promise<void> {
    if (!nameInput.value.trim()) return
    await run(() => files.createDirectory(currentPath.value, nameInput.value.trim()))
    showCreateDirectory.value = false
}

async function confirmDeleteSelected(): Promise<void> {
    const chosen = rows.value.filter((row) => selected.value.includes(row.filename))

    for (const row of chosen) {
        await run(() =>
            row.isDirectory
                ? files.deleteDirectory(currentPath.value, row.filename)
                : files.deleteFile(currentPath.value, row.filename)
        )
    }

    clearSelection()
    showDeleteSelected.value = false
}

function downloadSelected(): void {
    // One file downloads directly. Several would need `server.files.zip`, which
    // writes a zip onto the printer's own disk first -- not something to do
    // silently on a 512 MB machine with an SD card, so it is a follow-up.
    const chosen = rows.value.filter((row) => selected.value.includes(row.filename) && !row.isDirectory)
    for (const row of chosen.slice(0, 1)) {
        window.open(files.downloadUrl(currentPath.value, row.filename), '_blank')
    }
}

async function onUpload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement
    const chosen = [...(input.files ?? [])]
    input.value = ''

    for (const [index, file] of chosen.entries()) {
        await run(() => files.uploadFile(currentPath.value, file, index + 1, chosen.length))
    }

    await refresh()
}

const openNewDirectory = () => {
    nameInput.value = ''
    actionError.value = null
    showCreateDirectory.value = true
}
</script>

<template>
    <Panel
        panel-name="gcodefiles"
        title="G-Code Files"
        :icon="mdiFileDocumentMultipleOutline"
        :loading="loading"
        content-class="flex min-w-0 flex-col gap-dgap">
        <template #buttons>
            <Menu align="end" persistent content-class="max-h-[70vh] overflow-y-auto">
                <template #trigger>
                    <button
                        type="button"
                        class="text-muted-foreground hover:text-foreground hover:bg-accent inline-flex size-8 items-center justify-center rounded-md"
                        aria-label="Column settings">
                        <MdiIcon :path="mdiCog" class="size-4" />
                    </button>
                </template>

                <MenuLabel class="text-muted-foreground px-2 py-1.5 text-xs">Show</MenuLabel>
                <MenuCheckboxItem
                    label="Hidden files"
                    :model-value="view.showHiddenFiles"
                    @update:model-value="gui.saveSetting('view.gcodefiles.showHiddenFiles', $event)" />
                <MenuCheckboxItem
                    label="Already printed files"
                    :model-value="view.showPrintedFiles"
                    @update:model-value="gui.saveSetting('view.gcodefiles.showPrintedFiles', $event)" />

                <MenuSeparator class="bg-border my-1 h-px" />
                <MenuLabel class="text-muted-foreground px-2 py-1.5 text-xs">Columns</MenuLabel>
                <MenuCheckboxItem
                    v-for="column in FILE_COLUMNS"
                    :key="column.key"
                    :label="column.label"
                    :model-value="!view.hideMetadataColumns.includes(column.key)"
                    @update:model-value="toggleColumn(column.key)" />
            </Menu>
        </template>

        <!-- toolbar -->
        <div class="flex flex-wrap items-center gap-2">
            <input
                v-model="search"
                type="search"
                placeholder="Search"
                aria-label="Search files"
                class="border-input bg-background focus-visible:ring-ring min-w-0 flex-1 rounded-md border px-3 py-1.5 text-sm outline-none focus-visible:ring-2 sm:max-w-[18rem]" />

            <div class="flex items-center gap-1">
                <button
                    v-if="selected.length"
                    type="button"
                    class="bg-secondary text-secondary-foreground hover:bg-secondary/80 inline-flex size-9 items-center justify-center rounded-md"
                    title="Download the selected file"
                    @click="downloadSelected">
                    <MdiIcon :path="mdiCloudDownload" class="size-4" />
                </button>

                <button
                    v-if="selected.length"
                    type="button"
                    class="bg-destructive text-destructive-foreground hover:bg-destructive/90 inline-flex size-9 items-center justify-center rounded-md disabled:opacity-50"
                    title="Delete the selected files"
                    :disabled="!canWrite"
                    @click="showDeleteSelected = true">
                    <MdiIcon :path="mdiDelete" class="size-4" />
                </button>

                <input
                    ref="fileInput"
                    type="file"
                    multiple
                    class="hidden"
                    :accept="VALID_GCODE_EXTENSIONS.join(',')"
                    @change="onUpload" />

                <button
                    type="button"
                    class="border-input hover:bg-accent inline-flex size-9 items-center justify-center rounded-md border disabled:opacity-50"
                    title="Upload g-code"
                    :disabled="!canWrite"
                    @click="fileInput?.click()">
                    <MdiIcon :path="mdiUpload" class="size-4" />
                </button>

                <button
                    type="button"
                    class="border-input hover:bg-accent inline-flex size-9 items-center justify-center rounded-md border disabled:opacity-50"
                    title="New directory"
                    :disabled="!canWrite"
                    @click="openNewDirectory">
                    <MdiIcon :path="mdiFolderPlus" class="size-4" />
                </button>

                <button
                    type="button"
                    class="border-input hover:bg-accent inline-flex size-9 items-center justify-center rounded-md border"
                    title="Refresh this directory"
                    @click="refresh">
                    <MdiIcon :path="mdiRefresh" class="size-4" />
                </button>
            </div>
        </div>

        <!-- path + disk -->
        <div class="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs">
            <nav class="flex flex-wrap items-center gap-1" aria-label="Path">
                <button type="button" class="hover:text-foreground font-medium" @click="currentPath = ''">
                    /gcodes
                </button>
                <template v-for="(segment, index) in pathSegments" :key="index">
                    <span>/</span>
                    <button
                        type="button"
                        class="hover:text-foreground"
                        @click="currentPath = pathSegments.slice(0, index + 1).join('/')">
                        {{ segment }}
                    </button>
                </template>
            </nav>

            <span
                v-if="diskUsage"
                :title="`Used ${formatFilesize(diskUsage.used)} of ${formatFilesize(diskUsage.total)}`">
                <span class="font-medium">Free:</span>
                {{ formatFilesize(diskUsage.free) }}
            </span>
        </div>

        <p v-if="upload" class="text-muted-foreground text-xs">
            Uploading {{ upload.filename }} ({{ upload.index }}/{{ upload.total }}) — {{ upload.percent }}%
        </p>

        <p v-if="actionError" class="text-destructive text-xs">{{ actionError }}</p>

        <GcodefilesTable
            :rows="rows"
            :columns="visibleColumns"
            :sort-by="sortBy"
            :sort-desc="sortDesc"
            :current-path="currentPath"
            :selected="selected"
            :loading="loading"
            :error="error"
            :can-print="canPrint"
            :can-write="canWrite"
            :has-job-queue="hasJobQueue"
            @sort="toggleSort"
            @open="open"
            @up="goUp"
            @update:selected="selected = $event"
            @action="onAction" />

        <!-- dialogs -->
        <Dialog v-model="showPrint" title="Start print" :description="target?.filename">
            <p class="text-muted-foreground text-sm">The printer will home and begin this file immediately.</p>
            <template #footer>
                <button type="button" class="hover:bg-accent rounded-md px-3 py-2 text-sm" @click="showPrint = false">
                    Cancel
                </button>
                <button
                    type="button"
                    class="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-2 text-sm font-medium"
                    @click="confirmPrint">
                    Start print
                </button>
            </template>
        </Dialog>

        <Dialog v-model="showDelete" title="Delete" :description="target?.filename">
            <p class="text-muted-foreground text-sm">
                {{
                    target?.isDirectory
                        ? 'The directory and everything in it will be deleted.'
                        : 'This file will be deleted.'
                }}
            </p>
            <template #footer>
                <button type="button" class="hover:bg-accent rounded-md px-3 py-2 text-sm" @click="showDelete = false">
                    Cancel
                </button>
                <button
                    type="button"
                    class="bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-md px-3 py-2 text-sm font-medium"
                    @click="confirmDelete">
                    Delete
                </button>
            </template>
        </Dialog>

        <Dialog v-model="showDeleteSelected" title="Delete selected">
            <p class="text-muted-foreground text-sm">{{ selected.length }} item(s) will be deleted.</p>
            <template #footer>
                <button
                    type="button"
                    class="hover:bg-accent rounded-md px-3 py-2 text-sm"
                    @click="showDeleteSelected = false">
                    Cancel
                </button>
                <button
                    type="button"
                    class="bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-md px-3 py-2 text-sm font-medium"
                    @click="confirmDeleteSelected">
                    Delete
                </button>
            </template>
        </Dialog>

        <Dialog v-model="showRename" title="Rename">
            <input
                v-model="nameInput"
                type="text"
                aria-label="New name"
                class="border-input bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2"
                @keyup.enter="confirmRename" />
            <template #footer>
                <button type="button" class="hover:bg-accent rounded-md px-3 py-2 text-sm" @click="showRename = false">
                    Cancel
                </button>
                <button
                    type="button"
                    class="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-2 text-sm font-medium"
                    @click="confirmRename">
                    Rename
                </button>
            </template>
        </Dialog>

        <Dialog v-model="showDuplicate" title="Duplicate">
            <input
                v-model="nameInput"
                type="text"
                aria-label="Name of the copy"
                class="border-input bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2"
                @keyup.enter="confirmDuplicate" />
            <template #footer>
                <button
                    type="button"
                    class="hover:bg-accent rounded-md px-3 py-2 text-sm"
                    @click="showDuplicate = false">
                    Cancel
                </button>
                <button
                    type="button"
                    class="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-2 text-sm font-medium"
                    @click="confirmDuplicate">
                    Duplicate
                </button>
            </template>
        </Dialog>

        <Dialog v-model="showCreateDirectory" title="New directory">
            <input
                v-model="nameInput"
                type="text"
                aria-label="Directory name"
                placeholder="Name"
                class="border-input bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2"
                @keyup.enter="confirmCreateDirectory" />
            <template #footer>
                <button
                    type="button"
                    class="hover:bg-accent rounded-md px-3 py-2 text-sm"
                    @click="showCreateDirectory = false">
                    Cancel
                </button>
                <button
                    type="button"
                    class="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-2 text-sm font-medium"
                    @click="confirmCreateDirectory">
                    Create
                </button>
            </template>
        </Dialog>
    </Panel>
</template>
