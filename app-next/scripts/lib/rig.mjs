/**
 * A test bench for hardware this machine does not have.
 *
 * 🔴 WHY THIS EXISTS
 * ------------------
 * Queue 2 of the port is, by definition, panels for hardware that is not
 * attached: bed mesh (the CR-Touch burnt out), AFC, MMU, Spoolman, filament
 * farms, LED effects. Against the live printer every one of those panels
 * renders its empty state and nothing else, so "it looks right" would mean
 * "the empty state looks right" -- which is not what shipping them claims.
 *
 * The obvious alternative -- adding the hardware to the printer's config or
 * writing objects into the Moonraker database -- is not available: this fork is
 * not allowed to change the machine the user prints with, and half of it would
 * need a Klipper restart anyway.
 *
 * So the data is injected INSIDE THE BROWSER, into the websocket reply, before
 * the app ever parses the frame. The printer sends what it really has; the page
 * sees what it would see with the hardware fitted. Nothing on the printer
 * changes -- this is verifiable, because the rig never sends anything either
 * (see the g-code block below).
 *
 * Generalised from `shoot-multicam.mjs`, which does the same thing for a second
 * camera, so the next queue-2 panel does not reinvent it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 THE G-CODE BLOCK IS THE POINT, NOT A CONVENIENCE
 * ─────────────────────────────────────────────────────────────────────────
 * The heightmap panel is made almost entirely of buttons that send g-code:
 * G28, BED_MESH_CLEAR, BED_MESH_CALIBRATE, BED_MESH_PROFILE LOAD/SAVE/REMOVE.
 * A screenshot run drives a real browser against the live Moonraker, and the
 * printer is currently mid step-loss diagnostic with heating forbidden.
 *
 * Note the asymmetry that makes "just be careful" insufficient: the BED_MESH_*
 * commands would be refused by Klipper anyway (no `[bed_mesh]` section), but
 * G28 would NOT be -- it is real motion on a machine someone else is measuring.
 *
 * So outbound `printer.gcode.script` frames are recorded, DROPPED, and answered
 * with a synthetic reply. A stray click cannot reach the wire, and the recorded
 * list is the audit artifact: `window.__rig.gcode` is what the page tried to
 * send. An audit taken afterwards proves less than an interception that makes
 * it impossible.
 */

/**
 * @param {import('puppeteer-core').Page} page
 * @param {object}   options
 * @param {object}   options.status      Klipper objects to merge into the
 *                                       `printer.objects.subscribe` reply.
 * @param {string}   options.theme       'dark' | 'light'
 * @param {string}   options.density     'auto' | 's' | 'm' | 'l'
 * @param {object}   options.gui         Patch merged over the persisted gui state.
 * @param {boolean}  options.blockGcode  Default true. Never pass false unless
 *                                       you intend the printer to move.
 */
export async function installRig(page, { status = {}, theme = 'dark', density = 'auto', gui = null, blockGcode = true } = {}) {
    await page.evaluateOnNewDocument(
        (statusPatch, t, d, guiPatch, block) => {
            localStorage.setItem('mainsail-next.theme', t)
            localStorage.setItem('mainsail-next.density', d)
            if (guiPatch) localStorage.setItem('mainsail-next.gui', JSON.stringify(guiPatch))

            window.__rig = { injected: false, gcode: [], blocked: block }

            const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

            /**
             * Merge, not replace. `configfile.settings` must keep the machine's
             * real sections -- a panel that reads `[extruder]` has to still find
             * it after a `[bed_mesh]` is injected beside it.
             */
            const merge = (base, patch) => {
                for (const [key, value] of Object.entries(patch)) {
                    if (isObject(value) && isObject(base[key])) merge(base[key], value)
                    else base[key] = value
                }
                return base
            }

            const Native = window.WebSocket

            function Patched(...args) {
                const socket = new Native(...args)
                const subscribeIds = new Set()
                let appHandler = null

                /** Deliver a frame to the app as if the server had sent it. */
                const deliver = (frame) => {
                    // A microtask, so the caller's `send()` has returned before
                    // its reply lands -- the real socket never answers inline.
                    Promise.resolve().then(() => appHandler?.({ data: JSON.stringify(frame) }))
                }

                const nativeSend = socket.send.bind(socket)
                socket.send = (payload) => {
                    let frame = null
                    try {
                        frame = JSON.parse(payload)
                    } catch {
                        return nativeSend(payload)
                    }

                    if (block && frame?.method === 'printer.gcode.script') {
                        window.__rig.gcode.push(frame.params?.script ?? '')
                        // Answer it, or the app's promise never settles and the
                        // button spins forever -- which would look like a bug in
                        // the panel rather than like the rig.
                        deliver({ jsonrpc: '2.0', id: frame.id, result: 'ok' })
                        return undefined
                    }

                    // Record the id: a JSON-RPC reply carries only the id, never
                    // the method that produced it.
                    if (frame?.method === 'printer.objects.subscribe') subscribeIds.add(frame.id)

                    return nativeSend(payload)
                }

                // The app assigns `socket.onmessage = fn`. Shadowing the
                // prototype accessor with an own property captures that
                // assignment; the native event still reaches the listener below,
                // which forwards a possibly-rewritten copy.
                Object.defineProperty(socket, 'onmessage', {
                    configurable: true,
                    get: () => appHandler,
                    set: (fn) => {
                        appHandler = fn
                    },
                })

                socket.addEventListener('message', (event) => {
                    if (!appHandler) return

                    let data = event.data
                    try {
                        const frame = JSON.parse(data)
                        if (subscribeIds.has(frame?.id) && isObject(frame?.result?.status)) {
                            merge(frame.result.status, statusPatch)
                            window.__rig.injected = true
                            data = JSON.stringify(frame)
                        }
                    } catch {
                        /* not JSON -- pass through untouched */
                    }

                    appHandler({ data })
                })

                return socket
            }

            Patched.prototype = Native.prototype
            Object.assign(Patched, Native)
            window.WebSocket = Patched
        },
        status,
        theme,
        density,
        gui,
        blockGcode
    )
}

/** Read back what the page tried to send. Empty is the expected result. */
export async function rigReport(page) {
    return page.evaluate(() => window.__rig ?? { injected: false, gcode: [], blocked: null })
}
