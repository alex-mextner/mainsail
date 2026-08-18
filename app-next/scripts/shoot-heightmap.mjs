#!/usr/bin/env node
/**
 * Screenshot /heightmap AS IF this machine had a working Z probe.
 *
 *   node scripts/shoot-heightmap.mjs <url> <out> [width] [theme] [state] [orientation] [scheme]
 *
 *   state:       loaded | cleared | none   (default: loaded)
 *                - loaded : a mesh is on the bed
 *                - cleared: [bed_mesh] configured, nothing loaded
 *                - none   : no fixture at all -- what the live machine shows
 *   orientation: rightFront | leftFront | front | top
 *   scheme:      portland | spring | hot | hsv | grayscale
 *
 * See scripts/lib/rig.mjs for why the data is injected into the websocket reply
 * rather than added to the printer, and why every outbound `printer.gcode.script`
 * is intercepted and dropped rather than merely avoided.
 *
 * The run prints what the page TRIED to send. On a clean run that list is
 * empty, and that is the audit: no g-code left the browser.
 */
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { installRig, rigReport } from './lib/rig.mjs'
import { bedMeshFixture, bedMeshClearedFixture } from './fixtures/bed-mesh.mjs'

const [
    url,
    out,
    width = '1400',
    theme = 'dark',
    state = 'loaded',
    orientation = 'rightFront',
    scheme = 'portland',
] = process.argv.slice(2)

const fixtures = { loaded: bedMeshFixture, cleared: bedMeshClearedFixture, none: {} }
const status = fixtures[state]
if (!status) throw new Error(`unknown state "${state}" -- expected loaded, cleared or none`)

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

try {
    const page = await browser.newPage()
    await page.setViewport({ width: Number(width), height: Number(process.env.HEIGHT ?? 1000), deviceScaleFactor: 2 })

    // HM_VIEW='{"mesh":false}' seeds the Probed/Mesh/Flat/Wireframe switches.
    // They are how the surfaces are hidden, and the mechanism behind them
    // (`legend.selected`) is silently dead unless echarts' LegendComponent is
    // registered -- so being able to shoot them off is how that stays fixed.
    const viewPatch = process.env.HM_VIEW ? JSON.parse(process.env.HM_VIEW) : {}

    await installRig(page, {
        status,
        theme,
        // Only the heightmap keys are seeded; everything else falls back to the
        // store's own defaults, so the shot shows what a first-time visitor
        // sees rather than a state built up by earlier runs.
        gui: {
            heightmap: { defaultOrientation: orientation, activecolorscheme: scheme },
            view: { heightmap: viewPatch },
        },
    })

    const errors = []
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    page.on('pageerror', (e) => errors.push(String(e)))

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
    await page
        .waitForFunction(() => document.body.innerText.includes('Heightmap'), { timeout: 25000 })
        .catch(() => console.error('WARN: the heightmap panel never appeared'))

    // WebGL needs longer than a canvas chart: the first frame is behind a
    // shader compile, and screenshotting before it lands yields a blank box.
    await new Promise((r) => setTimeout(r, 5000))

    const report = await rigReport(page)
    console.log('fixture injected     :', report.injected)
    console.log('gcode the page sent  :', report.gcode.length ? report.gcode : '(none)')
    console.log(
        'webgl canvases       :',
        await page.evaluate(() => document.querySelectorAll('canvas').length)
    )
    console.log(
        'surface drew          :',
        await page.evaluate(() => {
            // Non-blank proof: sample the chart canvas and count distinct
            // colours. An empty 3D box is one flat background colour.
            const canvas = [...document.querySelectorAll('canvas')].sort(
                (a, b) => b.width * b.height - a.width * a.height
            )[0]
            if (!canvas) return 'no canvas'
            const source = canvas.getContext('2d') ?? canvas.getContext('webgl') ?? null
            if (!source) return 'no context'

            const copy = document.createElement('canvas')
            copy.width = canvas.width
            copy.height = canvas.height
            copy.getContext('2d').drawImage(canvas, 0, 0)
            const { data } = copy.getContext('2d').getImageData(0, 0, copy.width, copy.height)

            const seen = new Set()
            for (let i = 0; i < data.length; i += 4 * 97) seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`)
            return `${seen.size} distinct sampled colours`
        })
    )

    await page.screenshot({ path: out, fullPage: true })
    console.log(errors.length ? 'console errors: ' + errors.join(' | ') : 'no console errors')
    console.log('saved ' + out)
} finally {
    await browser.close()
}
