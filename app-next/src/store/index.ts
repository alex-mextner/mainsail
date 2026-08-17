import { createStore } from 'vuex'
import type { RootState } from './types'
import { socket } from './socket'
import { printer } from './printer'
import type { WebSocketClient } from '@/plugins/webSocketClient'

/**
 * Vuex 4. Upstream is Vuex 3 with `Vue.use(Vuex)` + `new Vuex.Store({...})`;
 * Vuex 4 is the same store, created with `createStore({...})` and installed as
 * an app plugin. Module definitions, getters, mutations and actions are
 * unchanged in shape -- which is what makes reusing the 12k-LOC data layer
 * from the Vue 2 tree a mechanical job rather than a rewrite.
 *
 * Deliberately NOT Pinia: switching state libraries at the same time as the
 * framework would throw away exactly the part of Mainsail worth keeping.
 */

/** Set once by main.ts so store actions can reach the socket. */
let socketClient: WebSocketClient | null = null
export const attachSocketClient = (client: WebSocketClient) => {
    socketClient = client
}

export const store = createStore<RootState>({
    // Vuex merges namespaced module state in at runtime, but the root state
    // factory is typed as if it had to produce the whole tree. Everything below
    // `modules:` fills in `socket` and `printer`, hence the cast.
    state: () =>
        ({
            packageVersion: '0.1.0',
            hostname: null,
        }) as unknown as RootState,
    getters: {
        socketClient: () => socketClient,
    },
    mutations: {
        setHostname(state, hostname: string | null) {
            state.hostname = hostname
        },
    },
    actions: {
        setKlippyInfo({ commit }, info: { state?: string; state_message?: string; hostname?: string }) {
            commit('setHostname', info?.hostname ?? null)
            commit(
                'socket/setKlippyState',
                { state: info?.state ?? null, message: info?.state_message ?? null },
                { root: true }
            )
        },
    },
    modules: {
        socket,
        printer,
    },
})

export type AppStore = typeof store
