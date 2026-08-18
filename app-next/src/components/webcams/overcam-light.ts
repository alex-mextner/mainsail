/**
 * /overcam work light: turn the RGB strip white while someone is watching the
 * camera, and - the part that is actually hard - NEVER turn off a light that is
 * on for a reason.
 *
 * The user's request, verbatim (2026-08-18, docs/tasks.md M2b):
 *
 *   «а еще при открытии этого экрана надо включать белую подсветку если никакая
 *    не включена. если страница не в фокусе гасить через 5 минут и снова
 *    зажигать при активности»
 *
 * So: (1) on open, if nothing is lit, light it white; if something is already
 * lit, do not touch it. (2) five minutes unfocused -> dark. (3) activity ->
 * lit again, but only if WE were the one who darkened it.
 *
 * ===========================================================================
 * WHO ELSE DRIVES THIS STRIP - the whole reason this file is not ten lines
 * ===========================================================================
 * `[led rgb_strip]` (printer-configs/rgb-status.cfg) is not ours. It is a
 * shared object with several independent writers, and two of them are saying
 * something that must never be silenced by a screensaver timer:
 *
 *   - LIFECYCLE MACROS, printer-configs/rgb-status.cfg:
 *       RGB_PREPARING  1,1,0   yellow, first line of PRINT_START
 *       RGB_PRINTING   1,1,1   white,  last line of PRINT_START
 *       RGB_ERROR      1,0,0   red,    an interrupted print
 *       RGB_DONE       0,1,0   green,  a finished print
 *       RGB_OFF        0,0,0
 *   - MAINSAIL'S OWN COLOR PICKER, src/components/dialogs/
 *     MiscellaneousLightNeopixelDialog.vue - a human choosing a colour by hand.
 *   - THE FIRE ALARM, orangepi-services/smoke-siren/smoke-siren-daemon.py -
 *     see the alarm section below; it is a special case in every sense.
 *
 * Note what RGB_PRINTING is: 1,1,1. Exactly the white this feature wants. So
 * "is the strip white?" cannot possibly distinguish "the camera page lit it"
 * from "a print is running". Colour alone is not an answer.
 *
 * ===========================================================================
 * OWNERSHIP: THE SENTINEL IS THE TOKEN
 * ===========================================================================
 * We do not write 1,1,1. We write SENTINEL_CHANNEL on all three channels - a
 * value that is
 *
 *   (a) physically identical to full white. smoke-siren-daemon.py thresholds
 *       each channel at RGB_THRESHOLD = 0.5 before driving the MOSFET gates,
 *       and 0.973 >= 0.5, so all three channels are hard on. The strip is
 *       white to the eye; nothing about the picture on the camera changes.
 *   (b) not reachable by any other writer on this machine. The macros write
 *       only exact 0.0 and 1.0. The picker quantises to two decimals -
 *       `Math.round((colorData.red / 255) * 100) / 100` in
 *       MiscellaneousLightNeopixelDialog.vue, and `newVal.toFixed(2)` in
 *       MiscellaneousSlider.vue - so every value a human can click is k/100.
 *       0.973 is deliberately OFF that grid.
 *
 *       🔴 This is why the sentinel is 0.973 and not 0.97: 0.97 IS on the
 *       two-decimal grid (any 8-bit value 246..249 rounds to it), i.e. a user
 *       dragging the picker can land on it exactly, and our "is this ours?"
 *       test would then steal a colour a human chose. Checked against the
 *       source, not assumed. Do not "tidy" this constant to fewer decimals.
 *
 * Ownership is therefore not stored anywhere in the browser. It lives in the
 * device itself: the strip is ours if and only if it is currently holding the
 * sentinel. That falls out nicely:
 *
 *   - a reload, a second tab, a different browser: all agree, no coordination.
 *   - ANY other writer revokes our claim for free, just by writing. PRINT_START
 *     fires mid-session -> colour becomes 1,1,1 -> not the sentinel any more ->
 *     we will not touch it again. No hooks, no subscriptions, no races.
 *
 * Compared with an epsilon rather than ===, because the value makes a round
 * trip through Python floats and JSON. Verified live on this printer: SET_LED
 * 0.973 reads back as exactly 0.973 in color_data. The epsilon is 1e-6, which
 * still excludes 0.97 and 0.98 by four orders of magnitude.
 *
 * ===========================================================================
 * THE FIRE ALARM - why a blur timer cannot darken it
 * ===========================================================================
 * Three independent layers, stated worst-case-first:
 *
 *   1. STRUCTURAL. The alarm blink does not go through Klipper at all.
 *      smoke-siren-daemon.py drives the GPIO gates directly and, while
 *      alarm_source() is non-None, ignores color_data entirely ("the
 *      REQUEST-flag mirroring is skipped entirely - fire alarm wins over
 *      whatever colour was requested, unconditionally"). A SET_LED from this
 *      file physically cannot stop the blinking.
 *   2. EXPLICIT REFUSAL, and this is the half that carries the weight. The
 *      case that matters is not the shutdown - during a SMOKE-ALARM shutdown
 *      Klipper refuses gcode anyway, so our release could not execute even if
 *      it wanted to. It is the BENCH path: `output_pin smoke_alarm_active` > 0
 *      with Klipper still `ready`, where a release WOULD execute. So both
 *      signals are read - the same two alarm_source() itself uses - and while
 *      either is up we neither claim nor release.
 *   3. REDUNDANT. A colour set during an alarm is not the sentinel anyway, so
 *      the ownership test alone would already refuse.
 *
 * Layer 2 could not be exercised against the hardware: raising that pin needs
 * SET_PIN, and this session was restricted to SET_LED while an endurance run
 * was on the bed. It is written as a pure predicate over a snapshot
 * (isAlarmActive) precisely so the harness can drive it with a fabricated
 * alarm state instead. Treat it as tested-in-software, not proven-on-metal.
 *
 * ===========================================================================
 * THE OFF PATH READS FRESH, NEVER THE STORE
 * ===========================================================================
 * The tempting implementation compares against Mainsail's websocket-backed
 * store, which is normally current within milliseconds. It is wrong here, and
 * wrong in exactly the worst place: the release fires after five minutes
 * hidden, which is precisely when the browser may have frozen the tab and
 * dropped or reconnected the socket. A stale store still holding our sentinel
 * while PRINT_START has since written 1,1,1 means we darken the status light -
 * the one outcome this whole file exists to prevent.
 *
 * So every decision - claim and release alike - is made from a snapshot
 * fetched right then, one round trip. Unknown state (query failed, socket
 * down, object missing) is NOT treated as "probably fine": it refuses. The
 * fail-safe direction for a light is to leave it as it is.
 */

/** All three channels of our white. See the ownership section above; the exact
 *  number is load-bearing and off the picker's two-decimal grid on purpose. */
export const SENTINEL_CHANNEL = 0.973

/** Mirrors smoke-siren-daemon.py's RGB_THRESHOLD - the point at which the
 *  daemon considers a channel "on" and switches its MOSFET. Anything dimmer is
 *  physically dark, so "is the strip lit?" has to use the daemon's number, not
 *  a nonzero test. */
export const ON_THRESHOLD = 0.5

/** Float round-trip tolerance, not a fuzzy match: 0.97 and 0.98 are 4 orders
 *  of magnitude away and stay distinguishable. */
export const MATCH_EPSILON = 1e-6

/** Five minutes, the number the user asked for. The harness may shorten it via
 *  ?lightIdleMs=, which is why there is a test asserting this default is still
 *  300000 - a shortened run must not be able to ship a 3-second production
 *  timeout. */
export const DEFAULT_IDLE_TIMEOUT_MS = 300_000

/** Must match printer-configs/smoke-alarm.cfg's _SMOKE_ESTOP and
 *  smoke-siren-daemon.py's SHUTDOWN_MARKER. See the CONTRACT note in that cfg
 *  before ever changing this string. */
export const SHUTDOWN_MARKER = 'SMOKE ALARM'

const OFF_GCODE = 'SET_LED LED=rgb_strip RED=0 GREEN=0 BLUE=0 SYNC=0'

/**
 * The deferred switch-off, held on the printer - see [delayed_gcode
 * _overcam_light_off] and _OVERCAM_LIGHT_OFF in printer-configs/rgb-status.cfg.
 *
 * 🔴 WHY A TIMER ON THE PRINTER AT ALL. The user's correction, 2026-08-18:
 *
 *   «но при закрытии свет должен еще 5 минут гореть а не гаснуть сразу»
 *
 * Closing the page is not a command to go dark; it starts the same five
 * minutes that losing focus does. That cannot be done in the page - a
 * setTimeout dies with the tab, and at minute five there is no tab left. So
 * the countdown is held where it outlives the browser entirely, and this side
 * only arms and cancels it.
 *
 * And this is exactly why arming is allowed from an unload handler when
 * switching off never was: arming SCHEDULES a decision rather than making one,
 * so it needs no fresh read. The ownership check happens on the printer, at
 * fire time, against live state.
 */
const REMOTE_TIMER_ID = '_overcam_light_off'
const remoteArmGcode = (seconds: number) => `UPDATE_DELAYED_GCODE ID=${REMOTE_TIMER_ID} DURATION=${seconds}`
/** DURATION=0 cancels without firing - see electronics-fan.cfg's note. */
const REMOTE_CANCEL_GCODE = `UPDATE_DELAYED_GCODE ID=${REMOTE_TIMER_ID} DURATION=0`

/** SYNC=0 on every write, without exception. SYNC=1 (led.py's own default)
 *  routes the colour change through toolhead.register_lookahead_callback, which
 *  both queues it behind the entire print move buffer - minutes, on a real
 *  print - and flips idle_timeout to "Printing", breaking the TURN_OFF_HEATERS
 *  safety net and scripts/deploy.sh's gate. rgb-status.cfg's header has the
 *  full derivation; this project has already paid for that lesson once. */
const ON_GCODE =
    `SET_LED LED=rgb_strip RED=${SENTINEL_CHANNEL} GREEN=${SENTINEL_CHANNEL} BLUE=${SENTINEL_CHANNEL} SYNC=0`

/**
 * Everything the decision functions are allowed to look at. Each field is
 * nullable and null means "could not be read", which is always answered with a
 * refusal rather than a guess.
 */
export interface LightSnapshot {
    /** `led rgb_strip`.color_data[0] - [r, g, b, w], fractional 0..1. */
    colorData: readonly number[] | null
    /** `output_pin smoke_alarm_active`.value. */
    smokeAlarmPin: number | null
    /** printer.info state / state_message. */
    klippyState: string | null
    klippyMessage: string | null
}

export type ClaimDecision = 'claim' | 'adopt' | 'skip:unknown' | 'skip:alarm' | 'skip:lit'
export type ReleaseDecision = 'release' | 'skip:unknown' | 'skip:alarm' | 'skip:not-ours' | 'skip:peer-active'

/** Both signals smoke-siren-daemon.py's alarm_source() uses, same order. */
export function isAlarmActive(snap: LightSnapshot): boolean {
    if (snap.smokeAlarmPin !== null && snap.smokeAlarmPin > 0) return true

    const state = snap.klippyState
    if (state === 'shutdown' || state === 'error') {
        if ((snap.klippyMessage ?? '').includes(SHUTDOWN_MARKER)) return true
    }

    return false
}

/** null = unreadable. Uses the daemon's threshold, not "nonzero". */
export function isLit(snap: LightSnapshot): boolean | null {
    const color = snap.colorData
    if (!color || color.length < 3) return null

    return color.slice(0, 3).some((channel) => Number(channel) >= ON_THRESHOLD)
}

/** Is the strip currently holding OUR token? null = unreadable. */
export function isOurs(snap: LightSnapshot): boolean | null {
    const color = snap.colorData
    if (!color || color.length < 3) return null

    return color.slice(0, 3).every((channel) => Math.abs(Number(channel) - SENTINEL_CHANNEL) < MATCH_EPSILON)
}

/**
 * Should we light it? 'adopt' means it is already showing our sentinel - most
 * likely a second tab, or this tab after a reload - so there is nothing to
 * send, but the strip is ours to manage and the idle timer applies.
 */
export function decideClaim(snap: LightSnapshot): ClaimDecision {
    if (isAlarmActive(snap)) return 'skip:alarm'

    const ours = isOurs(snap)
    const lit = isLit(snap)
    if (ours === null || lit === null) return 'skip:unknown'

    if (ours) return 'adopt'
    // "если никакая не включена" - anything already lit belongs to someone
    // else (a lifecycle macro, or a human at the picker) and is left alone.
    if (lit) return 'skip:lit'

    return 'claim'
}

/**
 * Should we darken it? `peerActive` is true when another /overcam tab reported
 * activity inside the idle window - without it, one tab navigating away would
 * darken the strip out from under a second tab someone is watching.
 */
export function decideRelease(snap: LightSnapshot, peerActive: boolean): ReleaseDecision {
    if (isAlarmActive(snap)) return 'skip:alarm'

    const ours = isOurs(snap)
    if (ours === null) return 'skip:unknown'
    // The single line that keeps every status colour safe: if anything at all
    // has written since we claimed, the token is gone and so is our claim.
    if (!ours) return 'skip:not-ours'

    if (peerActive) return 'skip:peer-active'

    return 'release'
}

/** Injected so the whole controller can be driven by the harness. */
export interface OvercamLightIo {
    querySnapshot(): Promise<LightSnapshot>
    sendGcode(script: string): Promise<void>
    now(): number
    /** Newest activity timestamp from any OTHER tab, or null. */
    readPeerActivity(): number | null
    /** Record this tab's own activity. */
    writeOwnActivity(ts: number): void
    /** Drop this tab from the shared activity record. */
    clearOwnActivity(): void
    /**
     * Fire-and-forget send that still works while the page is being torn down,
     * where an awaited websocket round trip would simply be dropped. Only ever
     * used to ARM the printer-side timer - never to switch anything off, which
     * would need a fresh read this context cannot do.
     */
    sendGcodeBeacon?: (script: string) => void
    log?(event: string, detail: Record<string, unknown>): void
}

export interface OvercamLightOptions {
    idleTimeoutMs?: number
}

/**
 * Reads ?lightIdleMs= off the URL so the harness can collapse five minutes into
 * a few seconds. Deliberately a query parameter and not a build flag: it takes
 * a deliberate act to enable, and it cannot change the default that ships.
 */
export function resolveIdleTimeoutMs(search: string): number {
    try {
        const raw = new URLSearchParams(search).get('lightIdleMs')
        if (raw === null) return DEFAULT_IDLE_TIMEOUT_MS

        const parsed = Number(raw)
        if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_IDLE_TIMEOUT_MS

        return parsed
    } catch {
        return DEFAULT_IDLE_TIMEOUT_MS
    }
}

/**
 * The state machine. Framework-free on purpose: both the Vue 2 build on :80 and
 * the Vue 3 port run this same file, and so does the test harness.
 */
export class OvercamLight {
    private readonly io: OvercamLightIo
    private readonly idleTimeoutMs: number

    private timer: ReturnType<typeof setTimeout> | null = null
    private stopped = false
    /** Rule 3 is "снова зажигать при активности" - re-light on activity - but
     *  only for a light WE darkened. If the user turned it off by hand, or a
     *  macro did, waking the tab must not fight them for it. */
    private darkenedByUs = false
    /** True once we have asked the printer to darken this light later. */
    private handedOff = false
    private inFlight: Promise<void> = Promise.resolve()

    phase: 'init' | 'owned' | 'released' | 'skipped' = 'init'
    lastDecision: ClaimDecision | ReleaseDecision | 'armed' | 'none' = 'none'
    active = true

    constructor(io: OvercamLightIo, options: OvercamLightOptions = {}) {
        this.io = io
        this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    }

    get idleMs(): number {
        return this.idleTimeoutMs
    }

    /** Serialised: a claim and a release must never overlap on the wire. */
    private enqueue(task: () => Promise<void>): Promise<void> {
        this.inFlight = this.inFlight.then(task, task)
        return this.inFlight
    }

    async start(): Promise<void> {
        this.stopped = false
        this.io.writeOwnActivity(this.io.now())
        await this.claimWithRetry()
    }

    /**
     * A claim that survives a socket that is not up yet.
     *
     * 🔴 The page mounts before Moonraker's websocket finishes connecting, so
     * the very first query can reject with "not connected" - which this code
     * correctly reads as "unknown state, refuse", and would then never try
     * again. The visible symptom is the whole feature silently not happening on
     * a cold load, intermittently, depending on whether the socket won the
     * race. Caught by scripts/check-overcam-light.mjs against the Vue 3 port,
     * where the connect is slower and it lost the race most times.
     *
     * Retries only while the answer is 'unknown'. Every DEFINITE answer -
     * claimed, adopted, someone else's light, an alarm - stops it immediately,
     * so this can never turn into a poll or a second SET_LED.
     */
    private async claimWithRetry(attempts = 8, delayMs = 400): Promise<void> {
        for (let attempt = 0; attempt < attempts; attempt++) {
            if (this.stopped) return

            await this.claim()
            if (this.lastDecision !== 'skip:unknown') return

            await new Promise((resolve) => setTimeout(resolve, delayMs))
        }
    }

    /**
     * Leaving the page HANDS THE LIGHT OVER - it does not switch it off.
     *
     * 🔴 This used to release immediately, and that was wrong. The user's
     * correction, 2026-08-18: «но при закрытии свет должен еще 5 минут гореть
     * а не гаснуть сразу». Walking away from the camera screen starts the same
     * five minutes as looking away from it; you are still standing at the
     * printer either way, and going dark the instant the tab closes is the
     * behaviour that was actually annoying.
     *
     * So this arms the printer-side timer and leaves. Nothing here switches
     * anything off, which also means nothing here has to do the fresh read an
     * unload handler could never do - see REMOTE_TIMER_ID above.
     */
    async stop(): Promise<void> {
        this.stopped = true
        this.clearTimer()
        await this.handOff()
        this.io.clearOwnActivity()
    }

    /**
     * Ask the printer to darken this light in `idleMs`, unless something else
     * has claimed it by then.
     *
     * Skipped when another /overcam tab is still being watched: without that,
     * closing one tab would start a countdown against the tab someone is
     * actually looking at. The peer's heartbeat is local (shared localStorage),
     * so this costs no round trip.
     *
     * Not gated on a snapshot on purpose - the printer re-checks the token when
     * the timer fires, so arming on a stale belief is harmless. Worst case we
     * arm a timer that then declines to do anything.
     */
    private async handOff(): Promise<void> {
        if (this.phase !== 'owned') return

        const peerTs = this.io.readPeerActivity()
        if (peerTs !== null && this.io.now() - peerTs < this.idleTimeoutMs) {
            this.note('skip:peer-active', { armed: false })
            return
        }

        this.handedOff = true
        this.note('armed', { seconds: Math.round(this.idleTimeoutMs / 1000) })
        await this.io.sendGcode(remoteArmGcode(Math.round(this.idleTimeoutMs / 1000))).catch(() => {
            /* the page is going away; a failed arm just means the light stays on */
        })
    }

    /**
     * The same hand-off, from a context that cannot await anything: the tab is
     * closing or navigating away for real, so this goes out as a beacon.
     *
     * This is the path that makes «при закрытии свет должен еще 5 минут гореть»
     * work at all - Vue's unmount hook does not run on a hard navigation or a
     * closed tab, so stop() never gets a chance there.
     *
     * Deliberately NOT suppressed when stop() has already armed the timer: on a
     * real navigation both run, and a websocket frame queued by an unloading
     * page is the one of the two that can silently vanish. Re-arming the same
     * timer with the same duration is idempotent, so paying for it twice is
     * cheaper than working out which one survived.
     */
    handOffSync(): void {
        if (this.phase !== 'owned') return

        const peerTs = this.io.readPeerActivity()
        if (peerTs !== null && this.io.now() - peerTs < this.idleTimeoutMs) return

        this.handedOff = true
        this.io.sendGcodeBeacon?.(remoteArmGcode(Math.round(this.idleTimeoutMs / 1000)))
    }

    /** Call off a pending printer-side switch-off - someone is watching again. */
    private async cancelHandOff(): Promise<void> {
        if (!this.handedOff) return

        this.handedOff = false
        await this.io.sendGcode(REMOTE_CANCEL_GCODE).catch(() => {})
    }

    private clearTimer() {
        if (this.timer !== null) {
            clearTimeout(this.timer)
            this.timer = null
        }
    }

    private note(decision: ClaimDecision | ReleaseDecision | 'armed', detail: Record<string, unknown> = {}) {
        this.lastDecision = decision
        this.io.log?.(decision, detail)
    }

    private claim(): Promise<void> {
        return this.enqueue(async () => {
            if (this.stopped) return

            let snap: LightSnapshot
            try {
                snap = await this.io.querySnapshot()
            } catch (err) {
                this.note('skip:unknown', { error: String(err) })
                this.phase = 'skipped'
                return
            }

            const decision = decideClaim(snap)
            this.note(decision, { colorData: snap.colorData })

            if (decision === 'claim') {
                await this.io.sendGcode(ON_GCODE)
                this.phase = 'owned'
                this.darkenedByUs = false
                return
            }

            if (decision === 'adopt') {
                this.phase = 'owned'
                this.darkenedByUs = false
                return
            }

            this.phase = 'skipped'
        })
    }

    private release(): Promise<void> {
        return this.enqueue(async () => {
            let snap: LightSnapshot
            try {
                snap = await this.io.querySnapshot()
            } catch (err) {
                this.note('skip:unknown', { error: String(err) })
                return
            }

            const peerTs = this.io.readPeerActivity()
            const peerActive = peerTs !== null && this.io.now() - peerTs < this.idleTimeoutMs

            const decision = decideRelease(snap, peerActive)
            this.note(decision, { colorData: snap.colorData, peerActive })

            if (decision !== 'release') {
                // Anything but a clean release means the strip is not ours to
                // re-light later either.
                if (decision === 'skip:not-ours' || decision === 'skip:alarm') {
                    this.darkenedByUs = false
                    this.phase = 'skipped'
                }
                return
            }

            await this.io.sendGcode(OFF_GCODE)
            this.darkenedByUs = true
            this.phase = 'released'
        })
    }

    /** The page became visible / focused / was touched. */
    onActive(): void {
        this.active = true
        this.clearTimer()
        this.io.writeOwnActivity(this.io.now())

        if (this.stopped) return

        // Someone is watching again, so call off the printer-side countdown.
        void this.cancelHandOff()

        // Rule 3. Re-light only what we darkened; a light someone else turned
        // off stays off. Retrying here too, for the same reason as start():
        // waking a tab that was frozen is exactly when the socket is still
        // reconnecting, and a single "not connected" would drop the re-light.
        if (this.phase === 'released' && this.darkenedByUs) void this.claimWithRetry()
    }

    /**
     * The page stopped being watched. Starts the five minutes - twice over, and
     * the redundancy is the design rather than an oversight:
     *
     *   - the LOCAL timer handles the case where the page is still here when
     *     the wait runs out (looked away, tab in the background). It can do the
     *     full fresh-read check before switching anything off.
     *   - the PRINTER-SIDE timer handles the case the local one cannot survive:
     *     the tab being closed. It re-checks the token itself when it fires.
     *
     * Whichever runs first wins; the other finds the token gone and declines,
     * because both refuse on anything but our own 0.973. So the light goes dark
     * once, five minutes after the last person stopped watching it, whether or
     * not the page is still open.
     */
    onInactive(): void {
        if (this.stopped) return

        this.active = false
        this.clearTimer()
        void this.handOff()
        this.timer = setTimeout(() => {
            this.timer = null
            void this.release()
        }, this.idleTimeoutMs)
    }

    /** Test seam: fire the pending idle timer now instead of waiting. */
    fireIdleNow(): Promise<void> {
        this.clearTimer()
        return this.release()
    }
}
