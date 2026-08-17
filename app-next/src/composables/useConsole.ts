import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useConnectionStore, type ConsoleLine } from '@/stores/connection'
import { usePrinterStore } from '@/stores/printer'
import { useGuiStore } from '@/stores/gui'

/**
 * The g-code console: which lines are shown, what commands exist, and the
 * history the ⇵ keys walk. Upstream's `mixins/console.ts` plus the parts of
 * `store/gui/console` that decide visibility.
 */

/** Klipper's temperature chatter: `ok T:210.1 /210.0 B:60.0 /60.0`. */
const TEMPERATURE_FILTER = '^(?:ok\\s+)?(B|C|T\\d*):'

/** Timelapse macro traffic, upstream's list verbatim. */
const TIMELAPSE_FILTERS = [
    '^_TIMELAPSE_NEW_FRAME',
    '^TIMELAPSE_TAKE_FRAME',
    '^TIMELAPSE_RENDER',
    '^_SET_TIMELAPSE_SETUP',
    '^HYPERLAPSE ACTION=',
    '^SET_GCODE_VARIABLE MACRO=TIMELAPSE_',
]

export interface HelpEntry {
    command: string
    help: string
}

/**
 * Strip Klipper's own prefixes for display. Upstream's `formatConsoleMessage`,
 * minus the HTML: it turned the message into markup and ran DOMPurify over it.
 *
 * Rendering as TEXT instead is a deliberate change. Nothing in this console
 * needs HTML -- the one thing upstream's markup bought, clickable commands, is
 * done here by making the whole line clickable when it IS a command. And the
 * macros on this machine emit aligned text tables (TUNE_REPORT, SMOKE_STATUS);
 * as HTML their runs of spaces collapse, as text with `pre-wrap` they line up.
 */
export function formatConsoleMessage(message: string): string {
    return message
        .replace(/^!! /, '')
        .replace(/\n!! /g, '\n')
        .replace(/^\/\/ /, '')
        .replace(/\n\/\/ /g, '\n')
        .replace(/^echo:/, '')
        .replace(/^debug:/, '')
        .trim()
}

export function useConsole() {
    const connection = useConnectionStore()
    const printer = usePrinterStore()
    const gui = useGuiStore()

    const { consoleLines } = storeToRefs(connection)
    const { gcodeCommands } = storeToRefs(printer)

    const settings = computed(() => gui.state.console)

    /** Every command Klipper knows, with its `description:`, for help + tab. */
    const helpList = computed<HelpEntry[]>(() =>
        Object.entries(gcodeCommands.value ?? {})
            .map(([command, value]) => ({ command, help: (value as { help?: string })?.help ?? '' }))
            .sort((a, b) => a.command.localeCompare(b.command))
    )

    /**
     * Compiled once per settings change rather than per line. A bad regex from
     * the user is dropped with a note instead of throwing on every render --
     * upstream logged it to the browser console, where nobody looks.
     */
    const filterRules = computed(() => {
        const patterns: string[] = []

        if (settings.value.hideWaitTemperatures) patterns.push(TEMPERATURE_FILTER)
        if (settings.value.hideTlCommands) patterns.push(...TIMELAPSE_FILTERS)

        for (const filter of settings.value.filters) {
            if (!filter.enabled) continue
            for (const rule of filter.regex.split('\n')) if (rule.trim()) patterns.push(rule.trim())
        }

        return patterns.flatMap((pattern) => {
            try {
                return [new RegExp(pattern)]
            } catch {
                return []
            }
        })
    })

    const brokenFilters = computed(() =>
        settings.value.filters
            .filter((filter) => filter.enabled)
            .flatMap((filter) =>
                filter.regex.split('\n').flatMap((rule) => {
                    if (!rule.trim()) return []
                    try {
                        new RegExp(rule)
                        return []
                    } catch {
                        return [filter.name || rule]
                    }
                })
            )
    )

    /**
     * Lines to show. Filtering happens HERE and not at ingest, so switching a
     * filter off brings the lines back -- see the note in stores/connection.ts.
     */
    const lines = computed<ConsoleLine[]>(() => {
        const since = settings.value.clearedSince
        const rules = filterRules.value

        return consoleLines.value.filter((line) => {
            if (line.time < since) return false
            if (line.type === 'command' || line.type === 'help') return true

            const text = formatConsoleMessage(line.message)
            return !rules.some((rule) => rule.test(text))
        })
    })

    /** `table` reads newest-first; `shell` newest-last, like a terminal. */
    const orderedLines = computed(() =>
        settings.value.direction === 'table' ? [...lines.value].reverse() : lines.value
    )

    const history = computed(() => gui.state.gcodeHistory)

    /** Newest last, de-duplicated against the immediately previous entry. */
    function pushHistory(command: string): void {
        const entries = gui.state.gcodeHistory
        if (entries[entries.length - 1] !== command) entries.push(command)
        if (entries.length > 100) entries.splice(0, entries.length - 100)
    }

    function send(command: string): void {
        const trimmed = command.trim()
        if (!trimmed) return

        pushHistory(trimmed)
        void connection.sendGcode(trimmed)
    }

    /** Hides everything currently in the buffer without dropping it. */
    function clear(): void {
        gui.saveSetting('console.clearedSince', Date.now())
    }

    /**
     * Tab completion. Returns the longest common prefix of the matches, and the
     * matches themselves so the caller can list them -- upstream pushed an HTML
     * blob into the event log; here the list is data.
     */
    function complete(prefix: string): { completion: string; matches: HelpEntry[] } {
        const needle = prefix.toUpperCase()
        if (!needle) return { completion: prefix, matches: [] }

        const matches = helpList.value.filter((entry) => entry.command.startsWith(needle))
        if (!matches.length) return { completion: prefix, matches: [] }

        const common = matches.reduce((accumulator, entry) => {
            let index = 0
            while (index < accumulator.length && accumulator[index] === entry.command[index]) index++
            return accumulator.slice(0, index)
        }, matches[0].command)

        return { completion: common, matches: matches.length === 1 ? [] : matches }
    }

    return { settings, lines, orderedLines, helpList, history, brokenFilters, send, clear, complete, pushHistory }
}
