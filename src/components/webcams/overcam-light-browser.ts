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
    resolveIdleTimeoutMs,
    type LightSnapshot,
    type OvercamLightIo,
} from '@/components/webcams/overcam-light'

/** One shared record for every tab of this origin: { tabId: lastActivityMs }. */
const ACTIVITY_KEY = 'overcam.light.activity'

/**
 * Which signals mean "someone is watching".
 *
 * 🔴 visibilityState is the primary signal and window blur is deliberately
 * event-only. The difference matters for the machine this is actually for: a
 * tablet propped up by the printer. `document.hasFocus()` can read false on a
 * page a user is plainly looking at (kiosk shells, on-screen keyboards, and -
 * observed while building this - any CDP-driven window), and polling it at
 * startup would then declare the page idle and darken the light every five
 * minutes with the user standing right there, which is the primary use case
 * broken. So focus is only ever believed when an actual blur event fires after
 * an actual focus - a page that never receives focus events is treated as
 * active, not as abandoned.
 */
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const

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

/** Shape of the harness handle hung on window - see attachOvercamLight. */
export interface OvercamLightHandle {
    light: OvercamLight
    fireIdleNow: () => Promise<void>
    snapshot: () => Promise<LightSnapshot>
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

    /** Only ever true once a real focus/blur pair has been seen - see the note
     *  on ACTIVITY_EVENTS above. */
    let blurred = false

    const evaluate = () => {
        const hidden = document.visibilityState === 'hidden'
        if (hidden || blurred) light.onInactive()
        else light.onActive()

        publish()
    }

    const onActivity = () => {
        blurred = false
        light.onActive()
        publish()
    }

    const onBlur = () => {
        blurred = true
        evaluate()
    }

    const onFocus = () => {
        blurred = false
        evaluate()
    }

    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', evaluate)
    ACTIVITY_EVENTS.forEach((name) => window.addEventListener(name, onActivity, { passive: true }))

    // Exposed for scripts/check-overcam-light.mjs: collapsing the wait is what
    // makes a five-minute rule testable in a few seconds. Reading state is the
    // point; fireIdleNow only runs the release the timer would have run anyway.
    ;(window as WindowWithLight).__overcamLight = {
        light,
        fireIdleNow: () => light.fireIdleNow().then(publish),
        snapshot: () => io.querySnapshot(),
    }

    publish()
    void light.start().then(publish)

    return () => {
        window.removeEventListener('blur', onBlur)
        window.removeEventListener('focus', onFocus)
        document.removeEventListener('visibilitychange', evaluate)
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
