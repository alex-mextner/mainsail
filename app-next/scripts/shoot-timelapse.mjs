#!/usr/bin/env node
/**
 * Screenshot /timelapse AS IF moonraker-timelapse were installed.
 *
 *   node scripts/shoot-timelapse.mjs <url> <out> [width] [theme] [state]
 *
 *   state: rigged     the component answers -- files, frame count, settings
 *          printing   same, plus print_stats printing: the panel becomes the
 *                     two switches that decide this print's timelapse
 *          rendering  same as rigged, plus a render event pushed at 42 %
 *          none       no fixture at all -- what this machine really shows
 *
 * The one thing worth stating: in `none` mode the page is still REACHABLE. The
 * sidebar entry is hidden because Moonraker has no `timelapse` component, but
 * the route resolves and explains itself, because a bookmarked link deserves a
 * better answer than "not found".
 */
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { installRig, rigReport } from './lib/rig.mjs'
import { timelapseRpc, timelapseRenderEvent } from './fixtures/timelapse.mjs'

const [url, out, width = '1400', theme = 'dark', state = 'rigged'] = process.argv.slice(2)

if (!['rigged', 'printing', 'rendering', 'none'].includes(state)) throw new Error(`unknown state "${state}"`)

const rigged = state !== 'none'
const status = state === 'printing' ? { print_stats: { state: 'printing' } } : {}

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

    await installRig(page, {
        status,
        theme,
        rpc: rigged ? timelapseRpc : {},
        components: rigged ? ['timelapse'] : [],
    })

    const errors = []
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    page.on('pageerror', (e) => errors.push(String(e)))
    const failed = []
    page.on('response', (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`))

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
    await new Promise((r) => setTimeout(r, 1500))

    if (state === 'rendering') {
        // Pushed the way Moonraker pushes it -- through the app's own socket
        // handler, not by writing into the store. A store poke would prove the
        // template renders; this proves the notification is wired to it.
        await page.evaluate((event) => {
            const frame = { jsonrpc: '2.0', method: 'notify_timelapse_event', params: [event] }
            for (const socket of window.__rigSockets ?? []) socket.deliver(frame)
        }, timelapseRenderEvent)
        await new Promise((r) => setTimeout(r, 400))
    }

    console.log('state                :', state)
    console.log(
        'sidebar entries      :',
        await page.evaluate(() => [...document.querySelectorAll('nav a')].map((a) => a.innerText.trim()))
    )
    console.log(
        'page text            :',
        await page.evaluate(() => {
            const main = document.querySelector('main') ?? document.body
            return main.innerText.split('\n').filter(Boolean).slice(0, 30)
        })
    )

    const report = await rigReport(page)
    console.log('faked rpc            :', report.rpc.length ? [...new Set(report.rpc)] : '(none)')
    console.log('gcode the page sent  :', report.gcode.length ? report.gcode : '(none)')
    console.log('failed requests      :', failed.length ? [...new Set(failed)] : '(none)')

    await page.screenshot({ path: out, fullPage: true })
    console.log(errors.length ? 'console errors: ' + errors.join(' | ') : 'no console errors')
    console.log('saved ' + out)
} finally {
    await browser.close()
}
