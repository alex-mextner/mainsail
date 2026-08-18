import { ref, computed, watch } from 'vue'
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
    /** False once the g-code file behind the job has been deleted. */
    exists?: boolean
    user?: string
    auxiliary_data?: { provider: string; name: string; value: number | number[] | null; units?: string }[]
    metadata?: {
        uuid?: string
        size?: number
        modified?: number
        [key: string]: unknown
    }
}

/** Moonraker's `server.history.totals` -- lifetime counters, not a job list. */
export interface HistoryTotals {
    total_jobs: number
    total_time: number
    total_print_time: number
    total_filament_used: number
    longest_job: number
    longest_print: number
}

/** Newest jobs kept in memory for the file table. */
export const HISTORY_LIMIT = 500

/**
 * How many jobs the History page pulls per request.
 *
 * Small enough that the page paints on a machine with thousands of jobs, big
 * enough that this machine's whole history (23 jobs) arrives in one round trip.
 */
export const HISTORY_PAGE_SIZE = 100

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

    /* ---------------------------------------------------------------------
     * The History PAGE's own dataset.
     *
     * 🔴 DELIBERATELY A SECOND ARRAY, NOT A BIGGER `jobs`
     * `jobs` above is capped at HISTORY_LIMIT and exists to answer one
     * question for the file table: "how did this file print last time".
     * The page wants the opposite -- everything, oldest included, paged in on
     * demand. Serving both from one array means the page's paging silently
     * changes what the file table shows, which is precisely the class of bug
     * this project keeps finding (settings overwriting the filter array,
     * merge deleting macro groups). Two arrays, one notification handler that
     * updates each explicitly, and the truncation applies to `jobs` alone.
     * ------------------------------------------------------------------- */

    const pageJobs = ref<HistoryJob[]>([])
    const pageLoading = ref(false)
    /** No further pages exist: a request came back shorter than asked for. */
    const pageComplete = ref(false)
    /** The last attempt failed. Distinct from `pageComplete` -- see loadMore. */
    const pageError = ref(false)
    /** Some view has asked for the paged list, so it is worth (re)loading. */
    const pageWanted = ref(false)

    const totals = ref<HistoryTotals | null>(null)

    /**
     * Append the next page.
     *
     * `start` is the count already held rather than a page number, and the
     * append DEDUPES BY job_id, because the offset is not stable: a print
     * finishing between two requests shifts every row down by one and the
     * naive version yields a duplicate (or, paging the other way, a hole).
     * There is a print running on this machine right now, so this is a real
     * case and not a hypothetical one.
     *
     * The terminating condition is "the page came back shorter than
     * requested", NOT a comparison against `totals.total_jobs`: the totals are
     * lifetime counters maintained separately from the job list, and a
     * comparison that can be permanently off by one leaves a Load-more button
     * that never goes away.
     */
    async function loadMore(limit = HISTORY_PAGE_SIZE): Promise<void> {
        if (pageLoading.value || pageComplete.value) return

        pageLoading.value = true
        try {
            const result = await connection.call<{ jobs: HistoryJob[]; count?: number }>('server.history.list', {
                limit,
                start: pageJobs.value.length,
                order: 'desc',
            })

            const incoming = result?.jobs ?? []
            if (incoming.length < limit) pageComplete.value = true

            const known = new Set(pageJobs.value.map((job) => job.job_id))
            for (const job of incoming) {
                if (known.has(job.job_id)) continue
                known.add(job.job_id)
                pageJobs.value.push(job)
            }
        } catch {
            /**
             * 🔴 DOES NOT SET `pageComplete`, AND THAT IS A FIX, NOT AN
             * OVERSIGHT.
             *
             * It used to. The reasoning was "a machine without [history] has no
             * jobs, so stop retrying" -- which quietly conflated "the server
             * says there is no history" with "there was no server to ask".
             * `connection.call` rejects immediately with `not connected`, so a
             * page opened before the socket finished connecting marked the
             * history permanently complete and empty, and no reconnect ever
             * undid it.
             *
             * Measured, not reasoned: with the first websocket pointed at a
             * dead port, /history sat at "0 of 0" for the whole session even
             * after the socket came back. Now the failure leaves the state
             * retryable and `ensurePage()` below retries it on reconnect.
             */
            pageError.value = true
        } finally {
            pageLoading.value = false
        }
    }

    /**
     * "This view wants the paged list." Safe to call repeatedly.
     *
     * 🔴 WHY THE PAGE CANNOT JUST CALL `loadMore()` FROM `onMounted`
     * It did, and that was the bug above: `onMounted` fires once, and if the
     * socket is not up yet the call rejects and nothing ever tries again. The
     * other two stores added in this rewrite (`webcams`, `server`) already key
     * their loading off `connection.isConnected`; this brings history into
     * line rather than leaving one store with a different shape.
     *
     * It is a function the view calls rather than an unconditional watcher in
     * the store body, because this store is ALSO used by the g-code file table
     * for its "printed N times" badge -- and that page has no use for the paged
     * list or the lifetime totals. Loading them for it would be traffic and
     * memory spent on an Orange Pi for something nobody is looking at.
     */
    function ensurePage(): void {
        pageWanted.value = true
        if (!connection.isConnected) return

        void loadTotals()
        if (!pageJobs.value.length) {
            pageComplete.value = false
            void loadMore()
        }
    }

    watch(
        () => connection.isConnected,
        (connected) => {
            if (connected && pageWanted.value) ensurePage()
        }
    )

    /** Page until the server stops giving more. Upstream's "load complete history". */
    async function loadAll(): Promise<void> {
        while (!pageComplete.value) {
            const before = pageJobs.value.length
            await loadMore()
            // Guard against a server that keeps answering without progressing:
            // without this a bad reply turns into an infinite request loop.
            if (pageJobs.value.length === before) break
        }
    }

    async function loadTotals(): Promise<void> {
        const result = await connection.call<{ job_totals?: HistoryTotals }>('server.history.totals').catch(() => null)

        if (result?.job_totals) totals.value = result.job_totals
    }

    /**
     * Remove jobs from Moonraker's history.
     *
     * Destructive and irreversible, so it is always behind an explicit
     * confirmation in the UI. It is wired rather than stubbed because it is
     * upstream behaviour under the user's "port everything, throw nothing
     * away" -- but note it deletes from the history the WORKING Mainsail also
     * reads, because there is only one history.
     */
    async function deleteJobs(jobIds: string[]): Promise<void> {
        for (const uid of jobIds) {
            await connection.call('server.history.delete_job', { uid }).catch(() => null)
        }

        const removed = new Set(jobIds)
        pageJobs.value = pageJobs.value.filter((job) => !removed.has(job.job_id))
        jobs.value = jobs.value.filter((job) => !removed.has(job.job_id))
        void loadTotals()
    }

    function reset(): void {
        jobs.value = []
        loaded.value = false
        pageJobs.value = []
        pageComplete.value = false
        totals.value = null
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

    /**
     * Moonraker pushes finished jobs; a stale list would show the wrong badge.
     *
     * Written as two explicit blocks rather than a loop over both arrays: the
     * HISTORY_LIMIT truncation belongs to `jobs` and to `jobs` only. Applying
     * it to `pageJobs` would silently drop the tail of a fully-paged history
     * every time a print finished -- the page would appear to lose its oldest
     * jobs for no visible reason.
     */
    connection.onNotify(({ method, params }) => {
        if (method !== 'notify_history_changed') return

        const payload = params[0] as { action?: string; job?: HistoryJob } | undefined
        const job = payload?.job
        if (!job) return

        const upsert = payload?.action === 'finished' || payload?.action === 'added'

        // 1. The capped list behind the file table's badge.
        const index = jobs.value.findIndex((entry) => entry.job_id === job.job_id)
        if (upsert) {
            if (index === -1) jobs.value.unshift(job)
            else jobs.value[index] = job
            if (jobs.value.length > HISTORY_LIMIT) jobs.value.length = HISTORY_LIMIT
        } else if (index !== -1) {
            jobs.value.splice(index, 1)
        }

        // 2. The History page's own paged list. No truncation here.
        const pageIndex = pageJobs.value.findIndex((entry) => entry.job_id === job.job_id)
        if (upsert) {
            if (pageIndex === -1) pageJobs.value.unshift(job)
            else pageJobs.value[pageIndex] = job
        } else if (pageIndex !== -1) {
            pageJobs.value.splice(pageIndex, 1)
        }

        // A finished job changes every lifetime counter on the page.
        if (totals.value) void loadTotals()
    })

    return {
        jobs,
        jobCount,
        loaded,
        loading,
        load,
        reset,
        jobsForFile,
        pageJobs,
        pageLoading,
        pageComplete,
        pageError,
        totals,
        ensurePage,
        loadMore,
        loadAll,
        loadTotals,
        deleteJobs,
    }
})
