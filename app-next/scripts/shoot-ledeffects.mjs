#!/usr/bin/env node
/**
 * Screenshot the LED-effects panel AS IF klipper-led_effect were installed.
 *
 *   node scripts/shoot-ledeffects.mjs <url> <out> [width] [theme] [state]
 *
 *   state: idle     the machine as it is now (not printing)
 *          printing print_stats says printing -- every button must go dead
 *
 * The panel is nothing but buttons that send g-code, so the run CLICKS THEM ALL
 * and prints what the firewall caught. That is the only way to check the one
 * thing the panel actually decides: a running effect must be stopped
 * (`STOP=1`), a stopped one must be started, and the difference is invisible in
 * a screenshot -- both are just a button with a colour.
 *
 * See scripts/lib/rig.mjs: the clicks cannot reach the printer. Which matters
 * more than usual here, because `SET_LED_EFFECT` on a machine WITHOUT the
 * plugin is an unknown command Klipper would answer with an error into the
 * user's console, mid endurance run.
 */
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { installRig, rigReport } from './lib/rig.mjs'
import { ledEffectsFixture } from './fixtures/led-effects.mjs'

const [url, out, width = '1400', theme = 'dark', state = 'idle'] = process.argv.slice(2)

const status = { ...ledEffectsFixture }
if (state === 'printing') {
    // Only the field the panel reads. The rig merges, so the rest of
    // print_stats stays whatever the printer really reports.
    status.print_stats = { state: 'printing' }
} else if (state !== 'idle') {
    throw new Error(`unknown state "${state}" -- expected idle or printing`)
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

try {
    const page = await browser.newPage()
    await page.setViewport({ width: Number(width), height: Number(process.env.HEIGHT ?? 1100), deviceScaleFactor: 2 })

    await installRig(page, { status, theme })

    const errors = []
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    page.on('pageerror', (e) => errors.push(String(e)))

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
    await page
        .waitForSelector('[data-panel="led-effects"]', { timeout: 25000 })
        .catch(() => console.error('WARN: the LED effects panel never appeared'))
    await new Promise((r) => setTimeout(r, 800))

    const buttons = await page.evaluate(() => {
        const panel = document.querySelector('[data-panel="led-effects"]')
        if (!panel) return []
        return [...panel.querySelectorAll('button')].map((button) => ({
            label: button.getAttribute('aria-label') ?? button.innerText.trim(),
            pressed: button.getAttribute('aria-pressed'),
            disabled: button.disabled,
        }))
    })

    console.log('state                :', state)
    console.log('buttons              :', buttons)

    const panel = await page.$('[data-panel="led-effects"]')
    if (panel) await panel.screenshot({ path: out })
    else await page.screenshot({ path: out, fullPage: true })

    // Click every enabled button. Disabled ones are skipped on purpose: a
    // click on a disabled button proves nothing, and the button list above
    // already records which were disabled.
    await page.evaluate(() => {
        const panel = document.querySelector('[data-panel="led-effects"]')
        if (!panel) return
        for (const button of panel.querySelectorAll('button')) if (!button.disabled) button.click()
    })
    await new Promise((r) => setTimeout(r, 500))

    const report = await rigReport(page)
    console.log('fixture injected     :', report.injected)
    console.log('gcode the page sent  :', report.gcode.length ? report.gcode : '(none -- every button was disabled)')
    console.log('blocked at the socket:', report.blocked)
    console.log(errors.length ? 'console errors: ' + errors.join(' | ') : 'no console errors')
    console.log('saved ' + out)
} finally {
    await browser.close()
}
