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
 *   4. the layout must settle: sampled three times, the numbers must not flap
 *      (docking insets the frame, so a measurement taken FROM the frame box
 *      would oscillate - this is the check that would catch that)
 *   5. no console errors
 *
 *   node scripts/measure-overcam.mjs <url> [wxh,wxh,...]
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

// Kept in step with src/store/variables.ts
const MIN_DOCK_WIDTH = 200
const MIN_DOCK_HEIGHT = 90

const candidates = [
    join(homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
]
const browser = await puppeteer.launch({
    executablePath: candidates.find((p) => existsSync(p)),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
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

    return {
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
    await page.evaluateOnNewDocument(() => {
        localStorage.removeItem('webcamHudPlacement')
        localStorage.removeItem('mainsail-next.webcamHudPlacement')
        localStorage.setItem('mainsail-next.theme', 'dark')
    })

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
