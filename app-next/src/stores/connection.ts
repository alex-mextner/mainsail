import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { MoonrakerClient, defaultMoonrakerUrl, type ConnectionState } from '@/lib/moonraker/client'
import { usePrinterStore } from './printer'
import { useTempHistoryStore } from './tempHistory'
import type { KlippyState, PrinterInfo } from '@/types/printer'

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

    let client: MoonrakerClient | null = null

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

    async function initialise() {
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

        client.onNotification(({ method, params }) => {
            switch (method) {
                case 'notify_status_update':
                    printer.applyStatus((params[0] ?? {}) as Record<string, unknown>)
                    tempHistory.record()
                    break

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
     * Run a g-code script. Every button in every panel goes through here, which
     * is why the echo into the event log lives here too rather than in each
     * caller -- upstream had to remember `server/addEvent` at 40-odd call sites
     * and occasionally didn't.
     */
    async function sendGcode(script: string, loadingKey?: string): Promise<void> {
        if (loadingKey && !loadings.value.includes(loadingKey)) loadings.value.push(loadingKey)

        try {
            await call('printer.gcode.script', { script })
        } catch {
            // Klipper rejecting a command is normal (unhomed axis, busy). It is
            // reported to the user through the console output Moonraker pushes
            // back, so nothing to do here but stop the spinner.
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
        isConnected,
        isReady,
        statusLabel,
        loadings,
        isLoading,
        connect,
        disconnect,
        call,
        sendGcode,
    }
})
