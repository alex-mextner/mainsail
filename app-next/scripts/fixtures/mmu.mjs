/**
 * A Happy Hare ERCF with eight gates, for a printer that has no MMU.
 *
 * 🔴 `printer/objects/list` on this machine has no `mmu` and no `mmu_machine`.
 * Happy Hare is a Klipper extra that is not installed, so as with AFC there is
 * no Moonraker component to fake either -- the whole panel is unreachable
 * against the real printer, in every state including its empty one.
 *
 * THE EIGHT GATES ARE DELIBERATELY NOT UNIFORM. Each exercises a different
 * branch of the spool gauge and the gate box:
 *
 *   0  available, red, spool_id set          a real percentage, printed on it
 *   1  available, named colour 'firebrick'   proves the W3C name table
 *   2  available, 8-digit hex with alpha     proves the alpha path is kept
 *   3  available, NO colour at all           falls back to no-filament grey
 *   4  empty                                 no filament drawn
 *   5  unknown (-1)                          dashed underline on the number
 *   6  available from buffer (2)             a distinct status from 1
 *   7  available, no spool_id                amount -1: drawn FULL, no number
 *
 * `ttg_map` is deliberately NOT the identity: T0->3 and T3->0 are swapped, so
 * the map graphic has crossing lines. An identity map draws eight parallel
 * lines and would hide any bug in the crossing geometry.
 *
 * `endless_spool_groups` puts gates 0,3 in group A and 1,2 in group B, leaving
 * 4..7 in singleton groups that must NOT be bracketed.
 */

export const mmuStatus = {
    mmu: {
        enabled: true,
        num_gates: 8,
        is_homed: true,
        is_locked: false,
        is_paused: false,
        is_in_print: false,
        print_state: 'idle',
        unit: 0,
        tool: 0,
        gate: 0,
        num_toolchanges: 12,
        last_tool: -1,
        next_tool: -1,
        runout: false,
        operation: '',
        filament: 'Loaded',
        filament_pos: 10, // FILAMENT_POS_LOADED
        filament_direction: 0,
        action: 'Idle',
        has_bypass: true,
        sync_drive: true,
        sync_feedback_enabled: true,
        sync_feedback_state: 'neutral',
        clog_detection: 1,
        endless_spool: 1,
        spoolman_support: 'readonly',
        reason_for_pause: '',
        // T0 and T3 swapped -- the map must show crossing lines.
        ttg_map: [3, 1, 2, 0, 4, 5, 6, 7],
        endless_spool_groups: [0, 1, 1, 0, 2, 3, 4, 5],
        gate_status: [1, 1, 1, 1, 0, -1, 2, 1],
        gate_filament_name: ['Galaxy Black', 'Firebrick', 'Translucent', 'Unnamed', '', 'Mystery', 'Buffered', 'No Spool'],
        gate_material: ['PLA', 'PETG', 'PLA', 'ABS', '', 'PLA', 'PETG', 'TPU'],
        // One per rendering path: plain hex, W3C name, hex+alpha, nothing.
        gate_color: ['#E53935', 'firebrick', '#1E88E580', '', '', '#FFC107', '#43A047', '#8E24AA'],
        gate_temperature: [215, 240, 210, 255, -1, 210, 235, 225],
        gate_spool_id: [3, 7, -1, -1, -1, -1, -1, -1],
        gate_speed_override: [100, 100, 100, 100, 100, 100, 100, 100],
        espooler: ['off', 'rewind', 'off', 'off', 'off', 'off', 'assist', 'off'],
        sensors: {
            mmu_pre_gate: true,
            mmu_gate: true,
            extruder: true,
            toolhead: true,
            filament_tension: false,
        },
        servo: 'Down',
        grip: 'Gripped',
        encoder: {
            enabled: true,
            encoder_pos: 1234.5,
            flow_rate: 98,
            detection_mode: 1,
            desired_headroom: 5,
            detection_length: 15,
            headroom: 7.2,
            min_headroom: 4.1,
        },
        active_filament: { filament_name: 'Galaxy Black', material: 'PLA', color: '#E53935', spool_id: 3, temperature: 215 },
    },
    mmu_machine: {
        num_units: 1,
        unit_0: {
            name: 'ERCF',
            vendor: 'ERCF',
            version: '2.0',
            num_gates: 8,
            first_gate: 0,
            selector_type: 'LinearSelector',
            has_bypass: true,
            multi_gear: false,
            can_crossload: false,
        },
    },
    configfile: {
        settings: {
            mmu: { gate_homing_endstop: 'encoder', mmu_num_gates: 8 },
        },
    },
}

/** Switched off in software: the panel must stay visible, dimmed, titled. */
export const mmuDisabledStatus = {
    ...mmuStatus,
    mmu: { ...mmuStatus.mmu, enabled: false },
}

/**
 * Paused after an error, mid tool change, filament nowhere in particular.
 * This is the state that lights the "Unlock" button -- the only one that does.
 */
export const mmuPausedStatus = {
    ...mmuStatus,
    mmu: {
        ...mmuStatus.mmu,
        print_state: 'pause_locked',
        is_paused: true,
        is_locked: true,
        filament_pos: 3, // FILAMENT_POS_IN_BOWDEN
        action: 'Loading',
        last_tool: 0,
        next_tool: 2,
        reason_for_pause: 'Filament not detected at the toolhead sensor after loading gate 2.',
    },
}

/** The bypass selected rather than a gate: the load/unload buttons rename. */
export const mmuBypassStatus = {
    ...mmuStatus,
    mmu: { ...mmuStatus.mmu, gate: -2, tool: -2, filament_pos: 0 },
}
