import type { HistoryJob } from '@/stores/history'

/**
 * The numbers behind the statistics panel -- upstream's `historyStats` mixin,
 * as plain functions.
 *
 * A module of functions rather than a mixin (or a composable) because none of
 * this holds state: it is a pure fold over a list of jobs, and the three charts
 * plus the totals table all want a different fold of the same list.
 */

export type StatsValue = 'jobs' | 'filament' | 'time'

export interface StatusSlice {
    name: string
    label: string
    value: number
    color: string
}

/**
 * Status colours.
 *
 * 🔴 A DELIBERATE DEPARTURE FROM UPSTREAM, AND THE REASON MATTERS
 * Upstream paints these four greys: #BDBDBD completed, #EEEEEE in_progress,
 * #616161 cancelled, #424242 everything else. That palette was chosen for a UI
 * that only had a dark theme -- #EEEEEE is very nearly white, and on this
 * rewrite's light theme (a white card) that slice disappears entirely, while
 * #424242 and #616161 are indistinguishable from each other on either theme.
 *
 * So the slices use the SAME semantic tokens the history table's status icons
 * already use: green completed, red cancelled, blue in progress, amber for
 * anything else. Both themes define every token, the legend and the table then
 * agree by construction, and the chart carries information (which outcome) in
 * its colour instead of only in its label.
 *
 * Resolved from CSS custom properties at render time rather than hard-coded,
 * because echarts paints to a canvas and cannot read a Tailwind class -- and
 * because the value has to be re-read when the theme flips at runtime.
 */
const STATUS_TOKEN: Record<string, string> = {
    completed: '--ok',
    cancelled: '--destructive',
    in_progress: '--primary',
}

export function statusColor(status: string): string {
    const token = STATUS_TOKEN[status] ?? '--warn'
    if (typeof window === 'undefined') return '#888'

    return getComputedStyle(document.documentElement).getPropertyValue(token).trim() || '#888'
}

export const statusLabel = (status: string): string => status.replace(/_/g, ' ')

/**
 * Jobs grouped by status, measured in whichever unit the toggle asks for.
 *
 * `filament` and `time` drop zero-valued slices, upstream's behaviour: a status
 * that used no filament is not a 0% wedge, it is simply absent from a chart
 * about filament.
 */
export function statusSlices(jobs: HistoryJob[], value: StatsValue): StatusSlice[] {
    const totals = new Map<string, number>()

    for (const job of jobs) {
        const amount = value === 'filament' ? job.filament_used : value === 'time' ? job.total_duration : 1
        totals.set(job.status, (totals.get(job.status) ?? 0) + amount)
    }

    return [...totals.entries()]
        .map(([name, amount]) => ({ name, label: statusLabel(name), value: amount, color: statusColor(name) }))
        .filter((slice) => (value === 'jobs' ? true : slice.value > 0))
        .sort((a, b) => b.value - a.value)
}

/**
 * Slices under 5% of the whole are folded into one "Others" wedge -- upstream's
 * `groupSmallEntries`, same threshold. Only when there are at least two of
 * them: replacing one small slice with an "Others (1)" slice tells you strictly
 * less than the slice it replaced.
 */
export function groupSmallSlices(slices: StatusSlice[], threshold = 0.05): StatusSlice[] {
    const total = slices.reduce((sum, slice) => sum + slice.value, 0)
    if (!total) return slices

    const small = slices.filter((slice) => slice.value < total * threshold)
    if (small.length < 2) return slices

    const rest = slices.filter((slice) => slice.value >= total * threshold)
    rest.push({
        name: '__others__',
        label: `Others (${small.length})`,
        value: small.reduce((sum, slice) => sum + slice.value, 0),
        color: statusColor('__others__'),
    })

    return rest
}

/** Local midnight of a timestamp, as milliseconds. The chart buckets by day. */
const startOfDay = (date: Date): number => new Date(date).setHours(0, 0, 0, 0)

/**
 * Filament used per day over the last 15 days (upstream's `i <= 14` inclusive
 * loop), in metres. Empty days are present as zeroes so the bar chart shows the
 * gap instead of silently compressing the axis.
 */
export function filamentPerDay(jobs: HistoryJob[], days = 14): [number, number][] {
    const first = new Date()
    first.setDate(first.getDate() - days)

    const buckets = new Map<number, number>()
    for (let i = 0; i <= days; i++) {
        const day = new Date(first)
        day.setDate(day.getDate() + i)
        buckets.set(startOfDay(day), 0)
    }

    const from = startOfDay(first)
    for (const job of jobs) {
        if (job.filament_used <= 0) continue

        const day = startOfDay(new Date(job.start_time * 1000))
        if (day < from) continue
        if (!buckets.has(day)) continue

        buckets.set(day, (buckets.get(day) ?? 0) + job.filament_used / 1000)
    }

    return [...buckets.entries()].sort((a, b) => a[0] - b[0])
}

/** Upstream's five duration buckets, over completed jobs in the same window. */
export const PRINTTIME_BUCKETS = ['0-2h', '2-6h', '6-12h', '12-24h', '>24h']

export function printtimeDistribution(jobs: HistoryJob[], days = 14): number[] {
    const output = [0, 0, 0, 0, 0]
    const from = Date.now() - days * 86400 * 1000

    for (const job of jobs) {
        if (job.status !== 'completed') continue
        if (job.start_time * 1000 < from) continue

        const hours = job.print_duration / 3600
        if (hours <= 0) continue

        if (hours <= 2) output[0]++
        else if (hours <= 6) output[1]++
        else if (hours <= 12) output[2]++
        else if (hours <= 24) output[3]++
        else output[4]++
    }

    return output
}
