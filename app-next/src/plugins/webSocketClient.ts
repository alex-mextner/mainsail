import type { App } from 'vue'
import type { Store } from 'vuex'
import type { RootState } from '@/store/types'

/**
 * JSON-RPC-over-websocket client for Moonraker.
 *
 * Ported from the Vue 2 tree's `src/plugins/webSocketClient.ts`. The class body
 * is deliberately kept close to the original: it never touched Vue, only Vuex,
 * so it survives the Vue 3 move nearly unchanged. The only real difference is
 * at the bottom -- Vue 2 installed it via `Vue.prototype.$socket`, which no
 * longer exists in Vue 3; the Vue 3 equivalent is `app.config.globalProperties`
 * plus `app.provide()` so `<script setup>` components can `inject()` it.
 */

type Params = object

interface EmitOptions {
    action?: string | null
    actionPayload?: Params
    loading?: string | null
}

export interface Wait {
    id: number
    params: unknown
    action?: string | null
    actionPayload?: Params
    loading?: string | null
    resolve?: (value: unknown) => void
    reject?: (reason?: unknown) => void
}

interface SocketError {
    code?: number
    message?: string
    [key: string]: unknown
}

interface SocketIncomingMessage {
    id?: number
    result?: unknown
    error?: SocketError
    method?: string
    params?: unknown[]
    [key: string]: unknown
}

export interface WebSocketPluginOptions {
    url: string
    maxReconnects?: number
    reconnectInterval?: number
    store: Store<RootState>
}

export class WebSocketClient {
    url = ''
    instance: WebSocket | null = null
    maxReconnects = 5
    reconnectInterval = 1000
    reconnects = 0
    messageId = 0
    store: Store<RootState> | null = null
    waits: Wait[] = []
    heartbeatTimer: number | null = null

    constructor(options: WebSocketPluginOptions) {
        this.url = options.url
        this.maxReconnects = options.maxReconnects ?? 5
        this.reconnectInterval = options.reconnectInterval ?? 1000
        this.store = options.store
    }

    setUrl(url: string): void {
        this.url = url
    }

    handleMessage(data: SocketIncomingMessage): void {
        const wait = typeof data.id === 'number' ? this.getWaitById(data.id) : null

        // reject the promise if one is attached
        if (data.error && wait?.reject) {
            wait.reject(data.error)
            this.removeWaitById(wait.id)
            return
        }

        if (data.error?.message) {
            if (data.error.message !== 'Klippy Disconnected') {
                window.console.error(`Response Error: ${data.error.message} (${wait?.action ?? 'no action'})`)
            }
            if (wait) this.removeWaitById(wait.id)
            return
        }

        // unsolicited message (notify_*) -> straight into the store
        if (!wait) {
            this.store?.dispatch('socket/onMessage', data)
            return
        }

        if (wait.resolve) wait.resolve(data.result ?? {})

        if (wait.action) {
            let result = data.result
            if (result === 'ok') result = { result }
            if (typeof result === 'string') result = { result }

            const preload: Record<string, unknown> = {}
            if (wait.actionPayload) Object.assign(preload, wait.actionPayload)
            Object.assign(preload, { requestParams: wait.params })
            Object.assign(preload, result as Record<string, unknown>)
            this.store?.dispatch(wait.action, preload)
        }

        this.removeWaitById(wait.id)
    }

    connect(): void {
        this.store?.dispatch('socket/setData', { isConnecting: true })

        this.instance?.close()
        this.instance = new WebSocket(this.url)

        this.instance.onopen = () => {
            this.reconnects = 0
            this.store?.dispatch('socket/onOpen')
        }

        this.instance.onclose = (e) => {
            if (e.wasClean || this.reconnects >= this.maxReconnects) {
                this.store?.dispatch('socket/onClose', e)
                return
            }

            this.reconnects++
            setTimeout(() => this.connect(), this.reconnectInterval)
        }

        this.instance.onerror = () => {
            this.instance?.close()
        }

        this.instance.onmessage = (msg) => {
            if (this.store === null) return

            this.heartbeat()

            const data = JSON.parse(msg.data)
            if (Array.isArray(data)) {
                for (const message of data) this.handleMessage(message)
                return
            }

            this.handleMessage(data)
        }
    }

    close(): void {
        this.instance?.close()
    }

    getWaitById(id: number): Wait | null {
        return this.waits.find((wait) => wait.id === id) ?? null
    }

    removeWaitById(id: number | null): void {
        const index = this.waits.findIndex((wait) => wait.id === id)
        // NOTE: the Vue 2 original wrote `if (index)`, which silently skipped
        // index 0 and leaked the very first wait of every connection. Fixed
        // here rather than ported faithfully -- see the migration notes.
        if (index === -1) return

        const wait = this.waits[index]
        if (wait.loading) this.store?.dispatch('socket/removeLoading', { name: wait.loading })
        this.waits.splice(index, 1)
    }

    emit(method: string, params: Params, options: EmitOptions = {}): void {
        if (this.instance?.readyState !== WebSocket.OPEN) return

        const id = this.messageId++
        this.waits.push({
            id,
            params,
            action: options.action ?? null,
            actionPayload: options.actionPayload ?? {},
            loading: options.loading ?? null,
        })

        if (options.loading) this.store?.dispatch('socket/addLoading', { name: options.loading })

        this.instance.send(JSON.stringify({ jsonrpc: '2.0', method, params, id }))
    }

    emitAndWait<T = unknown>(method: string, params: Params = {}, options: EmitOptions = {}): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            if (this.instance?.readyState !== WebSocket.OPEN) {
                reject(new Error('websocket is not open'))
                return
            }

            const id = this.messageId++
            this.waits.push({
                id,
                params,
                action: options.action ?? null,
                actionPayload: options.actionPayload ?? {},
                loading: options.loading ?? null,
                resolve: resolve as (value: unknown) => void,
                reject,
            })

            if (options.loading) this.store?.dispatch('socket/addLoading', { name: options.loading })

            this.instance.send(JSON.stringify({ jsonrpc: '2.0', method, params, id }))
        })
    }

    /** Drop the connection if no frame arrives for 10 s, so the UI can show it. */
    heartbeat(): void {
        if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer)

        this.heartbeatTimer = window.setTimeout(() => {
            if (this.instance?.readyState !== WebSocket.OPEN || !this.store) return

            this.close()
            this.store.dispatch('socket/onClose')
        }, 10000)
    }
}

export const socketKey = Symbol('socket') as InjectionKeyLike
type InjectionKeyLike = symbol & { __brand?: WebSocketClient }

export function createWebSocketPlugin(options: WebSocketPluginOptions) {
    const socket = new WebSocketClient(options)

    return {
        socket,
        install(app: App) {
            // Vue 3 replacement for `Vue.prototype.$socket = socket`.
            app.config.globalProperties.$socket = socket
            app.provide(socketKey, socket)
        },
    }
}
