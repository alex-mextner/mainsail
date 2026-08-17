<script setup lang="ts">
import { computed } from 'vue'
import { useStore } from 'vuex'
import TemperaturePanel from '@/components/panels/TemperaturePanel.vue'
import PrintStatusPanel from '@/components/panels/PrintStatusPanel.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import { useTheme, type ThemeMode } from '@/composables/useTheme'
import { useDensity, type DensityMode } from '@/composables/useDensity'
import type { RootState } from '@/store/types'

const store = useStore<RootState>()
const hostname = computed(() => store.state.hostname)

const { mode: themeMode, resolved: resolvedTheme } = useTheme()
const { mode: densityMode, resolved: resolvedDensity, width } = useDensity()

const themeOptions: { value: ThemeMode; label: string; title: string }[] = [
    { value: 'system', label: 'Auto', title: 'Follow the operating system, live' },
    { value: 'light', label: 'Light', title: 'Always light' },
    { value: 'dark', label: 'Dark', title: 'Always dark' },
]

const densityOptions: { value: DensityMode; label: string; title: string }[] = [
    { value: 'auto', label: 'Auto', title: 'Pick a density from the window width' },
    { value: 's', label: 'S', title: 'Compact' },
    { value: 'm', label: 'M', title: 'Default' },
    { value: 'l', label: 'L', title: 'Roomy' },
]
</script>

<template>
    <div class="min-h-screen px-dpx py-dpy">
        <header class="mx-auto mb-dgap flex max-w-md flex-wrap items-center justify-between gap-2">
            <div class="flex min-w-0 items-baseline gap-2">
                <h1 class="text-lg font-semibold tracking-tight">Mainsail Next</h1>
                <span class="text-muted-foreground truncate text-xs">{{ hostname ?? '—' }}</span>
            </div>

            <div class="flex flex-wrap items-center gap-2">
                <SegmentedControl v-model="themeMode" :options="themeOptions" />
                <SegmentedControl v-model="densityMode" :options="densityOptions" />
            </div>
        </header>

        <!-- Resolved state, so the automatic modes are inspectable rather than
             invisible. Doubles as the assertion target for the screenshot check. -->
        <p class="text-muted-foreground mx-auto mb-dgap max-w-md text-[11px]" data-testid="resolved-state">
            theme: {{ themeMode }} → {{ resolvedTheme }} · density: {{ densityMode }} → {{ resolvedDensity }} ·
            {{ width }}px
        </p>

        <div class="mx-auto grid max-w-md gap-dgap">
            <PrintStatusPanel />
            <TemperaturePanel />
        </div>
    </div>
</template>
