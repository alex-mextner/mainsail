/**
 * Prove what the app does when its Moonraker socket drops and comes back.
 *
 *   node scripts/reconnect-check.mjs http://192.168.11.160:8090/console
 *
 * Reports: how many sockets existed, what the status chip said the instant the
 * socket closed, whether a new socket appeared, and whether the console
 * scrollback changed length across the cycle. A growing line count means
 * something re-seeded itself on reconnect.
 *
 * 🔴 WHY IT PATCHES `window.WebSocket` INSTEAD OF USING OFFLINE MODE
 * Puppeteer's `setOfflineMode` does NOT tear down an already-established
 * WebSocket -- measured: twenty seconds "offline" with the chip reading `ready`
 * the whole time, because Moonraker's frames kept arriving and kept resetting
 * the heartbeat. A test built on it silently proves nothing. Capturing the
 * socket and closing it is the real event.
 *
 * Read-only with respect to the printer: closing a socket sends no g-code.
 */
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
const cands = [
    join(homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
]
const browser = await puppeteer.launch({
    executablePath: cands.find(existsSync),
    headless: true,
    args: ['--no-sandbox'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1200, height: 900 })
await page.evaluateOnNewDocument(() => {
    const Native = window.WebSocket
    window.__sockets = []
    window.WebSocket = function (...args) {
        const s = new Native(...args)
        window.__sockets.push(s)
        return s
    }
    window.WebSocket.prototype = Native.prototype
    Object.assign(window.WebSocket, Native)
})
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(process.argv[2], { waitUntil: 'networkidle2' })
await new Promise((r) => setTimeout(r, 5000))
const count = () => page.evaluate(() => document.querySelectorAll('[class*="border-b"] > span.tabular').length)
const chip = () =>
    page.evaluate(() => {
        const s = [...document.querySelector('header').querySelectorAll('span')]
        return s[s.length - 1].textContent.trim()
    })
const before = await count()
const sockets = await page.evaluate(() => window.__sockets.length)
await page.evaluate(() => window.__sockets[window.__sockets.length - 1].close())
await new Promise((r) => setTimeout(r, 800))
const during = await chip()
await new Promise((r) => setTimeout(r, 9000))
console.log(
    JSON.stringify({
        socketsBefore: sockets,
        linesBefore: before,
        chipRightAfterClose: during,
        socketsAfter: await page.evaluate(() => window.__sockets.length),
        chipAfter: await chip(),
        linesAfter: await count(),
        errors,
    })
)
await browser.close()
