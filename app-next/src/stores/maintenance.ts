import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { useConnectionStore } from './connection'
import { useHistoryStore } from './history'

/**
 * Maintenance reminders -- Mainsail's `store/gui/maintenance/*` Vuex module.
 *
 * 🔴 THIS IS NOT KLIPPER STATE. Entries live in the Moonraker DATABASE, in the
 * `maintenance` namespace, and they are written by whichever interface the
 * user has open. On this machine that namespace currently holds exactly one
 * record -- a `MAINTENANCE_INIT` marker with no fields -- which upstream
 * writes once to mark "the defaults file was read and was empty". So there is
 * nothing real to draw, which is why this went to queue 2 with the hardware
 * panels even though it needs no hardware at all.
 *
 * 🔴 AND THE NAMESPACE IS SHARED WITH THE OTHER INTERFACE. Whatever this
 * writes, the Mainsail on the other port reads, so a screenshot run that
 * clicked "add" would leave a record in the user's real maintenance list.
 * That is exactly why `server.database.post_item` and `delete_item` are on the
 * rig's blocklist, and why the rig answers a blocked call WITH its fixture:
 * it is the only way the add-then-list flow can be exercised at all. Reads
 * (`get_item`) are not blocked -- blocking those would hollow out the panel
 * this exists to photograph.
 *
 * THREE THINGS A REMINDER CAN COUNT, and upstream's units are unobvious
 * enough to be worth stating: filament in METRES (stored as mm, so ×1000),
 * print time in HOURS (stored as seconds, ×3600), and age in DAYS (×86400).
 * Getting one of those wrong produces a reminder that is off by three orders
 * of magnitude and looks merely "never due".
 */

export interface MaintenanceReminder {
    type: null | 'one-time' | 'repeat'
    filament: { bool: boolean; value: number | null }
    printtime: { bool: boolean; value: number | null }
    date: { bool: boolean; value: number | null }
}

export interface MaintenanceEntry {
    id: string
    name: string
    note: string
    perform_note: string | null
    start_time: number
    end_time: number | null
    start_filament: number
    end_filament: number | null
    start_printtime: number
    end_printtime: number | null
    last_entry: string | null
    reminder: MaintenanceReminder
}

/** Upstream's marker for "defaults were read and there were none". Not an entry. */
const INIT_MARKER = 'MAINTENANCE_INIT'

const emptyReminder = (): MaintenanceReminder => ({
    type: null,
    filament: { bool: false, value: null },
    printtime: { bool: false, value: null },
    date: { bool: false, value: null },
})

export const useMaintenanceStore = defineStore('maintenance', () => {
    const connection = useConnectionStore()
    const history = useHistoryStore()

    const raw = ref<Record<string, Partial<MaintenanceEntry>>>({})
    const loading = ref(false)
    const loaded = ref(false)

    /**
     * Every stored record, normalised.
     *
     * The `MAINTENANCE_INIT` marker is filtered out here rather than at the
     * render site: it is a record with a name and NOTHING else, so any code
     * that reaches for `entry.reminder.filament.bool` on it throws. Upstream
     * tolerates it because Vuex getters were never asked; this store is read
     * by a panel that sorts and groups.
     */
    const entries = computed<MaintenanceEntry[]>(() =>
        Object.entries(raw.value)
            .filter(([, value]) => value?.name !== INIT_MARKER)
            .map(([id, value]) => ({
                id,
                name: value.name ?? '(unnamed)',
                note: value.note ?? '',
                perform_note: value.perform_note ?? null,
                start_time: value.start_time ?? 0,
                end_time: value.end_time ?? null,
                start_filament: value.start_filament ?? 0,
                end_filament: value.end_filament ?? null,
                start_printtime: value.start_printtime ?? 0,
                end_printtime: value.end_printtime ?? null,
                last_entry: value.last_entry ?? null,
                reminder: { ...emptyReminder(), ...(value.reminder ?? {}) },
            }))
            .sort((a, b) => a.name.localeCompare(b.name))
    )

    /** Only records that are still open -- a performed one is history. */
    const openEntries = computed(() => entries.value.filter((entry) => entry.end_time === null))

    const totalPrintTime = computed(() => history.totals?.total_print_time ?? 0)
    const totalFilament = computed(() => history.totals?.total_filament_used ?? 0)

    /**
     * How far through its reminder an entry is, 0..1+, and what it is counting.
     * Returns null when the entry has no reminder at all.
     */
    function progressOf(entry: MaintenanceEntry): { ratio: number; label: string; due: boolean } | null {
        if (entry.reminder.type === null || entry.end_time !== null) return null

        const candidates: { ratio: number; label: string }[] = []

        if (entry.reminder.filament.bool) {
            const target = (entry.reminder.filament.value ?? 0) * 1000
            const used = totalFilament.value - entry.start_filament
            candidates.push({
                ratio: target ? used / target : 0,
                label: `${Math.round(used / 1000)} / ${entry.reminder.filament.value} m`,
            })
        }
        if (entry.reminder.printtime.bool) {
            const target = (entry.reminder.printtime.value ?? 0) * 3600
            const used = totalPrintTime.value - entry.start_printtime
            candidates.push({
                ratio: target ? used / target : 0,
                label: `${Math.round(used / 3600)} / ${entry.reminder.printtime.value} h`,
            })
        }
        if (entry.reminder.date.bool) {
            const target = (entry.reminder.date.value ?? 0) * 86400
            const used = Date.now() / 1000 - entry.start_time
            candidates.push({
                ratio: target ? used / target : 0,
                label: `${Math.floor(used / 86400)} / ${entry.reminder.date.value} d`,
            })
        }

        if (!candidates.length) return null

        // The one closest to due decides, because ANY of the three firing makes
        // the entry overdue -- upstream's `getOverdueEntries` is an OR.
        const worst = candidates.reduce((a, b) => (b.ratio > a.ratio ? b : a))
        return { ...worst, due: worst.ratio >= 1 }
    }

    const overdue = computed(() => openEntries.value.filter((entry) => progressOf(entry)?.due));

    async function load(): Promise<void> {
        if (loading.value) return
        loading.value = true

        const result = await connection
            .call<{ value?: Record<string, Partial<MaintenanceEntry>> }>('server.database.get_item', {
                namespace: 'maintenance',
            })
            .catch(() => null)

        // A 404 here is normal: the namespace does not exist until something
        // writes to it. An empty list is the correct rendering, not an error.
        raw.value = result?.value ?? {}
        loaded.value = true
        loading.value = false
    }

    /**
     * Write one entry back.
     *
     * 🔴 Blocked by the rig in every screenshot run -- see the header. That is
     * deliberate and must not be "temporarily" lifted to watch the list fill
     * up: this namespace belongs to the interface the user actually prints
     * with.
     */
    async function store(entry: MaintenanceEntry): Promise<void> {
        const { id, ...value } = entry
        await connection.call('server.database.post_item', { namespace: 'maintenance', key: id, value }).catch(() => null)
        await load()
    }

    async function remove(id: string): Promise<void> {
        await connection.call('server.database.delete_item', { namespace: 'maintenance', key: id }).catch(() => null)
        await load()
    }

    /**
     * Mark an entry done. A `repeat` reminder restarts from the current
     * totals; a `one-time` one is closed for good.
     */
    async function perform(entry: MaintenanceEntry, note: string): Promise<void> {
        const now = Date.now() / 1000

        if (entry.reminder.type === 'repeat') {
            await store({
                ...entry,
                perform_note: note,
                start_time: now,
                start_filament: totalFilament.value,
                start_printtime: totalPrintTime.value,
                end_time: null,
                end_filament: null,
                end_printtime: null,
                last_entry: entry.id,
            })
            return
        }

        await store({
            ...entry,
            perform_note: note,
            end_time: now,
            end_filament: totalFilament.value,
            end_printtime: totalPrintTime.value,
        })
    }

    function reset(): void {
        raw.value = {}
        loaded.value = false
    }

    return {
        entries,
        openEntries,
        overdue,
        loading,
        loaded,
        progressOf,
        load,
        store,
        remove,
        perform,
        reset,
    }
})
