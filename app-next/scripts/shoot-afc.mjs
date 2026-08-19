#!/usr/bin/env node
/**
 * Screenshot the AFC panel AS IF a BoxTurtle were attached.
 *
 *   node scripts/shoot-afc.mjs <url> <out> [width] [theme] [state]
 *
 *   state: loaded   one lane in the toolhead, one spare, one prep, one empty
 *          error    AFC has failed and is showing its message strip
 *          bypass   the bypass lever engaged
 *          ramming  a toolhead with no pre-extruder switch
 *          macros   the AFC macros installed too, so the menu's macro rows
 *                   can be checked for PRESENCE -- with the ordinary fixture
 *                   they are correctly absent, and absence is also what every
 *                   possible bug in that filter looks like
 *          sweep    loaded, but every lane control is clicked and the g-code
 *                   it WOULD have sent is printed
 *
 * 🔴 `sweep` is the reason the rig exists. The AFC panel is almost entirely
 * buttons that send g-code -- CHANGE_TOOL, TOOL_UNLOAD, LANE_UNLOAD, SET_MAP,
 * SET_RUNOUT, AFC_CALIBRATION -- and against this printer every one of them
 * would be an "Unknown command" at best. They are recorded and dropped at the
 * socket by `lib/rig.mjs`, whose firewall is checked separately by
 * `check-rig-firewall.mjs`. Nothing here reaches the machine.
 */
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { installRig, rigReport } from './lib/rig.mjs'
import {
    afcStatus,
    afcErrorStatus,
    afcBypassStatus,
    afcRammingStatus,
    afcWithMacrosStatus,
} from './fixtures/afc.mjs'

const [url, out, width = '1400', theme = 'dark', state = 'loaded'] = process.argv.slice(2)

const fixtures = {
    loaded: afcStatus,
    sweep: afcStatus,
    error: afcErrorStatus,
    bypass: afcBypassStatus,
    ramming: afcRammingStatus,
    macros: afcWithMacrosStatus,
}
const status = fixtures[state]
if (!status) throw new Error(`unknown state "${state}"`)

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
    await page.setViewport({ width: Number(width), height: Number(process.env.HEIGHT ?? 1400), deviceScaleFactor: 2 })

    await installRig(page, { status, theme })

    const errors = []
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    page.on('pageerror', (e) => errors.push(String(e)))

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
    await page
        .waitForSelector('[data-panel="afc"]', { timeout: 25000 })
        .catch(() => console.error('WARN: the AFC panel never appeared'))
    await new Promise((r) => setTimeout(r, 800))

    console.log('state               :', state)

    // The lane cards, each with the state the card decided for itself. A card
    // rendering the wrong branch is the failure this catches, and it is not
    // visible in a screenshot unless you already know what to expect.
    console.log(
        'lanes               :',
        await page.evaluate(() =>
            [...document.querySelectorAll('[data-lane]')].map(
                (el) => `${el.getAttribute('data-lane')}=${el.getAttribute('data-lane-state')}`
            )
        )
    )
    console.log(
        'lane buttons        :',
        await page.evaluate(() =>
            [...document.querySelectorAll('[data-lane]')].map((el) => {
                const labels = [...el.querySelectorAll('button')].map(
                    (b) => b.getAttribute('title') ?? b.textContent.trim()
                )
                return `${el.getAttribute('data-lane')}: ${labels.join(' / ')}`
            })
        )
    )
    console.log(
        'extruder row        :',
        await page.evaluate(() => {
            const row = document.querySelector('[data-afc-extruder]')
            if (!row) return 'absent'
            return {
                text: row.innerText.replace(/\n/g, ' | '),
                dots: [...row.querySelectorAll('span.rounded-full')].map((d) => d.getAttribute('title')),
            }
        })
    )
    console.log(
        'unit / hub          :',
        await page.evaluate(() => {
            const unit = document.querySelector('[data-afc-unit]')
            if (!unit) return 'absent'
            return {
                name: unit.querySelector('h3')?.innerText.trim(),
                hasIcon: !!unit.querySelector('h3 svg'),
                hub: unit.querySelector('span.rounded-full')?.getAttribute('title'),
            }
        })
    )
    console.log(
        'message / bypass    :',
        await page.evaluate(() => ({
            message: document.querySelector('[data-testid="afc-message"]')?.innerText.replace(/\n/g, ' ⏎ ') ?? null,
            bypass: document.querySelector('[data-testid="afc-bypass"]')?.innerText ?? null,
        }))
    )

    if (state === 'macros') {
        await page.evaluate(() => document.querySelector('[aria-label="AFC functions"]')?.click())
        await new Promise((r) => setTimeout(r, 400))
        console.log(
            'macro rows          :',
            await page.evaluate(() =>
                [...document.querySelectorAll('[role="menu"] [data-afc-macro]')].map(
                    (el) => `${el.getAttribute('data-afc-macro')} -> "${el.innerText.trim()}"`
                )
            )
        )

        // And FIRE them. Listing the rows proves the filter; only clicking
        // proves the row is wired to the command it names. Without this the
        // g-code artifact covered MMU's menu but not AFC's.
        await page.evaluate(() => {
            for (const item of document.querySelectorAll('[role="menu"] [data-afc-macro]')) item.click()
        })
        await new Promise((r) => setTimeout(r, 500))
        await page.keyboard.press('Escape')
    }

    if (state === 'sweep') {
        // Every lane action, then the two dialogs, then the menu's macros.
        // Order matters: the dialogs are inside the lane cards, so they have to
        // be opened and closed one at a time or the overlay eats the next click.
        await page.evaluate(() => {
            for (const card of document.querySelectorAll('[data-lane]')) {
                for (const button of card.querySelectorAll('button[title]')) button.click()
            }
        })
        await new Promise((r) => setTimeout(r, 300))

        for (const testid of ['afc-map-tools', 'afc-runout-lanes']) {
            const opener = testid === 'afc-map-tools' ? 'Map lane lane2 to a tool' : 'Infinite spool for lane lane2'
            await page.evaluate((label) => document.querySelector(`[aria-label="${label}"]`)?.click(), opener)
            await new Promise((r) => setTimeout(r, 400))
            const offered = await page.evaluate(
                (id) =>
                    [...(document.querySelector(`[data-testid="${id}"]`)?.querySelectorAll('button') ?? [])].map(
                        (b) => `${b.textContent.trim()}${b.disabled ? ' (disabled)' : ''}`
                    ),
                testid
            )
            console.log(`${testid.padEnd(20)}:`, offered)
            // Click the first enabled one, then the dialog closes itself.
            await page.evaluate((id) => {
                const button = [...(document.querySelector(`[data-testid="${id}"]`)?.querySelectorAll('button') ?? [])
                    ].find((b) => !b.disabled)
                button?.click()
            }, testid)
            await new Promise((r) => setTimeout(r, 400))
            await page.keyboard.press('Escape')
            await new Promise((r) => setTimeout(r, 300))
        }

        await page.evaluate(() => document.querySelector('[aria-label="AFC functions"]')?.click())
        await new Promise((r) => setTimeout(r, 400))
        console.log(
            'menu rows           :',
            await page.evaluate(() =>
                [...document.querySelectorAll('[role="menu"] [role="menuitem"], [role="menu"] [role="menuitemcheckbox"]')].map(
                    (el) => el.innerText.trim().replace(/\n/g, ' ')
                )
            )
        )
        await page.evaluate(() => {
            for (const item of document.querySelectorAll('[role="menu"] [data-afc-macro]')) item.click()
        })
        await new Promise((r) => setTimeout(r, 400))
        await page.keyboard.press('Escape')
    }

    const panel = await page.$('[data-panel="afc"]')
    if (panel) await panel.screenshot({ path: out })
    else await page.screenshot({ path: out })

    const report = await rigReport(page)
    console.log('gcode the page sent :', report.gcode.length ? report.gcode : '(none)')
    console.log('blocked calls       :', report.blockedCalls.length ? [...new Set(report.blockedCalls)] : '(none)')
    console.log('status injected     :', report.injected)
    console.log(errors.length ? 'console errors: ' + errors.join(' | ') : 'no console errors')
    console.log('saved ' + out)
} finally {
    await browser.close()
}
