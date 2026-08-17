import { ref, watch } from 'vue'
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
            showPressureAdvance: boolean
            showExtrusionFactor: boolean
            showFeedamount: boolean
        }
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
            showPressureAdvance: true,
            showExtrusionFactor: true,
            showFeedamount: true,
        },
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
        return raw ? mergeDeep(base, JSON.parse(raw)) : base
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
            if (!isPlainObject(node[part])) node[part] = {}
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

    function reset(): void {
        state.value = defaults()
    }

    return { state, saveSetting, isPanelExpanded, setPanelExpanded, reset }
})
