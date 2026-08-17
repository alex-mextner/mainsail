import { ref, computed, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type { Heater, PrintStats, PrintState, KlipperObjects } from '@/types/printer'
import { getMacroParams, type MacroParams } from '@/lib/macroParams'

/** One user-facing g-code macro, as the macro buttons need it. */
export interface PrinterMacro {
    name: string
    /** Klipper's `description:`, or null when the macro declares none. */
    description: string | null
    gcode: string
    params: MacroParams
    variables: Record<string, unknown>
}

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
                | {
                      position?: number[]
                      homed_axes?: string
                      max_velocity?: number
                      max_accel?: number
                      /** Name of the active extruder object, e.g. "extruder1". */
                      extruder?: string
                  }
                | undefined) ?? null
    )

    /** Klipper's own state string. Panels gate on this exactly as upstream does. */
    const printerState = computed<PrintState>(() => printStats.value?.state ?? 'standby')

    const gcodeMove = computed(
        () =>
            (objects.value.gcode_move as
                | {
                      speed_factor?: number
                      extrude_factor?: number
                      absolute_coordinates?: boolean
                      absolute_extrude?: boolean
                      gcode_position?: number[]
                      homing_origin?: number[]
                      speed?: number
                  }
                | undefined) ?? null
    )

    const motionReport = computed(
        () => (objects.value.motion_report as { live_position?: number[]; live_velocity?: number } | undefined) ?? null
    )

    const homedAxes = computed(() => toolhead.value?.homed_axes ?? '')

    /**
     * Every g-code command Klipper knows, including macros. Newer Klipper
     * publishes this as `gcode.commands`; the panels use it to decide whether a
     * command exists before offering a button for it.
     */
    const gcodeCommands = computed(
        () => (objects.value.gcode as { commands?: Record<string, unknown> } | undefined)?.commands ?? null
    )

    const hasCommand = (name: string): boolean => (gcodeCommands.value ? name in gcodeCommands.value : false)

    const hasConfigSection = (name: string): boolean => name in config.value

    /**
     * What this particular machine can do, derived from the live config and
     * command table rather than assumed. Same rules as Mainsail's
     * `store/printer/getters.ts`, including the Kalico `z_tilt_ng` variant and
     * the command-table-first / config-fallback order for Z-tilt.
     */
    const capabilities = computed(() => ({
        qgl: hasConfigSection('quad_gantry_level'),
        zTilt: gcodeCommands.value ? hasCommand('Z_TILT_ADJUST') : hasConfigSection('z_tilt'),
        bedTilt: hasConfigSection('bed_tilt'),
        bedScrews: hasConfigSection('bed_screws'),
        deltaCalibrate: hasConfigSection('delta_calibrate'),
        screwsTilt: hasConfigSection('screws_tilt_adjust'),
        firmwareRetraction: hasConfigSection('firmware_retraction'),
        /** `_CLIENT_LINEAR_MOVE` from mainsail.cfg. Present on this machine, and
         *  preferred over raw G91/G1 because it honours the print-area limits. */
        clientLinearMove: hasCommand('_CLIENT_LINEAR_MOVE'),
        clientExtrude: hasCommand('_CLIENT_EXTRUDE'),
        clientRetract: hasCommand('_CLIENT_RETRACT'),
    }))

    /** True while QGL / Z-tilt is out of date, so the button can warn. */
    const levelingApplied = computed(() => {
        const qgl = objects.value.quad_gantry_level as { applied?: boolean } | undefined
        const zTilt = (objects.value.z_tilt ?? objects.value.z_tilt_ng) as { applied?: boolean } | undefined

        return {
            qgl: qgl?.applied ?? true,
            zTilt: zTilt?.applied ?? true,
        }
    })

    const bedMeshProfile = computed(
        () => (objects.value.bed_mesh as { profile_name?: string } | undefined)?.profile_name ?? ''
    )

    /**
     * Extruders, from the CONFIG rather than from the live object bag: a
     * multi-extruder machine reports `extruder`, `extruder1`, ... and only the
     * config carries the per-extruder limits the UI has to respect.
     * `extruder_stepper` entries deliberately do not match -- they are a
     * different thing with a different pressure-advance path.
     */
    const extruders = computed(() =>
        Object.keys(config.value)
            .filter((key) => /^extruder\d?$/.test(key))
            .sort()
            .map((key) => ({
                key,
                name: `Extruder ${key === 'extruder' ? '0' : key.replace('extruder', '')}`,
            }))
    )

    const extruderSteppers = computed(() =>
        Object.keys(objects.value)
            .filter((key) => key.startsWith('extruder_stepper '))
            .sort((a, b) => a.localeCompare(b))
    )

    const activeExtruder = computed(() => toolhead.value?.extruder ?? 'extruder')

    const activeExtruderSettings = computed(() => config.value[activeExtruder.value])

    /**
     * Klipper's own answer to "would a G1 E be accepted right now". It is false
     * below `min_extrude_temp`, so the UI never has to guess a threshold or
     * compare temperatures itself.
     */
    const extrudePossible = computed(
        () => (objects.value[activeExtruder.value] as { can_extrude?: boolean } | undefined)?.can_extrude ?? false
    )

    /**
     * User-facing macros, filtered exactly as upstream does: leading-underscore
     * macros are internal helpers, and anything with `rename_existing` is an
     * override of a built-in (PAUSE, RESUME, CANCEL_PRINT) rather than a button.
     */
    const macros = computed<PrinterMacro[]>(() => {
        const prefix = 'gcode_macro '
        const commands = gcodeCommands.value ?? {}

        return (
            Object.keys(objects.value)
                .filter((key) => key.toLowerCase().startsWith(prefix))
                .flatMap<PrinterMacro>((key) => {
                    const name = key.slice(prefix.length)
                    if (name.startsWith('_')) return []

                    const settings = (config.value[key.toLowerCase()] ?? {}) as Record<string, unknown>
                    if ('rename_existing' in settings) return []

                    const gcode = typeof settings.gcode === 'string' ? settings.gcode : ''

                    return [
                        {
                            name,
                            description: (commands[name.toUpperCase()] as { help?: string } | undefined)?.help ?? null,
                            gcode,
                            // Parsed here rather than in the button, so a panel
                            // showing forty macros parses each body once per
                            // config change instead of once per render.
                            params: getMacroParams({ gcode }),
                            variables: (objects.value[key] ?? {}) as Record<string, unknown>,
                        },
                    ]
                })
                // Upstream sorts case-insensitively; without it an all-caps
                // config lists differently from a mixed-case one.
                .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
        )
    })

    const macroByName = (name: string): PrinterMacro | undefined => {
        const lower = name.toLowerCase()
        return macros.value.find((macro) => macro.name.toLowerCase() === lower)
    }

    /** T0, T1, ... tool-change commands, numerically ordered (T10 after T9). */
    const toolchangeMacros = computed(() => {
        const byNumber = (a: string, b: string) => parseInt(a.slice(1)) - parseInt(b.slice(1))

        if (gcodeCommands.value) {
            return Object.keys(gcodeCommands.value)
                .filter((command) => /^T\d+/.test(command))
                .sort(byNumber)
        }

        return Object.keys(objects.value)
            .filter((key) => /^gcode_macro t\d+/.test(key.toLowerCase()))
            .map((key) => key.slice(key.indexOf(' ') + 1))
            .sort(byNumber)
    })

    return {
        extruders,
        extruderSteppers,
        activeExtruder,
        activeExtruderSettings,
        extrudePossible,
        macros,
        macroByName,
        toolchangeMacros,
        objects,
        availableHeaters,
        availableSensors,
        config,
        heaters,
        sensors,
        allTemperatures,
        printStats,
        printerState,
        isPrinting,
        toolhead,
        gcodeMove,
        motionReport,
        homedAxes,
        gcodeCommands,
        capabilities,
        levelingApplied,
        bedMeshProfile,
        hasCommand,
        hasConfigSection,
        applyStatus,
        reset,
    }
})
