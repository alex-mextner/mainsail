import { ref, computed, watch } from 'vue'
import { defineStore } from 'pinia'
import { useConnectionStore } from './connection'

/**
 * Moonraker's own sensors -- `[sensor ...]` sections in moonraker.conf, not
 * Klipper objects. Power meters, PSU voltage, that class of thing.
 *
 * 🔴 GATED ON THE COMPONENT BEING LOADED, not tried-and-caught. `sensor` is an
 * optional Moonraker component: `server.sensors.list` on a printer without it
 * is a JSON-RPC error, and this app writes rejected calls into the console
 * scrollback on purpose (see `sendGcode`). Firing a call that is known to fail
 * on every connect would put a red line in the log the user has to learn to
 * ignore -- and the log is the thing they walk up to the machine to read.
 *
 * On this printer the component is NOT loaded (`server.info` lists 25
 * components and `sensor` is not among them), so everything below stays empty
 * and the panel simply has no sensor rows. The rig fixture covers the case
 * where it is loaded.
 */

export interface MoonrakerSensor {
    friendly_name: string
    id: string
    type: string
    values: Record<string, number>
}

export const useSensorsStore = defineStore('sensors', () => {
    const connection = useConnectionStore()

    const sensors = ref<Record<string, MoonrakerSensor>>({})
    /** `server.config`, only for the per-value `units:` of each parameter. */
    const serverConfig = ref<Record<string, Record<string, unknown>>>({})

    const available = computed(() => connection.moonrakerComponents.includes('sensor'))

    async function load() {
        if (!available.value) return

        const result = await connection
            .call<{ sensors?: Record<string, MoonrakerSensor> }>('server.sensors.list')
            .catch(() => null)

        if (result?.sensors) sensors.value = result.sensors

        const config = await connection
            .call<{ config?: Record<string, Record<string, unknown>> }>('server.config')
            .catch(() => null)

        if (config?.config) serverConfig.value = config.config
    }

    /**
     * `notify_sensor_update` pushes only the changed values of a sensor, so this
     * merges per sensor rather than replacing the map -- same reason the printer
     * store merges object payloads.
     */
    function applyUpdate(payload: Record<string, Record<string, number>>) {
        for (const [name, values] of Object.entries(payload)) {
            const existing = sensors.value[name]
            if (!existing) continue
            existing.values = { ...existing.values, ...values }
        }
    }

    connection.onNotify((notification) => {
        if (notification.method !== 'notify_sensor_update') return
        const payload = notification.params?.[0] as Record<string, Record<string, number>> | undefined
        if (payload) applyUpdate(payload)
    })

    watch(
        () => connection.isConnected,
        (connected) => {
            if (connected) void load()
        },
        { immediate: true }
    )

    const names = computed(() => Object.keys(sensors.value).sort((a, b) => a.localeCompare(b)))

    /** Unit of one value of one sensor, from `parameter_<name>.units`. */
    const unitOf = (sensor: string, value: string): string | null => {
        const section = serverConfig.value[`sensor ${sensor}`] as Record<string, unknown> | undefined
        const parameter = section?.[`parameter_${value}`] as { units?: string } | undefined
        return parameter?.units ?? null
    }

    return { sensors, names, available, unitOf, load }
})
