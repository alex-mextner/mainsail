#!/usr/bin/env node
/**
 * Drive the /overcam hud with a real pointer and check what it does, by number.
 *
 *   node scripts/drag-overcam.mjs <url> <outDir> [wxh]
 *
 * The window shape defaults to 1280x1024, on purpose: with a 4:3 camera that
 * leaves only 64px of letterbox, below the 90px a readable row needs. So it is
 * the case where the AUTOMATIC placement correctly refuses to dock - which makes
 * it the right place to prove the MANUAL one works anyway.
 *
 * Checked:
 *   1. eight floating anchors and four dock bars are all offered while dragging,
 *      and exactly one of them is highlighted
 *   2. dropping the hud on an edge docks it into that edge, even when the
 *      automatic measurement said there was no room
 *   3. a docked hud never covers the picture, and the frame moves aside for it
 *   4. the placement is stored as NAMES (mode/anchor/side), not pixels, and it
 *      survives a reload
 *   5. dropping in the middle floats it again, at one of the eight anchors
 *   6. the toolbar button docks and undocks without any dragging
 *   7. the 3D tile in the bar turns with a plain MOUSE drag, and turning it does
 *      not drag the overlay out of its bar with it
 *
 * Everything is addressed through data-overcam-* attributes, so the same script
 * runs against the Vue 2 build on :80 and the Vue 3 port on :8090.
 */
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const [url, outDir = '.', size = '1280x1024'] = process.argv.slice(2)
const [width, height] = size.split('x').map(Number)

/*
 * MODEL_FILE='Куб_0.2mm_PETG_....gcode' node scripts/drag-overcam.mjs <url> <dir>
 *
 * Which file the 3D tile shows is decided by the printer, not by this script: the tile
 * follows print_stats.filename. That makes the rotation check depend on whatever the user
 * last printed - and half the files on this machine are motion diagnostics with no extrusion
 * at all, which the renderer genuinely cannot draw. Naming a file here makes the check
 * deterministic.
 *
 * The file is seeded by faking one Moonraker `notify_status_update` frame on the websocket
 * the page already opened - NOT by reaching into Vuex or Pinia. That is the whole point: the
 * protocol is the same for the Vue 2 build and the Vue 3 port, the framework is not, and the
 * front end then goes and fetches the metadata for the new name entirely by itself, exactly
 * as it does for a real print.
 */
const MODEL_FILE = process.env.MODEL_FILE ?? ''

const candidates = [
    join(homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
]
const browser = await puppeteer.launch({
    executablePath: candidates.find((p) => existsSync(p)),
    headless: true,
    // swiftshader: the 3D tile needs a working webgl context, and headless chrome has no gpu
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const failures = []
const check = (ok, message) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`)
    if (!ok) failures.push(message)
}

const state = () => {
    const root = document.querySelector('[data-overcam-root]')
    const hud = root?.querySelector('[data-overcam-hud]')
    const media = root?.querySelector('img.webcamImage, video.webcamImage, img, video')

    const box = media?.getBoundingClientRect()
    // naturalWidth reads 0 between snapshots on mjpegstreamer-adaptive, so keep the
    // last real frame size and fall back to the ratio the overlay itself uses
    let nw = media?.naturalWidth || media?.videoWidth || 0
    let nh = media?.naturalHeight || media?.videoHeight || 0
    if (nw && nh) window.__overcamNatural = { nw, nh }
    else if (window.__overcamNatural) ({ nw, nh } = window.__overcamNatural)
    else if (Number(root?.dataset.frameAspect)) {
        nw = Number(root.dataset.frameAspect)
        nh = 1
    }

    const scale = box && nw && nh ? Math.min(box.width / nw, box.height / nh) : 0
    const pw = nw * scale
    const ph = nh * scale
    const painted = box
        ? { l: box.left + (box.width - pw) / 2, t: box.top + (box.height - ph) / 2, w: pw, h: ph }
        : null

    const hudRect = hud?.getBoundingClientRect()

    return {
        mode: root?.dataset.hudMode,
        anchor: root?.dataset.hudAnchor,
        axis: root?.dataset.dockAxis,
        side: root?.dataset.dockSide,
        size: Number(root?.dataset.dockSize ?? 0),
        shift: root?.dataset.dockShift === '1',
        painted: painted && {
            l: Math.round(painted.l),
            t: Math.round(painted.t),
            w: Math.round(painted.w),
            h: Math.round(painted.h),
        },
        hud: hudRect && {
            l: Math.round(hudRect.left),
            t: Math.round(hudRect.top),
            w: Math.round(hudRect.width),
            h: Math.round(hudRect.height),
        },
        overlapsImage:
            hudRect && painted
                ? hudRect.right > painted.l + 1 &&
                  hudRect.left < painted.l + painted.w - 1 &&
                  hudRect.bottom > painted.t + 1 &&
                  hudRect.top < painted.t + painted.h - 1
                : null,
        stored: localStorage.getItem('webcamHudPlacement') ?? localStorage.getItem('mainsail-next.webcamHudPlacement'),
        model: (() => {
            // getClientRects(), not just "exists": the tile stays mounted while the hud
            // floats (that is what keeps a loaded scene alive across an undock) and is
            // hidden with `display: none`, where every coordinate reads zero.
            const tile = document.querySelector('[data-overcam-model]')
            if (!tile?.getClientRects().length) return null
            return {
                state: tile.dataset.overcamModelState ?? '',
                camera: tile.dataset.overcamModelCamera ?? '',
                box: (({ left, top, width, height }) => ({
                    x: Math.round(left + width / 2),
                    y: Math.round(top + height / 2),
                    w: Math.round(width),
                    h: Math.round(height),
                }))(tile.getBoundingClientRect()),
            }
        })(),
        targets: {
            bars: document.querySelectorAll('[data-overcam-bar]').length,
            barsActive: document.querySelectorAll('[data-overcam-bar][data-active="1"]').length,
            snaps: document.querySelectorAll('[data-overcam-snap]').length,
            snapsActive: document.querySelectorAll('[data-overcam-snap][data-active="1"]').length,
        },
    }
}

// grab the hud somewhere in its body, clear of the chart, and drag to (x, y)
const dragTo = async (page, x, y, shot) => {
    const from = await page.evaluate(() => {
        const hud = document.querySelector('[data-overcam-hud]')
        const r = hud.getBoundingClientRect()
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 24) }
    })

    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await sleep(150)
    await page.mouse.move(Math.round((from.x + x) / 2), Math.round((from.y + y) / 2), { steps: 10 })
    await page.mouse.move(x, y, { steps: 10 })
    await sleep(350)

    const midDrag = await page.evaluate(state)
    if (shot) await page.screenshot({ path: `${outDir}/${shot}` })

    await page.mouse.up()
    await sleep(700)

    return midDrag
}

try {
    const page = await browser.newPage()
    await page.setViewport({ width, height, deviceScaleFactor: 1 })
    await page.evaluateOnNewDocument((modelFile) => {
        /*
         * Which file the front end thinks is loaded, decided here rather than by the printer.
         *
         * Every frame Moonraker sends on the websocket is passed through and, if it carries
         * print_stats, has the file name swapped before the page ever sees it. Substituting
         * ONE frame is not enough: a running print keeps publishing print_stats, and every one
         * of those puts the real name back - measured, that is exactly what happened.
         *
         * It is done at the protocol, not in the store: the Vue 2 build keeps this in Vuex and
         * the Vue 3 port in Pinia, and neither of those is something the harness should know.
         */
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
        // clear the stored placement ONCE, on the first load, so the run starts from the
        // automatic default - and never again, or the reload check below would be testing
        // this harness rather than the page
        if (sessionStorage.getItem('overcam-harness')) return
        sessionStorage.setItem('overcam-harness', '1')
        localStorage.removeItem('webcamHudPlacement')
        localStorage.removeItem('mainsail-next.webcamHudPlacement')
        // the 3D tile is opt-in and remembers the opt-in, so a previous run would
        // otherwise decide whether this one starts on the thumbnail or on the scene
        localStorage.removeItem('webcamHudModelOptIn')
        localStorage.removeItem('mainsail-next.webcamHudModelOptIn')
    }, MODEL_FILE)

    /*
     * swiftshader reports every software-rasteriser stall, and none of it says anything about
     * this page - so it is named and ignored rather than allowed to turn the one check that
     * catches real page errors into noise.
     *
     * "Missing feature <role>" stayed on this list after the tile learned the OrcaSlicer roles
     * @sindarius/gcodeviewer has no colour for (2026-08-18): the line is gone from the tile,
     * but any OTHER page that mounts the same engine - Mainsail's own /viewer - still produces
     * it, and this script walks a whole front end. scripts/check-model.mjs is the one that
     * asserts the tile itself no longer emits it.
     */
    const thirdPartyNoise = /Missing feature|GL Driver Message|WebGPU|swiftshader/i
    const errors = []
    page.on('console', (m) => m.type() === 'error' && !thirdPartyNoise.test(m.text()) && errors.push(m.text()))
    page.on('pageerror', (e) => errors.push(String(e)))

    // How many times the whole g-code came off the printer. The tile is allowed
    // exactly one per file; everything else is the SD card being read for nothing.
    let gcodeFetches = 0
    page.on(
        'response',
        (r) => r.url().includes('/server/files/gcodes/') && r.url().endsWith('.gcode') && (gcodeFetches += 1)
    )

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
    await page.waitForFunction(() => document.body.innerText.includes('ETA'), { timeout: 25000 })
    await sleep(3500)

    let s = await page.evaluate(state)
    console.log('start:', JSON.stringify(s))
    check(
        s.axis === 'none' && s.mode === 'auto',
        `${width}x${height} leaves too little letterbox, so it starts floating`
    )

    // --- 1/2/3: drag onto the left edge -----------------------------------
    const mid = await dragTo(page, 18, Math.round(height / 2), 'overcam-drag.png')
    console.log('mid-drag:', JSON.stringify(mid.targets))
    check(
        mid.targets.bars === 4 && mid.targets.snaps === 8,
        'four dock bars and eight anchors are offered while dragging'
    )
    check(
        mid.targets.barsActive === 1 && mid.targets.snapsActive === 0,
        'the left bar is the highlighted target, no anchor competes'
    )

    s = await page.evaluate(state)
    console.log('after drop on the left edge:', JSON.stringify(s))
    await page.screenshot({ path: `${outDir}/overcam-docked-left.png` })
    check(
        s.mode === 'dock' && s.axis === 'vertical' && s.side === 'left',
        'dropping on the left edge docks into a left column'
    )
    check(s.size >= 200, `the column is at least the readable minimum (${s.size}px)`)
    check(s.overlapsImage === false, 'the docked hud does not cover the picture')
    // flush, not merely "somewhere to the right": the bar takes all the room there
    // is on that side and the frame starts exactly where the bar ends. A frame that
    // stopped short would mean a strip of black left over next to the hud.
    check(
        Math.abs(s.painted.l - s.size) <= 2,
        `the frame sits flush against the column (bar ${s.size}px, painted starts at ${s.painted.l}px)`
    )

    /*
     * --- 7: the 3D tile turns with the mouse, and turning it does NOT move the hud ---
     *
     * This is the collision worth checking by hand rather than by eye. Babylon attaches its
     * ArcRotateCamera to the canvas and calls preventDefault on the pointer events, but it
     * never stops them propagating - so the hud's own drag handler is one bubble away from
     * tearing the overlay out of its bar every time the user turns the part. The two numbers
     * come from opposite ends: the camera angles are written to the DOM by the tile, the
     * placement by the overlay, and this asserts one moved while the other did not.
     *
     * There is no touch screen on the tablet at the machine, so the gesture used here is a
     * plain left-button mouse drag, deliberately.
     */
    const dragInsideTile = async (box) => {
        await page.mouse.move(box.x, box.y)
        await page.mouse.down()
        for (let i = 1; i <= 14; i++) await page.mouse.move(box.x + i * 7, box.y + i * 2)
        await page.mouse.up()
        await sleep(1200)
        return page.evaluate(state)
    }

    const beforeModel = await page.evaluate(state)
    const placementOf = (s) => `${s.mode}/${s.anchor}/${s.side}/${s.axis}`

    if (beforeModel.model === null) {
        /*
         * Nothing is loaded on the printer, so the tile draws nothing at all - which is the
         * "be quiet when there is nothing" rule, and worth asserting rather than skipping.
         */
        console.log('printer has no file loaded - checking that the tile stays out of the way')
        check(
            !(await page.$('[data-overcam-model-load]')),
            'with no file on the printer the tile leaves no button and no empty frame behind'
        )
    } else {
        check(beforeModel.model.state === 'idle', 'the tile starts on the cheap thumbnail, not on a download')

        // The guard first, and on the THUMBNAIL, so this runs whatever the printer has loaded.
        // Without it the overlay is dragged out of its bar the moment the tile is touched.
        // Note this drag both starts and ends inside the preview button, so the browser also
        // fires a click and the load is already under way by the time the explicit click
        // below lands - which the 'loading' guard absorbs. Do not read anything into which
        // of the two started it.
        const afterTileDrag = await dragInsideTile(beforeModel.model.box)
        check(
            placementOf(afterTileDrag) === placementOf(beforeModel),
            `dragging inside the tile leaves the overlay where it was (${placementOf(beforeModel)})`
        )

        await page.click('[data-overcam-model-load]')
        await page
            .waitForFunction(
                () =>
                    ['live', 'error'].includes(
                        document.querySelector('[data-overcam-model]')?.dataset.overcamModelState ?? ''
                    ),
                { timeout: 90000 }
            )
            .catch(() => {})
        await sleep(1500)

        const loaded = await page.evaluate(state)
        console.log('after asking for 3D:', JSON.stringify(loaded.model))

        if (loaded.model?.state === 'live') {
            check(!!loaded.model.camera, 'the live scene reports its camera')

            const turned = await dragInsideTile(loaded.model.box)
            console.log('after dragging inside the live tile:', JSON.stringify(turned.model?.camera))
            check(
                turned.model?.camera !== loaded.model.camera,
                'dragging inside the tile turns the model with the mouse'
            )
            check(placementOf(turned) === placementOf(loaded), 'and it still does NOT drag the overlay out of its bar')
            await page.screenshot({ path: `${outDir}/overcam-model-turned.png` })

            /*
             * Undocking must not throw the scene away. Mounted under `v-if` it did:
             * the tile was destroyed, and re-docking rebuilt the engine and pulled the
             * whole g-code off the printer's SD card again - measured at eleven
             * downloads for ten dock/undock cycles on the live build, every one of them
             * competing with the print for the same card. Counting bytes off the wire is
             * the only way to see this; the tile looks identical either way.
             */
            const before = gcodeFetches
            for (let i = 0; i < 3; i++) {
                await page.click('[data-overcam-dock-toggle]')
                await sleep(600)
                await page.click('[data-overcam-dock-toggle]')
                await sleep(1200)
            }
            await sleep(1500)
            const survived = await page.evaluate(state)
            check(
                gcodeFetches === before,
                `undocking and re-docking three times downloaded the g-code ${gcodeFetches - before} more time(s)`
            )
            check(survived.model?.state === 'live', 'and the scene is still there afterwards')
        } else {
            /*
             * The scene did not come up, and there are three honest reasons for that, none of
             * which is a defect:
             *
             *   - the file is a motion diagnostic with no extrusion at all, so there is
             *     nothing to draw and the tile says so                  -> state 'empty'
             *   - the printer changed the file mid-load (a job ending, the next one starting,
             *     a klipper restart, all of which happen constantly while the machine is being
             *     tuned) and the tile gave up on the old one            -> state 'idle'
             *   - the printer has nothing loaded at all                 -> no tile
             *
             * What is NOT acceptable is a tile that sits on 'loading' with nothing behind it,
             * because that is a button the user can never press again. That is what this
             * checks. Name a renderable file with MODEL_FILE= to reach the branch above -
             * though a printer that is actively starting and stopping prints can still take
             * the file away underneath it.
             *
             * 'error' is still allowed here, but it now means what it says: something went
             * wrong. "No extrusion in the file" used to land on it and is its own state since
             * 2026-08-18 - and scripts/check-model.mjs is the one that asserts WHICH of the
             * two a given file gets, because this script cannot know what it was handed.
             */
            console.log('the scene did not come up - checking that the tile gave up cleanly instead')
            check(
                loaded.model === null || ['idle', 'empty', 'error'].includes(loaded.model.state),
                `the tile ended in a state the user can act on, not '${loaded.model?.state}'`
            )
        }
    }

    // --- 4: stored as names, and it survives a reload ---------------------
    console.log('stored:', s.stored)
    check(
        /"mode"/.test(s.stored) && /"anchor"/.test(s.stored) && /"side"/.test(s.stored),
        'placement is stored as names'
    )
    check(!/\d{3}/.test(s.stored), 'placement contains no pixel coordinates')

    await page.reload({ waitUntil: 'networkidle2', timeout: 30000 })
    await page.waitForFunction(() => document.body.innerText.includes('ETA'), { timeout: 25000 })
    await sleep(3000)
    s = await page.evaluate(state)
    check(s.mode === 'dock' && s.side === 'left' && s.axis === 'vertical', 'the manual dock survives a reload')

    // --- 5: drag back into the middle -------------------------------------
    await dragTo(page, Math.round(width / 2), Math.round(height / 2))
    s = await page.evaluate(state)
    console.log('after drop in the middle:', JSON.stringify(s))
    await page.screenshot({ path: `${outDir}/overcam-floating.png` })
    check(s.mode === 'float' && s.axis === 'none', 'dropping in the middle floats it again')

    // --- 6: the button, without any dragging ------------------------------
    await page.click('[data-overcam-dock-toggle]')
    await sleep(600)
    s = await page.evaluate(state)
    console.log('after the dock button:', JSON.stringify(s))
    check(s.mode === 'dock' && s.axis !== 'none', 'the toolbar button docks it')
    check(s.overlapsImage === false, 'and it still does not cover the picture')

    await page.click('[data-overcam-dock-toggle]')
    await sleep(600)
    s = await page.evaluate(state)
    check(s.mode === 'float' && s.axis === 'none', 'and the same button undocks it')

    // --- and the top edge, which the old version could not use at all -----
    await dragTo(page, Math.round(width / 2), 18)
    s = await page.evaluate(state)
    console.log('after drop on the top edge:', JSON.stringify(s))
    await page.screenshot({ path: `${outDir}/overcam-docked-top.png` })
    check(
        s.mode === 'dock' && s.axis === 'horizontal' && s.side === 'top',
        'dropping on the top edge docks into a top row'
    )
    check(s.overlapsImage === false, 'the top row does not cover the picture either')
    check(
        Math.abs(s.painted.t - s.size) <= 2,
        `and the frame dropped flush below it (row ${s.size}px, painted starts at ${s.painted.t}px)`
    )

    // --- the record the previous version wrote ----------------------------
    // It only knew `pinned`, ANY drag set it, and it then suppressed docking for
    // good at every window size. Carrying that forward would leave a user who had
    // once nudged the hud still looking at it on top of the picture after the fix.
    // The corner must survive, the veto must not.
    await page.evaluate(() => {
        const legacy = JSON.stringify({ pinned: true, anchor: 'bottom-left' })
        if (localStorage.getItem('mainsail-next.webcamHudPlacement') !== null) {
            localStorage.setItem('mainsail-next.webcamHudPlacement', legacy)
        } else {
            localStorage.setItem('webcamHudPlacement', legacy)
        }
    })
    await page.reload({ waitUntil: 'networkidle2', timeout: 30000 })
    await page.waitForFunction(() => document.body.innerText.includes('ETA'), { timeout: 25000 })
    await sleep(3000)
    s = await page.evaluate(state)
    console.log('after a legacy {pinned:true} record:', JSON.stringify({ mode: s.mode, anchor: s.anchor }))
    check(s.mode === 'auto', 'a legacy pinned record no longer vetoes docking')
    check(s.anchor === 'bottom-left', 'and the corner it chose is kept')

    check(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''))
} finally {
    await browser.close()
}

console.log()
if (failures.length) {
    console.error(`FAILED (${failures.length}):`)
    failures.forEach((f) => console.error('  - ' + f))
    process.exit(1)
}
console.log('all checks passed')
