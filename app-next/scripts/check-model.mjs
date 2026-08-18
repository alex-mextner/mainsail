#!/usr/bin/env node
/**
 * What the 3D tile in the /overcam bar does with a real g-code file, by number.
 *
 *   node scripts/check-model.mjs <url> [wxh]
 *   RENDERABLE=cube30_sliced.gcode EMPTY=endurance_v300.gcode node scripts/check-model.mjs <url>
 *
 * The bug this exists for was reported as "the 3D model does not load", with one
 * line of console pasted with it: `Missing feature Brim`. Two separate things were
 * true at once, and neither could be told apart by looking:
 *
 *   - `Missing feature Brim` is @sindarius/gcodeviewer 3.7.17 shouting console.error
 *     about a COLOUR it has no entry for. It is not fatal - the file that produces
 *     it renders perfectly - but it is red, and it was the only thing visible.
 *   - the file actually on the printer at the time had every E word stripped out for
 *     a motion test, so there was genuinely nothing to draw; the tile fell back to
 *     the thumbnail and said "3D model unavailable", which reads as a fault.
 *
 * So this walks BOTH files and asserts the two different outcomes, in a fresh
 * browser context each, and FAILS (exit 1) rather than printing:
 *
 *   a renderable file
 *     1. reaches state 'live'
 *     2. is FRAMED - the camera ends up around the part, not around the bed. A scene
 *        that came up empty would leave resetCamera()'s radius of 3*bedCentre (330 on
 *        this bed) instead of span*1.7 (about 58 for a 30 mm cube), so this is the
 *        check that can tell "rendered nothing" from "rendered the part".
 *     3. produces NO 'Missing feature' line any more - the roles Orca writes and the
 *        library does not know are registered before the first ;TYPE: is looked up
 *     4. produces no page errors at all
 *
 *   a file with no extrusion
 *     5. reaches state 'empty', NOT 'error' and not a stuck 'loading'
 *     6. says so IN WORDS, and in words that name the reason - a thumbnail with a
 *        shrug on it is what started this
 *     7. never downloads the 320 kB engine, because the file is read first and the
 *        answer is known before the engine could be of any use
 *     8. downloads the g-code exactly once
 *
 * Everything is addressed through data-overcam-* attributes and the wire, never the
 * component, so the same script runs against the Vue 2 build on :80, the staging
 * copy on :8091 and the Vue 3 port on :8090.
 */
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const [url = 'http://192.168.11.160/overcam/mbot', size = '1920x1080'] = process.argv.slice(2)
const [width, height] = size.split('x').map(Number)

const RENDERABLE = process.env.RENDERABLE ?? 'cube30_sliced.gcode'
const EMPTY = process.env.EMPTY ?? 'endurance_v300.gcode'

// resetCamera() frames the whole build volume; frameModel() frames what was loaded.
// Anything at or above this is the bed, i.e. an empty scene.
const BED_RADIUS = 200

const candidates = [
    join(homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
]
const browser = await puppeteer.launch({
    executablePath: candidates.find((p) => existsSync(p)),
    headless: true,
    // swiftshader: the tile needs a working webgl context and headless chrome has no gpu
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const failures = []
const check = (ok, message) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`)
    if (!ok) failures.push(message)
}

/*
 * Which file the tile shows is decided by the printer - it follows print_stats.filename -
 * and most of the files on this machine are motion diagnostics. So one Moonraker
 * `notify_status_update` frame is rewritten on the websocket the page opened itself, which
 * keeps this at the protocol rather than in Vuex or Pinia: the protocol is the same for both
 * front ends, the store is not. One frame is not enough - a running print keeps publishing
 * print_stats and every one of those puts the real name back - so every frame is rewritten.
 */
const seedFile = (modelFile) => {
    window.__overcamModelFile = modelFile || null
    const rewrite = (event) => {
        if (!window.__overcamModelFile) return event
        try {
            const message = JSON.parse(event.data)
            const stats = message?.params?.[0]?.print_stats ?? message?.result?.status?.print_stats
            if (!stats) return event

            stats.filename = window.__overcamModelFile
            stats.print_duration = Math.max(stats.print_duration ?? 0, 42)
            return new MessageEvent('message', { data: JSON.stringify(message) })
        } catch {
            return event
        }
    }

    const Original = window.WebSocket
    window.WebSocket = new Proxy(Original, {
        construct(target, args) {
            const socket = new target(...args)
            const add = socket.addEventListener.bind(socket)
            socket.addEventListener = (type, handler, options) =>
                add(
                    type,
                    type === 'message' && typeof handler === 'function' ? (e) => handler(rewrite(e)) : handler,
                    options
                )
            Object.defineProperty(socket, 'onmessage', {
                configurable: true,
                get: () => null,
                set: (handler) => add('message', (e) => handler(rewrite(e))),
            })
            return socket
        },
    })

    localStorage.setItem('mainsail-next.theme', 'dark')
    localStorage.removeItem('webcamHudPlacement')
    localStorage.removeItem('mainsail-next.webcamHudPlacement')
    // opted in up front: the click itself is drag-overcam.mjs's business, this script is
    // about what happens AFTER it, and both keys because the two front ends name it differently
    localStorage.setItem('webcamHudModelOptIn', '1')
    localStorage.setItem('mainsail-next.webcamHudModelOptIn', '1')
}

const readTile = () => {
    const tile = document.querySelector('[data-overcam-model]')
    if (!tile?.getClientRects().length) return { state: null }

    return {
        state: tile.dataset.overcamModelState ?? '',
        file: tile.dataset.overcamModelFile ?? '',
        camera: tile.dataset.overcamModelCamera ?? '',
        text: tile.innerText.replace(/\s+/g, ' ').trim(),
    }
}

/** Open the page with `file` seeded, wait for the tile to settle, and report what happened. */
const run = async (file) => {
    // a context of its own per file: "the engine was never fetched" is only meaningful
    // when a previous run has not already put it in the cache
    const context = await browser.createBrowserContext()
    const page = await context.newPage()

    try {
        await page.setViewport({ width, height, deviceScaleFactor: 1 })
        await page.evaluateOnNewDocument(seedFile, file)

        const console_ = []
        const errors = []
        page.on('console', (m) => console_.push({ type: m.type(), text: m.text() }))
        page.on('pageerror', (e) => errors.push(String(e)))

        let engineFetches = 0
        let gcodeFetches = 0
        page.on('request', (r) => {
            if (/sindarius-gcodeviewer/.test(r.url())) engineFetches += 1
            if (r.url().includes('/server/files/gcodes/') && r.url().endsWith('.gcode')) gcodeFetches += 1
        })

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 40000 })
        await page.waitForFunction(() => document.body.innerText.includes('ETA'), { timeout: 30000 })

        // the tile auto-loads once the metadata is in; give up after 60 s rather than hang
        let tile = { state: null }
        for (let i = 0; i < 30; i++) {
            await sleep(2000)
            tile = await page.evaluate(readTile)
            if (['live', 'empty', 'error'].includes(tile.state)) break
        }
        await sleep(1500)
        tile = await page.evaluate(readTile)

        return { tile, console_, errors, engineFetches, gcodeFetches }
    } finally {
        await context.close()
    }
}

try {
    console.log(`\n=== ${RENDERABLE} - a real print, must render ===`)
    let r = await run(RENDERABLE)
    console.log(JSON.stringify(r.tile))
    console.log(`engine fetches ${r.engineFetches}, gcode fetches ${r.gcodeFetches}`)

    check(r.tile.state === 'live', `the tile reaches 'live' (got '${r.tile.state}')`)
    const radius = Number(r.tile.camera.split(',')[2])
    check(
        Number.isFinite(radius) && radius > 0 && radius < BED_RADIUS,
        `the camera framed the part, not the empty bed (radius ${r.tile.camera || '(never moved)'})`
    )
    const missing = r.console_.filter((m) => /Missing feature/.test(m.text))
    check(missing.length === 0, `no 'Missing feature' left in the console (${missing.map((m) => m.text).join(', ')})`)
    check(r.errors.length === 0, `no page errors (${r.errors.join(' | ')})`)

    console.log(`\n=== ${EMPTY} - no extrusion, must say so ===`)
    r = await run(EMPTY)
    console.log(JSON.stringify(r.tile))
    console.log(`engine fetches ${r.engineFetches}, gcode fetches ${r.gcodeFetches}`)

    check(r.tile.state === 'empty', `the tile reaches 'empty', not a fault (got '${r.tile.state}')`)
    check(/extrusion/i.test(r.tile.text), `and says why, in words: "${r.tile.text}"`)
    check(r.engineFetches === 0, `the 3D engine was never downloaded for it (${r.engineFetches} request(s))`)
    check(r.gcodeFetches === 1, `the g-code came off the printer exactly once (${r.gcodeFetches})`)
    const crashed = r.console_.filter((m) => /3D model could not be loaded/.test(m.text))
    check(crashed.length === 0, `nothing crashed on the way there (${crashed.length} report(s))`)
    check(r.errors.length === 0, `no page errors (${r.errors.join(' | ')})`)
} finally {
    await browser.close()
}

console.log(failures.length ? `\n${failures.length} FAILED` : '\nall checks passed')
process.exit(failures.length ? 1 : 0)
