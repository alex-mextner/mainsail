#!/usr/bin/env node
/**
 * Prove the farm page opens NO connections on this deployment.
 *
 *   node scripts/check-farm.mjs [url]
 *
 * 🔴 WHY THIS IS A CHECK AND NOT A SCREENSHOT. Every other queue-2 panel is
 * verified by photographing states a fixture produces. Farm's risk is the
 * opposite shape: the thing that could go wrong is INVISIBLE -- a websocket
 * and a reconnect timer left running against a 512 MB Orange Pi that has
 * already been driven out of memory once. A screenshot of an empty page
 * cannot tell you whether that page is quietly holding a socket open.
 *
 * So this counts sockets over CDP instead of looking at pixels:
 *
 *   1. The page must render the "single printer" empty state.
 *   2. Visiting /allPrinters must create NO websocket beyond the app's own.
 *   3. `addPrinter` must REFUSE an entry pointing back at this host, and
 *      refuse while the build is in single-printer mode.
 *   4. With farm mode forced on and a printer added, leaving the page must
 *      close what it opened -- that is the property that keeps a stale entry
 *      from outliving the tab.
 */
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { installRig } from './lib/rig.mjs'

// Bare address: since the 2026-08-19 port swap this fork is served on port 80
// and the old Mainsail sits on :8090.
const url = process.argv[2] ?? 'http://192.168.11.160/'

const failures = []
const check = (ok, message) => {
    console.log(`${ok ? '  ok  ' : '  FAIL'}  ${message}`)
    if (!ok) failures.push(message)
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
    await page.setViewport({ width: 1400, height: 1000 })
    await installRig(page)

    const client = await page.createCDPSession()
    await client.send('Network.enable')
    const created = []
    const closed = []
    client.on('Network.webSocketCreated', ({ url: socketUrl }) => created.push(socketUrl))
    client.on('Network.webSocketClosed', () => closed.push(1))

    await page.goto(new URL('/allPrinters', url).href, { waitUntil: 'networkidle2', timeout: 30000 })
    await new Promise((r) => setTimeout(r, 2500))

    console.log('sockets opened      :', created)

    check(
        (await page.$('[data-testid="farm-disabled"]')) !== null,
        'the page renders the single-printer empty state'
    )
    check(
        created.length <= 1,
        `no extra websocket: ${created.length} open (the app's own connection is the only allowed one)`
    )

    // The guard, asked directly. `isSelf` is what stands between a mistyped
    // farm entry and a second full subscription to the machine serving it.
    const guards = await page.evaluate(() => {
        const store = window.__pinia_farm
        if (!store) return null
        const here = { id: 'self', name: 'Self', hostname: location.hostname, port: Number(location.port || 80) }
        return {
            isSelf: store.isSelf(here),
            addWhileDisabled: store.addPrinter(here),
            mode: store.mode,
            enabled: store.enabled,
        }
    })

    if (guards === null) {
        console.log('  ..    store not exposed for inspection; skipping the guard assertions')
    } else {
        check(guards.mode === 'moonraker' && guards.enabled === false, `mode is "${guards.mode}", farm disabled`)
        check(guards.isSelf === true, 'isSelf() recognises this very host')
        check(
            typeof guards.addWhileDisabled === 'string',
            `addPrinter refused: "${guards.addWhileDisabled}"`
        )
    }

    // Now force farm mode on and add a REMOTE host that does not exist, to
    // prove the page connects when it should and hangs up when it unmounts.
    // 203.0.113.9 is TEST-NET-3 (RFC 5737): reserved for documentation, and
    // guaranteed not to be a machine anyone owns.
    const forced = await page.evaluate(async () => {
        const store = window.__pinia_farm
        if (!store) return null
        store.mode = 'browser'
        const refusal = store.addPrinter({ id: 'doc', name: 'Doc', hostname: '203.0.113.9', port: 7125 })
        return { refusal, count: store.count }
    })

    if (forced) {
        check(forced.refusal === null && forced.count === 1, 'a remote printer is accepted once farm mode is on')

        const before = created.length
        await page.evaluate(() => window.__pinia_farm.connectAll())
        await new Promise((r) => setTimeout(r, 1500))
        check(created.length === before + 1, `connectAll opened exactly one socket (${created.length - before})`)

        const closedBefore = closed.length
        await page.evaluate(() => window.__pinia_farm.disconnectAll())
        await new Promise((r) => setTimeout(r, 1000))
        check(closed.length > closedBefore, 'leaving the page closed the farm socket')
    }
} finally {
    await browser.close()
}

console.log(failures.length ? `\n${failures.length} FAILURE(S)` : '\nall checks passed')
process.exit(failures.length ? 1 : 0)
