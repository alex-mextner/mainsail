import {
    formatDateTime,
    formatFilamentLength,
    formatFilesize,
    formatLength,
    formatPrintTime,
    formatTemperature,
} from '@/lib/format'
import type { HistoryJob } from '@/stores/history'

/**
 * The columns of the print-history table -- upstream's `headers` getter in
 * `HistoryListPanel.vue`, same fields in the same order, each with the
 * formatter upstream chose through its `outputType`.
 *
 * Held as data for the same reason the file table's columns are: the settings
 * menu, the header row and the cells all read one list, so adding a column is
 * one entry here rather than three edits that can drift apart.
 *
 * A job carries its numbers in two places -- the job record itself
 * (`print_duration`, `filament_used`: what actually happened) and the file's
 * slicer metadata (`estimated_time`, `layer_height`: what was planned). The
 * accessor below hides which is which, exactly as upstream's `outputValue`
 * does with its `key in job ? ... : job.metadata[key]` fallback.
 */
export interface HistoryColumn {
    /** Field id; also the id stored in the persisted hide-list. */
    key: string
    label: string
    format: (job: HistoryJob) => string
    /** Right-aligned, tabular figures -- anything that is a quantity. */
    numeric?: boolean
}

/** Metadata value, or undefined. Keeps the column definitions to one line each. */
const meta = (job: HistoryJob, key: string): number | undefined => {
    const value = job.metadata?.[key]
    return typeof value === 'number' ? value : undefined
}

export const HISTORY_COLUMNS: HistoryColumn[] = [
    { key: 'size', label: 'Size', format: (job) => formatFilesize(meta(job, 'size') ?? 0), numeric: true },
    { key: 'modified', label: 'Last modified', format: (job) => formatDateTime((meta(job, 'modified') ?? 0) * 1000) },
    { key: 'start_time', label: 'Start time', format: (job) => formatDateTime(job.start_time * 1000) },
    { key: 'end_time', label: 'End time', format: (job) => formatDateTime((job.end_time ?? 0) * 1000) },
    {
        key: 'estimated_time',
        label: 'Estimated time',
        format: (job) => formatPrintTime(meta(job, 'estimated_time') ?? 0),
        numeric: true,
    },
    { key: 'print_duration', label: 'Print time', format: (job) => formatPrintTime(job.print_duration), numeric: true },
    { key: 'total_duration', label: 'Total time', format: (job) => formatPrintTime(job.total_duration), numeric: true },
    {
        // Upstream calls this "Filament (calc.)": what the slicer planned, as
        // opposed to `filament_used`, which is what the extruder actually did.
        // A cancelled job is where the two diverge, and that is the point.
        key: 'filament_total',
        label: 'Filament (calc.)',
        format: (job) => formatFilamentLength(meta(job, 'filament_total')),
        numeric: true,
    },
    {
        key: 'filament_used',
        label: 'Filament used',
        format: (job) => formatFilamentLength(job.filament_used),
        numeric: true,
    },
    {
        key: 'first_layer_extr_temp',
        label: 'First layer extruder',
        format: (job) => formatTemperature(meta(job, 'first_layer_extr_temp')),
        numeric: true,
    },
    {
        key: 'first_layer_bed_temp',
        label: 'First layer bed',
        format: (job) => formatTemperature(meta(job, 'first_layer_bed_temp')),
        numeric: true,
    },
    {
        key: 'first_layer_height',
        label: 'First layer height',
        format: (job) => formatLength(meta(job, 'first_layer_height')),
        numeric: true,
    },
    {
        key: 'layer_height',
        label: 'Layer height',
        format: (job) => formatLength(meta(job, 'layer_height')),
        numeric: true,
    },
    {
        key: 'object_height',
        label: 'Object height',
        format: (job) => formatLength(meta(job, 'object_height')),
        numeric: true,
    },
    {
        key: 'slicer',
        label: 'Slicer',
        format: (job) => {
            const name = job.metadata?.slicer
            if (typeof name !== 'string') return '—'
            const version = job.metadata?.slicer_version
            return typeof version === 'string' ? `${name} ${version}` : name
        },
    },
]

/**
 * Raw sort key for a column. Sorting has to compare the underlying NUMBER, not
 * the formatted string: "8m 12s" against "1h 4m" sorts alphabetically into
 * nonsense, and upstream's own `sortFiles` sorts on the raw value for exactly
 * this reason.
 */
export function historySortValue(job: HistoryJob, key: string): number | string {
    switch (key) {
        case 'filename':
            return job.filename.toLowerCase()
        case 'status':
            return job.status
        case 'start_time':
            return job.start_time
        case 'end_time':
            return job.end_time ?? 0
        case 'print_duration':
            return job.print_duration
        case 'total_duration':
            return job.total_duration
        case 'filament_used':
            return job.filament_used
        case 'slicer':
            return typeof job.metadata?.slicer === 'string' ? job.metadata.slicer.toLowerCase() : ''
        default:
            return meta(job, key) ?? 0
    }
}
