#!/usr/bin/env node
/**
 * Screenshot the Miscellaneous panel, live or with hardware this machine lacks.
 *
 *   node scripts/shoot-miscellaneous.mjs <url> <out> [width] [theme] [state]
 *
 *   state: live    only the printer's real objects (rig installed ONLY as the
 *                  g-code firewall -- see below)
 *          rigged  live objects plus the fixture's fans, pins, lights, filament
 *                  sensors and a Moonraker sensor
 *
 * 🔴 THE FIREWALL IS NOT OPTIONAL, EVEN IN `live` MODE. Every control in this
 * panel sends g-code: SET_PIN, M106, SET_FAN_SPEED, SET_LED,
 * SET_FILAMENT_SENSOR. One of the real pins on this machine is a fire-alarm
 * buzzer and another is the flag that says a fire was detected, and the printer
 * is mid endurance run with heating forbidden. So the rig is installed on every
 * run, with `status: {}` when there is nothing to inject: outbound
 * `printer.gcode.script` frames are recorded, dropped and answered
 * synthetically, and the run prints the list it caught. An empty list is the
 * audit.
 *
 * The run also samples the panel every 50 ms from first paint, because the
 * shape of a row depends on `configfile.settings` (`pwm:` decides slider vs
 * switch) and the config arrives AFTER Klippy reports ready -- the same window
 * that had the heightmap page claim "no [bed_mesh] section" for 200 ms.
 */
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { installRig, rigReport } from './lib/rig.mjs'
import { miscellaneousFixture, moonrakerSensorRpc } from './fixtures/miscellaneous.mjs'

const [url, out, width = '1400', theme = 'dark', state = 'rigged'] = process.argv.slice(2)

if (!['live', 'rigged'].includes(state)) throw new Error(`unknown state "${state}" -- expected live or rigged`)

const rigged = state === 'rigged'

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
    await page.setViewport({ width: Number(width), height: Number(process.env.HEIGHT ?? 1100), deviceScaleFactor: 2 })

    await installRig(page, {
        status: rigged ? miscellaneousFixture : {},
        theme,
        rpc: rigged ? moonrakerSensorRpc : {},
        // Without this the store never calls `server.sensors.list` at all: it
        // gates on the component being loaded, precisely so a printer without
        // it does not log a rejected call on every connect.
        components: rigged ? ['sensor'] : [],
    })

    const errors = []
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    page.on('pageerror', (e) => errors.push(String(e)))

    /**
     * Sample the panel's SHAPE, not its pixels: how many rows are switches and
     * how many are sliders. A row that starts as a switch and becomes a slider
     * (or the reverse) is the config-arrival race, and it is invisible in a
     * screenshot taken after everything settled.
     */
    const shape = () =>
        page.evaluate(() => {
            const panel = document.querySelector('[data-panel="miscellaneous"]')
            if (!panel) return 'absent'
            return [
                `rows=${panel.querySelectorAll(':scope > div > div > *').length}`,
                `switches=${panel.querySelectorAll('[aria-pressed]').length}`,
                `sliders=${panel.querySelectorAll('[role="slider"]').length}`,
            ].join(' ')
        })

    const samples = []
    const sampling = (async () => {
        for (let i = 0; i < 60; i++) {
            samples.push(`${i * 50}ms ${await shape().catch(() => 'n/a')}`)
            await new Promise((r) => setTimeout(r, 50))
        }
    })()

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
    await page
        .waitForSelector('[data-panel="miscellaneous"]', { timeout: 25000 })
        .catch(() => console.error('WARN: the Miscellaneous panel never appeared'))

    await sampling
    await new Promise((r) => setTimeout(r, 1200))

    // Collapse the run of identical samples: only the transitions matter.
    const transitions = samples.filter((sample, index) => {
        const value = sample.slice(sample.indexOf(' ') + 1)
        const previous = index ? samples[index - 1].slice(samples[index - 1].indexOf(' ') + 1) : null
        return value !== previous
    })

    const report = await rigReport(page)
    console.log('mode                 :', state)
    console.log('fixture injected     :', report.injected)
    console.log('faked rpc            :', report.rpc.length ? [...new Set(report.rpc)] : '(none)')
    console.log('gcode the page sent  :', report.gcode.length ? report.gcode : '(none)')
    console.log('panel shape over time:')
    for (const line of transitions) console.log('   ', line)
    console.log(
        'rows rendered        :',
        await page.evaluate(() => {
            const panel = document.querySelector('[data-panel="miscellaneous"]')
            if (!panel) return 'no panel'
            return [...panel.querySelectorAll(':scope > div > div > *')].map((row) => row.innerText.replace(/\n/g, ' | '))
        })
    )

    const panel = await page.$('[data-panel="miscellaneous"]')
    if (panel) await panel.screenshot({ path: out })
    else await page.screenshot({ path: out, fullPage: true })

    console.log(errors.length ? 'console errors: ' + errors.join(' | ') : 'no console errors')
    console.log('saved ' + out)
} finally {
    await browser.close()
}
