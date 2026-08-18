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

/** One saved bed mesh, as Klipper reports it under `bed_mesh.profiles`. */
export interface BedMeshProfile {
    points: number[][]
    mesh_params: {
        min_x: number
        max_x: number
        min_y: number
        max_y: number
        x_count: number
        y_count: number
        mesh_x_pps: number
        mesh_y_pps: number
        algo: string
        tension: number
    }
}

/**
 * Klipper's `bed_mesh` object.
 *
 * `probed_matrix` is what the probe actually measured, `mesh_matrix` is the
 * interpolated grid Klipper compensates with -- they have different dimensions
 * whenever `mesh_*_pps` is non-zero, which is why the chart derives its X/Y step
 * from each matrix separately rather than sharing one.
 *
 * Every field is optional because the whole object is absent on a printer with
 * no `[bed_mesh]` section, and present-but-empty between `BED_MESH_CLEAR` and
 * the next calibration.
 */
export interface BedMesh {
    profile_name?: string
    mesh_min?: number[]
    mesh_max?: number[]
    probed_matrix?: number[][]
    mesh_matrix?: number[][]
    profiles?: Record<string, BedMeshProfile>
}
