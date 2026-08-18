/**
 * moonraker-timelapse, which this printer does not have.
 *
 * `timelapse` is a third-party Moonraker component. `server.info` here lists 25
 * components without it, `machine.timelapse.*` answers 404, and `timelapse` is
 * not one of the registered file roots -- so every one of the calls below FAILS
 * against the live server, and the rig substitutes a result for the error. That
 * is the case the rig's `rpc` option was built for.
 *
 * Everything is keyed to one plausible history rather than to round numbers: a
 * machine that has rendered a few prints, has one older archive of raw frames,
 * files some videos under a per-print subdirectory, and is 342 frames into a
 * print right now.
 */

/** Seconds since the epoch -- Moonraker's unit for `modified`. */
const daysAgo = (days) => Math.round(Date.now() / 1000 - days * 86400)

export const timelapseRpc = {
    'machine.timelapse.get_settings': {
        enabled: true,
        camera: 'main',
        mode: 'layermacro',
        autorender: true,
        autorenderOnce: false,
        saveframes: false,
        stream_delay_compensation: 0.05,
        gcode_verbose: true,
        parkhead: true,
        parkpos: 'back_left',
        park_custom_pos_x: 0,
        park_custom_pos_y: 0,
        park_custom_pos_dz: 0,
        park_travel_speed: 100,
        park_retract_speed: 15,
        park_retract_distance: 1,
        park_extrude_speed: 15,
        park_extrude_distance: 1,
        park_time: 0.1,
        fw_retract: false,
        hyperlapse_cycle: 30,
        constant_rate_factor: 23,
        // Deliberately NOT the default 30: a value that matches the default
        // cannot show whether the panel is reading the server or its own
        // fallback.
        output_framerate: 24,
        pixelformat: 'yuv420p',
        extraoutputparams: '',
        variable_fps: false,
        targetlength: 60,
        variable_fps_min: 5,
        variable_fps_max: 60,
        rotation: 0,
        duplicatelastframe: 5,
        previewimage: true,
        time_format_code: '%Y%m%d_%H%M',
        // One pinned setting, because `blockedsettings` is the only reason a
        // control is rendered but refuses to be changed.
        blockedsettings: ['camera'],
    },

    /**
     * 342 frames at 24 fps + 5 duplicated = about 14 s. Worth checking against
     * what the panel prints, because the duplicate-frame term is easy to drop.
     */
    'machine.timelapse.lastframeinfo': {
        framecount: 342,
        lastframefile: 'frame000342.jpg',
    },

    /**
     * Qualified by root: `server.files.list` also serves the Machine page's log
     * panel, and faking it by method alone would hand that panel this list.
     *
     * The `.jpg` entry is here to be FILTERED OUT -- a failed render leaves raw
     * frames in this root, and they are not timelapses. A fixture of only
     * things that should appear cannot catch a filter that stopped filtering.
     */
    'server.files.list?root=timelapse': [
        { path: 'timelapse_20260817_2214.mp4', modified: daysAgo(1), size: 18_432_112, permissions: 'rw' },
        { path: 'timelapse_20260815_1902.mp4', modified: daysAgo(3), size: 7_204_338, permissions: 'rw' },
        { path: 'benchy/timelapse_20260812_1140.mp4', modified: daysAgo(6), size: 41_002_984, permissions: 'rw' },
        { path: 'timelapse_20260810_0930.zip', modified: daysAgo(8), size: 220_115_776, permissions: 'rw' },
        { path: 'frames/frame000001.jpg', modified: daysAgo(8), size: 96_233, permissions: 'rw' },
    ],
}

/** A render in flight, pushed the way Moonraker pushes it. */
export const timelapseRenderEvent = {
    action: 'render',
    status: 'running',
    progress: 42,
    filename: 'timelapse_20260818_2312.mp4',
}
