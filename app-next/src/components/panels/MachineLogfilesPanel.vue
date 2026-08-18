<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { mdiDownload, mdiFileDocumentEdit } from '@mdi/js'
import Panel from '@/components/ui/Panel.vue'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import { formatDateTime, formatFilesize } from '@/lib/format'
import { escapePath } from '@/stores/files'
import { useConnectionStore } from '@/stores/connection'

/**
 * Log files -- upstream's `LogfilesPanel`.
 *
 * 🔴 IT LISTS WHAT IS ACTUALLY THERE, NOT A HARD-CODED SET
 * Upstream renders `['klippy', 'moonraker']` plus a fixed list of five names
 * (`AFC`, `crowsnest`, `mms`, `mmu`, `sonar`) that it checks for. On THIS
 * machine that hides `KlipperScreen.log`, `mainsail-access.log`,
 * `mainsail-error.log` and every rotated `klippy.log.<date>` -- and
 * KlipperScreen's log is one somebody actually needs here. Listing the
 * directory Moonraker already exposes shows all of them, with size and age,
 * and cannot go stale when a new component starts writing a log.
 *
 * Download only. Upstream also has a "rollover logs" button, which asks
 * Moonraker to rotate the files and RESTARTS the services that hold them open.
 * That is a restart, and restarts are exactly what this session is not allowed
 * to do -- see MachinePage.vue for the full list of what is deliberately not
 * wired.
 */
const connection = useConnectionStore()

interface LogFile {
    path: string
    size: number
    modified: number
}

const files = ref<LogFile[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

onMounted(async () => {
    /**
     * `server.files.list`, not `server.files.get_directory`.
     *
     * The two are NOT interchangeable and the difference is a real bug this
     * panel had: `get_directory` answers `{dirs, files}` with the name under
     * `filename`, while `list` answers a flat array with the name under
     * `path`. Reading `.path` off a `get_directory` reply gives undefined for
     * every row -- caught by a console error on the live page, not by reading
     * the code. `list` is also what the config panel uses, so both read the
     * same shape.
     */
    const result = await connection.call<LogFile[]>('server.files.list', { root: 'logs' }).catch(() => null)

    if (!result) error.value = 'Moonraker did not return the log directory.'
    else files.value = result

    loading.value = false
})

/**
 * Current logs first, then rotated ones, each group newest first.
 *
 * A rotated log is `name.log.<something>`; those are archives and belong below
 * the live file you almost always want.
 */
const sorted = computed(() => {
    const isRotated = (file: LogFile) => !file.path.endsWith('.log')

    return [...files.value].sort((a, b) => {
        if (isRotated(a) !== isRotated(b)) return isRotated(a) ? 1 : -1
        return b.modified - a.modified
    })
})

const hrefFor = (file: LogFile) => `/server/files/logs/${escapePath(file.path)}`
</script>

<template>
    <Panel panel-name="machine-logfiles" title="Log files" :icon="mdiFileDocumentEdit" collapsible :loading="loading">
        <p v-if="error" class="text-destructive py-4 text-sm">{{ error }}</p>

        <p v-else-if="!loading && !sorted.length" class="text-muted-foreground py-4 text-sm italic">
            No log files found.
        </p>

        <div v-else class="grid grid-cols-1 gap-2 @lg:grid-cols-2">
            <a
                v-for="file in sorted"
                :key="file.path"
                :href="hrefFor(file)"
                :download="file.path"
                class="border-border hover:bg-accent/50 flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors">
                <MdiIcon :path="mdiDownload" class="text-muted-foreground size-4 shrink-0" />
                <span class="min-w-0 flex-1 truncate" :title="file.path">{{ file.path }}</span>
                <span class="text-muted-foreground tabular shrink-0 text-xs">{{ formatFilesize(file.size) }}</span>
                <span class="text-muted-foreground hidden shrink-0 text-xs @2xl:inline">
                    {{ formatDateTime(file.modified * 1000) }}
                </span>
            </a>
        </div>
    </Panel>
</template>
