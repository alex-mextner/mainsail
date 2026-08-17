#!/usr/bin/env node
/**
 * Screenshot any page, waiting on a TEXT MARKER rather than on a temperature.
 *
 * `shoot.mjs` waits for a "NN.N °C" reading, which only ever appears on the
 * dashboard -- on /files, /console or /history it burns its whole 25 s timeout
 * before giving up. This one waits for whatever string proves the page is
 * populated, so a verification screenshot costs seconds instead of half a
 * minute.
 *
 *   node scripts/shoot-page.mjs <url> <out> <marker> <width> <theme> [hoverSelector]
 *
 * `hoverSelector` dispatches a mouseenter, for previews and hover-only UI, and
 * switches to a viewport-sized shot so the hovered element is actually in frame.
 */
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const [url, out, marker = 'G-Code', width = '1400', theme = 'dark', hover = ''] = process.argv.slice(2)

const candidates = [
    join(homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
]
const executablePath = candidates.find((p) => existsSync(p))
const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

try {
    const page = await browser.newPage()
    await page.setViewport({ width: Number(width), height: 900, deviceScaleFactor: 2 })
    await page.evaluateOnNewDocument((t) => {
        localStorage.setItem('mainsail-next.theme', t)
        localStorage.setItem('mainsail-next.density', 'auto')
    }, theme)

    const errors = []
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    page.on('pageerror', (e) => errors.push(String(e)))

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
    await page
        .waitForFunction((m) => document.body.innerText.includes(m), { timeout: 25000 }, marker)
        .catch(() => console.error(`WARN: marker "${marker}" never appeared`))
    await new Promise((r) => setTimeout(r, 2500))

    if (hover) {
        const found = await page.evaluate((sel) => {
            const el = document.querySelector(sel)
            if (!el) return false
            el.scrollIntoView({ block: 'center' })
            el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))
            return true
        }, hover)
        console.log('hover:', found)
        await new Promise((r) => setTimeout(r, 1200))
    }

    await page.screenshot({ path: out, fullPage: !hover })
    console.log(errors.length ? 'console errors: ' + errors.join(' | ') : 'no console errors')
    console.log('saved ' + out)
} finally {
    await browser.close()
}
