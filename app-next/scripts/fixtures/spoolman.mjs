/**
 * A Spoolman server, which this machine does not talk to.
 *
 * Spoolman is a SEPARATE server with its own database and web UI; Moonraker
 * only proxies to it through an optional `spoolman` component that is not among
 * the 25 loaded here. So `server.spoolman.*` fails against this printer and the
 * rig substitutes results.
 *
 * Note the shape: every Spoolman call goes through `server.spoolman.proxy` and
 * comes back wrapped as `{ error, response }` because the app asks for
 * `use_v2_response`. The wrapper is reproduced rather than flattened -- the
 * unwrapping IS the part of the store that can be wrong, and a fixture that
 * hands over an already-unwrapped body would test nothing.
 *
 * The rig keys those by parameter, since one method serves every path.
 *
 * Three spools, and each is a different rendering path:
 *   #14 plain colour, the one that is loaded
 *   #9  COAXIAL multi-colour -> pie wedges
 *   #3  LONGITUDINAL multi-colour -> a banded gradient
 * plus an archived one that must NOT be offered, because Spoolman's "archived"
 * means retired and writing its id back would be wrong.
 */

const wrap = (response) => ({ error: null, response })

const spools = [
    {
        id: 14,
        archived: false,
        last_used: '2026-08-17T21:04:00Z',
        remaining_weight: 742.5,
        remaining_length: 248_900,
        location: 'Shelf A',
        filament: {
            id: 4,
            name: 'Galaxy Black',
            material: 'PLA',
            color_hex: '1B1B1F',
            weight: 1000,
            density: 1.24,
            diameter: 1.75,
            vendor: { id: 1, name: 'Prusament' },
        },
    },
    {
        id: 9,
        archived: false,
        last_used: '2026-08-11T10:20:00Z',
        remaining_weight: 310,
        remaining_length: 104_000,
        filament: {
            id: 7,
            name: 'Dual Silk Copper/Steel',
            material: 'PLA Silk',
            color_hex: 'B87333',
            multi_color_hexes: 'B87333,C0C0C0',
            multi_color_direction: 'coaxial',
            weight: 750,
            vendor: { id: 2, name: 'Eryone' },
        },
    },
    {
        id: 3,
        archived: false,
        last_used: '2026-07-30T08:00:00Z',
        remaining_weight: 96,
        remaining_length: 32_000,
        filament: {
            id: 2,
            name: 'Rainbow Gradient',
            material: 'PETG',
            color_hex: 'FF0000',
            multi_color_hexes: 'FF0000,FFA500,FFFF00,00A000,0000FF',
            multi_color_direction: 'longitudinal',
            weight: 1000,
            vendor: { id: 3, name: 'Geeetech' },
        },
    },
    {
        id: 1,
        archived: true,
        last_used: '2026-01-02T08:00:00Z',
        remaining_weight: 0,
        filament: { id: 1, name: 'Retired ABS', material: 'ABS', color_hex: 'EEEEEE', weight: 1000 },
    },
]

export const spoolmanRpc = {
    'server.spoolman.get_spool_id': { spool_id: 14 },
    'server.spoolman.proxy?path=/v1/info': wrap({ version: '0.19.1', debug_mode: false }),
    'server.spoolman.proxy?path=/v1/health': wrap({ status: 'healthy' }),
    'server.spoolman.proxy?path=/v1/spool': wrap(spools),
    'server.spoolman.proxy?path=/v1/spool/14': wrap(spools[0]),
    'server.config': {
        config: {
            // localhost FOR MOONRAKER: the store has to rewrite this to the
            // host the page came from, or the "open Spoolman" link is dead on
            // every device except the printer itself.
            spoolman: { server: 'http://localhost:7912' },
        },
    },
}

/** Spoolman reachable but unwell -- the status belongs in the panel title. */
export const spoolmanUnhealthyRpc = {
    ...spoolmanRpc,
    'server.spoolman.proxy?path=/v1/health': wrap({ status: 'unhealthy' }),
}

/** No spool loaded: `spool_id: 0` is Spoolman's "none", not a spool with id 0. */
export const spoolmanEmptyRpc = {
    ...spoolmanRpc,
    'server.spoolman.get_spool_id': { spool_id: 0 },
}
