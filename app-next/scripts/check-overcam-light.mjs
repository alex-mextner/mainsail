#!/usr/bin/env node
/**
 * Prove that /overcam's work light turns itself on, hands itself off when it
 * stops being watched -- and, the part worth a script, that it refuses to turn
 * off a light that belongs to someone else.
 *
 * docs/tasks.md M2b.
 *
 * 🔴 NOTHING HERE TOUCHES THE REAL STRIP. Every outgoing `printer.gcode.script`
 * frame is recorded and DROPPED inside the browser, and every state the logic
 * reads (`led rgb_strip`, `output_pin smoke_alarm_active`, `printer.info`) is
 * answered from a stub the test sets. An earlier version of this script drove
 * the real strip through the real Moonraker, and the user -- who is in the room
 * with the strip -- complained about the flickering, twice. Interception is not
 * a convenience here, it is the requirement: the audit artifact is the list of
 * commands the page TRIED to send, and a command that never reaches the wire
 * cannot blink anything. Same technique as scripts/lib/rig.mjs.
 *
 * That also buys coverage the live version could not have: states that must not
 * be staged on a real machine (a fire alarm) and states that are awkward to
 * stage (mid-print RGB_PRINTING white) are just values in the stub.
 *
 *   node scripts/check-overcam-light.mjs <url>
 *   node scripts/check-overcam-light.mjs http://192.168.11.160:8090/overcam/mbot
 *
 * Reads window.__overcamLight and <html data-light-*>, so it runs unchanged
 * against the Vue 2 build and the Vue 3 port, like measure-overcam.mjs does.
 */
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const [url = 'http://192.168.11.160:8090/overcam/mbot'] = process.argv.slice(2)

/** Must equal SENTINEL_CHANNEL in src/components/webcams/overcam-light.ts. The
 *  page's own value is asserted against this, so the two cannot drift apart:
 *  if someone "tidies" the constant, this fails. */
const SENTINEL = 0.973
const DEFAULT_IDLE_MS = 300000
/** What the harness collapses the five minutes to. */
const TEST_IDLE_MS = 1500

const DARK = [0, 0, 0, 0]
const TOKEN = [SENTINEL, SENTINEL, SENTINEL, 0]
const PRINTING_WHITE = [1, 1, 1, 0]
const PREPARING_YELLOW = [1, 1, 0, 0]

const failures = []
const notes = []

function check(name, ok, detail = '') {
    if (ok) {
        console.log(`  ok   ${name}`)
        return true
    }
    console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ''}`)
    failures.push(name)
    return false
}

function findChrome() {
    const candidates = [
        join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Google/Chrome/Application/chrome.exe'),
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    ]
    const found = candidates.find((c) => existsSync(c))
    if (!found) throw new Error('Chrome not found')
    return found
}

/**
 * Install the stub before any of the app's code runs.
 *
 * Only three RPC methods are touched; everything else (the initial subscribe,
 * file lists, the camera) goes through to the real Moonraker untouched, because
 * the page has to actually load. Reads are harmless -- it is writes this script
 * refuses to let out.
 */
async function installStub(page, initialColor) {
    await page.evaluateOnNewDocument((color) => {
        /**
         * Both the stub's settings AND its record live in localStorage, not just
         * on window. The reason is the test that matters most here: "closing the
         * page arms the timer" can only be checked AFTER the page is gone, and a
         * window-scoped record dies with the document that made it. Same-origin
         * localStorage outlives the navigation, so the commands a dying page
         * queued can still be read afterwards.
         */
        const KEY = '__overcamStub'
        const load = () => {
            try {
                return JSON.parse(window.localStorage.getItem(KEY) ?? 'null')
            } catch {
                return null
            }
        }

        const state = load() ?? {
            /** What `led rgb_strip`.color_data[0] will report. */
            color,
            /** `output_pin smoke_alarm_active`.value. */
            alarm: 0,
            klippy: { state: 'ready', state_message: 'Printer is ready' },
            /** Every gcode the page tried to send, in order. THE audit artifact. */
            gcode: [],
            /** Every sendBeacon the page tried to make -- the tab-close path. */
            beacons: [],
        }

        const save = () => {
            try {
                window.localStorage.setItem(KEY, JSON.stringify(state))
            } catch {
                /* nothing to do */
            }
        }

        window.__stub = state
        window.__stubSave = save
        save()

        // The beacon path cannot be seen at the websocket layer, and it is
        // exactly the path the "closing must not go dark" rule depends on.
        navigator.sendBeacon = (beaconUrl) => {
            state.beacons.push(String(beaconUrl))
            save()
            return true
        }

        const Native = window.WebSocket

        function Patched(...args) {
            const socket = new Native(...args)
            /** id -> synthetic reply, for frames answered locally. */
            const faked = new Map()
            let appHandler = null

            const deliver = (frame) => {
                // A microtask, so the caller's send() has returned first -- a
                // real socket never answers inline.
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

                if (frame?.method === 'printer.gcode.script') {
                    state.gcode.push(frame.params?.script ?? '')
                    save()
                    // Answer it, or the page's promise never settles and a
                    // retry loop would look like a bug in the page.
                    deliver({ jsonrpc: '2.0', id: frame.id, result: 'ok' })
                    return undefined
                }

                // Only the light's own query is faked; Mainsail issues other
                // printer.objects.query calls for its own reasons.
                const objects = frame?.params?.objects
                if (frame?.method === 'printer.objects.query' && objects && 'led rgb_strip' in objects) {
                    // Re-read: another tab in this test may have changed it.
                    const live = load() ?? state
                    deliver({
                        jsonrpc: '2.0',
                        id: frame.id,
                        result: {
                            eventtime: 0,
                            status: {
                                'led rgb_strip': { color_data: [live.color] },
                                'output_pin smoke_alarm_active': { value: live.alarm },
                            },
                        },
                    })
                    return undefined
                }

                if (frame?.method === 'printer.info') {
                    deliver({ jsonrpc: '2.0', id: frame.id, result: (load() ?? state).klippy })
                    return undefined
                }

                return nativeSend(payload)
            }

            Object.defineProperty(socket, 'onmessage', {
                configurable: true,
                get: () => appHandler,
                set: (fn) => {
                    appHandler = fn
                },
            })
            socket.addEventListener('message', (event) => appHandler?.(event))

            return socket
        }

        Patched.prototype = Native.prototype
        Object.assign(Patched, Native)
        window.WebSocket = Patched
    }, initialColor)
}

/** /overcam holds an MJPEG stream, so the document never fires `load`. */
async function openOvercam(page, targetUrl) {
    page.goto(targetUrl, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForFunction(() => typeof window.__overcamLight !== 'undefined', { timeout: 30000 })
    // The handle appears on mount, but the first decision is async -- it
    // queries, and retries while the socket is still connecting.
    await page.waitForFunction(() => document.documentElement.dataset.lightPhase !== 'init', { timeout: 30000 })
}

/** Read the shared record straight out of localStorage, so it works on any
 *  same-origin page -- including the one that REPLACED a closed /overcam. */
const readStub = (page) =>
    page.evaluate(() => JSON.parse(window.localStorage.getItem('__overcamStub') ?? 'null') ?? { gcode: [], beacons: [] })

const setStub = (page, patch) =>
    page.evaluate((p) => {
        Object.assign(window.__stub, p)
        window.__stubSave()
    }, patch)

const gcodeOf = async (page) => (await readStub(page)).gcode
const clearLog = (page) =>
    page.evaluate(() => {
        window.__stub.gcode = []
        window.__stub.beacons = []
        window.__stubSave()
    })

const isTokenOn = (cmd) =>
    cmd.startsWith('SET_LED') && cmd.includes(`RED=${SENTINEL}`) && cmd.includes('SYNC=0')
const isOff = (cmd) => cmd.startsWith('SET_LED') && /RED=0\b/.test(cmd)
const isArm = (cmd, seconds) => cmd === `UPDATE_DELAYED_GCODE ID=_overcam_light_off DURATION=${seconds}`
const isCancel = (cmd) => cmd === 'UPDATE_DELAYED_GCODE ID=_overcam_light_off DURATION=0'

/** Give an async reaction (a decision + its send) a moment to land. */
const settle = (ms = 900) => new Promise((r) => setTimeout(r, ms))

async function main() {
    console.log(`\n/overcam work light -- ${url}`)
    console.log('all gcode is intercepted in the browser; the real strip is never written\n')

    const browser = await puppeteer.launch({
        executablePath: findChrome(),
        headless: 'new',
        args: ['--no-sandbox', '--window-size=1280,800'],
    })

    try {
        const page = await browser.newPage()
        await page.setViewport({ width: 1280, height: 800 })
        await installStub(page, DARK)

        // ------------------------------------------------------------------
        // PART A -- decisions, fabricated snapshots
        // ------------------------------------------------------------------
        console.log('A. decisions (pure predicates, fabricated snapshots)')
        await openOvercam(page, `${url}?lightIdleMs=${TEST_IDLE_MS}`)

        const constants = await page.evaluate(() => window.__overcamLight.constants)
        check(`sentinel is ${SENTINEL} in the page too`, Math.abs(constants.sentinel - SENTINEL) < 1e-9, `page says ${constants.sentinel}`)
        // Guards the harness itself: a shortened run must not be able to ship a
        // production timeout of a second and a half.
        check(`default idle wait is still ${DEFAULT_IDLE_MS} ms (5 min)`, constants.defaultIdleMs === DEFAULT_IDLE_MS, `page says ${constants.defaultIdleMs}`)

        const cases = await page.evaluate((s) => {
            const snap = (colorData, extra = {}) => ({
                colorData,
                smokeAlarmPin: 0,
                klippyState: 'ready',
                klippyMessage: 'Printer is ready',
                ...extra,
            })
            const d = window.__overcamLight.decide
            return {
                claimWhenDark: d.claim(snap([0, 0, 0])),
                claimWhenPrintingWhite: d.claim(snap([1, 1, 1])),
                claimWhenPreparingYellow: d.claim(snap([1, 1, 0])),
                claimWhenErrorRed: d.claim(snap([1, 0, 0])),
                claimWhenPickerColour: d.claim(snap([0.97, 0.5, 0.2])),
                claimWhenOurs: d.claim(snap([s, s, s])),
                claimWhenUnreadable: d.claim(snap(null)),
                claimDuringAlarmPin: d.claim(snap([0, 0, 0], { smokeAlarmPin: 1 })),

                releaseWhenOurs: d.release(snap([s, s, s]), false),
                releaseWhenPrintingWhite: d.release(snap([1, 1, 1]), false),
                releaseWhenPreparingYellow: d.release(snap([1, 1, 0]), false),
                releaseWhenErrorRed: d.release(snap([1, 0, 0]), false),
                releaseWhenPickerNear: d.release(snap([0.97, 0.97, 0.97]), false),
                releaseWhenUnreadable: d.release(snap(null), false),
                releaseDuringAlarmPin: d.release(snap([s, s, s], { smokeAlarmPin: 1 }), false),
                releaseDuringAlarmShutdown: d.release(snap([s, s, s], { klippyState: 'shutdown', klippyMessage: 'SMOKE ALARM: MQ-2 triggered' }), false),
                releaseOnOrdinaryShutdown: d.release(snap([s, s, s], { klippyState: 'shutdown', klippyMessage: 'Lost communication with MCU' }), false),
                releaseWithPeerActive: d.release(snap([s, s, s]), true),
            }
        }, SENTINEL)

        check('dark strip -> claim', cases.claimWhenDark === 'claim', cases.claimWhenDark)
        check('already ours -> adopt, no second write', cases.claimWhenOurs === 'adopt', cases.claimWhenOurs)
        check('RGB_PRINTING white -> leave alone', cases.claimWhenPrintingWhite === 'skip:lit', cases.claimWhenPrintingWhite)
        check('RGB_PREPARING yellow -> leave alone', cases.claimWhenPreparingYellow === 'skip:lit', cases.claimWhenPreparingYellow)
        check('RGB_ERROR red -> leave alone', cases.claimWhenErrorRed === 'skip:lit', cases.claimWhenErrorRed)
        check('a colour from the picker -> leave alone', cases.claimWhenPickerColour === 'skip:lit', cases.claimWhenPickerColour)
        check('unreadable strip -> refuse, do not guess', cases.claimWhenUnreadable === 'skip:unknown', cases.claimWhenUnreadable)
        check('alarm pin up -> do not even light it', cases.claimDuringAlarmPin === 'skip:alarm', cases.claimDuringAlarmPin)

        check('our token -> release', cases.releaseWhenOurs === 'release', cases.releaseWhenOurs)
        check('🔴 RGB_PRINTING white -> NEVER released', cases.releaseWhenPrintingWhite === 'skip:not-ours', cases.releaseWhenPrintingWhite)
        check('🔴 RGB_PREPARING yellow -> NEVER released', cases.releaseWhenPreparingYellow === 'skip:not-ours', cases.releaseWhenPreparingYellow)
        check('🔴 RGB_ERROR red -> NEVER released', cases.releaseWhenErrorRed === 'skip:not-ours', cases.releaseWhenErrorRed)
        // The near-miss that made the sentinel 0.973 instead of 0.97: 0.97 is
        // exactly what the picker emits for 8-bit 246..249, so it must read as
        // someone else's colour, not as ours.
        check('🔴 0.97 (reachable by the picker) is NOT our token', cases.releaseWhenPickerNear === 'skip:not-ours', cases.releaseWhenPickerNear)
        check('unreadable strip -> refuse to release', cases.releaseWhenUnreadable === 'skip:unknown', cases.releaseWhenUnreadable)
        check('🔴 alarm pin up -> refuse to release', cases.releaseDuringAlarmPin === 'skip:alarm', cases.releaseDuringAlarmPin)
        check('🔴 SMOKE ALARM shutdown -> refuse to release', cases.releaseDuringAlarmShutdown === 'skip:alarm', cases.releaseDuringAlarmShutdown)
        // An ordinary shutdown is not an alarm: our own light should still be
        // releasable, otherwise the guard is just "never work".
        check('ordinary shutdown is not an alarm', cases.releaseOnOrdinaryShutdown === 'release', cases.releaseOnOrdinaryShutdown)
        check('another tab still active -> keep it lit', cases.releaseWithPeerActive === 'skip:peer-active', cases.releaseWithPeerActive)

        // ------------------------------------------------------------------
        // PART B -- what the page actually sends
        // ------------------------------------------------------------------
        console.log('\nB. commands the page sends (recorded, never delivered)')
        const idleSeconds = Math.round(TEST_IDLE_MS / 1000)

        // B1. dark -> open -> lights the token
        await setStub(page, { color: DARK })
        await clearLog(page)
        await openOvercam(page, `${url}?lightIdleMs=${TEST_IDLE_MS}`)
        let sent = await gcodeOf(page)
        check('opening /overcam on a dark strip lights our token', sent.some(isTokenOn), JSON.stringify(sent))

        // B2. someone else's colour is left completely alone
        await setStub(page, { color: PREPARING_YELLOW })
        await openOvercam(page, `${url}?lightIdleMs=${TEST_IDLE_MS}`)
        await clearLog(page)
        await settle(TEST_IDLE_MS + 1200) // deliberately past the idle wait
        sent = await gcodeOf(page)
        check('🔴 a status colour is never written to', sent.length === 0, JSON.stringify(sent))
        const phase = await page.evaluate(() => document.documentElement.dataset.lightPhase)
        const decision = await page.evaluate(() => document.documentElement.dataset.lightDecision)
        check('and the page says why', phase === 'skipped' && decision === 'skip:lit', `${phase} / ${decision}`)

        // B3. our own light, idle wait runs out -> off
        await setStub(page, { color: DARK })
        await openOvercam(page, `${url}?lightIdleMs=${TEST_IDLE_MS}`)
        await setStub(page, { color: TOKEN })
        await clearLog(page)
        await page.evaluate(() => window.__overcamLight.fireIdleNow())
        await settle()
        sent = await gcodeOf(page)
        check('idle wait darkens our own light', sent.some(isOff), JSON.stringify(sent))

        // B4. THE ONE THAT MATTERS. We hold the token, a lifecycle macro writes
        // over it while the tab is idle, and the wait runs out. Refusing here is
        // the difference between a screensaver and blanking RGB_PRINTING
        // mid-print.
        await setStub(page, { color: DARK })
        await openOvercam(page, `${url}?lightIdleMs=${TEST_IDLE_MS}`)
        await setStub(page, { color: PRINTING_WHITE }) // as if PRINT_START had just run
        await clearLog(page)
        await page.evaluate(() => window.__overcamLight.fireIdleNow())
        await settle()
        sent = await gcodeOf(page)
        check('🔴 PRINT_START mid-session revokes the claim -- no switch-off is sent', !sent.some(isOff), JSON.stringify(sent))
        check('and it refused for the right reason', (await page.evaluate(() => document.documentElement.dataset.lightDecision)) === 'skip:not-ours')

        // B5. a fire alarm must survive the idle wait too. This is the case that
        // could never be staged live -- raising the pin needs SET_PIN.
        await setStub(page, { color: DARK })
        await openOvercam(page, `${url}?lightIdleMs=${TEST_IDLE_MS}`)
        await setStub(page, { color: TOKEN, alarm: 1 })
        await clearLog(page)
        await page.evaluate(() => window.__overcamLight.fireIdleNow())
        await settle()
        sent = await gcodeOf(page)
        check('🔴 a smoke alarm blocks the switch-off even on our own token', !sent.some(isOff), JSON.stringify(sent))
        check('and it refused for the right reason', (await page.evaluate(() => document.documentElement.dataset.lightDecision)) === 'skip:alarm')
        await setStub(page, { alarm: 0 })

        // B6. losing focus arms the PRINTER-side timer, and coming back cancels
        // it. Real tab switches, not handler calls: there is no visibility
        // override in this Chrome (Emulation.setPageVisibilityStateOverride is
        // gone), so a second tab is brought to the front, which is what a user
        // does anyway.
        await setStub(page, { color: DARK })
        await openOvercam(page, `${url}?lightIdleMs=${TEST_IDLE_MS}`)
        await setStub(page, { color: TOKEN })
        await clearLog(page)
        check('page starts visible', (await page.evaluate(() => document.visibilityState)) === 'visible')

        const other = await browser.newPage()
        await other.goto('about:blank')
        await other.bringToFront()
        await page.waitForFunction(() => document.visibilityState === 'hidden', { timeout: 5000 })
        await settle()
        sent = await gcodeOf(page)
        check('🔴 losing focus arms the printer-side timer', sent.some((c) => isArm(c, idleSeconds)), JSON.stringify(sent))

        await clearLog(page)
        await page.bringToFront()
        await page.waitForFunction(() => document.visibilityState === 'visible', { timeout: 5000 })
        await settle()
        sent = await gcodeOf(page)
        check('coming back cancels it', sent.some(isCancel), JSON.stringify(sent))
        await other.close()

        // B7. 🔴 THE CORRECTION, 2026-08-18: «но при закрытии свет должен еще 5
        // минут гореть а не гаснуть сразу». Leaving must arm the deferred
        // switch-off and must NOT darken anything on the spot.
        await setStub(page, { color: DARK })
        await openOvercam(page, `${url}?lightIdleMs=${TEST_IDLE_MS}`)
        await setStub(page, { color: TOKEN })
        await clearLog(page)
        // A REAL navigation away, which is what fires pagehide -- the SPA's own
        // unmount hook does not run on one, which is the whole reason the close
        // path had to be built separately. Somewhere same-origin, so the record
        // written by the dying page can still be read from localStorage
        // afterwards; the dashboard does not mount the light, so it adds
        // nothing of its own.
        await page.goto(new URL(url).origin + '/', { waitUntil: 'domcontentloaded' }).catch(() => {})
        await settle()
        const closing = await readStub(page)
        const closingBeacons = closing.beacons
        const closingGcode = closing.gcode
        notes.push(`on close, the page sent: ${JSON.stringify([...closingGcode, ...closingBeacons])}`)
        check(
            '🔴 closing arms the 5-minute printer-side timer',
            closingBeacons.some((b) => b.includes('UPDATE_DELAYED_GCODE') && b.includes(`DURATION%3D${idleSeconds}`)) ||
                closingGcode.some((c) => isArm(c, idleSeconds)),
            JSON.stringify([...closingGcode, ...closingBeacons])
        )
        check(
            '🔴 closing does NOT darken the strip on the spot',
            !closingGcode.some(isOff) && !closingBeacons.some((b) => b.includes('RED%3D0')),
            JSON.stringify([...closingGcode, ...closingBeacons])
        )

        // B8. two tabs: the one nobody is looking at must not start a countdown
        // against the one somebody is. Exercises the real shared-localStorage
        // plumbing, unlike part A's fabricated boolean.
        await setStub(page, { color: DARK })
        await openOvercam(page, `${url}?lightIdleMs=${TEST_IDLE_MS}`)
        await setStub(page, { color: TOKEN })

        const second = await browser.newPage()
        await second.setViewport({ width: 1280, height: 800 })
        await installStub(second, TOKEN)
        await openOvercam(second, `${url}?lightIdleMs=${TEST_IDLE_MS}`)
        await second.bringToFront()
        check('a second tab adopts rather than re-lighting', (await second.evaluate(() => document.documentElement.dataset.lightPhase)) === 'owned')

        await settle(TEST_IDLE_MS + 500) // long enough that a heartbeat must have fired
        await clearLog(page)
        await page.evaluate(() => window.__overcamLight.fireIdleNow())
        await settle()
        sent = await gcodeOf(page)
        check('🔴 a backgrounded tab will not darken one being watched', !sent.some(isOff), JSON.stringify(sent))
        check('and it refused for the right reason', (await page.evaluate(() => document.documentElement.dataset.lightDecision)) === 'skip:peer-active')
        await second.close()
    } finally {
        await browser.close()
    }

    console.log('')
    notes.forEach((n) => console.log(`note: ${n}`))
    console.log('note: the deferred switch-off itself lives in printer-configs/rgb-status.cfg')
    console.log('      (_OVERCAM_LIGHT_OFF); its token/alarm checks are covered by the linter and')
    console.log('      by review, not executed here -- running it needs a real Klipper.')

    if (failures.length) {
        console.log(`\n${failures.length} FAILED: ${failures.join(', ')}\n`)
        process.exit(1)
    }
    console.log('\nall checks passed\n')
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
