import { ref, computed, watch } from 'vue'

export type ThemeMode = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'mainsail-next.theme'

const isThemeMode = (value: unknown): value is ThemeMode => value === 'system' || value === 'light' || value === 'dark'

const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null

/** Module-level so every component shares one theme, not one per mount. */
const mode = ref<ThemeMode>(isThemeMode(stored) ? stored : 'system')

const query = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null

/**
 * Tracks the OS preference LIVE. Reading `matches` once at startup would leave
 * the UI on the wrong theme when the machine flips to night mode while the page
 * is open -- which is the normal case for a tablet left running at the printer.
 */
const systemPrefersDark = ref(query?.matches ?? false)
query?.addEventListener('change', (event) => {
    systemPrefersDark.value = event.matches
})

const resolved = computed<'light' | 'dark'>(() => {
    if (mode.value === 'system') return systemPrefersDark.value ? 'dark' : 'light'
    return mode.value
})

watch(
    [resolved, mode],
    ([theme, current]) => {
        const root = document.documentElement
        root.classList.toggle('dark', theme === 'dark')
        // Lets the browser render form controls, scrollbars and the like in the
        // matching scheme instead of always-light chrome on a dark page.
        root.style.colorScheme = theme
        localStorage.setItem(STORAGE_KEY, current)
    },
    { immediate: true }
)

export function useTheme() {
    return {
        mode,
        resolved,
        systemPrefersDark,
        setMode: (value: ThemeMode) => {
            mode.value = value
        },
    }
}
