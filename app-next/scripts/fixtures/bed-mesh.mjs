/**
 * A bed mesh this machine cannot produce, shaped like one it would.
 *
 * The CR-Touch burnt out (H1) and `[include cr-touch.cfg]` is commented out of
 * printer.cfg, so Klipper here publishes no `bed_mesh` object at all. Every
 * state on the heightmap page except "no [bed_mesh] section" is unreachable
 * against the live printer, which is exactly why this file exists.
 *
 * GEOMETRY IS THE MACHINE'S OWN, not round numbers: X 0..245 and Y 0..190,
 * measured with MEASURE_HOME and recorded in printer-configs/printer.cfg. A
 * mesh drawn over a made-up 200x200 bed would hide the one thing the chart has
 * to get right -- that a 245x190 bed is drawn wider than it is deep, via
 * `grid3D.boxWidth/boxDepth`. The probe area is inset 25 mm, which is what a
 * real `mesh_min`/`mesh_max` looks like once the probe offset is accounted for.
 *
 * The SHAPE is a saddle plus a corner dip: a plane would make a wrong Z scale
 * or a wrong colour ramp invisible, and a symmetric dome would hide an X/Y
 * transposition. This one is asymmetric in both axes on purpose -- if rows and
 * columns were ever swapped, the picture changes.
 *
 * `mesh_matrix` is deliberately DENSER than `probed_matrix` (9x9 interpolated
 * from 5x5, which is what `mesh_x_pps: 1` gives): the two matrices covering the
 * same bounds with different dimensions is the case where sharing one X/Y step
 * between them would stretch one surface past the other.
 */

const MESH_MIN = [25, 25]
const MESH_MAX = [220, 165]

/** Deviation in mm at a normalised bed position -- the saddle, plus a dip. */
function height(u, v) {
    const saddle = 0.09 * Math.sin(Math.PI * u) - 0.07 * Math.cos(Math.PI * v)
    const dip = -0.06 * Math.exp(-(((u - 0.1) ** 2 + (v - 0.9) ** 2) / 0.06))
    const tilt = 0.04 * u - 0.02 * v

    return Math.round((saddle + dip + tilt) * 1000) / 1000
}

function matrix(xCount, yCount) {
    return Array.from({ length: yCount }, (_, y) =>
        Array.from({ length: xCount }, (_, x) => height(x / (xCount - 1), y / (yCount - 1)))
    )
}

const probed = matrix(5, 5)

/** A second, flatter profile, so the profile list has something to compare. */
const probedTuned = probed.map((row) => row.map((value) => Math.round(value * 0.35 * 1000) / 1000))

const meshParams = (xCount, yCount) => ({
    min_x: MESH_MIN[0],
    max_x: MESH_MAX[0],
    min_y: MESH_MIN[1],
    max_y: MESH_MAX[1],
    x_count: xCount,
    y_count: yCount,
    mesh_x_pps: 1,
    mesh_y_pps: 1,
    algo: 'lagrange',
    tension: 0.2,
})

/**
 * The Klipper objects the page needs, ready to merge into a
 * `printer.objects.subscribe` reply.
 *
 * `configfile.settings.bed_mesh` is separate from the live object and both are
 * required: the zero plane is drawn from the CONFIGURED probe grid, not from
 * what was probed, so a page given only the live object renders a mesh floating
 * over nothing.
 */
export const bedMeshFixture = {
    bed_mesh: {
        profile_name: 'default',
        mesh_min: MESH_MIN,
        mesh_max: MESH_MAX,
        probed_matrix: probed,
        mesh_matrix: matrix(9, 9),
        profiles: {
            default: { points: probed, mesh_params: meshParams(5, 5) },
            'after-tramming': { points: probedTuned, mesh_params: meshParams(5, 5) },
        },
    },
    configfile: {
        settings: {
            bed_mesh: {
                speed: 50,
                horizontal_move_z: 5,
                mesh_min: MESH_MIN,
                mesh_max: MESH_MAX,
                probe_count: [5, 5],
                mesh_pps: [1, 1],
                algorithm: 'lagrange',
                bicubic_tension: 0.2,
            },
        },
    },
}

/** The same machine with a mesh CLEARED: config present, nothing loaded. */
export const bedMeshClearedFixture = {
    bed_mesh: {
        profile_name: '',
        mesh_min: [0, 0],
        mesh_max: [0, 0],
        probed_matrix: [],
        mesh_matrix: [],
        profiles: bedMeshFixture.bed_mesh.profiles,
    },
    configfile: bedMeshFixture.configfile,
}
