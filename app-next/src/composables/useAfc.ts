import { computed } from 'vue'
import { usePrinterStore } from '@/stores/printer'
import { useSpoolmanStore, type SpoolmanSpool } from '@/stores/spoolman'
import { useConnectionStore } from '@/stores/connection'

/**
 * AFC (Armored Turtle Automated Filament Changer) -- Mainsail's
 * `components/mixins/afc.ts`, rewritten as a composable.
 *
 * 🔴 NOT PRESENT ON THIS MACHINE. `printer/objects/list` was checked before a
 * line of this was written: there is no `AFC` object and no `AFC_*` of any
 * kind, because AFC is a Klipper EXTRA (a separate python module installed
 * beside Klipper), not a Moonraker component -- so unlike Spoolman or
 * timelapse there is no `server.info` entry to gate on either. The panel
 * therefore gates on the Klipper object itself, which is upstream's own test
 * (`'AFC' in printer`), and everything below is exercised through the rig.
 *
 * WHAT THE OBJECT TREE LOOKS LIKE, because it is not obvious from the names:
 *
 *   AFC                     the root -- lists `units`, `lanes`, `hubs`,
 *                           `extruders` by name, plus the current state
 *   AFC_BoxTurtle Turtle_1  one per physical unit; the PREFIX is the hardware
 *                           model (BoxTurtle / HTLF / NightOwl / QuattroBox)
 *                           and it is what picks the icon
 *   AFC_stepper lane1       one per lane. Older builds call it `AFC_lane`,
 *                           so both spellings are tried -- upstream does the
 *                           same and it is not dead code, it is two firmware
 *                           generations
 *   AFC_hub Turtle_1        the shared filament path out of a unit
 *   AFC_extruder extruder   the toolhead end: pre/post sensors, which lane is
 *                           actually loaded
 *   AFC_buffer TN2          the tension buffer, which is how a ramming
 *                           toolhead knows filament arrived
 */

/** A lane's live state. Every field is optional -- AFC builds differ. */
export interface AfcLane {
    name?: string
    /** Filament sits at the lane's prep sensor -- i.e. something is inserted. */
    prep?: boolean
    /** Filament is engaged in the lane's own extruder gears. */
    load?: boolean
    /** This lane is the one currently threaded into the toolhead. */
    tool_loaded?: boolean
    map?: string | string[]
    color?: string
    material?: string
    weight?: number
    initial_weight?: number
    spool_id?: number
    filament_name?: string
    runout_lane?: string
    extruder?: string
    buffer?: string
    /** TD-1 filament scanner readings, when that accessory is fitted. */
    td1_td?: number | string | null
    td1_color?: string | null
}

export interface AfcExtruder {
    lanes?: string[]
    lane_loaded?: string
    tool_start?: string
    tool_start_status?: boolean
    tool_end_status?: boolean
}

export interface AfcRoot {
    units?: string[]
    lanes?: string[]
    hubs?: string[]
    extruders?: string[]
    current_load?: string | null
    current_lane?: string | null
    current_state?: string
    current_toolchange?: string
    error_state?: boolean
    bypass_state?: boolean
    led_state?: boolean
    td1_present?: boolean
    message?: { type?: string; message?: string }
}

export function useAfc() {
    const printer = usePrinterStore()
    const spoolman = useSpoolmanStore()
    const connection = useConnectionStore()

    const objects = computed(() => printer.objects as Record<string, Record<string, unknown> | undefined>)

    /** Upstream's gate, verbatim: the root object existing IS the feature. */
    const afcExists = computed(() => 'AFC' in objects.value)

    const afc = computed<AfcRoot>(() => (objects.value.AFC as AfcRoot | undefined) ?? {})

    const extruders = computed(() => afc.value.extruders ?? [])
    const hubs = computed(() => afc.value.hubs ?? [])
    const units = computed(() => afc.value.units ?? [])
    const lanes = computed(() => afc.value.lanes ?? [])

    const errorState = computed(() => afc.value.error_state ?? false)
    const bypassState = computed(() => afc.value.bypass_state ?? false)
    const currentState = computed(() => afc.value.current_state ?? '')

    /** Klipper settings for one section, lower-cased like `configfile` keys. */
    const settingsFor = (key: string): Record<string, unknown> =>
        (printer.config[key.toLowerCase()] as Record<string, unknown> | undefined) ?? {}

    /**
     * A lane, under either of the two names AFC has used for it.
     *
     * 🔴 `?? {}` is NOT the same as upstream's `??` chain if a key exists but
     * holds null, so the lookup is written to fall through on anything falsy --
     * a lane that reports `null` while the unit is re-enumerating would
     * otherwise return null and crash every caller that reads `.prep`.
     */
    const laneObject = (lane: string): AfcLane =>
        (objects.value[`AFC_stepper ${lane}`] as AfcLane | undefined) ??
        (objects.value[`AFC_lane ${lane}`] as AfcLane | undefined) ??
        {}

    const laneSettings = (lane: string): Record<string, unknown> => {
        const stepper = settingsFor(`AFC_stepper ${lane}`)
        return Object.keys(stepper).length ? stepper : settingsFor(`AFC_lane ${lane}`)
    }

    const extruderObject = (name: string): AfcExtruder =>
        (objects.value[`AFC_extruder ${name}`] as AfcExtruder | undefined) ?? {}

    const extruderSettings = (name: string) => settingsFor(`AFC_extruder ${name}`)

    const hubObject = (name: string) => (objects.value[`AFC_hub ${name}`] as { state?: boolean } | undefined) ?? {}

    const bufferObject = (name: string) => (objects.value[`AFC_buffer ${name}`] as { state?: string } | undefined) ?? {}

    /**
     * The lane threaded into the toolhead right now.
     *
     * Two field names again, and the order matters: `current_load` is what a
     * current AFC reports, `current_lane` is the older one. Reading the wrong
     * one first would show the previous lane through a tool change.
     */
    const currentLane = computed<(AfcLane & { name?: string }) | null>(() => {
        const name = afc.value.current_load ?? afc.value.current_lane ?? null
        if (!name) return null

        const lane = laneObject(name)
        // Older builds do not echo the name inside the lane object, and the
        // "is this lane active" test in every lane card compares by name.
        return { name, ...lane }
    })

    const currentBuffer = computed(() => {
        const name = currentLane.value?.buffer
        return name ? bufferObject(name) : null
    })

    /**
     * The unit object for a name like `BoxTurtle Turtle_1`.
     *
     * The root lists units as "<module> <name>", but the Klipper object is
     * `AFC_<module-without-underscores> <name>` and the CASE does not match
     * either, so the lookup is a case-insensitive scan rather than a direct
     * index. Upstream does exactly this; it looks wasteful and is not, because
     * the alternative is missing every unit on a firmware that capitalises
     * differently.
     */
    const unitObject = (name: string): { hubs?: string[]; lanes?: string[] } => {
        const shortName = name.substring(name.indexOf(' ') + 1)
        const moduleName = name.substring(0, name.indexOf(' ')).replaceAll('_', '')
        const wanted = `AFC_${moduleName} ${shortName}`.toLowerCase()
        const key = Object.keys(objects.value).find((candidate) => candidate.toLowerCase() === wanted)

        return key ? ((objects.value[key] as { hubs?: string[]; lanes?: string[] }) ?? {}) : {}
    }

    /** Hardware model of a unit, lower-cased -- what selects its icon. */
    const unitType = (name: string) => name.substring(0, name.indexOf(' ')).replaceAll('_', '').toLowerCase()

    const unitShortName = (name: string) => name.substring(name.indexOf(' ') + 1)

    const spoolmanAvailable = computed(() => connection.moonrakerComponents.includes('spoolman'))

    /** The Spoolman record behind a lane's `spool_id`, when there is one. */
    const laneSpool = (lane: string): SpoolmanSpool | null => {
        const spoolId = Number(laneObject(lane).spool_id || 0)
        if (!spoolId) return null

        return spoolman.spools.find((spool) => spool.id === spoolId) ?? null
    }

    /** Every tool name any lane is mapped to, sorted -- for the mapping menu. */
    const mapList = computed(() => {
        const seen = new Set<string>()
        for (const name of lanes.value) {
            const map = laneObject(name).map
            if (!map) continue
            for (const tool of Array.isArray(map) ? map : [map]) {
                if (tool) seen.add(tool)
            }
        }

        return [...seen].sort((a, b) => a.localeCompare(b))
    })

    return {
        afcExists,
        afc,
        extruders,
        hubs,
        units,
        lanes,
        errorState,
        bypassState,
        currentState,
        currentLane,
        currentBuffer,
        mapList,
        spoolmanAvailable,
        laneObject,
        laneSettings,
        laneSpool,
        extruderObject,
        extruderSettings,
        hubObject,
        bufferObject,
        unitObject,
        unitType,
        unitShortName,
    }
}
