#!/usr/bin/env node
/**
 * Screenshot the webcam panel AS IF the machine had more than one camera.
 *
 *   node scripts/shoot-multicam.mjs <url> <out> [width] [theme] [cameras]
 *
 * 🔴 WHY THIS EXISTS RATHER THAN "JUST ADD A SECOND CAMERA"
 * --------------------------------------------------------
 * This machine has exactly ONE camera, so three code paths in WebcamPanel are
 * unreachable against it: the switcher (`showSwitch` is false at one camera),
 * the 'all' grid, and the grid's own one-vs-two-column container query. They
 * are the paths most likely to be wrong, and shipping them unverified would be
 * exactly the "looks right, was never measured" failure this project keeps
 * catching.
 *
 * The obvious way to test them -- adding a camera through
 * `server.webcams.post_item` -- writes the Moonraker database, which is the
 * SAME database the working Mainsail on port 80 reads. The rewrite is not
 * allowed to change the interface the user prints with, and `stores/webcams.ts`
 * says in its own header that it only ever reads. So the second camera is
 * injected into the WEBSOCKET REPLY inside the browser instead: the printer
 * sends its one real camera, and the page sees two before the app ever parses
 * the frame. Nothing on the printer changes, and the injected camera points at
 * the same real stream, so the tiles show live pictures rather than placeholder
 * boxes.
 *
 * Technique borrowed from `reconnect-check.mjs`, which patches `window.WebSocket`
 * for the same reason: the interesting state is only reachable from inside the
 * page.
 *
 * The interception targets `server.webcams.list` by request id -- matching on
 * the method name alone would not work, because a JSON-RPC REPLY carries only
 * the id, never the method that produced it.
 */
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const [url, out, width = '1400', theme = 'dark', cameras = '2'] = process.argv.slice(2)

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
    await page.setViewport({ width: Number(width), height: Number(process.env.HEIGHT ?? 900), deviceScaleFactor: 2 })

    await page.evaluateOnNewDocument(
        (wanted, t) => {
            localStorage.setItem('mainsail-next.theme', t)
            localStorage.setItem('mainsail-next.density', 'auto')

            const Native = window.WebSocket
            window.__injected = 0

            function Patched(...args) {
                const socket = new Native(...args)
                const listRequestIds = new Set()
                let appHandler = null

                // Record the id of every server.webcams.list request, so the
                // reply can be recognised: a JSON-RPC reply has an id and no
                // method.
                const nativeSend = socket.send.bind(socket)
                socket.send = (payload) => {
                    try {
                        const frame = JSON.parse(payload)
                        if (frame?.method === 'server.webcams.list') listRequestIds.add(frame.id)
                    } catch {
                        /* binary or malformed -- not ours */
                    }
                    return nativeSend(payload)
                }

                // The app assigns `socket.onmessage = fn`. Shadowing the
                // prototype accessor with an own property captures that
                // assignment; the native event still reaches the listener
                // added below, which forwards a possibly-rewritten copy.
                Object.defineProperty(socket, 'onmessage', {
                    configurable: true,
                    get: () => appHandler,
                    set: (fn) => {
                        appHandler = fn
                    },
                })

                socket.addEventListener('message', (event) => {
                    if (!appHandler) return

                    let data = event.data
                    try {
                        const frame = JSON.parse(data)
                        const cams = frame?.result?.webcams
                        if (listRequestIds.has(frame?.id) && Array.isArray(cams) && cams.length) {
                            const real = cams[0]
                            // Clones of the REAL camera: same relative urls, so
                            // every tile shows the live picture and the layout
                            // is measured against real frames, not grey boxes.
                            while (cams.length < wanted) {
                                cams.push({
                                    ...real,
                                    name: `injected-${cams.length}`,
                                    uid: `injected-${cams.length}`,
                                    icon: 'mdiPrinter3dNozzle',
                                })
                            }
                            window.__injected = cams.length
                            data = JSON.stringify(frame)
                        }
                    } catch {
                        /* not JSON -- pass through untouched */
                    }

                    appHandler({ data })
                })

                return socket
            }

            Patched.prototype = Native.prototype
            Object.assign(Patched, Native)
            window.WebSocket = Patched
        },
        Number(cameras),
        theme
    )

    const errors = []
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    page.on('pageerror', (e) => errors.push(String(e)))

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
    await page
        .waitForFunction(() => document.body.innerText.includes('Webcam'), { timeout: 25000 })
        .catch(() => console.error('WARN: the webcam panel never appeared'))
    await new Promise((r) => setTimeout(r, 4000))

    console.log('cameras the page saw:', await page.evaluate(() => window.__injected))
    // Proof the grid really rendered a tile per camera, not one stretched image.
    console.log('stream elements:', await page.evaluate(() => document.querySelectorAll('img.webcam-image').length))

    await page.screenshot({ path: out, fullPage: true })
    console.log(errors.length ? 'console errors: ' + errors.join(' | ') : 'no console errors')
    console.log('saved ' + out)
} finally {
    await browser.close()
}
