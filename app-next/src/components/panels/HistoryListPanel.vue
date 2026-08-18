<script setup lang="ts">
import { computed, ref } from 'vue'
import {
    mdiCog,
    mdiDatabaseArrowDownOutline,
    mdiDatabaseExportOutline,
    mdiDelete,
    mdiFileDocumentMultipleOutline,
    mdiMagnify,
} from '@mdi/js'
import Panel from '@/components/ui/Panel.vue'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import Dialog from '@/components/ui/Dialog.vue'
import { Button } from '@/components/ui/button'
import { Menu, MenuCheckboxItem, MenuLabel, MenuSeparator } from '@/components/ui/menu'
import HistoryTable from './History/HistoryTable.vue'
import { HISTORY_COLUMNS, historySortValue } from './History/columns'
import { useHistoryStore } from '@/stores/history'
import { useGuiStore } from '@/stores/gui'

/**
 * The print history list -- upstream's `HistoryListPanel.vue`.
 *
 * 🔴 IT READS `pageJobs`, NEVER `jobs`
 * The store keeps two arrays on purpose: `jobs` is capped and exists to answer
 * "how did this file print last time" for the g-code table, `pageJobs` is this
 * page's own fully-paged set. Reading `jobs` here would make paging on this
 * page silently change what the file table shows. See stores/history.ts.
 *
 * NOT PORTED, and deliberately: maintenance entries. Upstream mixes them into
 * this same list, but they live in the Moonraker database namespace
 * `maintenance` -- the same rows the working Mainsail on port 80 owns, so
 * creating or deleting one from here would edit the interface the user prints
 * with. That namespace currently holds a single `MAINTENANCE_INIT` marker and
 * no actual entries, so even the read-only half would render nothing. It goes
 * to queue 2 with the rest of "what this machine does not have".
 */
const history = useHistoryStore()
const gui = useGuiStore()

const search = ref('')
const selected = ref<string[]>([])
const deleteDialog = ref(false)

/** Loading is the page's job, not this panel's -- see pages/HistoryPage.vue. */
const settings = computed(() => gui.state.view.history)

/** Statuses actually present, with their counts -- upstream's status filter list. */
const statusCounts = computed(() => {
    const counts = new Map<string, number>()
    for (const job of history.pageJobs) counts.set(job.status, (counts.get(job.status) ?? 0) + 1)

    return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name))
})

const visibleColumns = computed(() => HISTORY_COLUMNS.filter((c) => !settings.value.hideColumns.includes(c.key)))

/**
 * Search matches the filename only.
 *
 * Upstream's `advancedSearch` runs over every rendered cell, which sounds more
 * useful and is not: typing "60" then matches a bed temperature, a layer count
 * and a file size at once. The filename is what people actually look for, and
 * the status filter covers the other real case.
 */
const filtered = computed(() => {
    const needle = search.value.trim().toLowerCase()

    let rows = history.pageJobs.filter((job) => !settings.value.hideStatus.includes(job.status))
    if (needle) rows = rows.filter((job) => job.filename.toLowerCase().includes(needle))

    const key = settings.value.sortBy
    const direction = settings.value.sortDesc ? -1 : 1

    // Sorted on a COPY: `pageJobs` is the store's array, and sorting it in
    // place would reorder the store from a computed property -- a mutation the
    // rest of the app never asked for.
    return [...rows].sort((a, b) => {
        const left = historySortValue(a, key)
        const right = historySortValue(b, key)

        if (left === right) return 0
        if (typeof left === 'string' && typeof right === 'string') return left.localeCompare(right) * direction
        return (Number(left) - Number(right)) * direction
    })
})

function sort(key: string): void {
    if (settings.value.sortBy === key) gui.saveSetting('view.history.sortDesc', !settings.value.sortDesc)
    else {
        gui.saveSetting('view.history.sortBy', key)
        gui.saveSetting('view.history.sortDesc', true)
    }
}

function toggleColumn(key: string): void {
    const hidden = settings.value.hideColumns
    gui.saveSetting(
        'view.history.hideColumns',
        hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key]
    )
}

function toggleStatus(name: string): void {
    const hidden = settings.value.hideStatus
    gui.saveSetting(
        'view.history.hideStatus',
        hidden.includes(name) ? hidden.filter((s) => s !== name) : [...hidden, name]
    )
}

/**
 * CSV of what is on screen, or of the selection when there is one -- upstream's
 * `exportHistory`.
 *
 * The separator follows the browser's decimal separator: in a locale that
 * writes 1,23 a comma-separated file opens as one column in Excel, which is
 * upstream's reason and a real one on this machine (RU locale).
 */
function exportCsv(): void {
    const decimalComma = (1.23).toLocaleString().includes(',')
    const separator = decimalComma ? ';' : ','

    const rows = selected.value.length
        ? filtered.value.filter((j) => selected.value.includes(j.job_id))
        : filtered.value

    const escape = (value: string) => (value.includes(separator) || value.includes('"') ? `"${value}"` : value)

    const lines = [
        ['filename', 'status', ...visibleColumns.value.map((c) => c.key)].map(escape).join(separator),
        ...rows.map((job) =>
            [job.filename, job.status, ...visibleColumns.value.map((c) => c.format(job))].map(escape).join(separator)
        ),
    ]

    // A Blob rather than upstream's `data:` URI: a data URI carries the whole
    // file in the URL, and browsers cap that at a couple of megabytes -- which
    // a few thousand jobs will exceed.
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'print_history.csv'
    link.click()
    URL.revokeObjectURL(url)
}

async function confirmDelete(): Promise<void> {
    deleteDialog.value = false
    await history.deleteJobs([...selected.value])
    selected.value = []
}
</script>

<template>
    <Panel
        panel-name="history-list"
        title="Print history"
        :icon="mdiFileDocumentMultipleOutline"
        :loading="history.pageLoading">
        <template #buttons>
            <Button
                v-if="selected.length"
                variant="destructive"
                size="sm"
                :aria-label="`Delete ${selected.length} selected jobs`"
                @click="deleteDialog = true">
                <MdiIcon :path="mdiDelete" class="size-4" />
                <span class="hidden @md:inline">{{ selected.length }}</span>
            </Button>

            <!--
                "Load complete history". Hidden once the server has stopped
                giving more, which is decided by a short page rather than by
                comparing against the lifetime job counter -- the counter is
                maintained separately and a permanent off-by-one would leave a
                button that never goes away. See stores/history.ts.
            -->
            <button
                v-if="!history.pageComplete"
                type="button"
                aria-label="Load complete history"
                class="text-muted-foreground hover:text-foreground hover:bg-accent inline-flex size-8 items-center justify-center rounded-md transition-colors"
                :disabled="history.pageLoading"
                @click="history.loadAll()">
                <MdiIcon :path="mdiDatabaseArrowDownOutline" class="size-5" />
            </button>

            <button
                type="button"
                aria-label="Export history as CSV"
                class="text-muted-foreground hover:text-foreground hover:bg-accent inline-flex size-8 items-center justify-center rounded-md transition-colors"
                @click="exportCsv">
                <MdiIcon :path="mdiDatabaseExportOutline" class="size-5" />
            </button>

            <Menu align="end" persistent content-class="max-h-[70vh] overflow-y-auto">
                <template #trigger>
                    <button
                        type="button"
                        aria-label="History table settings"
                        class="text-muted-foreground hover:text-foreground hover:bg-accent inline-flex size-8 items-center justify-center rounded-md transition-colors">
                        <MdiIcon :path="mdiCog" class="size-5" />
                    </button>
                </template>

                <MenuLabel class="text-muted-foreground px-2 py-1.5 text-xs">Statuses</MenuLabel>
                <MenuCheckboxItem
                    v-for="status in statusCounts"
                    :key="status.name"
                    :model-value="!settings.hideStatus.includes(status.name)"
                    :label="`${status.name.replace(/_/g, ' ')} (${status.count})`"
                    @update:model-value="toggleStatus(status.name)" />

                <MenuSeparator class="bg-border my-1 h-px" />

                <MenuLabel class="text-muted-foreground px-2 py-1.5 text-xs">Columns</MenuLabel>
                <MenuCheckboxItem
                    v-for="column in HISTORY_COLUMNS"
                    :key="column.key"
                    :model-value="!settings.hideColumns.includes(column.key)"
                    :label="column.label"
                    @update:model-value="toggleColumn(column.key)" />
            </Menu>
        </template>

        <div class="mb-3 flex items-center gap-2">
            <div class="relative w-full max-w-xs">
                <MdiIcon
                    :path="mdiMagnify"
                    class="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2" />
                <input
                    v-model="search"
                    type="search"
                    placeholder="Search filename…"
                    aria-label="Search print history by filename"
                    class="border-input bg-background focus-visible:ring-ring h-(--density-control) w-full rounded-md border pr-2 pl-8 text-sm focus-visible:ring-2 focus-visible:outline-none" />
            </div>
            <span class="text-muted-foreground text-xs whitespace-nowrap">
                {{ filtered.length }} of {{ history.pageJobs.length }}
            </span>
        </div>

        <HistoryTable
            :jobs="filtered"
            :columns="visibleColumns"
            :sort-by="settings.sortBy"
            :sort-desc="settings.sortDesc"
            :selected="selected"
            :loading="history.pageLoading"
            @sort="sort"
            @update:selected="selected = $event" />

        <Dialog
            v-model="deleteDialog"
            title="Delete print jobs"
            :description="`${selected.length} job(s) will be removed from the printer's history. This cannot be undone, and there is only one history -- the working Mainsail shows the same records.`">
            <template #footer>
                <Button variant="ghost" @click="deleteDialog = false">Cancel</Button>
                <Button variant="destructive" @click="confirmDelete">Delete</Button>
            </template>
        </Dialog>
    </Panel>
</template>
