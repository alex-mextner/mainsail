#!/usr/bin/env node
/**
 * Prove that /overcam's work light turns itself on, turns itself off after the
 * idle wait -- and, the part worth a script, that it refuses to turn off a
 * light that belongs to someone else.
 *
 * docs/tasks.md M2b. The user's three rules are easy to eyeball; the failure
 * this guards against is not, because it is invisible until it matters: an
 * unfocused tab quietly darkening RGB_PRINTING, or a fire alarm. So the checks
 * are split in two, by what can actually be staged on a live machine:
 *
 *   PART A -- DECISIONS, against fabricated snapshots.
 *     The claim/release logic is pure functions over a state snapshot
 *     (src/components/webcams/overcam-light.ts), exposed on
 *     window.__overcamLight.decide. That is deliberate design, not test
 *     plumbing: the single most important case -- a fire alarm -- CANNOT be
 *     staged here. Raising `output_pin smoke_alarm_active` needs SET_PIN, and
 *     the session this was written in was restricted to SET_LED while an
 *     endurance run was on the bed. Fabricating the snapshot is the only
 *     honest way to cover it, and it is covered, but say what that means: the
 *     alarm guard is verified in software, never yet on metal.
 *
 *   PART B -- BEHAVIOUR, against the live printer and its real strip.
 *     Real SET_LED, real Moonraker, real page. Reads color_data rather than
 *     looking at the lamp: the daemon polls Klipper once a second and the
 *     wiring state of the physical strip is contradictory in the docs
 *     (rgb-status.cfg flags this itself), so color_data -- what the daemon
 *     consumes -- is the honest place to assert.
 *
 * Both parts read window.__overcamLight and <html data-light-*>, so this runs
 * unchanged against the Vue 2 build on :80 and the Vue 3 port on :8090, the
 * same way measure-overcam.mjs does.
 *
 *   node scripts/check-overcam-light.mjs <url> [moonrakerBase]
 *   node scripts/check-overcam-light.mjs http://192.168.11.160/overcam/mbot
 *
 * 🔴 THIS SCRIPT SENDS SET_LED TO A REAL PRINTER. Only SET_LED, only on
 * rgb_strip, and it puts the strip back to the colour it found at the end --
 * including when it fails. It sends no motion and touches no heater.
 */
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const [url = 'http://192.168.11.160/overcam/mbot', moonrakerBase = null] = process.argv.slice(2)

// Moonraker is reachable on the same host the page is served from; :80 proxies
// it, the Vue 3 dev server does not, hence the override.
const MOONRAKER = moonrakerBase ?? new URL(url).origin

/** Must equal SENTINEL_CHANNEL in src/components/webcams/overcam-light.ts. The
 *  page's own value is asserted against this, so the two cannot drift apart
 *  silently -- if someone "tidies" the constant, this fails. */
const SENTINEL = 0.973
const DEFAULT_IDLE_MS = 300000
/** How long the harness collapses the five minutes to. */
const TEST_IDLE_MS = 1500

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

async function rpc(method, params = {}) {
    const res = await fetch(`${MOONRAKER}/printer/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
    })
    if (!res.ok) throw new Error(`${method} -> HTTP ${res.status}`)
    return res.json()
}

async function readColor() {
    const res = await fetch(`${MOONRAKER}/printer/objects/query?led%20rgb_strip`)
    const body = await res.json()
    const color = body?.result?.status?.['led rgb_strip']?.color_data?.[0]
    return Array.isArray(color) ? color.slice(0, 3).map(Number) : null
}

/** SYNC=0 on every write. SYNC=1 queues the colour behind the whole print move
 *  buffer and flips idle_timeout to Printing -- see rgb-status.cfg's header. */
async function setColor(r, g, b) {
    const script = `SET_LED LED=rgb_strip RED=${r} GREEN=${g} BLUE=${b} SYNC=0`
    await fetch(`${MOONRAKER}/printer/gcode/script?script=${encodeURIComponent(script)}`, { method: 'POST' })
}

const near = (a, b) => Math.abs(a - b) < 1e-6
const isSentinel = (color) => Array.isArray(color) && color.every((c) => near(c, SENTINEL))
const sameColor = (color, expected) => Array.isArray(color) && color.every((c, i) => near(c, expected[i]))

/** color_data settles a beat after the gcode is acknowledged. */
async function waitForColor(predicate, timeoutMs = 6000) {
    const deadline = Date.now() + timeoutMs
    let last = null
    while (Date.now() < deadline) {
        last = await readColor()
        if (predicate(last)) return last
        await new Promise((r) => setTimeout(r, 250))
    }
    return last
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
 * /overcam holds an MJPEG stream, so the document never fires `load`. Every
 * harness here navigates and then waits for a marker instead of awaiting the
 * navigation -- same trick measure-overcam.mjs uses.
 */
async function openOvercam(page, targetUrl) {
    page.goto(targetUrl, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForFunction(() => typeof window.__overcamLight !== 'undefined', { timeout: 30000 })
}

async function main() {
    console.log(`\n/overcam work light -- ${url}`)
    console.log(`Moonraker: ${MOONRAKER}\n`)

    const startingColor = await readColor()
    if (!startingColor) throw new Error('cannot read led rgb_strip -- is rgb-status.cfg deployed?')
    console.log(`strip was at [${startingColor.join(', ')}] -- will be restored\n`)

    const browser = await puppeteer.launch({
        executablePath: findChrome(),
        headless: 'new',
        args: ['--no-sandbox', '--window-size=1280,800'],
    })

    try {
        const page = await browser.newPage()
        await page.setViewport({ width: 1280, height: 800 })

        // ------------------------------------------------------------------
        // PART A -- decisions, fabricated snapshots
        // ------------------------------------------------------------------
        console.log('A. decisions (fabricated snapshots)')
        await openOvercam(page, `${url}?lightIdleMs=${TEST_IDLE_MS}`)

        const constants = await page.evaluate(() => window.__overcamLight.constants)
        check(
            `sentinel is ${SENTINEL} in the page too`,
            near(constants.sentinel, SENTINEL),
            `page says ${constants.sentinel}`
        )
        // Guards the harness itself: a shortened run must not be able to ship a
        // production timeout of a second and a half.
        check(
            `default idle wait is still ${DEFAULT_IDLE_MS} ms (5 min)`,
            constants.defaultIdleMs === DEFAULT_IDLE_MS,
            `page says ${constants.defaultIdleMs}`
        )

        const S = SENTINEL
        const cases = await page.evaluate(
            (sentinel) => {
                const snap = (colorData, extra = {}) => ({
                    colorData,
                    smokeAlarmPin: 0,
                    klippyState: 'ready',
                    klippyMessage: 'Printer is ready',
                    ...extra,
                })
                const d = window.__overcamLight.decide
                const s = sentinel

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
                    releaseDuringAlarmShutdown: d.release(
                        snap([s, s, s], { klippyState: 'shutdown', klippyMessage: 'SMOKE ALARM: MQ-2 triggered' }),
                        false
                    ),
                    releaseOnOrdinaryShutdown: d.release(
                        snap([s, s, s], { klippyState: 'shutdown', klippyMessage: 'Lost communication with MCU' }),
                        false
                    ),
                    releaseWithPeerActive: d.release(snap([s, s, s]), true),
                }
            },
            S
        )

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

        notes.push('alarm cases are fabricated snapshots -- raising smoke_alarm_active needs SET_PIN, not available here')

        // ------------------------------------------------------------------
        // PART B -- live behaviour
        // ------------------------------------------------------------------
        console.log('\nB. live behaviour (real strip, real Moonraker)')

        // B1. dark -> open -> lit with our token
        await setColor(0, 0, 0)
        await waitForColor((c) => sameColor(c, [0, 0, 0]))
        await openOvercam(page, `${url}?lightIdleMs=${TEST_IDLE_MS}`)
        let color = await waitForColor(isSentinel)
        check('opening /overcam on a dark strip lights our token', isSentinel(color), `color_data = [${color}]`)

        // B2. a colour that is not ours survives the page untouched
        await setColor(1, 1, 0) // RGB_PREPARING's yellow
        await waitForColor((c) => sameColor(c, [1, 1, 0]))
        await openOvercam(page, `${url}?lightIdleMs=${TEST_IDLE_MS}`)
        await new Promise((r) => setTimeout(r, 2500)) // past the idle wait, deliberately
        color = await readColor()
        check('🔴 a status colour is left alone on open', sameColor(color, [1, 1, 0]), `color_data = [${color}]`)
        const phase = await page.evaluate(() => document.documentElement.dataset.lightPhase)
        const decision = await page.evaluate(() => document.documentElement.dataset.lightDecision)
        check('and the page says so', phase === 'skipped' && decision === 'skip:lit', `${phase} / ${decision}`)

        // B3. our own light goes dark when the idle timer fires
        await setColor(0, 0, 0)
        await waitForColor((c) => sameColor(c, [0, 0, 0]))
        await openOvercam(page, `${url}?lightIdleMs=${TEST_IDLE_MS}`)
        await waitForColor(isSentinel)
        await page.evaluate(() => window.__overcamLight.fireIdleNow())
        color = await waitForColor((c) => sameColor(c, [0, 0, 0]))
        check('idle timer darkens our own light', sameColor(color, [0, 0, 0]), `color_data = [${color}]`)

        // B4. THE ONE THAT MATTERS. We hold the token, then a lifecycle macro
        // writes over it while the tab is idle. The timer must find someone
        // else's colour and refuse -- this is the exact sequence that would
        // darken RGB_PRINTING mid-print if ownership were "is it white?".
        await setColor(0, 0, 0)
        await waitForColor((c) => sameColor(c, [0, 0, 0]))
        await openOvercam(page, `${url}?lightIdleMs=${TEST_IDLE_MS}`)
        await waitForColor(isSentinel)
        await setColor(1, 1, 1) // as if PRINT_START had just run
        await waitForColor((c) => sameColor(c, [1, 1, 1]))
        await page.evaluate(() => window.__overcamLight.fireIdleNow())
        await new Promise((r) => setTimeout(r, 1500))
        color = await readColor()
        check(
            '🔴 PRINT_START mid-session revokes our claim -- light survives the timer',
            sameColor(color, [1, 1, 1]),
            `color_data = [${color}]`
        )
        const afterDecision = await page.evaluate(() => document.documentElement.dataset.lightDecision)
        check('and it refused for the right reason', afterDecision === 'skip:not-ours', afterDecision)

        // B5. activity re-lights, but only what we darkened
        await setColor(0, 0, 0)
        await waitForColor((c) => sameColor(c, [0, 0, 0]))
        await openOvercam(page, `${url}?lightIdleMs=${TEST_IDLE_MS}`)
        await waitForColor(isSentinel)
        await page.evaluate(() => window.__overcamLight.fireIdleNow())
        await waitForColor((c) => sameColor(c, [0, 0, 0]))
        await page.evaluate(() => window.__overcamLight.light.onActive())
        color = await waitForColor(isSentinel)
        check('activity re-lights a light we darkened', isSentinel(color), `color_data = [${color}]`)

        // B6. THE RULE AS THE USER STATED IT, with no test seam in the way.
        // B3..B5 call fireIdleNow(), which proves the decision but skips the
        // timer -- so this one drives the real chain instead: a real
        // visibilitychange, a real setTimeout, a real release. Hiding the tab
        // is done by opening a second one and bringing it to the front, which
        // is what a user switching tabs does; there is no visibility override
        // in this Chrome (checked -- Emulation.setPageVisibilityStateOverride
        // is gone).
        await setColor(0, 0, 0)
        await waitForColor((c) => sameColor(c, [0, 0, 0]))
        await openOvercam(page, `${url}?lightIdleMs=${TEST_IDLE_MS}`)
        await waitForColor(isSentinel)
        check(
            'page starts visible, so the timer is not already running',
            (await page.evaluate(() => document.visibilityState)) === 'visible'
        )

        const other = await browser.newPage()
        await other.goto('about:blank')
        await other.bringToFront()
        await page.waitForFunction(() => document.visibilityState === 'hidden', { timeout: 5000 })
        check(
            'losing focus arms the timer',
            (await page.evaluate(() => document.documentElement.dataset.lightActive)) === '0'
        )

        color = await waitForColor((c) => sameColor(c, [0, 0, 0]), TEST_IDLE_MS + 6000)
        check('🔴 the real timer darkens it unaided', sameColor(color, [0, 0, 0]), `color_data = [${color}]`)

        // ...and coming back re-lights it, again through the real event.
        await page.bringToFront()
        await page.waitForFunction(() => document.visibilityState === 'visible', { timeout: 5000 })
        color = await waitForColor(isSentinel)
        check('🔴 coming back re-lights it unaided', isSentinel(color), `color_data = [${color}]`)
        await other.close()
    } finally {
        await browser.close()
        await setColor(startingColor[0], startingColor[1], startingColor[2])
        const restored = await waitForColor((c) => sameColor(c, startingColor))
        console.log(`\nstrip restored to [${restored?.join(', ')}]`)
    }

    console.log('')
    notes.forEach((n) => console.log(`note: ${n}`))

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
