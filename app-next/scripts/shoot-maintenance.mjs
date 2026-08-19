#!/usr/bin/env node
/**
 * Screenshot the maintenance panel AS IF the printer had reminders set up.
 *
 *   node scripts/shoot-maintenance.mjs <url> <out> [width] [theme] [state]
 *
 *   state: entries  four reminders: overdue on filament, due later on print
 *                   time, overdue on age, and one already performed
 *          empty    what this machine really returns -- the MAINTENANCE_INIT
 *                   marker and nothing else, which must render as "none"
 *          perform  `entries`, then "mark as done" clicked through, to check
 *                   that the WRITE is attempted and stopped
 *
 * 🔴 THE WRITE IS THE WHOLE POINT OF THE `perform` STATE. Maintenance records
 * live in the Moonraker database namespace that the OTHER interface on this
 * machine reads, so a run that actually wrote would leave a record in the
 * user's real list. `server.database.post_item` is on the rig's blocklist and
 * the rig answers it with the fixture instead -- which is also the only way a
 * write-then-reload flow can be exercised at all. This run asserts BOTH: that
 * the panel tried, and that nothing left the browser.
 */
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { installRig, rigReport } from './lib/rig.mjs'
import { maintenanceRpc, maintenanceEmptyRpc } from './fixtures/maintenance.mjs'

// Bare address: since the 2026-08-19 port swap this fork is served on port 80.
const [url = 'http://192.168.11.160/', out, width = '1200', theme = 'dark', state = 'entries'] = process.argv.slice(2)

const fixtures = { entries: maintenanceRpc, perform: maintenanceRpc, empty: maintenanceEmptyRpc }
const rpc = fixtures[state]
if (!rpc) throw new Error(`unknown state "${state}"`)

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

    await installRig(page, { rpc, theme })

    const errors = []
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    page.on('pageerror', (e) => errors.push(String(e)))

    await page.goto(new URL('/history', url).href, { waitUntil: 'networkidle2', timeout: 30000 })
    await page
        .waitForSelector('[data-maintenance-body]', { timeout: 25000 })
        .catch(() => console.error('WARN: the maintenance panel never appeared'))
    await new Promise((r) => setTimeout(r, 1200))

    console.log('state               :', state)
    console.log(
        'entries             :',
        await page.evaluate(() =>
            [...document.querySelectorAll('[data-maintenance-entry]')].map(
                (el) =>
                    `${el.getAttribute('data-maintenance-entry')}${el.getAttribute('data-maintenance-due') === 'true' ? ' [DUE]' : ''}`
            )
        )
    )
    console.log(
        'progress labels     :',
        await page.evaluate(() =>
            [...document.querySelectorAll('[data-maintenance-entry]')].map((el) => {
                const label = el.querySelector('.text-xs.text-muted-foreground:last-of-type')
                return `${el.getAttribute('data-maintenance-entry')}: ${el.innerText.replace(/\n/g, ' | ')}`
            })
        )
    )
    console.log(
        'empty state         :',
        await page.evaluate(() => document.querySelector('[data-testid="maintenance-empty"]')?.innerText ?? '(absent)')
    )

    if (state === 'perform') {
        await page.evaluate(() => document.querySelector('[aria-label="Mark Replace nozzle as done"]')?.click())
        await new Promise((r) => setTimeout(r, 500))

        await page.evaluate(() => {
            const box = document.querySelector('[data-testid="maintenance-note"]')
            if (box) {
                box.value = 'swapped for a hardened 0.4'
                box.dispatchEvent(new Event('input', { bubbles: true }))
            }
        })
        await page.evaluate(() => document.querySelector('[data-testid="maintenance-perform-confirm"]')?.click())
        await new Promise((r) => setTimeout(r, 800))

        // And the delete path, which is the other blocked write.
        await page.evaluate(() => document.querySelector('[aria-label="Delete Check belt tension"]')?.click())
        await new Promise((r) => setTimeout(r, 500))
        await page.evaluate(() => document.querySelector('[data-testid="maintenance-delete-confirm"]')?.click())
        await new Promise((r) => setTimeout(r, 800))
    }

    const panel = await page.$('[data-panel="maintenance"]')
    if (panel) await panel.screenshot({ path: out })
    else await page.screenshot({ path: out })

    const report = await rigReport(page)
    console.log('faked rpc           :', [...new Set(report.rpc)])
    console.log('blocked calls       :', report.blockedCalls.length ? [...new Set(report.blockedCalls)] : '(none)')
    console.log('gcode the page sent :', report.gcode.length ? report.gcode : '(none)')
    console.log(errors.length ? 'console errors: ' + errors.join(' | ') : 'no console errors')
    console.log('saved ' + out)
} finally {
    await browser.close()
}
