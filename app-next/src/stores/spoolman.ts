import { ref, computed, watch } from 'vue'
import { defineStore } from 'pinia'
import { useConnectionStore } from './connection'

/**
 * Spoolman -- Mainsail's `server/spoolman` Vuex module.
 *
 * 🔴 NOT PRESENT ON THIS MACHINE. Spoolman is a SEPARATE SERVER (a filament
 * database with its own web UI); Moonraker only proxies to it, through an
 * optional `spoolman` component that is not among the 25 loaded here. So the
 * store gates on the component, like `timelapse.ts` and `sensors.ts`, and for
 * the same reason -- and watches `available` as well as the socket, because
 * `server.info` lands AFTER the socket connects and gating on a list that has
 * not arrived is a race this port already lost once.
 *
 * Everything Spoolman-side goes through `server.spoolman.proxy`, which is
 * Moonraker forwarding an HTTP call. Two things follow, and both are ported:
 *
 *   `use_v2_response: true` -- without it a Spoolman error comes back as a
 *   successful RPC whose body happens to be an error, and the caller cannot
 *   tell "no spools" from "the spool server is down". With it the reply is
 *   `{ error, response }` and the difference is legible.
 *
 *   The proxy can succeed while Spoolman itself is unhealthy, so `/v1/health`
 *   is asked for separately and shown in the panel title.
 */

export interface SpoolmanVendor {
    id: number
    name: string
}

export interface SpoolmanFilament {
    id: number
    name: string
    material?: string
    color_hex?: string
    multi_color_hexes?: string
    multi_color_direction?: 'coaxial' | 'longitudinal'
    /** Grams of filament on a full spool, excluding the core. */
    weight?: number
    density?: number
    diameter?: number
    vendor?: SpoolmanVendor
}

export interface SpoolmanSpool {
    id: number
    archived?: boolean
    filament: SpoolmanFilament
    first_used?: string
    last_used?: string
    remaining_weight?: number
    remaining_length?: number
    used_weight?: number
    used_length?: number
    location?: string
    comment?: string
}

/** `{ error, response }` when `use_v2_response` was asked for; bare otherwise. */
const unwrapV2 = <T>(payload: unknown): { value: T | null; error: string | null } => {
    if (payload && typeof payload === 'object' && 'response' in payload) {
        const wrapper = payload as { error?: { message?: string } | null; response?: T }
        const message = wrapper.error?.message ?? null
        if (message) return { value: null, error: message }
        return { value: (wrapper.response ?? null) as T | null, error: null }
    }

    return { value: (payload ?? null) as T | null, error: null }
}

export const useSpoolmanStore = defineStore('spoolman', () => {
    const connection = useConnectionStore()

    const health = ref('')
    const version = ref('')
    const activeSpoolId = ref<number | null>(null)
    const activeSpool = ref<SpoolmanSpool | null>(null)
    const spools = ref<SpoolmanSpool[]>([])
    const loading = ref(false)
    /** Last error the proxy reported, so the panel can say what went wrong. */
    const error = ref<string | null>(null)

    const available = computed(() => connection.moonrakerComponents.includes('spoolman'))

    const proxy = async <T>(path: string): Promise<T | null> => {
        const payload = await connection
            .call<unknown>('server.spoolman.proxy', { request_method: 'GET', path, use_v2_response: true })
            .catch(() => null)

        if (payload === null) {
            error.value = 'Moonraker could not reach Spoolman.'
            return null
        }

        const { value, error: message } = unwrapV2<T>(payload)
        if (message) error.value = message
        return value
    }

    async function loadSpools(): Promise<void> {
        if (!available.value) return

        loading.value = true
        // Spoolman returns an object keyed by index over the proxy, not an
        // array, so it is normalised here rather than at every read site.
        const result = await proxy<Record<string, SpoolmanSpool> | SpoolmanSpool[]>('/v1/spool')
        loading.value = false

        if (!result) return
        spools.value = Array.isArray(result) ? result : Object.values(result)
    }

    async function loadActiveSpool(): Promise<void> {
        if (!available.value) return

        const current = await connection
            .call<{ spool_id?: number | null }>('server.spoolman.get_spool_id')
            .catch(() => null)

        activeSpoolId.value = current?.spool_id ?? null

        // 0 and null both mean "nothing loaded"; upstream treats them alike.
        if (!activeSpoolId.value) {
            activeSpool.value = null
            return
        }

        activeSpool.value = await proxy<SpoolmanSpool>(`/v1/spool/${activeSpoolId.value}`)
    }

    async function load(): Promise<void> {
        if (!available.value) return

        error.value = null

        const info = await proxy<{ version?: string }>('/v1/info')
        version.value = info?.version ?? ''

        const state = await proxy<{ status?: string }>('/v1/health')
        health.value = state?.status ?? ''

        await loadActiveSpool()
        await loadSpools()
    }

    /** `null` ejects: Moonraker takes the absence of the parameter as "none". */
    async function setActiveSpool(id: number | null): Promise<void> {
        await connection
            .call('server.spoolman.post_spool_id', id === null ? {} : { spool_id: id })
            .catch(() => null)

        await loadActiveSpool()
    }

    connection.onNotify((notification) => {
        if (notification.method !== 'notify_active_spool_set') return
        // The spool can be changed from Spoolman's own UI or by a macro, so the
        // panel has to follow rather than only lead.
        void loadActiveSpool()
    })

    /**
     * Spoolman's own web UI, from `server.config`. A `localhost` in the
     * configured URL is localhost FOR MOONRAKER, not for the tablet reading
     * this page, so it is rewritten to the host this app was served from --
     * upstream does the same, and without it the link is dead on every device
     * except the printer itself.
     */
    const managerUrl = ref<string | null>(null)

    async function loadManagerUrl(): Promise<void> {
        if (!available.value) return

        const config = await connection
            .call<{ config?: { spoolman?: { server?: string } } }>('server.config')
            .catch(() => null)

        const base = config?.config?.spoolman?.server
        if (!base) return

        try {
            const url = new URL(base)
            if (['localhost', '127.0.0.1', '::1'].includes(url.hostname)) url.hostname = window.location.hostname
            managerUrl.value = url.toString()
        } catch {
            managerUrl.value = null
        }
    }

    watch(
        [() => connection.isConnected, available],
        ([connected, ready]) => {
            if (!connected || !ready) return
            void load()
            void loadManagerUrl()
        },
        { immediate: true }
    )

    function reset(): void {
        health.value = ''
        version.value = ''
        activeSpoolId.value = null
        activeSpool.value = null
        spools.value = []
        error.value = null
        managerUrl.value = null
    }

    return {
        health,
        version,
        activeSpoolId,
        activeSpool,
        spools,
        loading,
        error,
        available,
        managerUrl,
        load,
        loadSpools,
        loadActiveSpool,
        setActiveSpool,
        reset,
    }
})
