import { ref, computed, watch } from 'vue'

export type DensityLevel = 's' | 'm' | 'l'
export type DensityMode = 'auto' | DensityLevel

const STORAGE_KEY = 'mainsail-next.density'

/**
 * Width thresholds, in CSS pixels, chosen from real device widths rather than
 * round numbers:
 *
 *   < 768   -> S   Phones report 360-430 CSS px; 768 is also where a desktop
 *                  browser sits when snapped to half of a 1536-wide screen.
 *   768..1279 -> M iPad portrait is 768 / 820 / 834 depending on model, and
 *                  iPad landscape is 1024 / 1180. The whole tablet range --
 *                  the tablet at the machine -- therefore lands in M.
 *   >= 1280 -> L   1280x720 is the smallest widely-used desktop logical width
 *                  (a 1366x768 laptop reports 1366), so at 1280+ there is room
 *                  to spend on comfortable spacing.
 *
 * These are window-width based, as asked -- not user-agent and not device type,
 * so a half-width window on a desktop correctly gets the compact layout.
 */
export const DENSITY_BREAKPOINTS = { s: 768, l: 1280 } as const

const isMode = (value: unknown): value is DensityMode =>
    value === 'auto' || value === 's' || value === 'm' || value === 'l'

const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null

const mode = ref<DensityMode>(isMode(stored) ? stored : 'auto')

const width = ref(typeof window !== 'undefined' ? window.innerWidth : 1280)
if (typeof window !== 'undefined') {
    window.addEventListener('resize', () => {
        width.value = window.innerWidth
    })
}

const autoLevel = computed<DensityLevel>(() => {
    if (width.value < DENSITY_BREAKPOINTS.s) return 's'
    if (width.value >= DENSITY_BREAKPOINTS.l) return 'l'
    return 'm'
})

const resolved = computed<DensityLevel>(() => (mode.value === 'auto' ? autoLevel.value : mode.value))

watch(
    [resolved, mode],
    ([level, current]) => {
        document.documentElement.dataset.density = level
        localStorage.setItem(STORAGE_KEY, current)
    },
    { immediate: true }
)

export function useDensity() {
    return {
        mode,
        resolved,
        autoLevel,
        width,
        setMode: (value: DensityMode) => {
            mode.value = value
        },
    }
}
