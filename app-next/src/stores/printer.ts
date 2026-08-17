import { ref, computed, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type { Heater, PrintStats, KlipperObjects } from '@/types/printer'

/**
 * Live Klipper object state.
 *
 * The raw bag is keyed by Klipper object name exactly as Moonraker reports it
 * ("extruder", "heater_bed", "temperature_fan hotend_fan", ...). That shape is
 * dictated by Moonraker, so it is kept verbatim and everything else is derived
 * from it -- same contract the Vue 2 Vuex module had, without the Vuex.
 */
export const usePrinterStore = defineStore('printer', () => {
    const objects = ref<KlipperObjects>({})
    /** Names Klipper reports as controllable heaters / readable sensors. */
    const availableHeaters = ref<string[]>([])
    const availableSensors = ref<string[]>([])
    /** Parsed `configfile.settings`, only needed for min/max temp. */
    const config = shallowRef<Record<string, Record<string, unknown>>>({})

    function reset() {
        objects.value = {}
        availableHeaters.value = []
        availableSensors.value = []
        config.value = {}
    }

    /**
     * Merge a status payload. Moonraker pushes only changed fields of an
     * object, so this merges per key rather than replacing.
     */
    function applyStatus(status: Record<string, unknown>) {
        for (const [key, value] of Object.entries(status)) {
            if (typeof value !== 'object' || value === null) {
                objects.value[key] = value
                continue
            }

            const existing = objects.value[key]
            if (typeof existing !== 'object' || existing === null) {
                objects.value[key] = { ...(value as object) }
                continue
            }

            Object.assign(existing as object, value as object)
        }

        const heaters = status.heaters as { available_heaters?: string[]; available_sensors?: string[] } | undefined
        if (heaters?.available_heaters) availableHeaters.value = heaters.available_heaters
        if (heaters?.available_sensors) availableSensors.value = heaters.available_sensors

        const configfile = status.configfile as { settings?: Record<string, Record<string, unknown>> } | undefined
        if (configfile?.settings) config.value = configfile.settings
    }

    const numberFrom = (name: string, field: string): number | null => {
        const value = config.value[name.toLowerCase()]?.[field]
        // Some sensor types declare an absurd ceiling; upstream applies the
        // same 10000 sanity bound.
        if (typeof value !== 'number' || value >= 10000) return null
        return Math.round(value)
    }

    const label = (name: string): string => {
        if (name === 'extruder') return 'Extruder'
        if (name === 'heater_bed') return 'Heater Bed'
        return name.includes(' ') ? name.split(' ').slice(1).join(' ') : name
    }

    const heaters = computed<Heater[]>(() =>
        availableHeaters.value.flatMap((name) => {
            const object = objects.value[name] as Record<string, number> | undefined
            if (!object) return []

            return [
                {
                    name,
                    label: label(name),
                    kind: name === 'heater_bed' ? 'bed' : 'hotend',
                    temperature: object.temperature ?? 0,
                    target: object.target ?? 0,
                    power: object.power ?? 0,
                    maxTemp: numberFrom(name, 'max_temp'),
                    minTemp: numberFrom(name, 'min_temp'),
                },
            ]
        })
    )

    /** Read-only temperature sources: host/MCU sensors and temperature fans. */
    const sensors = computed<Heater[]>(() =>
        availableSensors.value
            .filter((name) => !availableHeaters.value.includes(name))
            .flatMap((name) => {
                const object = objects.value[name] as Record<string, number> | undefined
                if (!object || object.temperature === undefined) return []

                return [
                    {
                        name,
                        label: label(name),
                        kind: 'sensor',
                        temperature: object.temperature,
                        target: 0,
                        power: 0,
                        maxTemp: object.measured_max_temp ?? null,
                        minTemp: object.measured_min_temp ?? null,
                    },
                ]
            })
    )

    const allTemperatures = computed<Heater[]>(() => [...heaters.value, ...sensors.value])

    const printStats = computed<PrintStats | null>(() => (objects.value.print_stats as PrintStats) ?? null)

    const isPrinting = computed(() => {
        const state = printStats.value?.state
        return state === 'printing' || state === 'paused'
    })

    const toolhead = computed(
        () =>
            (objects.value.toolhead as
                { position?: number[]; homed_axes?: string; max_velocity?: number; max_accel?: number } | undefined) ??
            null
    )

    return {
        objects,
        availableHeaters,
        availableSensors,
        config,
        heaters,
        sensors,
        allTemperatures,
        printStats,
        isPrinting,
        toolhead,
        applyStatus,
        reset,
    }
})
