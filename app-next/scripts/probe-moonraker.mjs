#!/usr/bin/env node
/**
 * Read-only probe of the live Moonraker instance.
 *
 * Speaks the same JSON-RPC-over-websocket protocol the app uses, so it answers
 * "is the data layer talking to the real printer?" without a browser, a bundler
 * or any UI in the way. If this fails, the problem is the data layer; if this
 * passes and the UI is blank, the problem is the UI.
 *
 * Strictly read-only: it calls `printer.info`, `printer.objects.list` and
 * `printer.objects.subscribe`, takes a handful of frames and disconnects. It
 * never sends a gcode command. The printer is an Orange Pi with 512 MB of RAM,
 * so it deliberately does not loop or poll -- it exits on its own.
 *
 *   node scripts/probe-moonraker.mjs [host]
 */

const host = process.argv[2] ?? process.env.MOONRAKER_HOST ?? '192.168.11.160'
const url = `ws://${host}/websocket`
const FRAMES_WANTED = 3
const TIMEOUT_MS = 20000

let id = 0
const pending = new Map()
let frames = 0
let exitCode = 1

const ws = new WebSocket(url)
const bail = (msg) => {
    console.error(`FAIL: ${msg}`)
    try {
        ws.close()
    } catch {
        /* already closed */
    }
    process.exit(1)
}

const timer = setTimeout(() => bail(`no result within ${TIMEOUT_MS} ms`), TIMEOUT_MS)

function call(method, params = {}) {
    return new Promise((resolve, reject) => {
        const msgId = ++id
        pending.set(msgId, { resolve, reject })
        ws.send(JSON.stringify({ jsonrpc: '2.0', method, params, id: msgId }))
    })
}

const fmt = (o) =>
    o === undefined || o === null
        ? '--'
        : `${(o.temperature ?? 0).toFixed(1)}°C -> ${(o.target ?? 0).toFixed(1)}°C  (power ${(
              (o.power ?? 0) * 100
          ).toFixed(0)}%)`

ws.onopen = async () => {
    console.log(`connected  ${url}`)

    const info = await call('printer.info')
    console.log(`klippy     state=${info.state}  ${info.software_version ?? ''}`)
    console.log(`hostname   ${info.hostname ?? '?'}`)

    const list = await call('printer.objects.list')
    const objects = list.objects ?? []
    console.log(`objects    ${objects.length} exposed`)
    const heaterish = objects.filter(
        (o) =>
            o === 'extruder' || o === 'heater_bed' || o.startsWith('temperature_sensor') || o.startsWith('heater_fan')
    )
    console.log(`heaterish  ${heaterish.join(', ')}`)

    // Subscribing is what the real UI does; notify_status_update frames follow.
    const sub = await call('printer.objects.subscribe', {
        objects: { extruder: null, heater_bed: null, print_stats: null, toolhead: null },
    })
    console.log(`subscribed eventtime=${sub.eventtime?.toFixed(1)}`)
    const s = sub.status ?? {}
    console.log(`  extruder   ${fmt(s.extruder)}`)
    console.log(`  heater_bed ${fmt(s.heater_bed)}`)
    console.log(`  print      state=${s.print_stats?.state}  file=${s.print_stats?.filename || '(none)'}`)
    console.log(`\nwaiting for ${FRAMES_WANTED} push frames (proves the subscription is live)...`)
}

ws.onmessage = (ev) => {
    const data = JSON.parse(ev.data)

    if (typeof data.id === 'number' && pending.has(data.id)) {
        const { resolve, reject } = pending.get(data.id)
        pending.delete(data.id)
        clearTimeout(timer)
        if (data.error) return reject(new Error(data.error.message ?? 'rpc error'))
        return resolve(data.result)
    }

    if (data.method === 'notify_status_update') {
        const [status, eventtime] = data.params
        frames++
        const bits = Object.entries(status).map(([k, v]) => {
            if ('temperature' in v) return `${k}=${v.temperature.toFixed(2)}°C`
            return `${k}=${JSON.stringify(v).slice(0, 60)}`
        })
        console.log(`  frame ${frames}  t=${eventtime.toFixed(1)}  ${bits.join('  ')}`)

        if (frames >= FRAMES_WANTED) {
            console.log('\nPASS: live push data received from the real printer.')
            exitCode = 0
            ws.close()
        }
    }
}

ws.onerror = (e) => bail(`websocket error: ${e.message ?? e.type}`)
ws.onclose = () => process.exit(exitCode)
