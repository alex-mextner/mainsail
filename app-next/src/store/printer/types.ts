/** Klipper objects keyed exactly as Moonraker reports them. */
export interface PrinterState {
    [objectName: string]: unknown
}

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

export interface PrintStats {
    filename: string
    state: 'standby' | 'printing' | 'paused' | 'complete' | 'cancelled' | 'error'
    message: string
    total_duration: number
    print_duration: number
    filament_used: number
    info: { total_layer: number | null; current_layer: number | null }
}
