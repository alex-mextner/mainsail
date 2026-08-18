#!/usr/bin/env node
/**
 * Check the letterbox geometry of /overcam, at several window shapes, by number.
 *
 * The bug report was "there is clearly room in the black area, but the overlay
 * will not go there". That is a claim about pixels, so this measures them
 * instead of eyeballing a screenshot, and FAILS (exit 1) rather than printing:
 *
 *   1. a docked hud must not overlap the painted image
 *   2. when the free space, both bars added together, clears the dock
 *      threshold, the hud must be docked - not floating over the picture
 *   3. a docked hud must have a non-zero bar
 *   4. a docked hud must get ALL of the free space, not one strip of it: the
 *      bar has to measure the same as the total slack, and the frame has to
 *      sit flush against the opposite edge. This is the one that fails on the
 *      version that took a single strip whenever a single strip was wide
 *      enough - at 1920x1080 that gave a 240px bar against 480px of slack.
 *   5. the hud's CONTENT must fit inside the hud's box - a bar is only as tall
 *      as the geometry allows, and readings that wrap spill off the screen
 *   6. the layout must settle: sampled three times, the numbers must not flap
 *      (docking insets the frame, so a measurement taken FROM the frame box
 *      would oscillate - this is the check that would catch that)
 *   7. no console errors
 *   8. the 3D tile, when it is there, sits BETWEEN the readings and the chart -
 *      the vertical middle of a docked column, which is what was asked for -
 *      stays inside the hud's box, never appears over a floating card, and
 *      stays out of a letterbox row narrower than the gate. A canvas carries no
 *      text, so check 5 cannot see it: this one measures rectangles instead.
 *
 *   node scripts/measure-overcam.mjs <url> [wxh,wxh,...]
 *   PLACEMENT='{"mode":"dock","anchor":"left-center","side":"left"}' node ... <url>
 *
 * It reads `data-dock-*` attributes off the overlay root rather than the Vue
 * instance, so the same script and the same assertions run against the Vue 2
 * build on :80 and the Vue 3 port on :8090.
 */
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const [url, sizeList = '1920x1080,1600x900,1366x768,1440x900,1280x1024,900x900,760x1200'] = process.argv.slice(2)
const sizes = sizeList.split(',').map((s) => s.split('x').map(Number))

// Kept in step with src/store/variables.ts (Vue 2) and src/lib/webcam.ts (Vue 3)
const MIN_DOCK_WIDTH = 200
const MIN_DOCK_HEIGHT = 90
const MIN_ROW_MODEL_WIDTH = 1440

/*
 * PLACEMENT seeds the stored placement before the first load, so the same seven
 * window shapes can be walked in a mode other than the automatic one:
 *
 *   PLACEMENT='{"mode":"dock","anchor":"left-center","side":"left"}'
 *
 * Manual docking recomputes the reserved bar on every resize and re-insets the
 * frame, which is the same feedback surface the stability check exists for --
 * so it has to be swept, not spot-checked at one viewport.
 */
const PLACEMENT = process.env.PLACEMENT ?? ''

const candidates = [
    join(homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
]
const browser = await puppeteer.launch({
    executablePath: candidates.find((p) => existsSync(p)),
    headless: true,
    // swiftshader: the 3D tile needs a working webgl context, and headless chrome has no gpu
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const probe = () => {
    const container = document.querySelector('[data-overcam-root]')
    if (!container) return { error: 'no overlay root' }

    const media = container.querySelector('img.webcamImage, video.webcamImage, img, video')
    if (!media) return { error: 'no media element' }

    const cw = container.clientWidth
    const ch = container.clientHeight
    const box = media.getBoundingClientRect()

    // mjpegstreamer-adaptive re-points the <img> at a new snapshot several times a
    // second, and naturalWidth reads 0 in between - measured at 0 whole seconds after
    // a resize. So remember the last real frame size, and fall back to the aspect
    // ratio the overlay itself is working from when there has not been one yet.
    let nw = media.naturalWidth || media.videoWidth || 0
    let nh = media.naturalHeight || media.videoHeight || 0
    if (nw && nh) window.__overcamNatural = { nw, nh }
    else if (window.__overcamNatural) ({ nw, nh } = window.__overcamNatural)
    else if (Number(container.dataset.frameAspect)) {
        nw = Number(container.dataset.frameAspect)
        nh = 1
    }

    // object-fit: contain inside whatever box docking left for the frame
    const scale = nw && nh ? Math.min(box.width / nw, box.height / nh) : 0
    const pw = nw * scale
    const ph = nh * scale
    const paintedLeft = box.left + (box.width - pw) / 2
    const paintedTop = box.top + (box.height - ph) / 2

    const hud = container.querySelector('[data-overcam-hud]')
    const hudRect = hud ? hud.getBoundingClientRect() : null

    /*
     * Does the hud's CONTENT fit inside the hud's box?
     *
     * A docked bar is exactly as tall (or wide) as the geometry allows, and the
     * readings inside it wrap when they run out of room -- at which point they
     * spill past the bottom of the bar and off the screen. `scrollHeight` does
     * not catch it: the hud is a flex column at `height: 100%`, and an
     * overflowing flex item does not lengthen it. So walk the leaves, which are
     * the elements that actually carry text, and compare rectangles.
     */
    let contentOverflow = 0
    if (hudRect && hud) {
        for (const el of hud.querySelectorAll('*')) {
            if (el.children.length) continue
            if (!el.textContent?.trim()) continue

            const r = el.getBoundingClientRect()
            if (!r.width || !r.height) continue

            contentOverflow = Math.max(
                contentOverflow,
                Math.round(r.bottom - hudRect.bottom),
                Math.round(hudRect.top - r.top),
                Math.round(r.right - hudRect.right),
                Math.round(hudRect.left - r.left)
            )
        }
    }

    /*
     * The 3D tile: where it is, and whether it is anywhere it has no business being.
     * Addressed through data-overcam-* like everything else here, so the same assertions
     * run against the Vue 2 build and the Vue 3 port.
     */
    /*
     * `getClientRects()`, not merely "the element exists": the tile stays MOUNTED
     * when the hud is not docked (that is what keeps the loaded scene alive across
     * an undock) and is hidden with `display: none`. A hidden element still answers
     * querySelector, and its rectangle is all zeros - which would read as a tile
     * showing at the top left corner, spilling out of everything.
     */
    const mounted = container.querySelector('[data-overcam-model]')
    const tile = mounted?.getClientRects().length ? mounted : null
    const stats = container.querySelector('[data-overcam-stats]')
    const chart = container.querySelector('[data-overcam-chart]')
    const rect = (el) => {
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) }
    }

    return {
        contentOverflow,
        model: tile ? { state: tile.dataset.overcamModelState ?? '', box: rect(tile) } : null,
        statsBox: rect(stats),
        chartBox: rect(chart),
        dock: {
            axis: container.dataset.dockAxis,
            side: container.dataset.dockSide,
            size: Number(container.dataset.dockSize ?? 0),
            shift: container.dataset.dockShift === '1',
            mode: container.dataset.hudMode,
        },
        container: { w: cw, h: ch },
        natural: { w: nw, h: nh, live: !!(media.naturalWidth || media.videoWidth) },
        painted: { w: Math.round(pw), h: Math.round(ph), l: Math.round(paintedLeft), t: Math.round(paintedTop) },
        // what the frame leaves over IN TOTAL, i.e. both bars added together
        freeTotal: { horizontal: Math.round(cw - pw), vertical: Math.round(ch - ph) },
        hud: hudRect
            ? {
                  l: Math.round(hudRect.left),
                  t: Math.round(hudRect.top),
                  w: Math.round(hudRect.width),
                  h: Math.round(hudRect.height),
              }
            : null,
        overlapsImage: hudRect
            ? hudRect.right > paintedLeft + 1 &&
              hudRect.left < paintedLeft + pw - 1 &&
              hudRect.bottom > paintedTop + 1 &&
              hudRect.top < paintedTop + ph - 1
            : null,
    }
}

const failures = []
const fail = (size, message) => failures.push(`${size}: ${message}`)

try {
    const page = await browser.newPage()
    await page.evaluateOnNewDocument((placement) => {
        localStorage.setItem('mainsail-next.theme', 'dark')
        // this script is about geometry, so the 3D tile is kept on its cheap thumbnail:
        // the opt-in is what a previous run may have left behind
        localStorage.removeItem('webcamHudModelOptIn')
        localStorage.removeItem('mainsail-next.webcamHudModelOptIn')

        if (placement) {
            // both keys: the Vue 2 build and the Vue 3 port name it differently,
            // and only one of them is ever read
            localStorage.setItem('webcamHudPlacement', placement)
            localStorage.setItem('mainsail-next.webcamHudPlacement', placement)
            return
        }

        localStorage.removeItem('webcamHudPlacement')
        localStorage.removeItem('mainsail-next.webcamHudPlacement')
    }, PLACEMENT)

    const errors = []
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    page.on('pageerror', (e) => errors.push(String(e)))

    await page.setViewport({ width: sizes[0][0], height: sizes[0][1], deviceScaleFactor: 1 })
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
    await page.waitForFunction(() => document.body.innerText.includes('ETA'), { timeout: 25000 })
    await sleep(3500)

    for (const [w, h] of sizes) {
        const label = `${w}x${h}`
        await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 })
        await sleep(1800)

        // three samples, to catch a layout that feeds back into its own measurement
        const samples = []
        for (let i = 0; i < 3; i++) {
            samples.push(await page.evaluate(probe))
            await sleep(400)
        }
        const result = samples[samples.length - 1]

        console.log(`\n=== ${label} (${(w / h).toFixed(2)}) ===`)
        console.log(JSON.stringify(result))

        if (result.error) {
            fail(label, result.error)
            continue
        }

        const stable = samples.every((s) => JSON.stringify(s.dock) === JSON.stringify(result.dock))
        if (!stable)
            fail(label, `dock flaps between samples: ${samples.map((s) => JSON.stringify(s.dock)).join(' -> ')}`)

        const docked = result.dock.axis !== 'none'

        if (docked && result.overlapsImage) fail(label, 'docked hud overlaps the painted image')
        if (docked && !(result.dock.size > 0)) fail(label, 'docked with a zero-width bar')

        /*
         * The bar is the SUM of the letterboxing, not one strip of it.
         *
         * With the frame pushed against the far edge, whatever the frame does not
         * paint IS the bar - so the total slack the probe measures and the bar the
         * page reserved have to be the same number. They come from opposite ends:
         * `dock.size` is what the component decided, `freeTotal` is measured off the
         * pixels the image actually covers. A bar that took only half the room shows
         * up here as half the slack, which is exactly the bug.
         *
         * It holds for a hand-made dock too, where the bar can be WIDER than the
         * letterboxing gave: the frame is then scaled down into what is left and
         * fills it, so the leftover is still exactly the bar.
         */
        if (docked) {
            const free = result.dock.axis === 'vertical' ? result.freeTotal.horizontal : result.freeTotal.vertical
            if (Math.abs(free - result.dock.size) > 2)
                fail(label, `bar is ${result.dock.size}px but ${free}px is free - the far bar was left empty`)

            if (!result.dock.shift) fail(label, 'docked without moving the frame aside')

            // and the frame really is flush against the opposite edge
            const flush = {
                left: result.painted.l - result.dock.size,
                right: result.painted.l,
                top: result.painted.t - result.dock.size,
                bottom: result.painted.t,
            }[result.dock.side]
            if (Math.abs(flush) > 2)
                fail(label, `frame is ${flush}px off the edge opposite a ${result.dock.side} bar`)
        }

        // 2px of tolerance: sub-pixel rounding on a scaled layout, not a wrap
        if (result.contentOverflow > 2) fail(label, `hud content spills ${result.contentOverflow}px out of its box`)

        /*
         * The 3D tile (M1b). Four things, and the first is the point of the whole feature:
         * it has to be BETWEEN the readings and the chart, which in a docked column is the
         * vertical middle - the empty half that appeared when the bar became the sum.
         *
         * The others are the ways it could break the layout it moved into: it must stay
         * inside the hud's box, it must never appear over a floating card (that card lies
         * ON the picture), and it must stay out of a letterbox row too narrow to hold the
         * readings and a square tile side by side.
         */
        if (result.model) {
            if (!docked) fail(label, 'the 3D tile is showing while the hud floats over the image')

            const box = result.model.box
            if (result.hud) {
                const hudBox = { l: result.hud.l, t: result.hud.t, r: result.hud.l + result.hud.w, b: result.hud.t + result.hud.h }
                const spill = Math.max(hudBox.l - box.l, box.r - hudBox.r, hudBox.t - box.t, box.b - hudBox.b)
                if (spill > 2) fail(label, `the 3D tile spills ${spill}px out of the hud box`)
            }

            if (result.dock.axis === 'vertical') {
                if (result.statsBox && box.t < result.statsBox.b - 2)
                    fail(label, `the 3D tile (top ${box.t}) is not below the readings (bottom ${result.statsBox.b})`)
                if (result.chartBox && box.b > result.chartBox.t + 2)
                    fail(label, `the 3D tile (bottom ${box.b}) is not above the chart (top ${result.chartBox.t})`)
            }

            if (result.dock.axis === 'horizontal' && result.container.w < MIN_ROW_MODEL_WIDTH)
                fail(label, `a ${result.container.w}px row shows the 3D tile below the ${MIN_ROW_MODEL_WIDTH}px gate`)
        }

        if (!docked) {
            if (result.freeTotal.horizontal >= MIN_DOCK_WIDTH)
                fail(label, `${result.freeTotal.horizontal}px of free width, both bars together, yet not docked`)
            if (result.freeTotal.vertical >= MIN_DOCK_HEIGHT)
                fail(label, `${result.freeTotal.vertical}px of free height, both bars together, yet not docked`)
        }
    }

    if (errors.length) fail('page', 'console errors: ' + errors.join(' | '))
} finally {
    await browser.close()
}

console.log()
if (failures.length) {
    console.error('FAILED:')
    failures.forEach((f) => console.error('  - ' + f))
    process.exit(1)
}
console.log('all checks passed')
