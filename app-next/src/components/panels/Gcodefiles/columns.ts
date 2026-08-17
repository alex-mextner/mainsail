import {
    formatDateTime,
    formatFilamentLength,
    formatFilesize,
    formatLength,
    formatPrintTime,
    formatTemperature,
    formatWeight,
} from '@/lib/format'
import type { GcodeRow } from '@/composables/useGcodefiles'

/**
 * The metadata columns of the file table -- upstream's `configurableHeaders`,
 * same fields in the same order, each with the formatter upstream picked via
 * its `outputType`.
 *
 * Held as data rather than as template branches so that the column settings
 * menu, the header row and the cells all read from one list. Adding a column
 * Moonraker starts reporting is one entry here.
 *
 * `filaments` has no `format`: it renders colour swatches, so the row handles
 * it specially. Everything else is a string.
 */
export interface FileColumn {
    /** Field on the row; also the id used in the persisted hide-list. */
    key: string
    label: string
    format?: (row: GcodeRow) => string
    /** Right-aligned when the value is a quantity, like every other table. */
    numeric?: boolean
}

export const FILE_COLUMNS: FileColumn[] = [
    { key: 'size', label: 'Size', format: (row) => formatFilesize(row.size), numeric: true },
    { key: 'modified', label: 'Last modified', format: (row) => formatDateTime(row.modified) },
    {
        key: 'object_height',
        label: 'Object height',
        format: (row) => formatLength(row.object_height),
        numeric: true,
    },
    { key: 'layer_height', label: 'Layer height', format: (row) => formatLength(row.layer_height), numeric: true },
    {
        key: 'nozzle_diameter',
        label: 'Nozzle',
        format: (row) => formatLength(row.nozzle_diameter),
        numeric: true,
    },
    {
        key: 'first_layer_extr_temp',
        label: 'Extruder temp',
        format: (row) => formatTemperature(row.first_layer_extr_temp),
        numeric: true,
    },
    {
        key: 'first_layer_bed_temp',
        label: 'Bed temp',
        format: (row) => formatTemperature(row.first_layer_bed_temp),
        numeric: true,
    },
    {
        key: 'chamber_temp',
        label: 'Chamber temp',
        format: (row) => formatTemperature(row.chamber_temp),
        numeric: true,
    },
    // Rendered as swatches by the row, not as text.
    { key: 'filaments', label: 'Filaments' },
    { key: 'filament_name', label: 'Filament name', format: (row) => row.filament_name ?? '—' },
    { key: 'filament_type', label: 'Filament type', format: (row) => row.filament_type ?? '—' },
    {
        key: 'filament_total',
        label: 'Filament usage',
        format: (row) => formatFilamentLength(row.filament_total),
        numeric: true,
    },
    {
        key: 'filament_weight_total',
        label: 'Filament weight',
        format: (row) => formatWeight(row.filament_weight_total),
        numeric: true,
    },
    {
        key: 'estimated_time',
        label: 'Print time',
        format: (row) => formatPrintTime(row.estimated_time ?? 0),
        numeric: true,
    },
    { key: 'lastStartTime', label: 'Last started', format: (row) => formatDateTime(row.lastStartTime) },
    { key: 'lastEndTime', label: 'Last ended', format: (row) => formatDateTime(row.lastEndTime) },
    {
        key: 'lastPrintDuration',
        label: 'Last print duration',
        format: (row) => formatPrintTime(row.lastPrintDuration ?? 0),
        numeric: true,
    },
    {
        key: 'lastTotalDuration',
        label: 'Last total duration',
        format: (row) => formatPrintTime(row.lastTotalDuration ?? 0),
        numeric: true,
    },
    {
        key: 'lastFilamentUsed',
        label: 'Last filament used',
        format: (row) => formatFilamentLength(row.lastFilamentUsed),
        numeric: true,
    },
    {
        key: 'slicer',
        label: 'Slicer',
        format: (row) => (row.slicer ? [row.slicer, row.slicer_version].filter(Boolean).join(' ') : '—'),
    },
]
