import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { MoonrakerClient, defaultMoonrakerUrl, type ConnectionState, type RpcError } from '@/lib/moonraker/client'
import { usePrinterStore } from './printer'
import { useTempHistoryStore } from './tempHistory'
import type { KlippyState, PrinterInfo } from '@/types/printer'

/**
 * One line of the g-code console: what was sent, or what Klipper said back.
 *
 * The types are upstream's. `action` and `debug` are Klipper's own `// action:`
 * and `// debug:` prefixes -- machine-to-client chatter rather than something
 * said to the operator, which is why the console greys them out.
 */
export type ConsoleLineType = 'command' | 'response' | 'error' | 'action' | 'debug' | 'help'

export interface ConsoleLine {
    /** Monotonic within a session, so a list can key on it without collisions. */
    id: number
    time: number
    message: string
    type: ConsoleLineType
}

/**
 * Owns the Moonraker connection and the Klippy lifecycle.
 *
 * Everything the UI needs to answer "can I trust what I'm looking at?" lives
 * here: socket state, Klippy state, and the last error message. Panels read
 * these rather than each deciding for themselves.
 */
export const useConnectionStore = defineStore('connection', () => {
    const printer = usePrinterStore()
    const tempHistory = useTempHistoryStore()

    const socketState = ref<ConnectionState>('disconnected')
    const klippyState = ref<KlippyState | null>(null)
    const klippyMessage = ref<string | null>(null)
    const hostname = ref<string | null>(null)
    const softwareVersion = ref<string | null>(null)
    /**
     * Which optional Moonraker components are loaded. Panels gate on this
     * rather than assuming: `job_queue`, `history` and `timelapse` are all
     * optional, and offering a button for a component that is not there
     * produces an RPC error the user cannot act on.
     */
    const moonrakerComponents = ref<string[]>([])

    let client: MoonrakerClient | null = null

    /**
     * Extra notification subscribers, for stores that own their own slice of
     * Moonraker's push traffic (files, history). They are called for EVERY
     * notification, after this store's own handling.
     *
     * The alternative -- a `case` here per feature -- is what the Vue 2 socket
     * plugin did, and it is why adding a panel meant editing the transport.
     */
    const notificationSubscribers = new Set<(notification: { method: string; params: unknown[] }) => void>()

    function onNotify(handler: (notification: { method: string; params: unknown[] }) => void): () => void {
        notificationSubscribers.add(handler)
        return () => notificationSubscribers.delete(handler)
    }

    const isConnected = computed(() => socketState.value === 'connected')
    const isReady = computed(() => isConnected.value && klippyState.value === 'ready')

    /** One line for the status chip, so panels do not each invent their own. */
    const statusLabel = computed(() => {
        if (socketState.value === 'connecting') return 'connecting'
        if (socketState.value === 'disconnected') return 'offline'
        return klippyState.value ?? 'unknown'
    })

    async function loadPrinterInfo() {
        if (!client) return

        const info = await client.call<PrinterInfo>('printer.info').catch(() => null)
        if (!info) return

        klippyState.value = info.state ?? null
        klippyMessage.value = info.state_message ?? null
        hostname.value = info.hostname ?? null
        softwareVersion.value = info.software_version ?? null
        return info
    }

    /**
     * Subscribe to every object Klipper exposes. Upstream builds a filtered
     * list from what is mounted; on a printer with ~80 objects subscribing to
     * all of them is simpler and costs little, and it means a newly added panel
     * never has to touch the subscription.
     */
    async function subscribeAll() {
        if (!client) return

        const list = await client.call<{ objects: string[] }>('printer.objects.list').catch(() => null)
        if (!list) return

        const objects: Record<string, null> = {}
        for (const name of list.objects) objects[name] = null

        const result = await client
            .call<{ status: Record<string, unknown> }>('printer.objects.subscribe', { objects })
            .catch(() => null)

        if (result?.status) printer.applyStatus(result.status)
    }

    /** Pull the ~20 minutes of history Moonraker already has, so the chart is
     *  never empty on first paint. */
    async function seedTemperatureHistory() {
        if (!client) return

        const store = await client
            .call<Record<string, Record<string, number[]>>>('server.temperature_store', { include_monitors: false })
            .catch(() => null)

        if (store) tempHistory.seed(store)
    }

    /**
     * Pull the console scrollback Moonraker already holds.
     *
     * Without this the console is empty on every page load and only fills with
     * what happens next, which is worse than useless when you have just walked
     * up to the machine to find out what it said. Moonraker keeps the last
     * ~1000 lines in `server.gcode_store`, timestamps and types included.
     *
     * Seeded lines are prepended: they are older than anything this session
     * recorded, and their ids stay below the live ones so ordering by id and
     * ordering by time agree.
     */
    async function seedConsole() {
        if (!client) return

        const store = await client
            .call<{ gcode_store?: { message: string; time: number; type: string }[] }>('server.gcode_store')
            .catch(() => null)

        const entries = store?.gcode_store ?? []
        if (!entries.length) return

        const seeded: ConsoleLine[] = entries.map((entry, index) => ({
            id: -entries.length + index,
            time: Math.round(entry.time * 1000),
            message: entry.message,
            type: classify(entry.message, entry.type === 'command' ? 'command' : 'response'),
        }))

        consoleLines.value = [...seeded, ...consoleLines.value]
    }

    async function loadServerInfo() {
        if (!client) return

        const info = await client.call<{ components?: string[] }>('server.info').catch(() => null)

        moonrakerComponents.value = info?.components ?? []
    }

    async function initialise() {
        await loadServerInfo()
        // Before the Klippy check: Moonraker still has the scrollback when
        // Klipper is down, and that is exactly when you want to read it.
        await seedConsole()

        const info = await loadPrinterInfo()
        if (info?.state !== 'ready') return

        await subscribeAll()
        await seedTemperatureHistory()
    }

    function connect(url: string = defaultMoonrakerUrl()) {
        if (client) return

        client = new MoonrakerClient({ url })

        client.onStateChange((state) => {
            socketState.value = state
            if (state === 'connected') void initialise()
            if (state === 'disconnected') {
                klippyState.value = null
                printer.reset()
            }
        })

        client.onNotification((notification) => {
            const { method, params } = notification

            for (const subscriber of notificationSubscribers) subscriber(notification)

            switch (method) {
                case 'notify_status_update':
                    printer.applyStatus((params[0] ?? {}) as Record<string, unknown>)
                    tempHistory.record()
                    break

                case 'notify_gcode_response': {
                    // Klipper's own words -- refusals, RESPOND output, M117 echoes.
                    const line = String(params[0] ?? '')
                    recordConsole(line, line.startsWith('!!') ? 'error' : 'response')
                    break
                }

                case 'notify_klippy_ready':
                    klippyState.value = 'ready'
                    void subscribeAll()
                    break

                case 'notify_klippy_shutdown':
                    klippyState.value = 'shutdown'
                    break

                case 'notify_klippy_disconnected':
                    klippyState.value = 'disconnected'
                    printer.reset()
                    tempHistory.reset()
                    break

                default:
                    // Unknown notifications are ignored rather than logged:
                    // these arrive several times a second during a print.
                    break
            }
        })

        client.connect()
    }

    function disconnect() {
        client?.close()
        client = null
    }

    /** Escape hatch for panels that need a raw RPC (file metadata, macros...). */
    function call<T = unknown>(method: string, params: object = {}): Promise<T> {
        if (!client) return Promise.reject({ message: 'not connected' })
        return client.call<T>(method, params)
    }

    /**
     * Keys of in-flight operations, so a button can show a spinner while its
     * command runs. Upstream keeps the same idea in `socket.loadings`; here the
     * key is added when the RPC is sent and removed when Klipper answers, which
     * is more honest than upstream's timeout-based clearing.
     */
    const loadings = ref<string[]>([])

    const isLoading = (key: string) => loadings.value.includes(key)

    /**
     * Console log: what we sent, and everything Klipper said back.
     *
     * Klipper reports refusals and RESPOND output through
     * `notify_gcode_response`, not through the RPC result, so a UI that only
     * watches call results is deaf to most of what the printer tells it. Lines
     * beginning `!!` are errors by Klipper's own convention.
     *
     * Capped ring buffer: during a print these arrive several times a second,
     * and an unbounded array on a long-running tablet session is a slow leak.
     *
     * 🔴 NOTHING IS FILTERED HERE, AND THAT IS A DELIBERATE DIFFERENCE
     * ---------------------------------------------------------------
     * Upstream applies the console filters ("hide temperatures", the user's own
     * regexes) in `server/addEvent`, BEFORE storing. Two consequences it lives
     * with: turning a filter off cannot bring back lines already discarded, and
     * the transport has to know about the settings store.
     *
     * Here everything is kept and the console filters at render time, so a
     * toggle is retroactive. The cost is buffer pressure -- a long `M109`
     * heat-and-wait emits a temperature line a second -- which is why the cap is
     * 2000 rather than upstream's 1000. At roughly 100 bytes a line that is
     * 200 kB, which is nothing next to what a single g-code thumbnail costs.
     */
    const MAX_CONSOLE_LINES = 2000

    const consoleLines = ref<ConsoleLine[]>([])
    let nextConsoleId = 1

    /**
     * Klipper marks its own machine-directed chatter with these prefixes, and
     * errors with `!!`. One place decides what a line is, so the seeded
     * scrollback and the live stream are classified identically.
     */
    function classify(message: string, type: ConsoleLineType): ConsoleLineType {
        if (type !== 'response') return type
        if (message.startsWith('!! ')) return 'error'
        if (message.startsWith('// action:')) return 'action'
        if (message.startsWith('// debug:')) return 'debug'
        return 'response'
    }

    function recordConsole(message: string, type: ConsoleLineType) {
        consoleLines.value.push({ id: nextConsoleId++, time: Date.now(), message, type: classify(message, type) })
        if (consoleLines.value.length > MAX_CONSOLE_LINES) {
            consoleLines.value.splice(0, consoleLines.value.length - MAX_CONSOLE_LINES)
        }
    }

    /** Local-only echo, for the console's own output (autocomplete, help). */
    const addConsoleLine = (message: string, type: ConsoleLineType = 'response') => recordConsole(message, type)

    /** Most recent error, for panels that want to surface a failure inline. */
    const lastError = computed(() => [...consoleLines.value].reverse().find((line) => line.type === 'error') ?? null)

    /**
     * Run a g-code script. Every button in every panel goes through here, which
     * is why the echo into the event log lives here too rather than in each
     * caller -- upstream had to remember `server/addEvent` at 40-odd call sites
     * and occasionally didn't.
     */
    async function sendGcode(script: string, loadingKey?: string): Promise<void> {
        if (loadingKey && !loadings.value.includes(loadingKey)) loadings.value.push(loadingKey)

        recordConsole(script, 'command')

        try {
            await call('printer.gcode.script', { script })
        } catch (error) {
            // NOT swallowed. A rejected command is how Klipper -- and anything
            // layered on it, such as a config-validating extras module --
            // explains that it refused and why. Discarding it would leave a
            // button that silently does nothing, which is the worst outcome:
            // the user retries instead of reading the reason.
            const message = (error as RpcError | undefined)?.message ?? 'command rejected'
            recordConsole(`!! ${message}`, 'error')
        } finally {
            if (loadingKey) loadings.value = loadings.value.filter((key) => key !== loadingKey)
        }
    }

    return {
        socketState,
        klippyState,
        klippyMessage,
        hostname,
        softwareVersion,
        moonrakerComponents,
        isConnected,
        isReady,
        consoleLines,
        lastError,
        statusLabel,
        loadings,
        isLoading,
        connect,
        disconnect,
        call,
        onNotify,
        sendGcode,
        addConsoleLine,
    }
})
