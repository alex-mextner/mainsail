<script setup lang="ts">
import { computed } from 'vue'
import {
    mdiAlertOutline,
    mdiCheckboxMarkedCircleOutline,
    mdiChevronDown,
    mdiChevronUp,
    mdiCloseCircleOutline,
    mdiCloudDownload,
    mdiDelete,
    mdiDotsVertical,
    mdiFire,
    mdiFolderUpload,
    mdiMagnify,
    mdiPlay,
    mdiPlaylistPlus,
    mdiProgressClock,
    mdiRenameBox,
    mdiContentCopy,
} from '@mdi/js'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/menu'
import GcodefilesThumbnail from './GcodefilesThumbnail.vue'
import { FILE_COLUMNS } from './columns'
import type { GcodeRow } from '@/composables/useGcodefiles'

/**
 * The file list -- Mainsail's `GcodefilesPanelTable.vue` and its three row
 * components, as one table.
 *
 * A real `<table>` rather than a grid of divs: the columns are user-configurable
 * and each one has to size itself to its widest value, which is exactly what
 * table layout does for free and what a CSS grid needs JavaScript to imitate.
 *
 * The table scrolls horizontally inside its own container. That is the whole
 * responsive strategy here and it is deliberate: hiding columns on a narrow
 * screen would mean the tablet at the machine silently shows less than the
 * desktop, and which columns matter is the user's call -- there is a settings
 * menu for it.
 */
const props = defineProps<{
    rows: GcodeRow[]
    columns: typeof FILE_COLUMNS
    sortBy: string
    sortDesc: boolean
    /** Empty at the root; the ".." row only exists below it. */
    currentPath: string
    selected: string[]
    loading: boolean
    error: string | null
    /** Klipper is able to accept a print right now. */
    canPrint: boolean
    canWrite: boolean
    hasJobQueue: boolean
}>()

const emit = defineEmits<{
    sort: [key: string]
    open: [dirname: string]
    up: []
    'update:selected': [value: string[]]
    action: [payload: { type: string; row: GcodeRow }]
}>()

const allSelected = computed(() => props.rows.length > 0 && props.selected.length === props.rows.length)

function toggleAll(): void {
    emit('update:selected', allSelected.value ? [] : props.rows.map((row) => row.filename))
}

function toggleOne(row: GcodeRow): void {
    const next = props.selected.includes(row.filename)
        ? props.selected.filter((name) => name !== row.filename)
        : [...props.selected, row.filename]

    emit('update:selected', next)
}

/** Upstream's status icons and colours, by the job status Moonraker reports. */
const STATUS = {
    in_progress: { icon: mdiProgressClock, class: 'text-primary' },
    completed: { icon: mdiCheckboxMarkedCircleOutline, class: 'text-ok' },
    cancelled: { icon: mdiCloseCircleOutline, class: 'text-destructive' },
} as const

const statusOf = (row: GcodeRow) =>
    STATUS[(row.lastStatus ?? '') as keyof typeof STATUS] ?? { icon: mdiAlertOutline, class: 'text-warn' }

const filamentColors = (row: GcodeRow): string[] => row.filament_colors ?? []

/** Clicking a row is upstream's shortcut to "print this", not to select it. */
function clickRow(row: GcodeRow): void {
    if (row.isDirectory) {
        emit('open', row.filename)
        return
    }
    if (!row.isPrintable || !props.canPrint) return

    emit('action', { type: 'print', row })
}
</script>

<template>
    <!--
        `min-w-0` is load-bearing, not decoration. This div is a flex item, and a
        flex item's default `min-width: auto` makes it grow to its content --
        so `overflow-x-auto` never triggers and the twenty-column table pushes
        the whole PAGE sideways instead. Caught by a screenshot at 1400px that
        came back 2771px wide.
    -->
    <div class="w-full min-w-0 overflow-x-auto">
        <table class="w-max min-w-full border-collapse text-sm">
            <thead>
                <tr class="text-muted-foreground border-border border-b text-left text-xs">
                    <th class="w-8 py-2 pr-2 pl-1">
                        <input
                            type="checkbox"
                            class="accent-primary size-4 align-middle"
                            aria-label="Select all files"
                            :checked="allSelected"
                            :disabled="!rows.length"
                            @change="toggleAll" />
                    </th>
                    <th class="w-9 px-1 py-2"><span class="sr-only">Preview</span></th>
                    <th class="cursor-pointer py-2 pr-3 font-medium select-none" @click="emit('sort', 'filename')">
                        <span class="inline-flex items-center gap-1">
                            Name
                            <MdiIcon
                                v-if="sortBy === 'filename'"
                                :path="sortDesc ? mdiChevronDown : mdiChevronUp"
                                class="size-3.5" />
                        </span>
                    </th>
                    <th class="px-2 py-2 text-right font-medium whitespace-nowrap">
                        <span class="sr-only">Print history</span>
                    </th>
                    <th
                        v-for="column in columns"
                        :key="column.key"
                        class="cursor-pointer px-2 py-2 font-medium whitespace-nowrap select-none"
                        :class="column.numeric ? 'text-right' : 'text-left'"
                        @click="emit('sort', column.key)">
                        <span class="inline-flex items-center gap-1">
                            {{ column.label }}
                            <MdiIcon
                                v-if="sortBy === column.key"
                                :path="sortDesc ? mdiChevronDown : mdiChevronUp"
                                class="size-3.5" />
                        </span>
                    </th>
                    <th class="w-9 px-1 py-2"><span class="sr-only">Actions</span></th>
                </tr>
            </thead>

            <tbody>
                <tr
                    v-if="currentPath"
                    class="border-border hover:bg-accent/50 cursor-pointer border-b"
                    @click="emit('up')">
                    <td class="py-2 pr-2 pl-1"></td>
                    <td class="px-1 py-2">
                        <MdiIcon :path="mdiFolderUpload" class="text-muted-foreground size-5" />
                    </td>
                    <td class="py-2 pr-3" :colspan="columns.length + 3">..</td>
                </tr>

                <tr v-if="error">
                    <td :colspan="columns.length + 5" class="text-destructive py-6 text-center text-sm">
                        {{ error }}
                    </td>
                </tr>

                <tr v-else-if="loading && !rows.length">
                    <td :colspan="columns.length + 5" class="text-muted-foreground py-6 text-center text-sm">
                        Loading…
                    </td>
                </tr>

                <tr v-else-if="!rows.length">
                    <td :colspan="columns.length + 5" class="text-muted-foreground py-6 text-center text-sm italic">
                        No files here.
                    </td>
                </tr>

                <tr
                    v-for="row in rows"
                    :key="row.filename"
                    class="border-border hover:bg-accent/40 border-b"
                    :class="row.isDirectory || (row.isPrintable && canPrint) ? 'cursor-pointer' : ''"
                    @click="clickRow(row)">
                    <td class="py-1.5 pr-2 pl-1" @click.stop>
                        <input
                            type="checkbox"
                            class="accent-primary size-4 align-middle"
                            :aria-label="`Select ${row.filename}`"
                            :checked="selected.includes(row.filename)"
                            @change="toggleOne(row)" />
                    </td>

                    <td class="px-1 py-1.5">
                        <GcodefilesThumbnail :row="row" />
                    </td>

                    <td class="max-w-[24rem] truncate py-1.5 pr-3" :title="row.filename">{{ row.filename }}</td>

                    <td class="px-2 py-1.5 text-right whitespace-nowrap">
                        <!--
                            Print history, as a count plus the last outcome. The
                            status word is rendered in `title` AND implied by
                            colour+icon; upstream put it in a hover tooltip only,
                            which the tablet at the machine cannot open.
                        -->
                        <span
                            v-if="row.lastStatus"
                            class="inline-flex items-center gap-1"
                            :class="statusOf(row).class"
                            :title="row.lastStatus.replace(/_/g, ' ')">
                            <span v-if="row.countPrinted > 0" class="text-xs tabular">{{ row.countPrinted }}</span>
                            <MdiIcon :path="statusOf(row).icon" class="size-4" />
                        </span>
                    </td>

                    <td
                        v-for="column in columns"
                        :key="column.key"
                        class="px-2 py-1.5 whitespace-nowrap"
                        :class="column.numeric ? 'tabular text-right' : ''">
                        <template v-if="row.isDirectory">
                            <!-- A directory has a size and a date and nothing else. -->
                            <span v-if="column.key === 'modified' || column.key === 'size'">
                                {{ column.format?.(row) }}
                            </span>
                        </template>

                        <span v-else-if="column.key === 'filaments'" class="inline-flex gap-1">
                            <span
                                v-for="(color, index) in filamentColors(row)"
                                :key="index"
                                class="border-border inline-block size-3.5 rounded-full border"
                                :style="{ backgroundColor: color }"
                                :title="color" />
                            <span v-if="!filamentColors(row).length" class="text-muted-foreground">—</span>
                        </span>

                        <span v-else>{{ column.format?.(row) ?? '—' }}</span>
                    </td>

                    <td class="px-1 py-1.5" @click.stop>
                        <Menu align="end">
                            <template #trigger>
                                <button
                                    type="button"
                                    class="text-muted-foreground hover:text-foreground hover:bg-accent inline-flex size-7 items-center justify-center rounded-md"
                                    :aria-label="`Actions for ${row.filename}`">
                                    <MdiIcon :path="mdiDotsVertical" class="size-4" />
                                </button>
                            </template>

                            <MenuItem
                                v-if="row.isPrintable"
                                :disabled="!canPrint"
                                @select="emit('action', { type: 'print', row })">
                                <MdiIcon :path="mdiPlay" class="size-4" />
                                Start print
                            </MenuItem>

                            <MenuItem
                                v-if="row.isPrintable && hasJobQueue"
                                @select="emit('action', { type: 'queue', row })">
                                <MdiIcon :path="mdiPlaylistPlus" class="size-4" />
                                Add to queue
                            </MenuItem>

                            <MenuItem
                                v-if="row.preheatGcode"
                                :disabled="!canPrint"
                                @select="emit('action', { type: 'preheat', row })">
                                <MdiIcon :path="mdiFire" class="size-4" />
                                Preheat
                            </MenuItem>

                            <MenuItem v-if="row.isPrintable" @select="emit('action', { type: 'metascan', row })">
                                <MdiIcon :path="mdiMagnify" class="size-4" />
                                Scan metadata
                            </MenuItem>

                            <MenuItem v-if="!row.isDirectory" @select="emit('action', { type: 'download', row })">
                                <MdiIcon :path="mdiCloudDownload" class="size-4" />
                                Download
                            </MenuItem>

                            <MenuSeparator class="bg-border my-1 h-px" />

                            <MenuItem :disabled="!canWrite" @select="emit('action', { type: 'rename', row })">
                                <MdiIcon :path="mdiRenameBox" class="size-4" />
                                Rename
                            </MenuItem>

                            <MenuItem
                                v-if="!row.isDirectory"
                                :disabled="!canWrite"
                                @select="emit('action', { type: 'duplicate', row })">
                                <MdiIcon :path="mdiContentCopy" class="size-4" />
                                Duplicate
                            </MenuItem>

                            <MenuItem
                                class="text-destructive"
                                :disabled="!canWrite"
                                @select="emit('action', { type: 'delete', row })">
                                <MdiIcon :path="mdiDelete" class="size-4" />
                                Delete
                            </MenuItem>
                        </Menu>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</template>
