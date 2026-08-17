import { computed, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useFilesStore, isGcodeFilename, type FileEntry } from '@/stores/files'
import { useHistoryStore, type HistoryJob } from '@/stores/history'
import { useConnectionStore } from '@/stores/connection'
import { usePrinterStore } from '@/stores/printer'
import { useGuiStore } from '@/stores/gui'

/**
 * Everything the g-code file panel and its rows agree on: where we are, what is
 * in it, and how it is sorted. Upstream keeps this in a `GcodefilesMixin`;
 * a composable is the same idea without the inheritance.
 */

/** A file row, with the print history for that exact file folded in. */
export interface GcodeRow extends FileEntry {
    /** Path relative to the gcodes root, for commands and links. */
    fullPath: string
    isPrintable: boolean
    countPrinted: number
    lastStatus: string | null
    lastStartTime: number | null
    lastEndTime: number | null
    lastPrintDuration: number | null
    lastTotalDuration: number | null
    lastFilamentUsed: number | null
    /** M104/M140/M141 line built from the slicer's first-layer targets. */
    preheatGcode: string | null
}

export function useGcodefiles() {
    const files = useFilesStore()
    const history = useHistoryStore()
    const connection = useConnectionStore()
    const printer = usePrinterStore()
    const gui = useGuiStore()

    const { klippyState } = storeToRefs(connection)

    const view = computed(() => gui.state.view.gcodefiles)

    const currentPath = computed({
        get: () => view.value.currentPath,
        set: (value: string) => gui.saveSetting('view.gcodefiles.currentPath', value),
    })

    const search = computed({
        get: () => view.value.search,
        set: (value: string) => gui.saveSetting('view.gcodefiles.search', value),
    })

    const sortBy = computed({
        get: () => view.value.sortBy,
        set: (value: string) => gui.saveSetting('view.gcodefiles.sortBy', value),
    })

    const sortDesc = computed({
        get: () => view.value.sortDesc,
        set: (value: boolean) => gui.saveSetting('view.gcodefiles.sortDesc', value),
    })

    const directory = computed(() => files.stateFor(currentPath.value) ?? null)
    const loading = computed(() => directory.value?.loading ?? false)
    const error = computed(() => directory.value?.error ?? null)
    const diskUsage = computed(() => directory.value?.diskUsage ?? null)

    /**
     * Load on arrival and whenever the path changes -- but only once Klippy is
     * up. Moonraker answers file requests even when Klipper is down, so this is
     * not strictly required; it is here because a failed connection should show
     * one connection message rather than a directory error as well.
     */
    watch(
        [currentPath, klippyState],
        ([path]) => {
            if (!connection.isConnected) return
            void files.loadDirectory(path)
            void history.load()
        },
        { immediate: true }
    )

    const refresh = () => files.loadDirectory(currentPath.value, true)

    function open(dirname: string): void {
        currentPath.value = currentPath.value ? `${currentPath.value}/${dirname}` : dirname
    }

    function goUp(): void {
        const path = currentPath.value
        const slash = path.lastIndexOf('/')
        currentPath.value = slash === -1 ? '' : path.slice(0, slash)
    }

    /** `['sub', 'dir']` for `sub/dir`, for the breadcrumb. */
    const pathSegments = computed(() => (currentPath.value ? currentPath.value.split('/') : []))

    /**
     * Slicer first-layer targets, as the preheat command Mainsail offers in the
     * row menu. Only the commands Klipper actually knows are included: this
     * machine has no chamber heater, so no M141 is ever emitted.
     */
    function preheatGcodeFor(entry: FileEntry): string | null {
        const lines = [
            { command: 'M104', value: entry.first_layer_extr_temp },
            { command: 'M140', value: entry.first_layer_bed_temp },
            { command: 'M141', value: entry.chamber_temp },
        ]
            .filter(
                (item) =>
                    // No command table yet (Klipper still starting) means no
                    // preheat offer, rather than a guess that might not exist.
                    printer.hasCommand(item.command) && typeof item.value === 'number' && item.value > 1
            )
            .map((item) => `${item.command} S${item.value}`)

        return lines.length ? lines.join('\n') : null
    }

    /**
     * The rows, in upstream's order of operations: hide, filter to printable
     * files, fold in history, search, sort. Directories always sort above files
     * regardless of the column -- otherwise sorting by size scatters the
     * folders through the list.
     */
    const rows = computed<GcodeRow[]>(() => {
        const entries = directory.value?.entries ?? []
        const showHidden = view.value.showHiddenFiles

        const visible = entries.filter((entry) => {
            // `.thumbs` is Moonraker's own cache; `thumbs` is what older slicer
            // setups wrote. Both are noise, and both are hideable.
            if (!showHidden && (entry.filename.startsWith('.') || entry.filename === 'thumbs')) return false
            if (entry.isDirectory) return true
            return isGcodeFilename(entry.filename)
        })

        const withHistory = visible.map<GcodeRow>((entry) => {
            const fullPath = currentPath.value ? `${currentPath.value}/${entry.filename}` : entry.filename

            const jobs: HistoryJob[] = entry.isDirectory
                ? []
                : history.jobsForFile({ uuid: entry.uuid, size: entry.size, modified: entry.modified })

            // Newest job decides the badge; the count is every job for the file.
            const latest = jobs.reduce<HistoryJob | null>(
                (best, job) => (best === null || job.start_time > best.start_time ? job : best),
                null
            )

            return {
                ...entry,
                fullPath,
                isPrintable: !entry.isDirectory && isGcodeFilename(entry.filename),
                countPrinted: jobs.length,
                lastStatus: latest?.status ?? null,
                lastStartTime: latest ? latest.start_time * 1000 : null,
                lastEndTime: latest?.end_time ? latest.end_time * 1000 : null,
                lastPrintDuration: latest?.print_duration ?? null,
                lastTotalDuration: latest?.total_duration ?? null,
                lastFilamentUsed: latest?.filament_used ?? null,
                preheatGcode: entry.isDirectory ? null : preheatGcodeFor(entry),
            }
        })

        const printed = view.value.showPrintedFiles
            ? withHistory
            : withHistory.filter((row) => row.isDirectory || row.countPrinted === 0)

        const needle = search.value.trim().toLowerCase()
        const matched = needle
            ? printed.filter((row) => {
                  // Every word must appear, in any order -- upstream's
                  // `advancedSearch`, which is what makes "cube petg" work.
                  const haystack = row.filename.toLowerCase()
                  return needle.split(' ').every((word) => haystack.includes(word))
              })
            : printed

        const factor = sortDesc.value ? -1 : 1
        const key = sortBy.value

        return [...matched].sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1

            const left = a[key] as unknown
            const right = b[key] as unknown

            // Missing values sink, in both directions: a file with no layer
            // height is not "the smallest", it is unknown.
            if (left === right) return a.filename.localeCompare(b.filename)
            if (left === null || left === undefined) return 1
            if (right === null || right === undefined) return -1

            if (typeof left === 'string' && typeof right === 'string') {
                return left.localeCompare(right, undefined, { sensitivity: 'base' }) * factor
            }

            return ((left as number) > (right as number) ? 1 : -1) * factor
        })
    })

    function toggleSort(key: string): void {
        if (sortBy.value === key) sortDesc.value = !sortDesc.value
        else {
            sortBy.value = key
            sortDesc.value = false
        }
    }

    /** Writing is gated on the ROOT's permissions, which Moonraker reports. */
    const canWrite = computed(() => (directory.value?.rootPermissions ?? 'rw').includes('w'))

    return {
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
        preheatGcodeFor,
    }
}
