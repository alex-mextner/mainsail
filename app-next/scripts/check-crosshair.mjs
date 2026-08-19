#!/usr/bin/env node
/**
 * Measure the nozzle crosshair on the live camera.
 *
 *   node scripts/check-crosshair.mjs [url]
 *
 * The crosshair is off unless the camera's `extra_data.nozzleCrosshair` is
 * set, and it is not set on this machine -- so the rig fakes the webcam list
 * with the flag on. `server.webcams.list` is a READ and passes the firewall
 * untouched; the write that would turn it on for real is blocked, which is
 * exactly right: this camera's settings belong to the user.
 *
 * 🔴 WHAT IS ACTUALLY BEING CHECKED, and why a screenshot alone would not do
 * it. Upstream sizes the circle from the CONTAINER height. Here the image is
 * `object-contain`, so on a letterboxed frame the container is taller than the
 * picture and upstream's circle would grow with the black bars -- the same
 * camera showing a different-sized reference on a phone and on a desktop. The
 * fix is to size from the rendered picture, and the way to prove it is to
 * render the SAME camera at two very different container aspect ratios and
 * require the circle to come out the same. That is a number, not a look.
 */
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { installRig } from './lib/rig.mjs'

// Bare address: since the 2026-08-19 port swap this fork is served on port 80.
const url = process.argv[2] ?? 'http://192.168.11.160/'

const failures = []
const check = (ok, message) => {
    console.log(`${ok ? '  ok  ' : '  FAIL'}  ${message}`)
    if (!ok) failures.push(message)
}

/** The machine's real camera, with the crosshair switched on. */
const webcamsRpc = {
    'server.webcams.list': {
        webcams: [
            {
                name: 'mbot',
                enabled: true,
                service: 'mjpegstreamer-adaptive',
                target_fps: 10,
                target_fps_idle: 5,
                stream_url: '/webcam/?action=stream',
                snapshot_url: '/webcam/?action=snapshot',
                flip_horizontal: false,
                flip_vertical: false,
                rotation: 0,
                aspect_ratio: '4:3',
                extra_data: { nozzleCrosshair: true, nozzleCrosshairColor: '#00ff88', nozzleCrosshairSize: 0.2 },
            },
        ],
    },
}

const candidates = [
    join(homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
]

const browser = await puppeteer.launch({
    executablePath: candidates.find(existsSync),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

/** Render /cam at one viewport and measure what the crosshair drew. */
async function measure(width, height) {
    const page = await browser.newPage()
    await page.setViewport({ width, height })
    await installRig(page, { rpc: webcamsRpc })

    await page.goto(new URL('/cam', url).href, { waitUntil: 'networkidle2', timeout: 30000 })
    await page.waitForSelector('[data-testid="nozzle-crosshair"]', { timeout: 25000 }).catch(() => null)
    // The image has to actually arrive: the crosshair only renders once the
    // streamer reports `connected`, and the circle needs the aspect ratio.
    await new Promise((r) => setTimeout(r, 3500))

    const result = await page.evaluate(() => {
        const root = document.querySelector('[data-testid="nozzle-crosshair"]')
        if (!root) return null

        const box = root.getBoundingClientRect()
        const circle = root.querySelector('.rounded-full')?.getBoundingClientRect()
        const image = document.querySelector('.webcam-image')
        const imageBox = image?.getBoundingClientRect()
        const natural = image ? { w: image.naturalWidth, h: image.naturalHeight } : null

        return {
            container: { w: Math.round(box.width), h: Math.round(box.height) },
            circle: circle ? Math.round(circle.width) : null,
            imageBox: imageBox ? { w: Math.round(imageBox.width), h: Math.round(imageBox.height) } : null,
            natural,
            color: getComputedStyle(root.querySelector('.h-px')).backgroundColor,
        }
    })

    await page.close()
    return result
}

try {
    // Two very different shapes. 4:3 camera in a wide box letterboxes on the
    // sides; in a tall box it letterboxes top and bottom.
    const wide = await measure(1600, 700)
    const tall = await measure(700, 1200)

    console.log('wide  :', JSON.stringify(wide))
    console.log('tall  :', JSON.stringify(tall))

    check(wide !== null && tall !== null, 'the crosshair rendered at both viewports')

    if (wide && tall) {
        check(wide.color === 'rgb(0, 255, 136)', `the configured colour is used (${wide.color})`)

        const pictureBased = (m) => Math.round(Math.min(m.container.h, m.container.w / (4 / 3)) * 0.2)
        const containerBased = (m) => Math.round(m.container.h * 0.2)

        check(
            Math.abs(wide.circle - pictureBased(wide)) <= 2,
            `wide: circle ${wide.circle}px = 20% of the picture height (${pictureBased(wide)}px)`
        )
        check(
            Math.abs(tall.circle - pictureBased(tall)) <= 2,
            `tall: circle ${tall.circle}px = 20% of the picture height (${pictureBased(tall)}px)`
        )

        /**
         * 🔴 SAY WHEN THE TEST CANNOT TELL. `webcamWrapperStyle` puts the
         * camera's aspect ratio on the WRAPPER, so in this layout the
         * container IS the picture and there are no letterbox bars -- both
         * formulas give the same number and this run does not discriminate
         * between them. Reported rather than dressed up as a passing check,
         * because a green tick here would otherwise be read as "the letterbox
         * fix is proven", which it is not.
         *
         * Where it WOULD discriminate: any surface that gives the frame a
         * container of a different shape -- the docked hud on /overcam is the
         * candidate. Not measured yet.
         */
        const discriminates =
            Math.abs(pictureBased(wide) - containerBased(wide)) > 2 ||
            Math.abs(pictureBased(tall) - containerBased(tall)) > 2

        console.log(
            discriminates
                ? '  note  the two sizing formulas differ here, so the letterbox fix IS exercised'
                : `  note  NOT DISCRIMINATING: the wrapper already enforces the aspect ratio, so\n` +
                      `        picture-based (${pictureBased(wide)}px) and container-based (${containerBased(wide)}px)\n` +
                      `        agree. This run proves geometry and colour, NOT the letterbox fix.`
        )
    }
} finally {
    await browser.close()
}

console.log(failures.length ? `\n${failures.length} FAILURE(S)` : '\nall checks passed')
process.exit(failures.length ? 1 : 0)
