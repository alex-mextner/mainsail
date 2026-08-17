/**
 * Moonraker JSON-RPC-over-websocket transport.
 *
 * Deliberately knows nothing about Vue, Pinia or any store: it speaks the
 * protocol and hands results back through callbacks. The Vue 2 original was
 * wired straight into Vuex (`this.store.dispatch(...)` from inside the socket
 * handler), which is what made it untestable and un-reusable. Keeping the
 * transport pure means the stores can be rewritten -- as they just were, from
 * Vuex to Pinia -- without touching a line of protocol code.
 */

export type RpcId = number

export interface RpcError {
    code?: number
    message?: string
}

export interface Notification {
    method: string
    params: unknown[]
}

interface Pending {
    resolve: (value: never) => void
    reject: (reason: RpcError) => void
}

export interface MoonrakerClientOptions {
    url: string
    /** Delay before a reconnect attempt, in ms. */
    reconnectInterval?: number
    /** Drop the socket if no frame arrives within this window, in ms. */
    heartbeatTimeout?: number
}

export type ConnectionState = 'connecting' | 'connected' | 'disconnected'

export class MoonrakerClient {
    private socket: WebSocket | null = null
    private nextId: RpcId = 1
    private readonly pending = new Map<RpcId, Pending>()
    private heartbeat: ReturnType<typeof setTimeout> | null = null
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null
    private closedByUs = false

    private readonly url: string
    private readonly reconnectInterval: number
    private readonly heartbeatTimeout: number

    /** Subscribers. Kept as sets so a component can attach and detach freely. */
    private readonly notificationHandlers = new Set<(n: Notification) => void>()
    private readonly stateHandlers = new Set<(s: ConnectionState) => void>()

    constructor(options: MoonrakerClientOptions) {
        this.url = options.url
        this.reconnectInterval = options.reconnectInterval ?? 2000
        this.heartbeatTimeout = options.heartbeatTimeout ?? 10000
    }

    onNotification(handler: (n: Notification) => void): () => void {
        this.notificationHandlers.add(handler)
        return () => this.notificationHandlers.delete(handler)
    }

    onStateChange(handler: (s: ConnectionState) => void): () => void {
        this.stateHandlers.add(handler)
        return () => this.stateHandlers.delete(handler)
    }

    private emitState(state: ConnectionState) {
        for (const handler of this.stateHandlers) handler(state)
    }

    connect(): void {
        this.closedByUs = false
        this.emitState('connecting')

        this.socket?.close()
        this.socket = new WebSocket(this.url)

        this.socket.onopen = () => this.emitState('connected')

        this.socket.onmessage = (event) => {
            this.resetHeartbeat()
            const data = JSON.parse(event.data)
            // Moonraker may batch frames into an array.
            if (Array.isArray(data)) data.forEach((frame) => this.handleFrame(frame))
            else this.handleFrame(data)
        }

        this.socket.onerror = () => this.socket?.close()

        this.socket.onclose = () => {
            this.clearHeartbeat()
            this.rejectAllPending({ message: 'socket closed' })
            this.emitState('disconnected')
            if (!this.closedByUs) this.scheduleReconnect()
        }
    }

    close(): void {
        this.closedByUs = true
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
        this.clearHeartbeat()
        this.socket?.close()
    }

    private scheduleReconnect() {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
        // Retries forever rather than giving up after N attempts: the printer
        // host reboots, and the tablet at the machine should recover on its own.
        this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectInterval)
    }

    private resetHeartbeat() {
        this.clearHeartbeat()
        this.heartbeat = setTimeout(() => {
            if (this.socket?.readyState === WebSocket.OPEN) this.socket.close()
        }, this.heartbeatTimeout)
    }

    private clearHeartbeat() {
        if (this.heartbeat) clearTimeout(this.heartbeat)
        this.heartbeat = null
    }

    private rejectAllPending(error: RpcError) {
        for (const { reject } of this.pending.values()) reject(error)
        this.pending.clear()
    }

    private handleFrame(frame: Record<string, unknown>) {
        const id = frame.id as RpcId | undefined

        if (typeof id === 'number') {
            const waiter = this.pending.get(id)
            if (!waiter) return
            this.pending.delete(id)

            if (frame.error) waiter.reject(frame.error as RpcError)
            else waiter.resolve((frame.result ?? {}) as never)
            return
        }

        if (typeof frame.method === 'string') {
            const notification: Notification = {
                method: frame.method,
                params: (frame.params as unknown[]) ?? [],
            }
            for (const handler of this.notificationHandlers) handler(notification)
        }
    }

    get isOpen(): boolean {
        return this.socket?.readyState === WebSocket.OPEN
    }

    /** Fire-and-forget. */
    notify(method: string, params: object = {}): void {
        if (!this.isOpen) return
        this.socket?.send(JSON.stringify({ jsonrpc: '2.0', method, params, id: this.nextId++ }))
    }

    /** Request/response. Rejects if the socket is not open or Moonraker errors. */
    call<T = unknown>(method: string, params: object = {}): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            if (!this.isOpen) {
                reject({ message: 'socket is not open' })
                return
            }

            const id = this.nextId++
            this.pending.set(id, { resolve: resolve as (v: never) => void, reject })
            this.socket?.send(JSON.stringify({ jsonrpc: '2.0', method, params, id }))
        })
    }
}

/**
 * Same-origin URL. In dev the Vite proxy forwards it to the printer; in
 * production the bundle is served by the printer itself, so it is already
 * correct. Nothing hardcodes an IP.
 */
export function defaultMoonrakerUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    return `${protocol}://${window.location.host}/websocket`
}
