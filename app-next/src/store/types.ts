import type { SocketState } from './socket/types'
import type { PrinterState } from './printer/types'

export interface RootState {
    packageVersion: string
    /** Klipper's hostname, from printer.info; null until the first reply. */
    hostname: string | null

    // Vuex 4 does not fold module state into the root state type on its own.
    // Declaring the namespaced modules here is what lets components read
    // `store.state.socket.klippyState` with types instead of casts.
    socket: SocketState
    printer: PrinterState
}
