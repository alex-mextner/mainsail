import { ref, computed, onMounted, onUnmounted } from 'vue'

export type Breakpoint = 'mobile' | 'tablet' | 'desktop' | 'widescreen'

/**
 * Mainsail's own breakpoints, which are Vuetify 2's:
 *   mobile     < 600
 *   tablet     600 - 959
 *   desktop    960 - 1903
 *   widescreen >= 1904
 *
 * Kept identical on purpose. The dashboard changes its column count at these
 * widths, and matching them is what makes the layout feel like Mainsail rather
 * than an approximation of it.
 *
 * Note this is a different scale from the S/M/L density thresholds in
 * useDensity.ts, and deliberately so: breakpoints decide HOW MANY columns of
 * panels fit, density decides how much padding is inside them.
 */
export const BREAKPOINTS = { tablet: 600, desktop: 960, widescreen: 1904 } as const

export function useBreakpoint() {
    const width = ref(typeof window !== 'undefined' ? window.innerWidth : 1280)

    const update = () => {
        width.value = window.innerWidth
    }

    onMounted(() => window.addEventListener('resize', update))
    onUnmounted(() => window.removeEventListener('resize', update))

    const breakpoint = computed<Breakpoint>(() => {
        if (width.value < BREAKPOINTS.tablet) return 'mobile'
        if (width.value < BREAKPOINTS.desktop) return 'tablet'
        if (width.value < BREAKPOINTS.widescreen) return 'desktop'
        return 'widescreen'
    })

    return { width, breakpoint }
}
