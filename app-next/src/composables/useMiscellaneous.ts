import { computed } from 'vue'
import { usePrinterStore } from '@/stores/printer'
import { READ_ONLY_OUTPUT_PINS } from '@/lib/machineOutputs'

/**
 * The "Miscellaneous" panel's data -- Mainsail's `printer/getMiscellaneous`,
 * `printer/getFilamentSensors`, `printer/getMiscellaneousSensors` getters and
 * its `miscellaneous` mixin, as one composable.
 *
 * Four different Klipper object families end up in one panel because they share
 * a shape rather than a purpose: something with a name, a state, and sometimes
 * a switch. Upstream's grouping is kept as-is.
 *
 * Note what is NOT here: `temperature_fan`. Those are fans, but Klipper drives
 * them from a temperature and Mainsail shows them in the temperature panel with
 * their sensor -- listing them here as well would give this machine's
 * `electronics_fan` and `hotend_fan` two homes and two different controls.
 */

export interface MiscellaneousEntry {
    /** Klipper object key, e.g. `output_pin siren`. Unique, so it is the list key. */
    key: string
    name: string
    type: string
    /** Raw reported value: `speed` for fans, `value` for pins. */
    power: number
    rpm: number | null
    /** Whether a command exists to change it at all. */
    controllable: boolean
    /** Continuous (slider) rather than on/off (toggle). */
    pwm: boolean
    /** Command scale: 255 for `[fan]`'s M106 S, `scale:` for output pins. */
    scale: number
    /** Below this the hardware stalls, so the slider snaps around it. */
    offBelow: number
    /** `max_power`, the divisor that turns the reported value into 0..1. */
    maxPower: number
    /** Set when this machine forbids writing the pin -- see machineOutputs.ts. */
    readOnlyReason: string | null
    /**
     * Only for `type: 'led'` rows, which the light component synthesises for a
     * single-channel light: which SET_LED parameter this slider drives.
     */
    ledChannel?: 'RED' | 'GREEN' | 'BLUE' | 'WHITE'
}

export interface LightEntry {
    key: string
    type: string
    name: string
}

export interface FilamentSensorEntry {
    key: string
    type: string
    name: string
    enabled: boolean
    filamentDetected: boolean
    /** Only `hall_filament_width_sensor` reports one. */
    diameter: number | null
}

export interface MiscellaneousSensorEntry {
    key: string
    type: string
    name: string
    value: number
    unit: string
}

/** Object types upstream renders as a fan/pin row, in upstream's order. */
const CONTROL_OBJECTS = ['controller_fan', 'heater_fan', 'fan_generic', 'fan', 'output_pin', 'pwm_tool', 'pwm_cycle_time']
/** Only these two accept a speed command; the rest are driven by Klipper. */
const CONTROLLABLE_FANS = ['fan_generic', 'fan']
const LIGHT_OBJECTS = ['dotstar', 'led', 'neopixel', 'pca9533', 'pca9632']
const FILAMENT_SENSOR_OBJECTS = ['filament_switch_sensor', 'filament_motion_sensor', 'hall_filament_width_sensor']
const SENSOR_OBJECTS = ['load_cell']

const splitKey = (key: string): [string, string] => {
    const index = key.indexOf(' ')
    if (index === -1) return [key, key]
    return [key.slice(0, index), key.slice(index + 1)]
}

const byName = (a: { name: string }, b: { name: string }) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase())

export function useMiscellaneous() {
    const printer = usePrinterStore()

    const settingsOf = (key: string): Record<string, unknown> => printer.config[key.toLowerCase()] ?? {}

    const controls = computed<MiscellaneousEntry[]>(() => {
        const output: MiscellaneousEntry[] = []

        for (const [key, raw] of Object.entries(printer.objects)) {
            const [type, name] = splitKey(key)
            if (!CONTROL_OBJECTS.includes(type)) continue
            // A leading underscore is Klipper's own "internal, do not show".
            if (name.startsWith('_')) continue

            const object = (raw ?? {}) as Record<string, unknown>
            const settings = settingsOf(key)

            let controllable = CONTROLLABLE_FANS.includes(type)
            let pwm = controllable
            let scale = type === 'fan' ? 255 : 1

            if (['output_pin', 'pwm_tool', 'pwm_cycle_time'].includes(type)) {
                controllable = true
                // An output pin is a plain on/off switch unless the config says
                // `pwm: True`; the two pwm_* section types always are one.
                pwm = ['pwm_tool', 'pwm_cycle_time'].includes(type) ? true : (settings.pwm as boolean) ?? false
                if (typeof settings.scale === 'number') scale = settings.scale
            }

            const power =
                typeof object.speed === 'number' ? object.speed : typeof object.value === 'number' ? object.value : 0

            const reason = type === 'output_pin' ? READ_ONLY_OUTPUT_PINS[name] ?? null : null

            output.push({
                key,
                name,
                type,
                power,
                rpm: typeof object.rpm === 'number' ? object.rpm : null,
                controllable: controllable && !reason,
                pwm,
                scale,
                offBelow: typeof settings.off_below === 'number' ? settings.off_below : 0,
                maxPower: typeof settings.max_power === 'number' ? settings.max_power : 1,
                readOnlyReason: reason,
            })
        }

        /**
         * Upstream's sort, kept: the part-cooling fan first because it is the
         * one people reach for mid-print, then sliders before switches, then
         * controllable before read-only, then by name.
         */
        return output.sort((a, b) => {
            if (a.type === 'fan') return -1
            if (b.type === 'fan') return 1
            if (a.pwm !== b.pwm) return a.pwm ? -1 : 1
            if (a.controllable !== b.controllable) return a.controllable ? -1 : 1
            return byName(a, b)
        })
    })

    const lights = computed<LightEntry[]>(() =>
        Object.keys(printer.objects)
            .flatMap((key) => {
                const [type, name] = splitKey(key)
                if (!LIGHT_OBJECTS.includes(type) || name.startsWith('_')) return []
                return [{ key, type, name }]
            })
            .sort(byName)
    )

    const filamentSensors = computed<FilamentSensorEntry[]>(() =>
        Object.entries(printer.objects)
            .flatMap(([key, raw]) => {
                const [type, name] = splitKey(key)
                if (!FILAMENT_SENSOR_OBJECTS.includes(type)) return []

                const object = (raw ?? {}) as Record<string, unknown>
                return [
                    {
                        key,
                        type,
                        name,
                        enabled: object.enabled === true,
                        filamentDetected: object.filament_detected === true,
                        // Klipper capitalises this one field. Not a typo.
                        diameter: typeof object.Diameter === 'number' ? object.Diameter : null,
                    },
                ]
            })
            .sort(byName)
    )

    const sensors = computed<MiscellaneousSensorEntry[]>(() =>
        Object.entries(printer.objects)
            .flatMap(([key, raw]) => {
                const [type, name] = splitKey(key)
                if (!SENSOR_OBJECTS.includes(type) || name.startsWith('_')) return []

                const object = (raw ?? {}) as Record<string, unknown>
                if (type === 'load_cell') {
                    return [
                        {
                            key,
                            type,
                            name,
                            value: typeof object.force_g === 'number' ? object.force_g : NaN,
                            unit: 'g',
                        },
                    ]
                }

                return [
                    {
                        key,
                        type,
                        name,
                        value: typeof object.value === 'number' ? object.value : NaN,
                        unit: typeof object.unit === 'string' ? object.unit : '',
                    },
                ]
            })
            .sort(byName)
    )

    /** Colour channels this light actually has, as "RGB" / "RGBW" / "W" / ... */
    const colorOrder = (light: LightEntry): string => {
        const settings = settingsOf(light.key)

        // A neopixel chain declares its own order; a plain [led] is described by
        // which *_pin lines exist -- this machine's strip has no white channel,
        // and led.py accepts the pin simply being absent.
        if (light.type !== 'led') {
            const order = settings.color_order
            if (Array.isArray(order)) return String(order[0] ?? '')
            return typeof order === 'string' ? order : ''
        }

        return ['red_pin', 'green_pin', 'blue_pin', 'white_pin']
            .filter((pin) => pin in settings)
            .map((pin) => pin[0].toUpperCase())
            .join('')
    }

    /** `color_data[index]` as 0..1 channel floats, defaulting to off. */
    const colorData = (light: LightEntry, index = 0): number[] => {
        const object = (printer.objects[light.key] ?? {}) as { color_data?: number[][] }
        return object.color_data?.[index] ?? []
    }

    return { controls, lights, filamentSensors, sensors, colorOrder, colorData, settingsOf }
}
