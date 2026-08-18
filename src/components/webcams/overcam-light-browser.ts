/**
 * Browser wiring for the /overcam work light. The decisions all live in
 * overcam-light.ts; this file only supplies the outside world: which events
 * count as "activity", how tabs see each other, and how the harness sees us.
 *
 * Split out from the state machine so the interesting logic can be tested with
 * fabricated snapshots and a fake clock, with no DOM in the way.
 */
import {
    OvercamLight,
    decideClaim,
    decideRelease,
    isAlarmActive,
    isLit,
    isOurs,
    resolveIdleTimeoutMs,
    DEFAULT_IDLE_TIMEOUT_MS,
    SENTINEL_CHANNEL,
    type ClaimDecision,
    type LightSnapshot,
    type OvercamLightIo,
    type ReleaseDecision,
} from '@/components/webcams/overcam-light'

/** One shared record for every tab of this origin: { tabId: lastActivityMs }. */
const ACTIVITY_KEY = 'overcam.light.activity'

/**
 * Which signals mean "someone is watching".
 *
 * 🔴 visibilityState is the primary signal, and `document.hasFocus()` is never
 * polled - not at startup, not anywhere. The difference matters for the machine
 * this is actually for: a tablet propped up by the printer. hasFocus() can read
 * false on a page a user is plainly looking at (kiosk shells, on-screen
 * keyboards, and - observed while building this - any CDP-driven window), and
 * polling it would declare that page idle and darken the light every five
 * minutes with the user standing right there. That is the primary use case,
 * broken. So the page starts active and only a real `blur` EVENT can make it
 * otherwise: a page that never receives focus events is treated as watched,
 * not as abandoned.
 */
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const

/** How often a stream of pointer movement is allowed to do real work. */
const ACTIVITY_THROTTLE_MS = 5_000

/** Heartbeat period: often enough that a peer never looks stale inside the
 *  idle window, capped so the production case is a write every 30s and not
 *  every 100s. */
function heartbeatMs(idleTimeoutMs: number): number {
    return Math.max(250, Math.min(30_000, Math.floor(idleTimeoutMs / 3)))
}

/**
 * Exactly the three Moonraker calls this feature makes, and nothing else.
 *
 * Narrow on purpose rather than a generic `call(method, params)`: the two ports
 * reach Moonraker differently (Vue 2 `$socket.emitAndWait`, Vue 3 the
 * connection store's `call`), and naming the three operations lets each side
 * stay fully typed instead of meeting in the middle at `any`.
 */
export interface LightTransport {
    queryObjects(objects: Record<string, string[] | null>): Promise<{ status: Record<string, unknown> }>
    printerInfo(): Promise<{ state: string; state_message: string }>
    sendGcode(script: string): Promise<void>
}

export interface BrowserLightOptions {
    transport: LightTransport
    /** Overridden by the harness only. */
    search?: string
}

/**
 * Shape of the harness handle hung on window - see attachOvercamLight.
 *
 * The decision functions are exported here, not just the running instance,
 * because the case that most needs testing is the one that cannot be staged on
 * the hardware: a fire alarm. Raising `smoke_alarm_active` needs SET_PIN. Being
 * pure functions over a snapshot, they can be fed a fabricated alarm instead -
 * which is how scripts/check-overcam-light.mjs covers it.
 */
export interface OvercamLightHandle {
    light: OvercamLight
    fireIdleNow: () => Promise<void>
    snapshot: () => Promise<LightSnapshot>
    constants: { sentinel: number; defaultIdleMs: number }
    decide: {
        claim: (snap: LightSnapshot) => ClaimDecision
        release: (snap: LightSnapshot, peerActive: boolean) => ReleaseDecision
        alarm: (snap: LightSnapshot) => boolean
        lit: (snap: LightSnapshot) => boolean | null
        ours: (snap: LightSnapshot) => boolean | null
    }
}

interface WindowWithLight extends Window {
    __overcamLight?: OvercamLightHandle
}

/** color_data[0] as Klipper reports it, once we have checked it is really that. */
function readColorData(strip: unknown): number[] | null {
    if (typeof strip !== 'object' || strip === null) return null

    const colorData = (strip as { color_data?: unknown }).color_data
    if (!Array.isArray(colorData)) return null

    const first = colorData[0]
    if (!Array.isArray(first)) return null

    return first.map((channel) => Number(channel))
}

function readPinValue(pin: unknown): number | null {
    if (typeof pin !== 'object' || pin === null) return null

    const value = (pin as { value?: unknown }).value
    return typeof value === 'number' ? value : null
}

/**
 * The one round trip every decision is made from. `printer.objects.query` for
 * the strip and the alarm pin, `printer.info` for the shutdown half of the
 * alarm test - see the alarm section in overcam-light.ts for why both halves
 * are read rather than just the pin.
 *
 * Deliberately does not fall back to the Vuex/Pinia store on failure: a refusal
 * is the safe answer, a stale colour is not.
 */
async function querySnapshot(transport: LightTransport): Promise<LightSnapshot> {
    const [objects, info] = await Promise.all([
        transport.queryObjects({ 'led rgb_strip': null, 'output_pin smoke_alarm_active': null }),
        transport.printerInfo().catch(() => null),
    ])

    const status = objects?.status ?? {}

    // An object Klipper does not know about comes back as {} with HTTP 200 -
    // confirmed live on this printer, same behaviour smoke-siren-daemon.py
    // documents. That lands here as null, i.e. "unreadable", i.e. refuse.
    return {
        colorData: readColorData(status['led rgb_strip']),
        smokeAlarmPin: readPinValue(status['output_pin smoke_alarm_active']),
        klippyState: info?.state ?? null,
        klippyMessage: info?.state_message ?? null,
    }
}

function readActivityMap(): Record<string, number> {
    try {
        const raw = window.localStorage.getItem(ACTIVITY_KEY)
        if (!raw) return {}

        const parsed = JSON.parse(raw)
        return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
        return {}
    }
}

function writeActivityMap(map: Record<string, number>) {
    try {
        window.localStorage.setItem(ACTIVITY_KEY, JSON.stringify(map))
    } catch {
        /* private mode, quota, whatever - the peer check degrades to "no peers" */
    }
}

/**
 * Attaches the light to the page and returns a teardown.
 *
 * State is published on <html> as data-light-* rather than on the overlay's own
 * root. That keeps the harness identical across the Vue 2 build and the Vue 3
 * port (their overlay markup differs) and, more practically, adds no wrapper
 * element to a component whose whole job is pixel-exact letterbox geometry -
 * see scripts/measure-overcam.mjs, which asserts on that geometry.
 */
export function attachOvercamLight(options: BrowserLightOptions): () => void {
    const search = options.search ?? window.location.search
    const tabId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const idleTimeoutMs = resolveIdleTimeoutMs(search)

    const io: OvercamLightIo = {
        querySnapshot: () => querySnapshot(options.transport),
        sendGcode: (script: string) => options.transport.sendGcode(script),
        now: () => Date.now(),
        readPeerActivity: () => {
            const map = readActivityMap()
            let newest: number | null = null
            const cutoff = Date.now() - idleTimeoutMs * 2

            for (const [id, ts] of Object.entries(map)) {
                if (id === tabId) continue
                if (typeof ts !== 'number' || ts < cutoff) continue // a tab that died without cleaning up
                if (newest === null || ts > newest) newest = ts
            }

            return newest
        },
        writeOwnActivity: (ts: number) => {
            const map = readActivityMap()
            const cutoff = ts - idleTimeoutMs * 2
            for (const [id, value] of Object.entries(map)) {
                if (typeof value !== 'number' || value < cutoff) delete map[id]
            }
            map[tabId] = ts
            writeActivityMap(map)
        },
        clearOwnActivity: () => {
            const map = readActivityMap()
            delete map[tabId]
            writeActivityMap(map)
        },
        /**
         * Moonraker over plain HTTP, same origin - nginx proxies /printer/ on
         * both the port-80 build and the :8090 port, so this is the same
         * Moonraker the websocket talks to. sendBeacon is the only send that
         * survives an unloading page; a websocket frame queued at that moment
         * is simply discarded.
         */
        sendGcodeBeacon: (script: string) => {
            try {
                navigator.sendBeacon(`/printer/gcode/script?script=${encodeURIComponent(script)}`)
            } catch {
                /* nothing useful to do here - the page is already going away */
            }
        },
    }

    const light = new OvercamLight(io, { idleTimeoutMs })

    const publish = () => {
        const root = document.documentElement
        root.dataset.lightPhase = light.phase
        root.dataset.lightDecision = light.lastDecision
        root.dataset.lightActive = light.active ? '1' : '0'
        root.dataset.lightIdleMs = String(light.idleMs)
    }

    io.log = () => publish()

    /**
     * Each signal decides on its own, and none of them keeps a flag about the
     * others.
     *
     * 🔴 An earlier version ANDed a sticky `blurred` flag into the visibility
     * handler, and it was wrong in a way that only showed up on the second
     * port: switching tabs fires `blur`, but coming back does NOT reliably
     * fire a paired `focus` before `visibilitychange`, so the stale flag
     * survived and the page that had just been brought to the front was still
     * treated as unfocused - the light stayed off. Caught by
     * scripts/check-overcam-light.mjs, which drives real tab switches rather
     * than calling the handlers; the Vue 2 build had been passing the same
     * check by luck of event ordering.
     *
     * Becoming visible therefore counts as activity outright. Blur only means
     * anything while the page is still visible, which is precisely the case
     * (another window on top, on a desktop) where blur/focus are reliable.
     */
    const onVisibilityChange = () => {
        if (document.visibilityState === 'hidden') light.onInactive()
        else light.onActive()

        publish()
    }

    /**
     * 🔴 Throttled, because `pointermove` is in the list. Unthrottled, every
     * mouse movement would run a synchronous localStorage round trip
     * (getItem + JSON.parse + JSON.stringify + setItem) plus four dataset
     * writes - 60-100 times a second, on the page whose entire job is
     * rendering an MJPEG stream, on a tablet. A five-minute rule does not need
     * sub-second resolution.
     *
     * The throttle only applies in the steady state where a mouse move has
     * nothing to change: we already hold the light and no timer is running.
     * Anything that actually needs doing - re-lighting after a release,
     * cancelling an armed timer - still goes through immediately, so the
     * response to real activity is never delayed.
     */
    let lastActivityAt = 0

    const onActivity = () => {
        const now = Date.now()
        if (light.phase === 'owned' && light.active && now - lastActivityAt < ACTIVITY_THROTTLE_MS) return

        lastActivityAt = now
        light.onActive()
        publish()
    }

    /**
     * A tab that is being watched but not touched - which is the normal way to
     * watch a camera - would otherwise let its timestamp go stale and be read
     * by other tabs as dead. The concrete failure: two /overcam tabs, you
     * navigate one away, its release sees no live peer and darkens the strip
     * out from under the tab you are still watching (whose own phase is
     * 'owned', so nothing in it would re-light).
     *
     * Scaled to the idle timeout rather than fixed, so a harness that collapses
     * five minutes into seconds gets a heartbeat that still beats inside the
     * window it is testing.
     */
    const heartbeat = setInterval(() => {
        if (light.active) io.writeOwnActivity(Date.now())
    }, heartbeatMs(idleTimeoutMs))

    /**
     * 🔴 Withdraw this tab from the shared record when the page goes away for
     * real (reload, closed tab, navigation out of the app) - Vue's unmount
     * hook does not run on a hard navigation, so without this the entry is
     * left behind with a heartbeat timestamp from the instant of the reload.
     * The next incarnation of the page then sees the ghost of its predecessor
     * as a live peer and refuses its own release, and the feature looks
     * broken: you blur the tab, the wait passes, and the light stays on.
     * Caught by the harness, where the shortened idle made a marginal
     * production race into a reproducible failure.
     *
     * ⚠️ This is the ONLY thing hooked to pagehide, and the distinction is the
     * point: it is a synchronous localStorage write, no network. The release
     * path stays off this event on purpose - it needs a fresh Moonraker read
     * it could never await here (see OvercamLight.stop()).
     */
    const onPageHide = () => {
        // Hand the light to the printer BEFORE withdrawing from the shared
        // record: the peer check inside handOffSync must still see an accurate
        // picture of who else is watching.
        light.handOffSync()
        io.clearOwnActivity()
    }

    /** bfcache restore: the entry was withdrawn on the way out, so put it back. */
    const onPageShow = () => {
        light.onActive()
        publish()
    }

    const onBlur = () => {
        light.onInactive()
        publish()
    }

    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onActivity)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onPageShow)
    document.addEventListener('visibilitychange', onVisibilityChange)
    ACTIVITY_EVENTS.forEach((name) => window.addEventListener(name, onActivity, { passive: true }))

    // Exposed for scripts/check-overcam-light.mjs: collapsing the wait is what
    // makes a five-minute rule testable in a few seconds. Reading state is the
    // point; fireIdleNow only runs the release the timer would have run anyway.
    ;(window as WindowWithLight).__overcamLight = {
        light,
        fireIdleNow: () => light.fireIdleNow().then(publish),
        snapshot: () => io.querySnapshot(),
        constants: { sentinel: SENTINEL_CHANNEL, defaultIdleMs: DEFAULT_IDLE_TIMEOUT_MS },
        decide: {
            claim: decideClaim,
            release: decideRelease,
            alarm: isAlarmActive,
            lit: isLit,
            ours: isOurs,
        },
    }

    publish()
    void light.start().then(publish)

    return () => {
        clearInterval(heartbeat)
        window.removeEventListener('blur', onBlur)
        window.removeEventListener('focus', onActivity)
        window.removeEventListener('pagehide', onPageHide)
        window.removeEventListener('pageshow', onPageShow)
        document.removeEventListener('visibilitychange', onVisibilityChange)
        ACTIVITY_EVENTS.forEach((name) => window.removeEventListener(name, onActivity))
        delete (window as WindowWithLight).__overcamLight

        void light.stop().then(() => {
            const root = document.documentElement
            delete root.dataset.lightPhase
            delete root.dataset.lightDecision
            delete root.dataset.lightActive
            delete root.dataset.lightIdleMs
        })
    }
}
