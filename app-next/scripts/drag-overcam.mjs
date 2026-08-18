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
    await page.evaluateOnNewDocument(() => {
        localStorage.setItem('mainsail-next.theme', 'dark')
        // clear the stored placement ONCE, on the first load, so the run starts from the
        // automatic default - and never again, or the reload check below would be testing
        // this harness rather than the page
        if (sessionStorage.getItem('overcam-harness')) return
        sessionStorage.setItem('overcam-harness', '1')
        localStorage.removeItem('webcamHudPlacement')
        localStorage.removeItem('mainsail-next.webcamHudPlacement')
    })

    const errors = []
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    page.on('pageerror', (e) => errors.push(String(e)))

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
    check(s.painted.l >= s.size - 1, `the frame moved aside for it (painted starts at ${s.painted.l}px)`)

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
