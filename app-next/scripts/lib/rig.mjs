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
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 G-CODE IS NOT THE ONLY WAY TO MOVE THIS MACHINE (added 2026-08-19)
 * ─────────────────────────────────────────────────────────────────────────
 * Until now this file intercepted exactly ONE method, `printer.gcode.script`,
 * and that was enough -- every panel it had been used on (heightmap,
 * Miscellaneous, LED effects) is made of buttons that send g-code.
 *
 * The job queue breaks that assumption, and it breaks it in the worst
 * direction. `server.job_queue.start` sends no g-code at all: it flips
 * Moonraker's queue from `paused` to `ready`, and Moonraker then starts the
 * next queued file BY ITSELF, at a moment of its choosing -- when the current
 * print ends. A "click every control" pass, which is exactly how every panel in
 * this port gets verified, would have armed an unattended print that begins
 * after the harness has exited and the browser is closed. Nothing in the run's
 * own output would have shown it.
 *
 * The same hole covers `server.database.post_item` (the maintenance records
 * write into a namespace the port-80 Mainsail reads), `server.files.delete_file`,
 * `printer.emergency_stop`, and the machine/service restarts.
 *
 * So the firewall is now a LIST, not a special case. The rule for adding to it:
 * if the call changes anything that outlives the browser tab, it belongs here.
 * Read-only calls must NOT be listed -- blocking those would silently hollow out
 * the panels this rig exists to photograph.
 *
 * 🔴 The list is not the firewall -- `scripts/check-rig-firewall.mjs` is what
 * says the firewall works. It sends each method from inside the page and reads
 * the frames that actually left over CDP, so a list that is declared but never
 * consulted fails the check instead of reading correct. That script exists
 * because the first draft of this file did exactly that: declared the list,
 * defined `isBlocked`, and never called it. Run it after touching this file.
 */

/**
 * Calls that must never reach the printer from a screenshot run.
 *
 * A trailing `*` matches a prefix; everything else is an exact method name.
 * Deliberately NOT here, because they only read: `server.job_queue.status`,
 * `server.database.get_item`, `machine.update.status`, `server.files.list`,
 * `printer.objects.*`, `server.temperature_store`.
 */
export const DEFAULT_BLOCKED_METHODS = [
    // Motion and heat.
    'printer.gcode.script',
    'printer.emergency_stop',
    'printer.print.*', // start, pause, resume, cancel
    'printer.restart',
    'printer.firmware_restart',

    // The queue: no g-code, but it makes the printer start a job on its own.
    'server.job_queue.post_job',
    'server.job_queue.delete_job',
    'server.job_queue.pause',
    'server.job_queue.start',
    'server.job_queue.jump',

    // Shared state that outlives the tab. The `mainsail` and `maintenance`
    // namespaces are read by the interface the user actually prints with.
    'server.database.post_item',
    'server.database.delete_item',
    'server.webcams.post_item',
    'server.webcams.delete_item',

    // Destroys data.
    'server.files.delete_file',
    'server.files.delete_directory',
    'server.files.move',
    'server.files.copy',
    'server.files.post_directory',
    'server.history.delete_job',
    'server.history.reset_totals',

    // The host itself.
    'machine.reboot',
    'machine.shutdown',
    'machine.services.*',
    'machine.update.*', // `machine.update.status` is exempted explicitly below

    // Third-party components that are faked in fixtures, so their writes would
    // land on a printer that does not even have them.
    'machine.timelapse.post_settings',
    'machine.timelapse.render',
    'machine.timelapse.delete',
    'machine.timelapse.saveframes',
    'server.spoolman.post_spool_id',
]

/** Read-only calls that would otherwise be caught by a `*` above. */
export const BLOCK_EXEMPTIONS = ['machine.update.status']

/**
 * @param {import('puppeteer-core').Page} page
 * @param {object}   options
 * @param {object}   options.status      Klipper objects to merge into the
 *                                       `printer.objects.subscribe` reply.
 * @param {string}   options.theme       'dark' | 'light'
 * @param {string}   options.density     'auto' | 's' | 'm' | 'l'
 * @param {object}   options.gui         Patch merged over the persisted gui state.
 * @param {boolean}  options.blockGcode  Default true. Never pass false unless
 *                                       you intend the printer to move. Despite
 *                                       the name it now governs the whole
 *                                       firewall, not just g-code.
 * @param {string[]} options.block       Extra methods to block, appended to
 *                                       DEFAULT_BLOCKED_METHODS.
 * @param {object}   options.rpc         Moonraker replies to fake, keyed by
 *                                       method. See the block below. A method
 *                                       listed here AND blocked gets this as
 *                                       its synthetic reply.
 * @param {string[]} options.components  Optional Moonraker components to add to
 *                                       the `server.info` reply.
 */
export async function installRig(
    page,
    {
        status = {},
        theme = 'dark',
        density = 'auto',
        gui = null,
        blockGcode = true,
        block = [],
        rpc = {},
        components = [],
    } = {}
) {
    const blocked = [...DEFAULT_BLOCKED_METHODS, ...block]

    await page.evaluateOnNewDocument(
        (statusPatch, t, d, guiPatch, firewallOn, rpcPatch, extraComponents, blockedMethods, exemptMethods) => {
            localStorage.setItem('mainsail-next.theme', t)
            localStorage.setItem('mainsail-next.density', d)
            if (guiPatch) localStorage.setItem('mainsail-next.gui', JSON.stringify(guiPatch))

            window.__rig = { injected: false, gcode: [], blocked: firewallOn, rpc: [], blockedCalls: [] }

            const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

            /** `a.b.*` matches a prefix; anything else is an exact method name. */
            const matches = (pattern, method) =>
                pattern.endsWith('.*') ? method.startsWith(pattern.slice(0, -1)) : pattern === method

            const isBlocked = (method) =>
                typeof method === 'string' &&
                !exemptMethods.some((pattern) => matches(pattern, method)) &&
                blockedMethods.some((pattern) => matches(pattern, method))

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
                /** id -> method, for the calls listed in `rpc`. */
                const rpcIds = new Map()
                const serverInfoIds = new Set()
                let appHandler = null

                /** Deliver a frame to the app as if the server had sent it. */
                const deliver = (frame) => {
                    // A microtask, so the caller's `send()` has returned before
                    // its reply lands -- the real socket never answers inline.
                    Promise.resolve().then(() => appHandler?.({ data: JSON.stringify(frame) }))
                }

                /**
                 * Which `rpc` fixture answers this frame, if any.
                 *
                 * A key is either a bare method or `method?k=v`. The qualified
                 * form exists because ONE method serves several roots:
                 * `server.files.list` lists the timelapse videos AND the log
                 * files, and faking it by method alone would hand the Machine
                 * page's log panel a list of timelapses.
                 */
                const rpcKeyFor = (frame) => {
                    if (!frame?.method) return null
                    for (const key of Object.keys(rpcPatch)) {
                        const [method, query] = key.split('?')
                        if (method !== frame.method) continue

                        if (query) {
                            const [name, value] = query.split('=')
                            if (String(frame.params?.[name]) !== value) continue
                        }

                        return key
                    }
                    return null
                }

                const nativeSend = socket.send.bind(socket)
                socket.send = (payload) => {
                    let frame = null
                    try {
                        frame = JSON.parse(payload)
                    } catch {
                        return nativeSend(payload)
                    }

                    const rpcKey = rpcKeyFor(frame)

                    /**
                     * THE FIREWALL. Everything on the blocklist is recorded,
                     * dropped, and answered locally -- `nativeSend` is not
                     * reached, so the frame never exists on the wire.
                     */
                    if (firewallOn && isBlocked(frame?.method)) {
                        window.__rig.blockedCalls.push(frame.method)
                        // Keep the g-code list as its own artifact: it is the
                        // one every existing shoot script already prints, and
                        // "which commands would have run" is a different
                        // question from "which calls were stopped".
                        if (frame.method === 'printer.gcode.script') {
                            window.__rig.gcode.push(frame.params?.script ?? '')
                        }

                        /**
                         * Answer it, or the app's promise never settles and the
                         * button spins forever -- which would look like a bug in
                         * the panel rather than like the rig.
                         *
                         * A fixture wins when one is supplied, which is the only
                         * way a write-then-read flow can be photographed at all:
                         * `server.database.post_item` is blocked, so the reply
                         * the panel gets has to be manufactured here.
                         */
                        let result = frame.method === 'printer.gcode.script' ? 'ok' : {}
                        if (rpcKey !== null) {
                            result = JSON.parse(JSON.stringify(rpcPatch[rpcKey]))
                            window.__rig.rpc.push(rpcKey)
                        }
                        deliver({ jsonrpc: '2.0', id: frame.id, result })
                        return undefined
                    }

                    // Record the id: a JSON-RPC reply carries only the id, never
                    // the method that produced it.
                    if (frame?.method === 'printer.objects.subscribe') subscribeIds.add(frame.id)
                    if (rpcKey !== null) rpcIds.set(frame.id, rpcKey)
                    if (frame?.method === 'server.info' && extraComponents.length) serverInfoIds.add(frame.id)

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

                /**
                 * Push a server-initiated frame into the app.
                 *
                 * Needed because some states only exist as a NOTIFICATION -- a
                 * render in progress, a new frame captured -- and there is no
                 * request whose reply could carry them. Poking the store
                 * directly would prove the template renders; this proves the
                 * notification is actually wired to it.
                 */
                window.__rigSockets = window.__rigSockets ?? []
                window.__rigSockets.push({ deliver })

                socket.addEventListener('message', (event) => {
                    if (!appHandler) return

                    let data = event.data
                    try {
                        const frame = JSON.parse(data)
                        let rewritten = false

                        if (subscribeIds.has(frame?.id) && isObject(frame?.result?.status)) {
                            merge(frame.result.status, statusPatch)
                            window.__rig.injected = true
                            rewritten = true
                        }

                        /**
                         * Moonraker calls the panel needs but this server cannot
                         * answer. Two cases, and both are real:
                         *   - the call SUCCEEDS and the fake is merged over it
                         *     (adding a sensor to a server that has some);
                         *   - the call FAILS, because the component is not
                         *     loaded at all, and the fake replaces the error.
                         * The second is what happens here: `server.sensors.list`
                         * and every `machine.timelapse.*` are 404 on this host.
                         */
                        if (rpcIds.has(frame?.id)) {
                            const patch = rpcPatch[rpcIds.get(frame.id)]
                            if (isObject(frame.result)) merge(frame.result, patch)
                            else {
                                frame.result = JSON.parse(JSON.stringify(patch))
                                delete frame.error
                            }
                            window.__rig.rpc.push(rpcIds.get(frame.id))
                            rewritten = true
                        }

                        // Components are what a panel gates on before it calls
                        // anything, so a faked call is useless without this.
                        if (serverInfoIds.has(frame?.id) && Array.isArray(frame?.result?.components)) {
                            for (const name of extraComponents) {
                                if (!frame.result.components.includes(name)) frame.result.components.push(name)
                            }
                            rewritten = true
                        }

                        if (rewritten) data = JSON.stringify(frame)
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
        blockGcode,
        rpc,
        components,
        blocked,
        BLOCK_EXEMPTIONS
    )
}

/**
 * Read back what the page tried to send. Empty is the expected result.
 *
 * `gcode` is what it tried to run; `blockedCalls` is every method the firewall
 * stopped, g-code included. Print BOTH from a shoot script -- a run that
 * reports "no g-code" while `blockedCalls` holds `server.job_queue.start` is
 * not the quiet run it looks like.
 */
export async function rigReport(page) {
    return page.evaluate(
        () => window.__rig ?? { injected: false, gcode: [], blocked: null, rpc: [], blockedCalls: [] }
    )
}
