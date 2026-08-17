/** Klipper objects keyed exactly as Moonraker reports them. */
export type KlipperObjects = Record<string, unknown>

export type HeaterKind = 'hotend' | 'bed' | 'sensor'

/** Normalised row for the temperature panel -- one per heater or sensor. */
export interface Heater {
    name: string
    label: string
    kind: HeaterKind
    temperature: number
    target: number
    power: number
    maxTemp: number | null
    minTemp: number | null
}

export type PrintState = 'standby' | 'printing' | 'paused' | 'complete' | 'cancelled' | 'error'

export interface PrintStats {
    filename: string
    state: PrintState
    message: string
    total_duration: number
    print_duration: number
    filament_used: number
    info: { total_layer: number | null; current_layer: number | null }
}

export type KlippyState = 'ready' | 'startup' | 'shutdown' | 'error' | 'disconnected'

export interface PrinterInfo {
    state?: KlippyState
    state_message?: string
    hostname?: string
    software_version?: string
}
