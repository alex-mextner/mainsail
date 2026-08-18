#!/usr/bin/env node
/**
 * One-off: prove the /overcam hud really drags and really snaps.
 *
 * Screenshots mid-drag (all eight targets visible, nearest highlighted) and
 * after release (docked into the snapped anchor), and reads back the
 * localStorage entry to confirm it stores an anchor NAME, not pixels.
 */
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const [url, outDir] = process.argv.slice(2)

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

try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1760, height: 900, deviceScaleFactor: 1 })
    await page.evaluateOnNewDocument(() => {
        localStorage.setItem('mainsail-next.theme', 'dark')
        // Start from the automatic dock every run, so the drag is what moves it.
        localStorage.removeItem('mainsail-next.webcamHudPlacement')
    })

    const errors = []
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    page.on('pageerror', (e) => errors.push(String(e)))

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
    await page.waitForFunction(() => document.body.innerText.includes('ETA'), { timeout: 25000 })
    await sleep(3000)

    // Grab the hud in the middle of the docked column, clear of the chart.
    await page.mouse.move(140, 400)
    await page.mouse.down()
    await sleep(200)
    await page.mouse.move(900, 500, { steps: 12 })
    await sleep(200)
    await page.mouse.move(1500, 780, { steps: 12 })
    await sleep(500)

    const targets = await page.evaluate(() => ({
        visible: document.querySelectorAll('.border-dashed').length,
        highlighted: document.querySelectorAll('.border-white\\/95').length,
    }))
    console.log('snap targets on screen:', JSON.stringify(targets))

    await page.screenshot({ path: `${outDir}/overcam-drag.png` })

    await page.mouse.up()
    await sleep(1200)
    await page.screenshot({ path: `${outDir}/overcam-snapped.png` })

    console.log('stored placement:', await page.evaluate(() => localStorage.getItem('mainsail-next.webcamHudPlacement')))
    console.log(errors.length ? 'console errors: ' + errors.join(' | ') : 'no console errors')
} finally {
    await browser.close()
}
