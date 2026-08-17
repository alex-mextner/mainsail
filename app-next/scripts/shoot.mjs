#!/usr/bin/env node
/**
 * Screenshot the running dev server with the locally installed Chrome.
 *
 * Not part of the app -- a verification aid, so a claim like "the panel shows
 * live temperatures" can be backed by a picture and by the DOM text rather than
 * asserted. Uses puppeteer-core against the existing Chrome install, so nothing
 * downloads a browser.
 *
 *   node scripts/shoot.mjs [url] [outfile]
 */
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const url = process.argv[2] ?? 'http://127.0.0.1:5273/'
const out = process.argv[3] ?? 'shot.png'

const candidates = [
    join(homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
]
const executablePath = candidates.find((p) => existsSync(p))
if (!executablePath) {
    console.error('FAIL: no Chrome/Edge binary found')
    process.exit(1)
}

const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

try {
    const page = await browser.newPage()
    await page.setViewport({ width: 520, height: 760, deviceScaleFactor: 2 })

    const errors = []
    page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text())
    })
    page.on('pageerror', (e) => errors.push(String(e)))

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })

    // Wait for a real reading to appear rather than a fixed sleep, so the
    // screenshot cannot accidentally capture the placeholder.
    await page
        .waitForFunction(() => /\d+\.\d\s*°C/.test(document.body.innerText), { timeout: 25000 })
        .catch(() => console.error('WARN: no "NN.N °C" reading appeared before the timeout'))

    // Let a few push frames land so the sparklines have a shape.
    await new Promise((r) => setTimeout(r, 6000))

    await page.screenshot({ path: out, fullPage: true })

    const text = await page.evaluate(() => document.body.innerText)
    console.log('--- rendered text ---')
    console.log(text)
    console.log('--- end ---')
    if (errors.length) {
        console.log('\nconsole errors:')
        for (const e of errors.slice(0, 10)) console.log(`  ${e}`)
    } else {
        console.log('\nno console errors')
    }
    console.log(`\nsaved ${out}`)
} finally {
    await browser.close()
}
