import type { Module, MutationTree, ActionTree, GetterTree } from 'vuex'
import type { RootState } from '@/store/types'
import type { PrinterState, Heater, PrintStats } from './types'

/**
 * Klipper object state. Ported from the Vue 2 tree's `src/store/printer/`.
 *
 * The state is a bag keyed by Klipper object name exactly as Moonraker reports
 * it ("extruder", "heater_bed", "temperature_sensor OrangePi_CPU", ...). That
 * shape is dictated by Moonraker, not by Mainsail, so it carries over as-is and
 * every getter written against it keeps working.
 *
 * `setData` is upstream's merge logic with `Vue.set` removed. Vue 3 tracks
 * plain property assignment on the reactive proxy, including keys added after
 * the object was created -- which is the entire reason `Vue.set` existed.
 */

export const getDefaultState = (): PrinterState => ({})

const mutations: MutationTree<PrinterState> = {
    reset(state) {
        for (const key of Object.keys(state)) delete state[key]
    },

    setData(state, payload: Record<string, unknown>) {
        Object.entries(payload).forEach(([key, value]) => {
            if (typeof value !== 'object' || value === null || !(key in state)) {
                state[key] = value
                return
            }

            // Moonraker sends partial objects: only the changed fields of an
            // object are pushed, so merge rather than replace.
            const target = state[key] as Record<string, unknown>
            Object.entries(value as Record<string, unknown>).forEach(([subkey, subvalue]) => {
                target[subkey] = subvalue
            })
        })
    },
}

/** Klipper prefixes that carry a `temperature` field but are not heaters. */
const SENSOR_PREFIXES = ['temperature_sensor', 'temperature_fan', 'tmc2130', 'tmc2208', 'tmc2209', 'tmc5160']

const getters: GetterTree<PrinterState, RootState> = {
    getAvailableHeaters: (state) => (state.heaters as { available_heaters?: string[] })?.available_heaters ?? [],

    getAvailableSensors: (state) => (state.heaters as { available_sensors?: string[] })?.available_sensors ?? [],

    /**
     * Controllable heaters (extruder, heater_bed, generic_heater...), in the
     * order Klipper reports them. Upstream sorts case-insensitively by name;
     * kept here so extruder/bed stay in a stable position.
     */
    getHeaters: (state, storeGetters): Heater[] => {
        const names: string[] = storeGetters.getAvailableHeaters

        return names
            .map((name): Heater | null => {
                const object = state[name] as Record<string, number> | undefined
                if (!object) return null

                return {
                    name,
                    label: name === 'heater_bed' ? 'Heater Bed' : name === 'extruder' ? 'Extruder' : name,
                    kind: name === 'heater_bed' ? 'bed' : 'hotend',
                    temperature: object.temperature ?? 0,
                    target: object.target ?? 0,
                    power: object.power ?? 0,
                    maxTemp: storeGetters.getMaxTemp(name),
                    minTemp: storeGetters.getMinTemp(name),
                }
            })
            .filter((h): h is Heater => h !== null)
    },

    /** Read-only temperature sources: MCU/host sensors, temperature fans. */
    getSensors: (state, storeGetters): Heater[] => {
        const heaterNames: string[] = storeGetters.getAvailableHeaters
        const sensorNames: string[] = storeGetters.getAvailableSensors

        return sensorNames
            .filter((name) => !heaterNames.includes(name))
            .filter((name) => SENSOR_PREFIXES.some((prefix) => name.startsWith(prefix)) || !name.includes(' '))
            .map((name): Heater | null => {
                const object = state[name] as Record<string, number> | undefined
                if (!object || object.temperature === undefined) return null

                return {
                    name,
                    label: name.includes(' ') ? name.split(' ').slice(1).join(' ') : name,
                    kind: 'sensor',
                    temperature: object.temperature,
                    target: 0,
                    power: 0,
                    maxTemp: object.measured_max_temp ?? null,
                    minTemp: object.measured_min_temp ?? null,
                }
            })
            .filter((h): h is Heater => h !== null)
    },

    /**
     * Configured max_temp for an object, straight out of the live configfile
     * Klipper reports. Upstream applies the same `< 10000` sanity bound, because
     * some sensor types declare an absurd ceiling.
     */
    getMaxTemp: (state) => (name: string) => {
        const settings = (state.configfile as { settings?: Record<string, Record<string, unknown>> })?.settings
        const entry = settings?.[name.toLowerCase()]
        const value = entry?.max_temp

        if (typeof value !== 'number' || value >= 10000) return null
        return Math.round(value)
    },

    getMinTemp: (state) => (name: string) => {
        const settings = (state.configfile as { settings?: Record<string, Record<string, unknown>> })?.settings
        const value = settings?.[name.toLowerCase()]?.min_temp

        return typeof value === 'number' ? Math.round(value) : null
    },

    getPrintStats: (state): PrintStats | null => (state.print_stats as PrintStats) ?? null,

    /** Klipper's own idea of what it is; used for the connection badge. */
    getHostname: (state) => (state.mcu as { hostname?: string })?.hostname ?? null,
}

const actions: ActionTree<PrinterState, RootState> = {
    /**
     * Subscribe to everything Klipper exposes. Upstream builds a filtered
     * subscription list from what the UI has mounted; subscribing to all
     * objects is simpler and, on a printer with 79 objects, cheap. Revisit if
     * the object count ever grows a lot -- the Orange Pi has 512 MB.
     */
    async init({ dispatch, rootGetters }) {
        const socket = rootGetters.socketClient
        if (!socket) return

        const info = await socket.emitAndWait('printer.info')
        dispatch('setKlippyInfo', info, { root: true })

        if (info?.state !== 'ready') return

        const list = await socket.emitAndWait('printer.objects.list')
        const objects: Record<string, null> = {}
        for (const name of list?.objects ?? []) objects[name] = null

        const result = await socket.emitAndWait('printer.objects.subscribe', { objects })
        dispatch('getData', result?.status ?? {})
    },

    getData({ commit }, payload) {
        // notify_status_update sends [status, eventtime]; the raw subscribe
        // result sends the status object directly.
        const status = Array.isArray(payload) ? payload[0] : payload
        if (status && typeof status === 'object') commit('setData', status)
    },
}

export const printer: Module<PrinterState, RootState> = {
    namespaced: true,
    state: getDefaultState(),
    getters,
    actions,
    mutations,
}
