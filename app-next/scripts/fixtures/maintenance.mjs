/**
 * Maintenance reminders, for a printer whose `maintenance` namespace is empty.
 *
 * 🔴 The live namespace on this machine holds exactly one record: upstream's
 * `MAINTENANCE_INIT` marker, a `{ name }` and nothing else. So the only state
 * reachable against the real database is the empty list -- and the marker is
 * itself a trap, because it has no `reminder` field and any code that reaches
 * for `entry.reminder.filament.bool` on it throws. It is included below on
 * purpose, so the run proves it is filtered rather than rendered.
 *
 * These are `rpc` fixtures, not `status` ones: maintenance is not a Klipper
 * object, it is a Moonraker database read.
 *
 * THE FOUR ENTRIES ARE FOUR REMINDER SHAPES, and the units are the part worth
 * checking -- filament is stored in mm but entered in METRES, print time in
 * seconds but entered in HOURS, age in seconds but entered in DAYS. Getting
 * one wrong yields a reminder that is merely "never due", which looks like
 * nothing at all.
 */

const HOUR = 3600
const DAY = 86400
const now = Math.floor(Date.now() / 1000)

/** Totals the reminders are measured against; also faked, so the bars are stable. */
export const maintenanceTotals = {
    'server.history.totals': {
        job_totals: {
            total_jobs: 24,
            total_time: 900000,
            total_print_time: 500 * HOUR,
            total_filament_used: 120000, // 120 m
            longest_job: 40000,
            longest_print: 39000,
        },
    },
}

export const maintenanceRpc = {
    ...maintenanceTotals,
    'server.database.get_item': {
        namespace: 'maintenance',
        key: null,
        value: {
            // The marker. Must be filtered, never drawn.
            'a3c7ac6b-65a6-43ca-8123-b824cd172ede': { name: 'MAINTENANCE_INIT' },

            // Overdue on filament: 120 m used since 0, limit 100 m.
            'b1000000-0000-0000-0000-000000000001': {
                name: 'Replace nozzle',
                note: 'Brass 0.4 wears out around 100 m of abrasive filament.',
                perform_note: null,
                start_time: now - 60 * DAY,
                end_time: null,
                start_filament: 0,
                end_filament: null,
                start_printtime: 0,
                end_printtime: null,
                last_entry: null,
                reminder: {
                    type: 'repeat',
                    filament: { bool: true, value: 100 },
                    printtime: { bool: false, value: null },
                    date: { bool: false, value: null },
                },
            },

            // Not yet due on print time: 100 h of 250 h.
            'b1000000-0000-0000-0000-000000000002': {
                name: 'Lubricate rails',
                note: '',
                perform_note: null,
                start_time: now - 30 * DAY,
                end_time: null,
                start_filament: 0,
                end_filament: null,
                start_printtime: 400 * HOUR,
                end_printtime: null,
                last_entry: null,
                reminder: {
                    type: 'repeat',
                    filament: { bool: false, value: null },
                    printtime: { bool: true, value: 250 },
                    date: { bool: false, value: null },
                },
            },

            // Overdue on age: started 60 days ago, limit 30 days.
            'b1000000-0000-0000-0000-000000000003': {
                name: 'Check belt tension',
                note: 'Y belt was found slack once already.',
                perform_note: null,
                start_time: now - 60 * DAY,
                end_time: null,
                start_filament: 0,
                end_filament: null,
                start_printtime: 0,
                end_printtime: null,
                last_entry: null,
                reminder: {
                    type: 'one-time',
                    filament: { bool: false, value: null },
                    printtime: { bool: false, value: null },
                    date: { bool: true, value: 30 },
                },
            },

            // Already performed: no progress bar, no "done" button, a date.
            'b1000000-0000-0000-0000-000000000004': {
                name: 'Clean bed surface',
                note: '',
                perform_note: 'IPA wipe',
                start_time: now - 20 * DAY,
                end_time: now - 5 * DAY,
                start_filament: 0,
                end_filament: 90000,
                start_printtime: 0,
                end_printtime: 300 * HOUR,
                last_entry: null,
                reminder: {
                    type: 'one-time',
                    filament: { bool: false, value: null },
                    printtime: { bool: false, value: null },
                    date: { bool: true, value: 30 },
                },
            },
        },
    },
}

/** What the machine really returns today: the marker alone. */
export const maintenanceEmptyRpc = {
    ...maintenanceTotals,
    'server.database.get_item': {
        namespace: 'maintenance',
        key: null,
        value: { 'a3c7ac6b-65a6-43ca-8123-b824cd172ede': { name: 'MAINTENANCE_INIT' } },
    },
}
