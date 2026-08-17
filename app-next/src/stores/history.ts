import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { useConnectionStore } from './connection'

/**
 * Moonraker's print history.
 *
 * Ported now because the g-code file table needs it: the "printed N times, last
 * one cancelled" column is history data, not file data. The History PAGE
 * (upstream's HistoryListPanel / HistoryStatisticsPanel) is a later item in the
 * queue and will build on this store rather than replace it.
 *
 * 🔴 THE LIST IS LIMITED ON PURPOSE
 * --------------------------------
 * `server.history.list` with no `limit` returns every job the machine has ever
 * run, each with its full metadata blob (~1 kB). Loading all of it to render
 * one column would grow without bound on a machine that gets used. The limit
 * below is the newest N jobs, which is what the column can actually reflect --
 * a file printed a hundred jobs ago shows no badge rather than stalling the UI.
 * The History page will page through the rest with its own explicit requests.
 */

export interface HistoryJob {
    job_id: string
    filename: string
    status: string
    start_time: number
    end_time: number | null
    print_duration: number
    total_duration: number
    filament_used: number
    metadata?: {
        uuid?: string
        size?: number
        modified?: number
        [key: string]: unknown
    }
}

/** Newest jobs kept in memory for the file table. */
export const HISTORY_LIMIT = 500

export const useHistoryStore = defineStore('history', () => {
    const connection = useConnectionStore()

    const jobs = ref<HistoryJob[]>([])
    const loaded = ref(false)
    const loading = ref(false)

    async function load(force = false): Promise<void> {
        if (loading.value) return
        if (loaded.value && !force) return

        loading.value = true
        try {
            const result = await connection.call<{ jobs: HistoryJob[] }>('server.history.list', {
                limit: HISTORY_LIMIT,
                start: 0,
                order: 'desc',
            })
            jobs.value = result?.jobs ?? []
            loaded.value = true
        } catch {
            // A machine without the history component simply has no jobs; the
            // column then renders empty, which is correct rather than an error.
            jobs.value = []
            loaded.value = true
        } finally {
            loading.value = false
        }
    }

    function reset(): void {
        jobs.value = []
        loaded.value = false
    }

    /**
     * Jobs belonging to one file. Upstream's `getPrintJobsForGcodes`, same
     * order of evidence and same reason:
     *
     *   1. `uuid` -- Moonraker stamps a file with one and copies it into the
     *      job record. This is the only key that survives a rename.
     *   2. size + modified -- for files predating uuid. Both must match, so a
     *      re-sliced file does NOT inherit the old file's print count; that is
     *      the whole point of including `modified`.
     *
     * Filename alone is deliberately NOT a fallback: re-slicing to the same
     * name is the normal workflow, and it would show the previous version's
     * results against the new file.
     */
    const jobsForFile = (file: { uuid?: string | null; size?: number; modified?: number }): HistoryJob[] => {
        if (!jobs.value.length) return []

        if (file.uuid) return jobs.value.filter((job) => job.metadata?.uuid === file.uuid)

        return jobs.value.filter(
            (job) =>
                job.metadata?.size === file.size &&
                Math.round((job.metadata?.modified ?? 0) * 1000) === Math.round(file.modified ?? -1)
        )
    }

    const jobCount = computed(() => jobs.value.length)

    /** Moonraker pushes finished jobs; a stale list would show the wrong badge. */
    connection.onNotify(({ method, params }) => {
        if (method !== 'notify_history_changed') return

        const payload = params[0] as { action?: string; job?: HistoryJob } | undefined
        if (!payload?.job) return

        const index = jobs.value.findIndex((job) => job.job_id === payload.job?.job_id)

        if (payload.action === 'finished' || payload.action === 'added') {
            if (index === -1) jobs.value.unshift(payload.job)
            else jobs.value[index] = payload.job
            if (jobs.value.length > HISTORY_LIMIT) jobs.value.length = HISTORY_LIMIT
            return
        }

        if (index !== -1) jobs.value.splice(index, 1)
    })

    return { jobs, jobCount, loaded, loading, load, reset, jobsForFile }
})
