import type { Module, MutationTree, ActionTree, GetterTree } from 'vuex'
import type { SocketState } from './types'
import type { RootState } from '@/store/types'

/**
 * Connection module. Ported from the Vue 2 tree's `src/store/socket/`.
 *
 * Two mechanical changes were needed and nothing else:
 *   - `Vue.set(state, k, v)` becomes `state[k] = v`. Vue 3's proxy-based
 *     reactivity tracks plain assignment, so `Vue.set` has no replacement and
 *     no purpose. (188 `Vue.set` + 7 `Vue.delete` calls across the Vue 2 store
 *     collapse the same way.)
 *   - `Vue.prototype.$socket` becomes an injected instance -- see
 *     `plugins/webSocketClient.ts`.
 *
 * The init chain is shorter than upstream's on purpose: upstream `onOpen`
 * dispatches `server/init`, which pulls in `src/store/server/` (45 files) for
 * announcements, job queue, update manager, spoolman and friends -- none of
 * which this printer's UI needs yet. Here it goes straight to `printer/init`.
 */

export const getDefaultState = (): SocketState => {
    const hostname = window.location.hostname
    const defaultPort = window.location.port || (window.location.protocol === 'https:' ? 443 : 80)

    return {
        hostname,
        port: Number(defaultPort),
        path: '',
        protocol: window.location.protocol === 'https:' ? 'wss' : 'ws',
        reconnectInterval: 2000,
        isConnected: false,
        isConnecting: false,
        connectingFailed: false,
        connectionFailedMessage: null,
        loadings: [],
        klippyState: null,
        klippyMessage: null,
    }
}

const mutations: MutationTree<SocketState> = {
    setConnected(state) {
        state.isConnected = true
        state.isConnecting = false
        state.connectingFailed = false
    },

    setDisconnected(state, message?: string) {
        state.isConnected = false
        state.isConnecting = false
        state.connectingFailed = true
        state.klippyState = null

        if (message) state.connectionFailedMessage = message
    },

    setData(state, payload: Partial<SocketState>) {
        Object.entries(payload).forEach(([key, value]) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ;(state as any)[key] = value
        })
    },

    setKlippyState(state, payload: { state: SocketState['klippyState']; message?: string | null }) {
        state.klippyState = payload.state
        state.klippyMessage = payload.message ?? null
    },

    addLoading(state, payload: { name: string }) {
        state.loadings.push(payload.name)
    },

    removeLoading(state, payload: { name: string }) {
        const index = state.loadings.indexOf(payload.name)
        if (index > -1) state.loadings.splice(index, 1)
    },

    clearLoadings(state) {
        if (state.loadings.length) state.loadings = []
    },
}

const getters: GetterTree<SocketState, RootState> = {
    getConnectionState: (state) => {
        if (state.isConnected) return 'connected'
        if (state.isConnecting) return 'connecting'
        return 'disconnected'
    },
    isKlippyReady: (state) => state.klippyState === 'ready',
}

const actions: ActionTree<SocketState, RootState> = {
    setData({ commit }, payload) {
        commit('setData', payload)
    },

    addLoading({ commit }, payload) {
        commit('addLoading', payload)
    },

    removeLoading({ commit }, payload) {
        commit('removeLoading', payload)
    },

    onOpen({ commit, dispatch }) {
        commit('setConnected')
        dispatch('printer/init', null, { root: true })
    },

    onClose({ commit }) {
        commit('setDisconnected')
        commit('printer/reset', null, { root: true })
    },

    /**
     * Every unsolicited frame Moonraker pushes lands here. Upstream fans these
     * out to ~20 modules; the cases below are the ones the ported modules can
     * actually service. Unknown methods are ignored rather than logged -- this
     * fires several times a second during a print.
     */
    onMessage({ commit, dispatch }, payload) {
        switch (payload.method) {
            case 'notify_status_update':
                dispatch('printer/getData', payload.params[0], { root: true })
                break

            case 'notify_klippy_ready':
                commit('setKlippyState', { state: 'ready' })
                dispatch('printer/init', null, { root: true })
                break

            case 'notify_klippy_disconnected':
                commit('setKlippyState', { state: 'disconnected' })
                break

            case 'notify_klippy_shutdown':
                commit('setKlippyState', { state: 'shutdown' })
                break

            default:
                break
        }
    },
}

export const socket: Module<SocketState, RootState> = {
    namespaced: true,
    state: getDefaultState(),
    getters,
    actions,
    mutations,
}
