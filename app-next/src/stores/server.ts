import { ref, computed, watch } from 'vue'
import { defineStore } from 'pinia'
import { useConnectionStore } from './connection'

/**
 * What the HOST is doing -- the Orange Pi, not Klipper.
 *
 * Upstream's `server` Vuex module, trimmed to what the Machine page renders.
 * Everything here is READ-ONLY by construction: the store has no action that
 * writes, restarts, updates or reboots anything. That is not an accident, see
 * the note on the update section below.
 *
 * 🔴 THE POLLING IS THE POINT ON THIS MACHINE
 * `machine.proc_stats` returns a rolling buffer of per-second samples and
 * Moonraker also PUSHES `notify_proc_stat_update` once a second. This store
 * takes the push and does not poll: the host is an Orange Pi One with 512 MB
 * that has been brought down by memory exhaustion before, and a UI that adds
 * its own timer on top of a push it already receives is pure waste.
 */

export interface ProcStatSample {
    time: number
    cpu_usage: number
    memory: number
    mem_units: string
}

export interface SystemInfo {
    cpu_info?: {
        cpu_count?: number
        bits?: string
        processor?: string
        cpu_desc?: string
        hardware_desc?: string
        model?: string
        total_memory?: number
        memory_units?: string
    }
    distribution?: { name?: string; codename?: string; kernel_version?: string }
    sd_info?: { manufacturer?: string; product_name?: string; capacity?: string }
    python?: { version_string?: string }
    network?: Record<string, { mac_address?: string; ip_addresses?: { family: string; address: string }[] }>
    [key: string]: unknown
}

/** One entry of `machine.update.status`. Only the fields the panel renders. */
export interface UpdateEntry {
    name: string
    configured_type?: string
    channel?: string
    owner?: string
    version?: string
    remote_version?: string
    full_version_string?: string
    is_valid?: boolean
    is_dirty?: boolean
    package_count?: number
}

export const useServerStore = defineStore('server', () => {
    const connection = useConnectionStore()

    const systemInfo = ref<SystemInfo | null>(null)
    const cpuUsage = ref<number | null>(null)
    const moonrakerMemory = ref<number | null>(null)
    /** Kelvin-free: Moonraker reports the SoC sensor in °C, or omits it. */
    const cpuTemp = ref<number | null>(null)
    const throttledFlags = ref<string[]>([])
    const websocketCount = ref<number | null>(null)

    const updates = ref<UpdateEntry[]>([])
    const updatesLoaded = ref(false)
    const updatesBusy = ref(false)

    async function loadSystemInfo(): Promise<void> {
        const result = await connection.call<{ system_info?: SystemInfo }>('machine.system_info').catch(() => null)

        if (result?.system_info) systemInfo.value = result.system_info
    }

    async function loadProcStats(): Promise<void> {
        const result = await connection
            .call<{
                moonraker_stats?: ProcStatSample[]
                cpu_temp?: number | null
                throttled_state?: { flags?: string[] } | null
                websocket_connections?: number
            }>('machine.proc_stats')
            .catch(() => null)

        if (!result) return

        const last = result.moonraker_stats?.at(-1)
        if (last) {
            cpuUsage.value = last.cpu_usage
            moonrakerMemory.value = last.memory
        }
        cpuTemp.value = result.cpu_temp ?? null
        throttledFlags.value = result.throttled_state?.flags ?? []
        websocketCount.value = result.websocket_connections ?? null
    }

    /**
     * Update status.
     *
     * 🔴 `refresh: false` IS DELIBERATE AND MUST STAY THAT WAY
     * With `refresh: true` Moonraker goes out to GitHub for every configured
     * repository. That is slow on this link, it burns an unauthenticated
     * GitHub rate limit shared with the working Mainsail, and it is not what a
     * page load should do. The cached answer is what the panel shows, and it
     * is labelled as cached rather than presented as live.
     *
     * There is NO action here that starts an update. See the panel for why.
     */
    async function loadUpdates(): Promise<void> {
        const result = await connection
            .call<{ version_info?: Record<string, Record<string, unknown>>; busy?: boolean }>('machine.update.status', {
                refresh: false,
            })
            .catch(() => null)

        if (!result?.version_info) return

        updatesBusy.value = result.busy ?? false
        updates.value = Object.entries(result.version_info).map(([name, info]) => ({
            name,
            configured_type: info.configured_type as string | undefined,
            channel: info.channel as string | undefined,
            owner: info.owner as string | undefined,
            version: info.version as string | undefined,
            remote_version: info.remote_version as string | undefined,
            full_version_string: info.full_version_string as string | undefined,
            is_valid: info.is_valid as boolean | undefined,
            is_dirty: info.is_dirty as boolean | undefined,
            package_count: Array.isArray(info.package_list) ? info.package_list.length : undefined,
        }))
        updatesLoaded.value = true
    }

    /**
     * An entry is out of date when the two versions differ.
     *
     * `system` (apt packages) has no version pair at all -- it reports a
     * package_count instead -- so it is handled separately rather than being
     * silently reported as up to date.
     */
    const isOutdated = (entry: UpdateEntry): boolean => {
        if (entry.configured_type === 'system') return (entry.package_count ?? 0) > 0
        if (!entry.version || !entry.remote_version) return false
        return entry.version !== entry.remote_version
    }

    const outdatedCount = computed(() => updates.value.filter(isOutdated).length)

    /** Moonraker pushes these once a second; no timer of our own. */
    connection.onNotify(({ method, params }) => {
        if (method === 'notify_proc_stat_update') {
            const payload = params[0] as
                | {
                      moonraker_stats?: ProcStatSample
                      cpu_temp?: number | null
                      throttled_state?: { flags?: string[] } | null
                      websocket_connections?: number
                  }
                | undefined
            if (!payload) return

            if (payload.moonraker_stats) {
                cpuUsage.value = payload.moonraker_stats.cpu_usage
                moonrakerMemory.value = payload.moonraker_stats.memory
            }
            if (payload.cpu_temp !== undefined) cpuTemp.value = payload.cpu_temp
            if (payload.throttled_state) throttledFlags.value = payload.throttled_state.flags ?? []
            if (payload.websocket_connections !== undefined) websocketCount.value = payload.websocket_connections
            return
        }

        // Moonraker announces a finished update or a refreshed cache; without
        // this the panel keeps showing what was true when the page loaded.
        if (method === 'notify_update_response' || method === 'notify_update_refreshed') void loadUpdates()
    })

    watch(
        () => connection.isConnected,
        (connected) => {
            if (!connected) return
            void loadSystemInfo()
            void loadProcStats()
            void loadUpdates()
        },
        { immediate: true }
    )

    return {
        systemInfo,
        cpuUsage,
        cpuTemp,
        moonrakerMemory,
        throttledFlags,
        websocketCount,
        updates,
        updatesLoaded,
        updatesBusy,
        outdatedCount,
        isOutdated,
        loadSystemInfo,
        loadProcStats,
        loadUpdates,
    }
})
