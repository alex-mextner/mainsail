/**
 * Miscellaneous-panel hardware this machine does not have.
 *
 * 🔴 WHAT THIS FIXTURE IS FOR, AND WHAT IT IS NOT FOR.
 * Unlike the bed mesh, most of this panel IS reachable live: the RGB strip, the
 * controller fan and the three smoke-alarm pins are real objects on this
 * printer, and they are checked against it. So this file deliberately does NOT
 * re-create them. It supplies exactly the object types the machine lacks --
 * which are precisely the code paths a live run cannot execute:
 *
 *   [fan]                        the part-cooling fan. NOT on this machine
 *                                (hotend-fan.cfg redefines M106/M107 instead),
 *                                and the only object whose command scale is 255
 *                                rather than 1 -- so `M106 S255`, not `S1.00`.
 *   [fan_generic]                the only other fan Klipper lets the UI drive,
 *                                via SET_FAN_SPEED, and the one with an
 *                                `off_below` stall band worth dragging through.
 *   [heater_fan]                 read-only: reports a speed, takes no command.
 *   [output_pin] with pwm: True  a pin that is a slider, not a switch. The three
 *                                real pins here are all digital, so without this
 *                                the pwm branch of an output pin never renders.
 *                                `scale: 100` too, because a scale that is
 *                                neither 1 nor 255 is where an off-by-one in the
 *                                command multiplier shows up.
 *   [pwm_tool]                   pwm regardless of what the config says.
 *   [neopixel] RGBW              a CHAIN (three pixels) with a white channel:
 *                                the INDEX= loop and the W control are both dead
 *                                code against a single-pixel RGB strip.
 *   [led] single channel         one white channel -> the light renders as a
 *                                brightness slider instead of a colour picker.
 *   filament sensors x3          switch, motion and width. The width one is the
 *                                only sensor that sends a SECOND command.
 *   [load_cell]                  a Klipper sensor row.
 *
 * Moonraker's own `[sensor]` section is faked separately -- it is not a Klipper
 * object at all, so it rides the rig's `rpc` option, see `moonrakerSensorRpc`.
 *
 * Values are believable rather than round: a fan at 0.6 with 1700 RPM, a strip
 * mid-fade. Round numbers hide off-by-one scaling.
 */

export const miscellaneousFixture = {
    fan: { speed: 0.6, rpm: 1700 },
    'fan_generic exhaust': { speed: 0.35, rpm: null },
    'heater_fan hotend_heatsink': { speed: 1, rpm: 5100 },
    'output_pin case_light': { value: 0.42 },
    'pwm_tool laser': { value: 0.1 },

    'neopixel chamber_bar': {
        // Three pixels, mid-fade, and NOT all the same -- a chain drawn from
        // color_data[0] alone would look right on a uniform strip.
        color_data: [
            [0.9, 0.35, 0.1, 0.0],
            [0.9, 0.35, 0.1, 0.0],
            [0.9, 0.35, 0.1, 0.2],
        ],
    },
    'led work_light': { color_data: [[0, 0, 0, 0.75]] },

    'filament_switch_sensor runout': { enabled: true, filament_detected: true },
    'filament_motion_sensor encoder': { enabled: true, filament_detected: false },
    'hall_filament_width_sensor width': { enabled: true, filament_detected: true, Diameter: 1.732 },

    'load_cell probe': { force_g: 12.4, is_calibrated: true },

    configfile: {
        settings: {
            fan: { max_power: 1, off_below: 0.1 },
            'fan_generic exhaust': { max_power: 1, off_below: 0.25 },
            'heater_fan hotend_heatsink': { max_power: 1 },
            // `pwm: True` is what turns a switch into a slider; `scale: 100`
            // means the command is sent in 0..100, not 0..1.
            'output_pin case_light': { pwm: true, scale: 100, value: 0 },
            'pwm_tool laser': { scale: 1, value: 0 },
            'neopixel chamber_bar': { color_order: ['RGBW', 'RGBW', 'RGBW'], chain_count: 3 },
            // Klipper lower-cases config keys, so `initial_WHITE` arrives here
            // as `initial_white` -- the reset buttons read these.
            'led work_light': { white_pin: 'PA7', initial_white: 0.5 },
        },
    },
}

/**
 * A Moonraker `[sensor]`, for the rig's `rpc` option.
 *
 * Two values on one sensor on purpose: the row collapses to a single line when
 * a sensor reports one number and expands to a labelled list when it reports
 * several, and only the second shape needs the per-parameter units lookup.
 */
export const moonrakerSensorRpc = {
    'server.sensors.list': {
        sensors: {
            psu: {
                id: 'psu',
                friendly_name: 'PSU',
                type: 'mqtt',
                values: { voltage: 23.87, current: 1.42 },
            },
        },
    },
    'server.config': {
        config: {
            'sensor psu': {
                type: 'mqtt',
                parameter_voltage: { units: 'V' },
                parameter_current: { units: 'A' },
            },
        },
    },
}
