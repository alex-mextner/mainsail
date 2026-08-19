import { ref, computed, shallowRef } from 'vue'
import { defineStore } from 'pinia'

/**
 * Printer farm -- Mainsail's `store/farm/*` Vuex modules, as one pinia store.
 *
 * 🔴 THIS ONE IS NOT "HARDWARE THIS MACHINE LACKS" -- IT IS A DEPLOYMENT MODE
 * THIS BUILD IS NOT IN, and the difference matters for how it was checked.
 * AFC and MMU are absent because a Klipper extra is not installed; asking the
 * printer was the right test. Farm asks nothing of the printer at all. It is a
 * view over OTHER Moonraker hosts, and upstream gates it on `instancesDB`:
 *
 *   'moonraker'  one printer, served by that printer   <- what this build is
 *   'browser'    a user-managed list in localStorage
 *   'json'       a fixed list baked into remote/config.json
 *
 * Under 'moonraker' upstream never registers a farm printer and never shows
 * the route. This port keeps that gate and defaults to 'moonraker', so on this
 * deployment the list is empty, `connectAll()` is a no-op, and NOT ONE extra
 * websocket is opened.
 *
 * 🔴 WHY THAT DEFAULT IS A SAFETY PROPERTY AND NOT A PREFERENCE. Each farm
 * printer holds its OWN persistent websocket with an automatic reconnect loop
 * (`maxReconnects` attempts, `reconnectInterval` apart). The host this is
 * served from is an Orange Pi with 512 MB of RAM that has already been driven
 * into an out-of-memory state once, needing a physical power-cycle. A farm
 * entry pointed back at 192.168.11.160 would add a second full status
 * subscription plus a reconnect timer that survives the tab being idle. So
 * `addPrinter` refuses an entry that resolves to the host serving the page --
 * see the guard below, which is ours and not upstream's.
 */

export type InstancesMode = 'moonraker' | 'browser' | 'json'

export interface FarmPrinterConfig {
    id: string
    name: string
    hostname: string
    port: number
    path?: string
}

export interface FarmPrinterState {
    config: FarmPrinterConfig
    isConnecting: boolean
    isConnected: boolean
    klippyConnected: boolean
    reconnects: number
    /** Live `printer.objects.subscribe` state, same shape as the main store. */
    objects: Record<string, unknown>
    error: string | null
}

const MAX_RECONNECTS = 3
const RECONNECT_INTERVAL = 5000

/** Objects a farm card needs. Deliberately short: this is N printers at once. */
const SUBSCRIBE = {
    webhooks: null,
    print_stats: null,
    virtual_sdcard: null,
    display_status: null,
    heater_bed: null,
    extruder: null,
    toolhead: null,
}

export const useFarmStore = defineStore('farm', () => {
    /**
     * Which deployment mode this build is in. `moonraker` means "this UI is
     * served by the one printer it talks to", which is what the app-next
     * bundle is (whichever port it happens to be served on), so nothing
     * farm-related is ever activated.
     */
    const mode = ref<InstancesMode>('moonraker')

    const printers = ref<FarmPrinterState[]>([])
    /** Sockets kept out of the reactive graph -- a WebSocket is not data. */
    const sockets = shallowRef(new Map<string, WebSocket>())

    const enabled = computed(() => mode.value !== 'moonraker')
    const count = computed(() => printers.value.length)

    const find = (id: string) => printers.value.find((printer) => printer.config.id === id)

    /**
     * Would this entry point back at the host serving this page?
     *
     * Compares against `location`, so it is right regardless of how the page
     * was reached. A same-host entry is refused rather than deduplicated: the
     * main connection already subscribes to everything this card would.
     */
    function isSelf(config: FarmPrinterConfig): boolean {
        if (typeof window === 'undefined') return false

        const selfPort = window.location.port ? Number(window.location.port) : 80
        return config.hostname === window.location.hostname && config.port === selfPort
    }

    function addPrinter(config: FarmPrinterConfig): string | null {
        if (!enabled.value) return 'Farm mode is off: this build serves a single printer.'
        if (printers.value.some((printer) => printer.config.id === config.id)) return 'That printer is already listed.'
        if (isSelf(config)) return 'That is the printer serving this page -- it is already connected.'

        printers.value.push({
            config,
            isConnecting: false,
            isConnected: false,
            klippyConnected: false,
            reconnects: 0,
            objects: {},
            error: null,
        })

        return null
    }

    function removePrinter(id: string): void {
        sockets.value.get(id)?.close(1000, 'removed')
        sockets.value.delete(id)
        printers.value = printers.value.filter((printer) => printer.config.id !== id)
    }

    const socketUrl = (config: FarmPrinterConfig) => {
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
        const path = (config.path ?? '').replace(/\/$/, '')

        return `${protocol}://${config.hostname}:${config.port}${path}/websocket`
    }

    function connect(id: string): void {
        const entry = printers.value.find((printer) => printer.config.id === id)
        if (!entry || sockets.value.has(id)) return

        entry.isConnecting = true
        entry.error = null

        const socket = new WebSocket(socketUrl(entry.config))
        sockets.value.set(id, socket)

        socket.onopen = () => {
            entry.isConnecting = false
            entry.isConnected = true
            entry.reconnects = 0
            socket.send(
                JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'printer.objects.subscribe',
                    params: { objects: SUBSCRIBE },
                    id: Date.now(),
                })
            )
        }

        socket.onmessage = (event) => {
            let frame: { method?: string; params?: unknown[]; result?: { status?: Record<string, unknown> } }
            try {
                frame = JSON.parse(event.data)
            } catch {
                return
            }

            if (frame.method === 'notify_status_update') {
                Object.assign(entry.objects, (frame.params?.[0] as Record<string, unknown>) ?? {})
            } else if (frame.method === 'notify_klippy_ready') {
                entry.klippyConnected = true
            } else if (frame.method === 'notify_klippy_disconnected') {
                entry.klippyConnected = false
            } else if (frame.result?.status) {
                Object.assign(entry.objects, frame.result.status)
                entry.klippyConnected = true
            }
        }

        socket.onerror = () => {
            entry.error = 'Could not reach this printer.'
        }

        /**
         * Reconnect only on an UNCLEAN close, and only a bounded number of
         * times. Upstream's rule, kept for the reason in the header: an
         * unbounded retry loop against an unreachable host is a timer that
         * never stops, on a page nobody is looking at.
         */
        socket.onclose = (event) => {
            sockets.value.delete(id)
            entry.isConnected = false
            entry.klippyConnected = false

            if (!find(id)) return
            if (event.wasClean || entry.reconnects >= MAX_RECONNECTS) {
                entry.isConnecting = false
                entry.reconnects = 0
                return
            }

            entry.reconnects += 1
            setTimeout(() => connect(id), RECONNECT_INTERVAL)
        }
    }

    function connectAll(): void {
        if (!enabled.value) return
        for (const entry of printers.value) connect(entry.config.id)
    }

    function disconnectAll(): void {
        for (const [id, socket] of sockets.value) {
            socket.close(1000, 'farm page left')
            sockets.value.delete(id)
        }
        for (const entry of printers.value) {
            entry.isConnected = false
            entry.isConnecting = false
        }
    }

    return {
        mode,
        printers,
        enabled,
        count,
        isSelf,
        addPrinter,
        removePrinter,
        connect,
        connectAll,
        disconnectAll,
    }
})
