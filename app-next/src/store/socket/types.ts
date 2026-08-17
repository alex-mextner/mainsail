export interface SocketState {
    hostname: string
    port: number
    path: string
    protocol: 'ws' | 'wss'
    reconnectInterval: number
    isConnected: boolean
    isConnecting: boolean
    connectingFailed: boolean
    connectionFailedMessage: string | null
    loadings: string[]
    /** Klippy's own state, as reported by printer.info / notify_klippy_*. */
    klippyState: 'ready' | 'startup' | 'shutdown' | 'error' | 'disconnected' | null
    klippyMessage: string | null
}
