/**
 * A BoxTurtle with four lanes, for a printer that has no AFC at all.
 *
 * 🔴 WHY A FIXTURE AND NOT THE MACHINE. `printer/objects/list` on this printer
 * returns no `AFC` and no `AFC_*`: AFC is a Klipper extra that is not
 * installed, and there is not even a Moonraker component to fake, so the panel
 * is unreachable in every state including its empty one. Everything below is
 * injected into the websocket reply inside the browser (see `lib/rig.mjs`);
 * the printer sends what it really has and is not touched.
 *
 * THE FOUR LANES ARE FOUR DIFFERENT STATES ON PURPOSE, because the lane card
 * has three distinct renderings and picking between them is the part most
 * likely to be got wrong:
 *
 *   lane1  prep+load+tool_loaded  the lane in the toolhead -- highlighted,
 *                                 and its action button must read UNLOAD
 *   lane2  prep+load              ready, idle -- action button reads LOAD, and
 *                                 it carries a TD-1 reading and a runout
 *                                 partner so those two paths are visible
 *   lane3  prep only              filament inserted but not gripped: the
 *                                 "Prep detected" state with an eject and
 *                                 nothing else
 *   lane4  neither                empty
 *
 * The numbers are plausible rather than round (742 g left of 1000 g) so that a
 * formatting bug shows up as a wrong number instead of a suspiciously neat one.
 */

const lane = (overrides) => ({
    prep: false,
    load: false,
    tool_loaded: false,
    map: '',
    color: '#000000',
    material: '',
    weight: 0,
    initial_weight: 1000,
    spool_id: 0,
    filament_name: '',
    runout_lane: 'NONE',
    extruder: 'extruder',
    buffer: 'TN2',
    td1_td: null,
    td1_color: null,
    ...overrides,
})

/** The ordinary case: a unit mid-print, one lane loaded, one spare ready. */
export const afcStatus = {
    AFC: {
        units: ['BoxTurtle Turtle_1'],
        lanes: ['lane1', 'lane2', 'lane3', 'lane4'],
        hubs: ['Turtle_1'],
        extruders: ['extruder'],
        current_load: 'lane1',
        current_state: 'Idle',
        error_state: false,
        bypass_state: false,
        led_state: true,
        td1_present: true,
        message: null,
    },
    'AFC_BoxTurtle Turtle_1': {
        hubs: ['Turtle_1'],
        lanes: ['lane1', 'lane2', 'lane3', 'lane4'],
    },
    'AFC_hub Turtle_1': { state: true },
    'AFC_buffer TN2': { state: 'Trailing' },
    'AFC_extruder extruder': {
        lanes: ['lane1', 'lane2', 'lane3', 'lane4'],
        lane_loaded: 'lane1',
        tool_start: 'sensor',
        tool_start_status: true,
        tool_end_status: false,
    },
    'AFC_stepper lane1': lane({
        name: 'lane1',
        prep: true,
        load: true,
        tool_loaded: true,
        map: 'T0',
        color: '#1E88E5',
        material: 'PLA',
        weight: 742,
        spool_id: 3,
        filament_name: 'Prusament Galaxy Black',
        runout_lane: 'lane2',
    }),
    'AFC_stepper lane2': lane({
        name: 'lane2',
        prep: true,
        load: true,
        map: 'T1',
        color: '#E53935',
        material: 'PETG',
        weight: 913,
        spool_id: 7,
        filament_name: 'Devil Design Red',
        runout_lane: 'NONE',
        td1_td: 2.31,
        td1_color: 'E53935',
    }),
    'AFC_stepper lane3': lane({ name: 'lane3', prep: true, map: 'T2' }),
    'AFC_stepper lane4': lane({ name: 'lane4', map: 'T3' }),
    /**
     * `configfile.settings` is MERGED by the rig, not replaced, so the real
     * `[extruder]` and the rest of this machine's config survive underneath.
     * `pin_tool_end` is what makes the post-extruder sensor dot appear at all.
     */
    configfile: {
        settings: {
            afc: { wipe: true, wipe_cmd: 'AFC_BRUSH', park: false },
            'afc_extruder extruder': { pin_tool_end: 'PA1' },
            'afc_stepper lane1': {},
        },
    },
}

/** AFC has failed and is telling the user about it. */
export const afcErrorStatus = {
    ...afcStatus,
    AFC: {
        ...afcStatus.AFC,
        error_state: true,
        current_state: 'Error',
        message: {
            type: 'error',
            message: 'Lane lane1 failed to load into the toolhead.\nCheck the hub and clear the message to retry.',
        },
    },
}

/**
 * The bypass lever engaged. Everything below the banner is still rendered --
 * upstream does not hide it -- so this checks the banner appears and that the
 * lane cards do not shift around underneath it.
 */
export const afcBypassStatus = {
    ...afcStatus,
    AFC: { ...afcStatus.AFC, bypass_state: true, current_load: null, message: null },
    'AFC_extruder extruder': { ...afcStatus['AFC_extruder extruder'], lane_loaded: '' },
    'AFC_stepper lane1': lane({ name: 'lane1', prep: true, load: true, map: 'T0', color: '#1E88E5', material: 'PLA' }),
}

/**
 * The same unit on a printer that also has AFC's macros installed.
 *
 * 🔴 THIS EXISTS BECAUSE THE MENU'S MACRO FILTER IS EASY TO PROVE BACKWARDS.
 * With `afcStatus` alone the menu shows no macro rows at all -- correct, since
 * this printer has no `AFC_CALIBRATION` -- but "no rows" is also what a broken
 * filter, a broken menu and a typo'd store lookup all look like. So this
 * fixture adds the macros as Klipper objects and the run asserts the rows
 * APPEAR, which is the half that a passing negative cannot cover.
 *
 * `TURN_OFF_AFC_LED` is included and `TURN_ON_AFC_LED` is not, on purpose:
 * `led_state` is true in this fixture, so the menu should offer exactly the
 * "off" one. A menu showing both, or the wrong one, is a live bug.
 *
 * `AFC_BRUSH` is gated on `afc.wipe`, which the settings above turn on;
 * `AFC_PARK` is left out of the config so the park row must NOT appear even
 * though nothing else would stop it.
 */
export const afcWithMacrosStatus = {
    ...afcStatus,
    'gcode_macro AFC_CALIBRATION': {},
    'gcode_macro TURN_OFF_AFC_LED': {},
    'gcode_macro AFC_GET_TD_ONE_DATA': {},
    'gcode_macro AFC_BRUSH': {},
    'gcode_macro AFC_PARK': {},
}

/**
 * A ramming toolhead: no pre-extruder switch, arrival detected by the buffer.
 * The pre-sensor dot means something different here, which is the one piece of
 * `AfcExtruderRow` logic that cannot be checked with the fixture above.
 */
export const afcRammingStatus = {
    ...afcStatus,
    'AFC_extruder extruder': {
        ...afcStatus['AFC_extruder extruder'],
        tool_start: 'buffer',
        lane_loaded: '',
    },
    'AFC_buffer TN2': { state: 'Trailing' },
}
