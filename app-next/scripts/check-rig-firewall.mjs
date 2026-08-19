#!/usr/bin/env node
/**
 * Prove the rig's firewall actually stops calls, instead of merely listing them.
 *
 *   node scripts/check-rig-firewall.mjs [url]     # default http://192.168.11.160/
 *
 * 🔴 WHY THIS SCRIPT EXISTS
 * -------------------------
 * The first draft of the blocklist in `lib/rig.mjs` declared
 * DEFAULT_BLOCKED_METHODS, defined `isBlocked()`, and never called it: the two
 * arrays were not passed to the page, `exemptMethods` was `undefined`, and
 * `socket.send` still special-cased `printer.gcode.script` alone. Reading the
 * file it looked like a firewall. Every shoot script would have printed
 * "blocked at the socket: true" while `server.job_queue.start` went straight to
 * Moonraker.
 *
 * A screenshot of a panel cannot catch that, and neither can reading. So this
 * runs the two questions that matter, empirically:
 *
 *   1. Does a blocked frame reach the wire?      -- answered by CDP, which sees
 *      what the socket actually sent, not what the page believes it sent.
 *   2. Does a read-only call still get through?  -- the failure in the other
 *      direction. `machine.update.*` is blocked and `machine.update.status` is
 *      exempted from it; if the exemption is broken the Machine page silently
 *      shows nothing and every screenshot of it is a lie.
 *
 * 🔴 NIGHT-SAFE BY CONSTRUCTION, NOT BY CARE
 * ------------------------------------------
 * This check sends the very calls it is checking, so "the firewall is broken"
 * and "the probe fired for real" are the same run. It must therefore be
 * harmless even when it fails completely. Two mechanisms:
 *
 *   - The DANGEROUS methods (service restarts, host reboot, emergency stop,
 *     file deletion) are probed on a socket that is still CONNECTING, to a port
 *     where nothing listens. Per the WebSocket spec `send()` on a CONNECTING
 *     socket throws InvalidStateError -- so "returned normally" proves the
 *     firewall answered before `nativeSend`, and "threw" proves it did not.
 *     Nothing can leave, because there is nothing to leave through.
 *   - The LIVE probes are limited to calls that are harmless on this machine
 *     even if they leak: an unknown g-code word (Klipper answers "Unknown
 *     command", no motion, no heat), a job-queue start that is refused unless
 *     the queue is loaded -- and the run aborts beforehand if the queue is not
 *     empty or a print is running -- and a database write into a junk namespace
 *     no interface reads, whose absence afterwards is then confirmed over HTTP.
 */
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { installRig, rigReport, DEFAULT_BLOCKED_METHODS, BLOCK_EXEMPTIONS } from './lib/rig.mjs'

// Bare address: since the 2026-08-19 port swap this fork is served on port 80
// and the old Mainsail sits on :8090.
const url = process.argv[2] ?? 'http://192.168.11.160/'
const origin = new URL(url).origin
const PROBE_NAMESPACE = 'rig_firewall_probe'

/** Live probes: harmless on this machine even if the firewall lets them out. */
const LIVE_BLOCKED = [
    // Not G28. An unknown word is refused by Klipper without moving anything,
    // and it leaves a traceable line in klippy.log if it ever does leak.
    { method: 'printer.gcode.script', params: { script: 'RIG_FIREWALL_PROBE' } },
    { method: 'server.job_queue.start', params: {} },
    { method: 'server.database.post_item', params: { namespace: PROBE_NAMESPACE, key: 'leaked', value: true } },
]

/** Must reach Moonraker. The firewall failing open is a bug; failing shut is also a bug. */
const LIVE_ALLOWED = [
    // The exemption that carries the whole Machine page past `machine.update.*`.
    { method: 'machine.update.status', params: { refresh: false } },
    { method: 'server.job_queue.status', params: {} },
    { method: 'printer.objects.list', params: {} },
]

/** Probed only on a dead socket -- a leak here would restart or destroy things. */
const DEAD_SOCKET_BLOCKED = [
    { method: 'printer.emergency_stop', params: {} },
    { method: 'printer.firmware_restart', params: {} },
    { method: 'printer.print.start', params: { filename: 'nonexistent.gcode' } },
    { method: 'machine.services.restart', params: { service: 'klipper' } },
    { method: 'machine.reboot', params: {} },
    { method: 'machine.shutdown', params: {} },
    { method: 'machine.update.refresh', params: {} },
    { method: 'server.files.delete_file', params: { path: 'gcodes/nonexistent.gcode' } },
    { method: 'server.history.reset_totals', params: {} },
    { method: 'server.job_queue.post_job', params: { filenames: ['nonexistent.gcode'] } },
    { method: 'server.webcams.delete_item', params: { name: 'nonexistent' } },
    { method: 'machine.timelapse.render', params: {} },
    { method: 'server.spoolman.post_spool_id', params: { spool_id: 1 } },
]

const failures = []
const check = (ok, message) => {
    console.log(`${ok ? '  ok  ' : '  FAIL'}  ${message}`)
    if (!ok) failures.push(message)
}

// --- gate: never probe the queue while it has something in it ---------------
const rest = async (path) => {
    const res = await fetch(origin + path, { signal: AbortSignal.timeout(10000) })
    return res.json()
}

const queue = await rest('/server/job_queue/status')
const stats = await rest('/printer/objects/query?print_stats')
const queued = queue?.result?.queued_jobs?.length ?? 0
const printState = stats?.result?.status?.print_stats?.state ?? '(unknown)'

console.log(`job queue        : ${queued} job(s), state ${queue?.result?.queue_state}`)
console.log(`print_stats.state: ${printState}`)
if (queued !== 0) {
    console.error('\nABORT: the job queue is not empty. A `server.job_queue.start` probe could arm a print.')
    process.exit(2)
}
if (printState === 'printing' || printState === 'paused') {
    console.error('\nABORT: a print is running or paused. Not probing anything.')
    process.exit(2)
}

console.log(`\nblocklist        : ${DEFAULT_BLOCKED_METHODS.length} patterns, exemptions: ${BLOCK_EXEMPTIONS}`)

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
    await installRig(page, {
        // A fixture for one blocked method, to check the other half of the
        // contract: blocked AND faked must answer with the fake, or a
        // write-then-read panel can never be photographed.
        rpc: { 'server.database.post_item': { namespace: PROBE_NAMESPACE, key: 'leaked', value: 'from-the-fixture' } },
    })

    /**
     * CDP, not the page's own bookkeeping. `Network.webSocketFrameSent` is
     * emitted by the browser when a frame is handed to the socket, so it sees
     * past `window.__rig` entirely -- which is the point, since `window.__rig`
     * is written by the code under test.
     */
    const client = await page.createCDPSession()
    await client.send('Network.enable')
    const onWire = []
    client.on('Network.webSocketFrameSent', ({ response }) => {
        try {
            const frame = JSON.parse(response.payloadData)
            if (frame?.method) onWire.push(frame.method)
        } catch {
            /* not JSON */
        }
    })

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })

    // ---- 1. dead-socket probes: the dangerous list -------------------------
    console.log('\n--- dangerous methods, probed on a CONNECTING socket (nothing can leave) ---')
    const deadResults = await page.evaluate((methods) => {
        // Nothing listens on 9331. The socket stays CONNECTING for the whole
        // synchronous block below, so a frame that reaches the native send()
        // throws instead of going anywhere.
        const ws = new WebSocket('ws://127.0.0.1:9331/websocket')
        const out = []
        let id = 900000
        for (const m of methods) {
            let outcome
            try {
                ws.send(JSON.stringify({ jsonrpc: '2.0', method: m.method, params: m.params, id: ++id }))
                outcome = 'intercepted'
            } catch (e) {
                outcome = 'REACHED NATIVE SEND (' + e.name + ')'
            }
            out.push({ method: m.method, outcome, readyState: ws.readyState })
        }
        try {
            ws.close()
        } catch {
            /* already dead */
        }
        return out
    }, DEAD_SOCKET_BLOCKED)

    for (const r of deadResults) {
        check(r.outcome === 'intercepted' && r.readyState === 0, `${r.method.padEnd(34)} ${r.outcome}`)
    }

    // A negative control on the same socket: an unlisted method MUST throw,
    // otherwise "intercepted" above means nothing (e.g. if send were a no-op).
    const control = await page.evaluate(() => {
        const ws = new WebSocket('ws://127.0.0.1:9331/websocket')
        try {
            ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'server.info', params: {}, id: 909999 }))
            return 'did not throw'
        } catch (e) {
            return e.name
        }
    })
    check(
        control === 'InvalidStateError',
        `control: unlisted server.info DOES reach native send (${control}) -- proves the test can fail`
    )

    // ---- 2. live probes over the real socket -------------------------------
    console.log('\n--- live socket: blocked calls must not appear on the wire ---')
    onWire.length = 0
    const liveResults = await page.evaluate(
        async (blockedProbes, allowedProbes, wsOrigin) => {
            const ws = new WebSocket(wsOrigin.replace(/^http/, 'ws') + '/websocket')
            const replies = new Map()
            ws.onmessage = (event) => {
                try {
                    const frame = JSON.parse(event.data)
                    if (frame?.id) replies.set(frame.id, frame)
                } catch {
                    /* ignore */
                }
            }
            await new Promise((resolve, reject) => {
                ws.onopen = resolve
                ws.onerror = () => reject(new Error('probe socket failed to open'))
                setTimeout(() => reject(new Error('probe socket timed out')), 10000)
            })

            let id = 800000
            const sent = []
            for (const m of [...blockedProbes, ...allowedProbes]) {
                const thisId = ++id
                sent.push({ method: m.method, id: thisId })
                ws.send(JSON.stringify({ jsonrpc: '2.0', method: m.method, params: m.params, id: thisId }))
            }
            await new Promise((r) => setTimeout(r, 4000))
            ws.close()

            return sent.map((s) => ({
                method: s.method,
                answered: replies.has(s.id),
                result: JSON.stringify(replies.get(s.id)?.result ?? replies.get(s.id)?.error ?? null).slice(0, 90),
            }))
        },
        LIVE_BLOCKED,
        LIVE_ALLOWED,
        origin
    )

    for (const probe of LIVE_BLOCKED) {
        const live = liveResults.find((r) => r.method === probe.method)
        check(!onWire.includes(probe.method), `${probe.method.padEnd(34)} never reached the wire`)
        // A dropped call still has to be answered, or the panel's button spins.
        check(live?.answered === true, `${probe.method.padEnd(34)} was answered locally: ${live?.result}`)
    }

    console.log('\n--- live socket: read-only calls must still get through ---')
    for (const probe of LIVE_ALLOWED) {
        const live = liveResults.find((r) => r.method === probe.method)
        check(onWire.includes(probe.method), `${probe.method.padEnd(34)} reached the wire`)
        check(live?.answered === true, `${probe.method.padEnd(34)} got a real answer`)
    }

    // ---- 3. the fixture-answers-a-blocked-call contract ---------------------
    console.log('\n--- a blocked call with a fixture answers WITH the fixture ---')
    const dbProbe = liveResults.find((r) => r.method === 'server.database.post_item')
    check(
        (dbProbe?.result ?? '').includes('from-the-fixture'),
        `server.database.post_item answered from rpc fixture: ${dbProbe?.result}`
    )

    // ---- 4. the rig's own bookkeeping --------------------------------------
    const report = await rigReport(page)
    console.log('\n--- what the rig recorded ---')
    console.log('blocked flag     :', report.blocked)
    console.log('blockedCalls     :', [...new Set(report.blockedCalls)].join(', ') || '(none)')
    console.log('gcode            :', report.gcode.length ? report.gcode : '(none)')
    for (const probe of LIVE_BLOCKED) {
        check(report.blockedCalls.includes(probe.method), `${probe.method.padEnd(34)} recorded in blockedCalls`)
    }
    check(report.gcode.includes('RIG_FIREWALL_PROBE'), 'the g-code artifact still lists the probe command')
    for (const probe of LIVE_ALLOWED) {
        check(!report.blockedCalls.includes(probe.method), `${probe.method.padEnd(34)} NOT recorded as blocked`)
    }
} finally {
    await browser.close()
}

// ---- 5. independent confirmation, outside the browser ----------------------
// If the database write had leaked, this namespace would now exist. Asking
// Moonraker directly does not depend on any of the code under test.
console.log('\n--- independent check: did anything land in the database? ---')
const dbRes = await fetch(`${origin}/server/database/item?namespace=${PROBE_NAMESPACE}`, {
    signal: AbortSignal.timeout(10000),
})
check(dbRes.status === 404, `namespace "${PROBE_NAMESPACE}" absent from Moonraker (HTTP ${dbRes.status})`)

console.log(failures.length ? `\n${failures.length} FAILURE(S)` : '\nall checks passed')
process.exit(failures.length ? 1 : 0)
