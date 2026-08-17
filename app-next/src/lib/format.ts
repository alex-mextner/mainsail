/**
 * Value formatters shared by the tables.
 *
 * Ported from Mainsail's `plugins/filters.ts` / `plugins/helpers.ts` so a
 * number reads the same in both interfaces. Deliberately not a Vue plugin:
 * these are pure functions, and importing them is clearer than a global filter
 * that only works inside a template.
 */

/** "3.8 MB". Upstream's algorithm, including the always-at-least-0.1 floor. */
export function formatFilesize(bytes: number): string {
    if (!bytes) return '—'

    let value = bytes
    let index = -1
    const units = [' kB', ' MB', ' GB', ' TB', ' PB']

    do {
        value = value / 1024
        index++
    } while (value > 1024 && index < units.length - 1)

    return Math.max(value, 0.1).toFixed(1) + units[index]
}

/**
 * Print durations. Upstream's `formatPrintTime`: days only when there are any,
 * and seconds dropped once the number is big enough that they are noise.
 */
export function formatPrintTime(totalSeconds: number): string {
    if (!totalSeconds || totalSeconds < 0) return '—'

    const parts: string[] = []

    const days = Math.floor(totalSeconds / 86400)
    if (days) {
        totalSeconds -= days * 86400
        parts.push(`${days}d`)
    }

    const hours = Math.floor(totalSeconds / 3600)
    if (hours) {
        totalSeconds -= hours * 3600
        parts.push(`${hours}h`)
    }

    const minutes = Math.floor(totalSeconds / 60)
    if (minutes) {
        totalSeconds -= minutes * 60
        parts.push(`${minutes}m`)
    }

    const seconds = Math.floor(totalSeconds)
    if (seconds && !days) parts.push(`${seconds}s`)

    return parts.length ? parts.join(' ') : '—'
}

/**
 * Timestamps in the browser's own locale and zone. The machine is used in a
 * RU locale and the printer's clock is on MSK; formatting on the client is what
 * keeps those two from disagreeing.
 */
export function formatDateTime(milliseconds: number | null | undefined): string {
    if (!milliseconds) return '—'

    const date = new Date(milliseconds)
    if (Number.isNaN(date.getTime())) return '—'

    return date.toLocaleString(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    })
}

/** Millimetres, two decimals -- layer heights and object heights. */
export const formatLength = (value: number | null | undefined): string =>
    value === null || value === undefined ? '—' : `${Number(value).toFixed(2)} mm`

/** Filament usage runs to metres; below a metre millimetres are more useful. */
export function formatFilamentLength(value: number | null | undefined): string {
    if (value === null || value === undefined) return '—'
    if (value < 1000) return `${Math.round(value)} mm`
    return `${(value / 1000).toFixed(2)} m`
}

export const formatWeight = (value: number | null | undefined): string =>
    value === null || value === undefined ? '—' : `${Number(value).toFixed(1)} g`

/** A target of 0 means "not set by the slicer", not "print at 0 °C". */
export const formatTemperature = (value: number | null | undefined): string =>
    value === null || value === undefined || value <= 0 ? '—' : `${Math.round(value)} °C`
