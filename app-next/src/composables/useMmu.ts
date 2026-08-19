import { computed } from 'vue'
import { usePrinterStore } from '@/stores/printer'
import { useConnectionStore } from '@/stores/connection'
import { W3C_COLORS } from '@/lib/w3cColors'

/**
 * MMU (Happy Hare) -- Mainsail's `components/mixins/mmu.ts`, rewritten as a
 * composable.
 *
 * 🔴 NOT PRESENT ON THIS MACHINE. Checked, not assumed: `printer/objects/list`
 * has no `mmu`, no `mmu_machine`, nothing matching mmu/happy/ercf. Happy Hare
 * is a Klipper extra, so as with AFC there is no Moonraker component to gate
 * on -- the panel gates on the `mmu` object itself, upstream's own test.
 *
 * WHAT MAKES THIS ONE BIG. Happy Hare drives many vendors' hardware (ERCF,
 * BoxTurtle, Tradrack, KMS, ...) through one object, so almost everything is
 * conditional on what the unit reports it has: a selector or not, an encoder
 * or not, one of three different sync-feedback sensors, a bypass or not. The
 * conditionals are the feature, and dropping them would produce a panel that
 * is correct for exactly one machine.
 */

// ---- gate availability ----------------------------------------------------
export const GATE_UNKNOWN = -1
export const GATE_EMPTY = 0
/** Loadable, from either a buffer or straight off the spool. */
export const GATE_AVAILABLE = 1
export const GATE_AVAILABLE_FROM_BUFFER = 2

// ---- the sentinels shared by `tool` and `gate` ----------------------------
export const TOOL_GATE_BYPASS = -2
export const TOOL_GATE_UNKNOWN = -1
export const UNIT_UNKNOWN = -1

/**
 * Where the filament has got to, gate -> nozzle. Ordered, and the order is
 * load-bearing: the filament-path graphic fills in proportion to it.
 */
export const FILAMENT_POS_UNKNOWN = -1
export const FILAMENT_POS_UNLOADED = 0
export const FILAMENT_POS_HOMED_GATE = 1
export const FILAMENT_POS_START_BOWDEN = 2
export const FILAMENT_POS_IN_BOWDEN = 3
export const FILAMENT_POS_END_BOWDEN = 4
export const FILAMENT_POS_HOMED_ENTRY = 5
export const FILAMENT_POS_HOMED_EXTRUDER = 6
export const FILAMENT_POS_EXTRUDER_ENTRY = 7
export const FILAMENT_POS_HOMED_TS = 8
export const FILAMENT_POS_IN_EXTRUDER = 9
export const FILAMENT_POS_LOADED = 10

export const DIRECTION_LOAD = 1
export const DIRECTION_UNKNOWN = 0
export const DIRECTION_UNLOAD = -1

export const ACTION_IDLE = 'Idle'

/** Grey with alpha -- deliberately not `transparent`, so an empty gate is still a shape. */
export const NO_FILAMENT_COLOR = '#808182E3'

export const FILAMENT_SPEED_OVERRIDE_MIN = 10
export const FILAMENT_SPEED_OVERRIDE_MAX = 150

export type MmuEspoolerState = 'rewind' | 'assist' | 'off'
export type MmuDryingState = '' | 'active' | 'queued' | 'complete' | 'cancelled'

export interface MmuSensors {
    mmu_pre_gate?: boolean
    mmu_gear?: boolean
    mmu_gate?: boolean
    filament_compression?: boolean
    filament_proportional?: boolean
    filament_tension?: boolean
    extruder?: boolean
    toolhead?: boolean
}

export interface MmuEncoder {
    enabled: boolean
    encoder_pos: number
    flow_rate: number
    detection_mode: number
    desired_headroom: number
    detection_length: number
    headroom: number
    min_headroom: number
}

export interface Mmu {
    enabled?: boolean
    num_gates?: number
    is_homed?: boolean
    is_locked?: boolean
    is_paused?: boolean
    is_in_print?: boolean
    print_state?: string
    unit?: number
    tool?: number
    gate?: number
    active_filament?: {
        filament_name?: string
        material?: string
        color?: string
        spool_id?: number
        temperature?: number
    }
    num_toolchanges?: number
    last_tool?: number
    next_tool?: number
    runout?: boolean
    operation?: string
    filament?: string
    filament_position?: number
    filament_pos?: number
    filament_direction?: number
    ttg_map?: number[]
    endless_spool_groups?: number[]
    gate_status?: number[]
    gate_filament_name?: string[]
    gate_material?: string[]
    gate_color?: string[]
    gate_temperature?: number[]
    gate_spool_id?: number[]
    gate_speed_override?: number[]
    action?: string
    has_bypass?: boolean
    sync_drive?: boolean
    sync_feedback_enabled?: boolean
    sync_feedback_state?: string
    clog_detection?: number
    endless_spool?: number
    reason_for_pause?: string
    spoolman_support?: 'off' | 'readonly' | 'push' | 'pull'
    espooler?: MmuEspoolerState[]
    /** Legacy Happy Hare: one state, applying to the selected gate only. */
    espooler_active?: MmuEspoolerState
    drying_state?: MmuDryingState[]
    sensors?: MmuSensors
    servo?: 'Up' | 'Down' | 'Move' | 'Unknown'
    grip?: 'Gripped' | 'Released' | 'Unknown'
    encoder?: MmuEncoder
}

export interface MmuMachineUnit {
    name: string
    vendor: string
    version: string
    num_gates: number
    first_gate: number
    selector_type: 'VirtualSelector' | 'RotarySelector' | 'ServoSelector' | 'LinearSelector'
    has_bypass?: boolean
    multi_gear?: boolean
    can_crossload?: boolean
    environment_sensor?: string
    filament_heater?: string
}

export interface MmuMachine {
    num_units?: number
    [key: string]: number | MmuMachineUnit | undefined
}

/**
 * Normalise a gate colour to `#RRGGBBAA`.
 *
 * Three input shapes, because `gate_map` is typed by a human: a W3C name, a
 * 6-digit hex, or an 8-digit hex with alpha. Anything else is not an error to
 * shout about -- it is a gate whose colour was never set -- so it falls back
 * to the "no filament" grey rather than throwing.
 */
export function formColorString(color: string | null | undefined): string {
    if (!color) return NO_FILAMENT_COLOR

    const named = W3C_COLORS.find((entry) => entry.name === color.toLowerCase())
    if (named) return named.hex.length === 7 ? `${named.hex}FF` : named.hex.toUpperCase()

    const match = color.match(/^#?([0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?)$/)
    if (!match) return NO_FILAMENT_COLOR

    const hex = match[1]
    return `#${hex}${hex.length === 6 ? 'FF' : ''}`.toUpperCase()
}

export function useMmu() {
    const printer = usePrinterStore()
    const connection = useConnectionStore()

    const objects = computed(() => printer.objects as Record<string, unknown>)

    const mmu = computed<Mmu | undefined>(() => objects.value.mmu as Mmu | undefined)
    const mmuMachine = computed<MmuMachine | undefined>(() => objects.value.mmu_machine as MmuMachine | undefined)

    /** The panel's gate: the object exists AND Happy Hare says it is enabled. */
    const mmuExists = computed(() => mmu.value !== undefined)
    const enabled = computed(() => mmu.value?.enabled ?? false)

    const settings = computed(() => (printer.config.mmu ?? {}) as Record<string, unknown>)

    const numGates = computed(() => mmu.value?.num_gates ?? 0)
    const numUnits = computed(() => mmuMachine.value?.num_units ?? 1)

    const ttgMap = computed(() => mmu.value?.ttg_map ?? [])
    const endlessSpoolGroups = computed(() => mmu.value?.endless_spool_groups ?? [])
    const gateStatus = computed(() => mmu.value?.gate_status ?? [])

    const action = computed(() => mmu.value?.action ?? ACTION_IDLE)
    const printState = computed(() => mmu.value?.print_state ?? '')
    const sensors = computed(() => mmu.value?.sensors)
    const encoder = computed(() => mmu.value?.encoder)

    const unit = computed(() => mmu.value?.unit ?? UNIT_UNKNOWN)
    const gate = computed(() => mmu.value?.gate ?? TOOL_GATE_UNKNOWN)
    const tool = computed(() => mmu.value?.tool ?? TOOL_GATE_UNKNOWN)

    const hasBypass = computed(() => mmu.value?.has_bypass ?? false)
    const filamentPos = computed(() => mmu.value?.filament_pos ?? FILAMENT_POS_UNKNOWN)
    const syncDrive = computed(() => mmu.value?.sync_drive ?? false)
    const spoolmanSupport = computed(() => mmu.value?.spoolman_support ?? 'off')
    const servo = computed(() => mmu.value?.servo ?? 'Unknown')
    const grip = computed(() => mmu.value?.grip ?? 'Unknown')

    const hasSensor = (name: keyof MmuSensors) => sensors.value !== undefined && name in sensors.value
    const getSensor = (name: keyof MmuSensors) => sensors.value?.[name]

    const hasEncoder = computed(() => encoder.value !== undefined)
    const hasCompressionSensor = computed(() => hasSensor('filament_compression'))
    const hasTensionSensor = computed(() => hasSensor('filament_tension'))
    const hasProportionalSensor = computed(() => hasSensor('filament_proportional'))
    const hasSyncFeedback = computed(
        () => hasCompressionSensor.value || hasTensionSensor.value || hasProportionalSensor.value
    )

    const machineUnit = (index: number): MmuMachineUnit | undefined =>
        mmuMachine.value?.[`unit_${index}`] as MmuMachineUnit | undefined

    /**
     * Spool width in px, chosen by gate count -- upstream's three steps.
     * A 24-gate unit at 56px wide would not fit any panel column, and
     * scaling continuously would make two units of different sizes look like
     * two different products.
     */
    const spoolWidth = computed(() => {
        if (numGates.value <= 8) return 56
        if (numGates.value <= 16) return 48
        return 40
    })

    /**
     * 🔴 Whether it is safe to send an MMU command at all.
     *
     * Upstream's `canSend`, kept: Klipper ready, not printing, and the idle
     * timeout not reporting `Printing` either. The third clause is the one
     * that matters -- it catches a manual `G28` or a macro running from
     * somewhere else, and without it the buttons stay live while the machine
     * is mid-move.
     */
    const canSend = computed(() => {
        const idleTimeout = (objects.value.idle_timeout as { state?: string } | undefined)?.state ?? ''
        return connection.isReady && printer.printerState !== 'printing' && idleTimeout !== 'Printing'
    })

    const send = (gcode: string, loadingKey?: string) => connection.sendGcode(gcode, loadingKey)

    return {
        mmu,
        mmuMachine,
        mmuExists,
        enabled,
        settings,
        numGates,
        numUnits,
        ttgMap,
        endlessSpoolGroups,
        gateStatus,
        action,
        printState,
        sensors,
        encoder,
        unit,
        gate,
        tool,
        hasBypass,
        filamentPos,
        syncDrive,
        spoolmanSupport,
        servo,
        grip,
        hasSensor,
        getSensor,
        hasEncoder,
        hasCompressionSensor,
        hasTensionSensor,
        hasProportionalSensor,
        hasSyncFeedback,
        machineUnit,
        spoolWidth,
        canSend,
        send,
    }
}
