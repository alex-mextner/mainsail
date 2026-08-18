import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

/**
 * User interface preferences -- Mainsail's `gui` Vuex module, rewritten.
 *
 * 🔴 STORAGE, AND WHY IT IS NOT THE MOONRAKER DATABASE
 * ---------------------------------------------------
 * Upstream persists this in the Moonraker database under namespace `mainsail`.
 * That is the SAME namespace the working Mainsail on port 80 reads and writes.
 * If this app wrote there, changing a step size or collapsing a panel here would
 * silently rewrite the settings of the interface the user actually prints with
 * -- the one thing this rewrite is not allowed to touch.
 *
 * So this store is localStorage-only, under the same `mainsail-next.` prefix the
 * theme and density composables already use. It is per-browser rather than
 * per-printer, which is a real difference from upstream; moving it to a
 * SEPARATE Moonraker namespace (`mainsail_next`) later is a drop-in change to
 * the two functions at the bottom of this file, because nothing else knows where
 * the bytes go.
 *
 * The shape below is Mainsail's own (src/store/gui/index.ts, `getDefaultState`),
 * trimmed to the keys the ported panels actually read. Values are upstream's
 * defaults verbatim -- a user coming from Mainsail must not find different
 * step sizes here.
 */

export type ControlStyle = 'bars' | 'cross' | 'circle'
export type ActionButton = 'motorsOff' | 'qgl' | 'ztilt'
export type Viewport = 'mobile' | 'tablet' | 'desktop' | 'widescreen'

/** Named colours a macro group can paint its buttons with (upstream's set). */
export type MacroColor = 'primary' | 'secondary' | 'success' | 'warning' | 'error'

export interface MacrogroupMacro {
    pos: number
    name: string
    /** `group` means "whatever the group is painted with". */
    color: MacroColor | 'group'
    showInStandby: boolean
    showInPrinting: boolean
    showInPause: boolean
}

export interface Macrogroup {
    id: string | null
    name: string
    color: MacroColor | 'custom'
    colorCustom?: string
    showInStandby: boolean
    showInPrinting: boolean
    showInPause: boolean
    macros?: MacrogroupMacro[]
}

export interface GuiState {
    control: {
        style: ControlStyle
        actionButton: ActionButton | null
        hideDuringPrint: boolean
        enableXYHoming: boolean
        feedrateXY: number
        stepsXY: number[]
        feedrateZ: number
        offsetsZ: number[]
        offsetZSaveOption: string | null
        stepsZ: number[]
        stepsAll: number[]
        stepsCircleXY: number[]
        stepsCircleZ: number[]
        selectedCrossStep: number | null
        reverseX: boolean
        reverseY: boolean
        reverseZ: boolean
        extruder: {
            feedamount: number
            feedamounts: number[]
            feedrate: number
            feedrates: number[]
            showEstimatedExtrusionInfo: boolean
        }
    }
    view: {
        toolhead: {
            showPosition: boolean
            showCoordinates: boolean
            showControl: boolean
            showZOffset: boolean
            showSpeedFactor: boolean
        }
        extruder: {
            showTools: boolean
            showExtrusionFactor: boolean
            showPressureAdvance: boolean
            showFirmwareRetraction: boolean
            showExtruderControl: boolean
        }
        gcodefiles: {
            /** Path relative to the gcodes root; '' is the root. */
            currentPath: string
            search: string
            showHiddenFiles: boolean
            showPrintedFiles: boolean
            sortBy: string
            sortDesc: boolean
            /** Metadata columns the user switched off, by field name. */
            hideMetadataColumns: string[]
        }
        history: {
            /** Column ids the user switched off. Upstream's `hideColums` (sic). */
            hideColumns: string[]
            /** Job statuses hidden from the list, e.g. 'cancelled'. */
            hideStatus: string[]
            sortBy: string
            sortDesc: boolean
            /** `chart` or `table` for the print-status breakdown. */
            statusView: 'chart' | 'table'
            /** What the breakdown counts: jobs, filament or time. */
            statusValue: 'jobs' | 'filament' | 'time'
            /** Which of the two right-hand charts is shown. */
            chart: 'filament_usage' | 'printtime_avg'
        }
        webcam: {
            /**
             * Which camera each surface shows, keyed by surface -- upstream's
             * `view.webcam.currentCam`, same two keys and the same `'all'`
             * sentinel for "show them all in a grid".
             *
             * Two keys rather than one because they are genuinely different
             * choices: the dashboard panel is a glance at the one camera that
             * matters, the /cam page is where you look at all of them.
             */
            currentCam: { dashboard: string; page: string }
        }
    }
    console: {
        /** `table` puts newest first; `shell` reads bottom-up like a terminal. */
        direction: 'table' | 'shell'
        entryStyle: 'default' | 'compact'
        autoscroll: boolean
        /** Hide `ok T:210 B:60` chatter from M105 and heat-and-wait. */
        hideWaitTemperatures: boolean
        hideTlCommands: boolean
        /** Raw means: no prefix stripping, show exactly what came over the wire. */
        rawOutput: boolean
        /** User regexes. Each entry hides lines it matches while `enabled`. */
        filters: { name: string; regex: string; enabled: boolean }[]
        /** Lines older than this are not shown. Upstream's `cleared_since`. */
        clearedSince: number
    }
    /** Commands typed into the console, oldest first -- the ⇵ history. */
    gcodeHistory: string[]
    macros: {
        /** `simple` shows one panel with every macro; `expert` shows the
         *  user-defined groups instead. Upstream's own two modes. */
        mode: 'simple' | 'expert'
        /** Lower-cased names the user hid from the simple panel. */
        hiddenMacros: string[]
        macrogroups: Record<string, Macrogroup>
    }
    dashboard: {
        /** Panels the user collapsed, per viewport. Same inverted sense as
         *  upstream: a panel is expanded unless it is listed here. */
        nonExpandPanels: Record<Viewport, string[]>
    }
}

const defaults = (): GuiState => ({
    control: {
        style: 'bars',
        actionButton: null,
        hideDuringPrint: false,
        enableXYHoming: false,
        feedrateXY: 100,
        stepsXY: [100, 10, 1],
        feedrateZ: 25,
        offsetsZ: [0.005, 0.01, 0.025, 0.05],
        offsetZSaveOption: null,
        stepsZ: [25, 1, 0.1],
        stepsAll: [0.1, 1, 10, 25, 50, 100],
        stepsCircleXY: [1, 10, 50, 100],
        stepsCircleZ: [0.1, 1, 10, 50],
        selectedCrossStep: null,
        reverseX: false,
        reverseY: false,
        reverseZ: false,
        extruder: {
            feedamount: 25,
            feedamounts: [50, 25, 10, 5, 1],
            feedrate: 5,
            feedrates: [10, 5, 2, 1],
            showEstimatedExtrusionInfo: true,
        },
    },
    view: {
        toolhead: {
            showPosition: true,
            showCoordinates: true,
            showControl: true,
            showZOffset: true,
            showSpeedFactor: true,
        },
        extruder: {
            showTools: true,
            showExtrusionFactor: true,
            showPressureAdvance: true,
            showFirmwareRetraction: true,
            showExtruderControl: true,
        },
        gcodefiles: {
            currentPath: '',
            search: '',
            showHiddenFiles: false,
            showPrintedFiles: true,
            // Upstream's defaults: newest first is what you want after slicing.
            sortBy: 'modified',
            sortDesc: true,
            // Everything the machine reports is shown until switched off. On a
            // narrow screen the table scrolls rather than dropping columns, so
            // hiding is the user's choice, not the layout's.
            hideMetadataColumns: [],
        },
        history: {
            hideColumns: [],
            hideStatus: [],
            // Upstream's defaults: newest job first.
            sortBy: 'start_time',
            sortDesc: true,
            statusView: 'chart',
            statusValue: 'jobs',
            chart: 'filament_usage',
        },
        webcam: {
            currentCam: { dashboard: 'all', page: 'all' },
        },
    },
    console: {
        direction: 'table',
        entryStyle: 'default',
        autoscroll: true,
        hideWaitTemperatures: true,
        hideTlCommands: true,
        rawOutput: false,
        filters: [],
        clearedSince: 0,
    },
    gcodeHistory: [],
    macros: {
        mode: 'simple',
        hiddenMacros: [],
        macrogroups: {},
    },
    dashboard: {
        nonExpandPanels: { mobile: [], tablet: [], desktop: [], widescreen: [] },
    },
})

const STORAGE_KEY = 'mainsail-next.gui'

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Merge stored values over defaults key by key. A plain `{...defaults, ...stored}`
 * would lose every default under a branch the user has ever touched, so a
 * settings key added in a later version would read `undefined` for anyone with
 * an existing localStorage entry.
 */
function mergeDeep<T>(base: T, patch: unknown): T {
    if (!isPlainObject(patch) || !isPlainObject(base)) return base

    const result: Record<string, unknown> = { ...base }
    for (const [key, value] of Object.entries(patch)) {
        // Unknown keys are dropped: they are either stale or hand-edited.
        if (!(key in result)) continue
        result[key] = isPlainObject(result[key]) ? mergeDeep(result[key], value) : value
    }
    return result as T
}

function load(): GuiState {
    const base = defaults()
    if (typeof localStorage === 'undefined') return base

    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return base

        const stored = JSON.parse(raw)
        const merged = mergeDeep(base, stored)

        /**
         * `macrogroups` is a free-form map: its keys are ids the user created,
         * not schema. `mergeDeep` drops keys that are absent from the defaults,
         * which is right for every other branch and exactly wrong for this one --
         * it would silently delete every group the user ever made. So this one
         * branch is restored wholesale.
         */
        const groups = (stored as { macros?: { macrogroups?: unknown } } | null)?.macros?.macrogroups
        if (isPlainObject(groups)) merged.macros.macrogroups = groups as Record<string, Macrogroup>

        return merged
    } catch {
        // Corrupt JSON must not take the whole UI down; defaults are always safe.
        return base
    }
}

export const useGuiStore = defineStore('gui', () => {
    const state = ref<GuiState>(load())

    watch(
        state,
        (value) => {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
            } catch {
                // Private-mode / quota. Settings stay in memory for the session.
            }
        },
        { deep: true }
    )

    /**
     * Write one setting by dotted path, e.g. `control.stepsXY`.
     * Same call shape as upstream's `gui/saveSetting` dispatch, so the ported
     * components read almost identically to the originals.
     */
    function saveSetting(path: string, value: unknown): void {
        const parts = path.split('.')
        const last = parts.pop()
        if (!last) return

        let node: Record<string, unknown> = state.value as unknown as Record<string, unknown>
        for (const part of parts) {
            // Arrays count as traversable: `console.filters.0.enabled` has to
            // reach into the array, not replace it with an object. Testing for
            // a PLAIN object here silently wiped the whole filter list.
            const next = node[part]
            if (typeof next !== 'object' || next === null) node[part] = {}
            node = node[part] as Record<string, unknown>
        }
        node[last] = value
    }

    /** Whether a panel is expanded in this viewport. Expanded is the default. */
    function isPanelExpanded(name: string, viewport: Viewport): boolean {
        return !state.value.dashboard.nonExpandPanels[viewport].includes(name)
    }

    function setPanelExpanded(name: string, viewport: Viewport, expanded: boolean): void {
        const list = state.value.dashboard.nonExpandPanels[viewport]
        const index = list.indexOf(name)

        if (expanded && index !== -1) list.splice(index, 1)
        if (!expanded && index === -1) list.push(name)
    }

    /**
     * Macro groups with their id filled in, name-sorted case-insensitively --
     * upstream's `gui/macros/getAllMacrogroups`. The id lives in the map key
     * upstream, so it has to be folded back into the object for the panels.
     */
    const macrogroups = computed<Macrogroup[]>(() =>
        Object.entries(state.value.macros.macrogroups)
            .map(([id, group]) => ({ ...group, id }))
            .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
    )

    const macrogroup = (id: string): Macrogroup | undefined => state.value.macros.macrogroups[id]

    function reset(): void {
        state.value = defaults()
    }

    return { state, macrogroups, macrogroup, saveSetting, isPanelExpanded, setPanelExpanded, reset }
})
