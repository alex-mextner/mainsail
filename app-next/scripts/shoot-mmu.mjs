#!/usr/bin/env node
/**
 * Screenshot the MMU panel AS IF a Happy Hare ERCF were attached.
 *
 *   node scripts/shoot-mmu.mjs <url> <out> [width] [theme] [state]
 *
 *   state: idle      eight gates, gate 0 selected, filament loaded
 *          disabled  MMU ENABLE=0 -- panel visible, dimmed, "(disabled)"
 *          paused    pause_locked after an error: Unlock becomes available
 *          bypass    the bypass selected, so Load/Unload rename to "ext."
 *          sweep     idle, but every enabled control is clicked and the
 *                    g-code it WOULD have sent is printed
 *
 * 🔴 Every MMU button sends g-code -- MMU_LOAD, MMU_EJECT, MMU_SELECT,
 * MMU_CHECK_GATES -- and on a printer with no `mmu` object each is an
 * "Unknown command" at best. They are recorded and dropped at the socket by
 * `lib/rig.mjs`, whose firewall `check-rig-firewall.mjs` verifies separately.
 */
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { installRig, rigReport } from './lib/rig.mjs'
import { mmuStatus, mmuDisabledStatus, mmuPausedStatus, mmuBypassStatus } from './fixtures/mmu.mjs'

const [url, out, width = '1400', theme = 'dark', state = 'idle'] = process.argv.slice(2)

const fixtures = {
    idle: mmuStatus,
    sweep: mmuStatus,
    disabled: mmuDisabledStatus,
    paused: mmuPausedStatus,
    bypass: mmuBypassStatus,
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
        .waitForSelector('[data-panel="mmu"]', { timeout: 25000 })
        .catch(() => console.error('WARN: the MMU panel never appeared'))
    await new Promise((r) => setTimeout(r, 800))

    console.log('state               :', state)
    console.log(
        'panel               :',
        // 🔴 `[data-panel="mmu"]` is Panel.vue's own <section>, NOT the body.
        // The dim class and the enabled flag live on the inner div, so they
        // have to be read from `[data-mmu-body]` -- querying the section for
        // them returned "not dimmed" for the disabled fixture, which is how
        // this was caught.
        await page.evaluate(() => {
            const section = document.querySelector('[data-panel="mmu"]')
            const body = document.querySelector('[data-mmu-body]')
            if (!section || !body) return 'absent'
            return {
                enabled: body.getAttribute('data-mmu-enabled'),
                title: section.querySelector('h2,h3')?.innerText,
                dimmed: body.className.includes('opacity-50'),
            }
        })
    )

    // Each gate's status and the amount its spool decided to draw. This is the
    // check a screenshot cannot make: -1 (draw full, no number) and 0 (draw
    // nothing) look similar at 40px but mean opposite things.
    console.log(
        'gates               :',
        await page.evaluate(() =>
            [...document.querySelectorAll('[data-gate]')].map((el) => {
                const spool = el.querySelector('[data-gate-spool]')
                return `${el.getAttribute('data-gate')}:st=${el.getAttribute('data-gate-status')},amt=${spool?.getAttribute('data-filament-amount')}${el.getAttribute('data-gate-selected') === 'true' ? ',SEL' : ''}`
            })
        )
    )
    console.log(
        'spool colours       :',
        await page.evaluate(() =>
            [...document.querySelectorAll('[data-gate-spool]')].map((svg) => {
                const path = [...svg.querySelectorAll('path')].find((p) => p.getAttribute('transform')?.startsWith('matrix('))
                return `${svg.getAttribute('data-gate-spool')}=${path?.getAttribute('fill') ?? 'none'}`
            })
        )
    )
    console.log(
        'buttons             :',
        await page.evaluate(() =>
            [...document.querySelectorAll('[data-mmu-button]')].map(
                (b) => `${b.getAttribute('data-mmu-button')}${b.disabled ? '(off)' : ''}`
            )
        )
    )
    console.log(
        'ttg map             :',
        await page.evaluate(() => {
            const svg = document.querySelector('[data-testid="mmu-ttg-map"]')
            if (!svg) return 'absent'
            return {
                viewBox: svg.getAttribute('viewBox'),
                lines: svg.querySelectorAll('path[marker-end]').length,
                groupBrackets: svg.querySelectorAll('path[stroke-linecap="round"]').length,
                labels: [...svg.querySelectorAll('text')].map((t) => t.textContent.trim()).join(' '),
            }
        })
    )
    console.log(
        'summary / error     :',
        await page.evaluate(() => ({
            toolchange: document.querySelector('[data-testid="mmu-toolchange"]')?.innerText ?? null,
            gateSummary: document.querySelector('[data-testid="mmu-gate-summary"]')?.innerText ?? null,
            lastError: document.querySelector('[data-testid="mmu-last-error"]')?.innerText.replace(/\n/g, ' | ') ?? null,
        }))
    )

    if (state === 'sweep') {
        await page.evaluate(() => {
            for (const button of document.querySelectorAll('[data-mmu-button]')) {
                if (!button.disabled) button.click()
            }
            // One gate click, to prove MMU_SELECT carries the right number.
            document.querySelector('[data-gate="5"]')?.click()
            document.querySelector('[data-gate="-2"]')?.click()
        })
        await new Promise((r) => setTimeout(r, 400))

        await page.evaluate(() => document.querySelector('[aria-label="MMU functions"]')?.click())
        await new Promise((r) => setTimeout(r, 400))
        console.log(
            'menu rows           :',
            await page.evaluate(() =>
                [
                    ...document.querySelectorAll(
                        '[role="menu"] [role="menuitem"], [role="menu"] [role="menuitemcheckbox"]'
                    ),
                ].map((el) => `${el.innerText.trim().replace(/\n/g, ' ')}${el.getAttribute('data-disabled') !== null ? '(off)' : ''}`)
            )
        )
        await page.evaluate(() => {
            for (const item of document.querySelectorAll('[role="menu"] [data-mmu-menu]')) item.click()
        })
        await new Promise((r) => setTimeout(r, 400))
        await page.keyboard.press('Escape')
        await new Promise((r) => setTimeout(r, 300))
    }

    const panel = await page.$('[data-panel="mmu"]')
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
