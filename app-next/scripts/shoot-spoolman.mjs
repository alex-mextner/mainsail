#!/usr/bin/env node
/**
 * Screenshot the Spoolman panel AS IF a Spoolman server were reachable.
 *
 *   node scripts/shoot-spoolman.mjs <url> <out> [width] [theme] [state]
 *
 *   state: loaded    a spool is selected
 *          empty     spool_id 0 -- Spoolman's "none", not a spool with id 0
 *          unhealthy the proxy answers but Spoolman reports unhealthy
 *          picker    the spool picker open, which is where the three
 *                    different spool renderings are visible at once
 *
 * Nothing here sends g-code -- Spoolman is all Moonraker RPC -- but the rig is
 * installed on every run anyway, so a stray click on the dashboard behind the
 * panel cannot reach the printer either.
 */
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { installRig, rigReport } from './lib/rig.mjs'
import { spoolmanRpc, spoolmanEmptyRpc, spoolmanUnhealthyRpc } from './fixtures/spoolman.mjs'

const [url, out, width = '1400', theme = 'dark', state = 'loaded'] = process.argv.slice(2)

const fixtures = { loaded: spoolmanRpc, picker: spoolmanRpc, empty: spoolmanEmptyRpc, unhealthy: spoolmanUnhealthyRpc }
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
    await page.setViewport({ width: Number(width), height: Number(process.env.HEIGHT ?? 1200), deviceScaleFactor: 2 })

    await installRig(page, { rpc, theme, components: ['spoolman'] })

    const errors = []
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    page.on('pageerror', (e) => errors.push(String(e)))

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
    await page
        .waitForSelector('[data-panel="spoolman"]', { timeout: 25000 })
        .catch(() => console.error('WARN: the Spoolman panel never appeared'))
    await new Promise((r) => setTimeout(r, 800))

    console.log('state                :', state)
    console.log(
        'panel               :',
        await page.evaluate(() => {
            const panel = document.querySelector('[data-panel="spoolman"]')
            return panel ? panel.innerText.split('\n').filter(Boolean) : 'absent'
        })
    )
    console.log(
        'spoolman link       :',
        await page.evaluate(
            () => document.querySelector('[aria-label="Open Spoolman"]')?.getAttribute('href') ?? '(none)'
        )
    )

    if (state === 'picker') {
        await page.evaluate(() => document.querySelector('[aria-label="Change spool"]')?.click())
        await new Promise((r) => setTimeout(r, 600))

        console.log(
            'spools offered      :',
            await page.evaluate(() =>
                [...document.querySelectorAll('[role="dialog"] li button')].map((b) =>
                    b.innerText.replace(/\n/g, ' | ')
                )
            )
        )
        console.log(
            'wedges / gradients  :',
            await page.evaluate(() => ({
                wedgePaths: document.querySelectorAll('[role="dialog"] svg path[fill^="#"]').length,
                gradients: document.querySelectorAll('[role="dialog"] svg linearGradient').length,
            }))
        )

        const dialog = await page.$('[role="dialog"]')
        if (dialog) await dialog.screenshot({ path: out })
    } else {
        const panel = await page.$('[data-panel="spoolman"]')
        if (panel) await panel.screenshot({ path: out })
        else await page.screenshot({ path: out, fullPage: true })
    }

    const report = await rigReport(page)
    console.log('faked rpc            :', report.rpc.length ? [...new Set(report.rpc)] : '(none)')
    console.log('gcode the page sent  :', report.gcode.length ? report.gcode : '(none)')
    console.log(errors.length ? 'console errors: ' + errors.join(' | ') : 'no console errors')
    console.log('saved ' + out)
} finally {
    await browser.close()
}
