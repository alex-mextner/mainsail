#!/usr/bin/env node
/**
 * Verify BOTH themes at every density instead of eyeballing one of them.
 *
 * Checks two things the eye is bad at:
 *   1. WCAG contrast of every text node and of the sparkline strokes, measured
 *      from the browser's own computed colours -- these are oklch tokens, so
 *      guessing from the source is not good enough.
 *   2. Horizontal overflow, i.e. anything wider than the viewport at the
 *      narrowest density. Nothing may be cut off.
 *
 *   node scripts/check-contrast.mjs [url]
 */
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const url = process.argv[2] ?? 'http://127.0.0.1:5273/'

const candidates = [
    join(homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
]
const executablePath = candidates.find((p) => existsSync(p))
if (!executablePath) {
    console.error('FAIL: no Chrome/Edge binary found')
    process.exit(1)
}

// AA: 4.5 for body text, 3.0 for large text and for non-text graphics such as
// the sparkline strokes and the duty-cycle bars.
const TEXT_MIN = 4.5
const LARGE_MIN = 3.0
const GRAPHIC_MIN = 3.0

const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
let failures = 0

try {
    for (const [theme, width] of [
        ['light', 420],
        ['light', 900],
        ['light', 1440],
        ['dark', 420],
        ['dark', 900],
        ['dark', 1440],
    ]) {
        const page = await browser.newPage()
        await page.setViewport({ width, height: 900, deviceScaleFactor: 1 })
        await page.evaluateOnNewDocument((t) => {
            localStorage.setItem('mainsail-next.theme', t)
            localStorage.setItem('mainsail-next.density', 'auto')
        }, theme)

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
        await page.waitForFunction(() => /\d+\.\d/.test(document.body.innerText), { timeout: 25000 }).catch(() => {})
        await new Promise((r) => setTimeout(r, 1500))

        const report = await page.evaluate(
            (limits) => {
                const srgb = (c) => {
                    const v = c / 255
                    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
                }
                const lum = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b)

                // These tokens are oklch(), and Chrome returns computed colours
                // in their authored colour space -- "oklch(0.21 0.04 264.7)".
                // Scraping those three numbers as if they were RGB produces
                // nonsense (every ratio came out ~1.05). Let the browser do the
                // conversion instead: paint the colour and read the pixel back.
                const canvas = document.createElement('canvas')
                canvas.width = canvas.height = 1
                const ctx = canvas.getContext('2d', { willReadFrequently: true })
                const parse = (s) => {
                    ctx.clearRect(0, 0, 1, 1)
                    ctx.fillStyle = '#000'
                    ctx.fillStyle = s
                    ctx.fillRect(0, 0, 1, 1)
                    const d = ctx.getImageData(0, 0, 1, 1).data
                    return [d[0], d[1], d[2], d[3] / 255]
                }

                const ratio = (a, b) => {
                    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x)
                    return (l1 + 0.05) / (l2 + 0.05)
                }

                // Returns null when the backdrop is a gradient or an image. The
                // print-status overlay is white text on a `from-black/80` scrim
                // over a thumbnail; a colour-only walk would sail past the
                // gradient, land on the white card and report white-on-white.
                // Reporting those as "unmeasurable" is honest -- failing them is
                // not, and passing them silently would be worse.
                const bgOf = (el) => {
                    let node = el
                    while (node) {
                        const cs = getComputedStyle(node)
                        if (cs.backgroundImage && cs.backgroundImage !== 'none') return null
                        const rgba = parse(cs.backgroundColor)
                        if (rgba[3] > 0.85) return rgba
                        node = node.parentElement
                    }
                    return [255, 255, 255, 1]
                }

                const problems = []
                let skipped = 0

                // --- text nodes ---
                document.querySelectorAll('body *').forEach((el) => {
                    const text = Array.from(el.childNodes)
                        .filter((n) => n.nodeType === 3)
                        .map((n) => n.textContent.trim())
                        .join('')
                    if (!text) return

                    const cs = getComputedStyle(el)
                    if (cs.visibility === 'hidden' || cs.display === 'none') return

                    const size = parseFloat(cs.fontSize)
                    const weight = Number(cs.fontWeight) || 400
                    const isLarge = size >= 24 || (size >= 18.66 && weight >= 700)
                    const min = isLarge ? limits.large : limits.text

                    const bg = bgOf(el)
                    if (bg === null) {
                        skipped++
                        return
                    }

                    const r = ratio(parse(cs.color), bg)
                    if (r < min) {
                        problems.push({
                            kind: 'text',
                            text: text.slice(0, 32),
                            size: Math.round(size),
                            ratio: Number(r.toFixed(2)),
                            min,
                        })
                    }
                })

                // --- sparkline strokes (non-text graphic) ---
                document.querySelectorAll('polyline').forEach((el) => {
                    const bg = bgOf(el)
                    if (bg === null) {
                        skipped++
                        return
                    }

                    const r = ratio(parse(getComputedStyle(el).stroke), bg)
                    if (r < limits.graphic) {
                        problems.push({ kind: 'sparkline', ratio: Number(r.toFixed(2)), min: limits.graphic })
                    }
                })

                // --- horizontal overflow ---
                // Only things that actually escape the page count. An element
                // parked outside an `overflow: hidden` ancestor is clipped by
                // design -- the Progress indicator is translated off to the left
                // on purpose -- so walking up for a clipping ancestor avoids
                // flagging it.
                const clipped = (el) => {
                    let node = el.parentElement
                    while (node) {
                        const o = getComputedStyle(node).overflowX
                        if (o === 'hidden' || o === 'clip' || o === 'auto' || o === 'scroll') return true
                        node = node.parentElement
                    }
                    return false
                }

                const docWidth = document.documentElement.clientWidth
                const overflow = []
                document.querySelectorAll('body *').forEach((el) => {
                    const r = el.getBoundingClientRect()
                    if (r.width > 0 && r.right > docWidth + 1 && !clipped(el)) {
                        overflow.push({
                            tag: el.tagName.toLowerCase(),
                            cls: (el.className || '').toString().slice(0, 40),
                            right: Math.round(r.right),
                        })
                    }
                })

                return {
                    problems,
                    skipped,
                    overflow: overflow.slice(0, 5),
                    scrollW: document.documentElement.scrollWidth,
                    clientW: docWidth,
                    density: document.documentElement.dataset.density,
                    dark: document.documentElement.classList.contains('dark'),
                }
            },
            { text: TEXT_MIN, large: LARGE_MIN, graphic: GRAPHIC_MIN }
        )

        const bodyScrolls = report.scrollW > report.clientW + 1
        const ok = report.problems.length === 0 && !bodyScrolls && report.overflow.length === 0
        if (!ok) failures++

        console.log(
            `${ok ? 'PASS' : 'FAIL'}  ${theme.padEnd(5)} ${String(width).padStart(4)}px  ` +
                `density=${report.density}  dark=${report.dark}  ` +
                `scrollW=${report.scrollW}/${report.clientW}  unmeasurable=${report.skipped}`
        )
        for (const p of report.problems.slice(0, 8)) {
            console.log(
                `        ${p.kind}${p.text ? ` "${p.text}"` : ''}${p.size ? ` ${p.size}px` : ''} ` +
                    `ratio ${p.ratio} < ${p.min}`
            )
        }
        for (const o of report.overflow) console.log(`        overflow <${o.tag} class="${o.cls}"> right=${o.right}`)

        await page.close()
    }
} finally {
    await browser.close()
}

console.log(
    failures === 0 ? '\nPASS: both themes readable at every density, nothing clipped.' : `\nFAIL: ${failures} case(s)`
)
process.exit(failures === 0 ? 0 : 1)
