<script setup lang="ts">
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import { useTheme, type ThemeMode } from '@/composables/useTheme'
import { useDensity, type DensityMode, DENSITY_BREAKPOINTS } from '@/composables/useDensity'
import { useConnectionStore } from '@/stores/connection'

/**
 * Where the appearance controls belong. They previously sat in a permanent bar
 * at the top of every page, which was wrong twice over: it is not where
 * Mainsail keeps settings, and it spent the most valuable screen space on
 * something touched once.
 */
const { mode: themeMode, resolved: resolvedTheme } = useTheme()
const { mode: densityMode, resolved: resolvedDensity, width } = useDensity()
const connection = useConnectionStore()

const themeOptions: { value: ThemeMode; label: string; title: string }[] = [
    { value: 'system', label: 'System', title: 'Follow the operating system, live' },
    { value: 'light', label: 'Light', title: 'Always light' },
    { value: 'dark', label: 'Dark', title: 'Always dark' },
]

const densityOptions: { value: DensityMode; label: string; title: string }[] = [
    { value: 'auto', label: 'Auto', title: 'Choose from the window width' },
    { value: 's', label: 'S', title: 'Compact' },
    { value: 'm', label: 'M', title: 'Default' },
    { value: 'l', label: 'L', title: 'Roomy' },
]
</script>

<template>
    <div class="flex w-full flex-col gap-dgap">
        <Card>
            <CardHeader><CardTitle>Appearance</CardTitle></CardHeader>
            <CardContent class="flex flex-col gap-6">
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <p class="text-sm font-medium">Theme</p>
                        <p class="text-muted-foreground text-xs">
                            System follows the operating system as it changes, without a reload — currently
                            <span class="font-medium">{{ resolvedTheme }}</span>
                            .
                        </p>
                    </div>
                    <SegmentedControl v-model="themeMode" :options="themeOptions" />
                </div>

                <div class="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <p class="text-sm font-medium">Density</p>
                        <p class="text-muted-foreground text-xs">
                            Auto picks from window width (S below {{ DENSITY_BREAKPOINTS.s }}px, L from
                            {{ DENSITY_BREAKPOINTS.l }}px) — currently
                            <span class="font-medium">{{ resolvedDensity }}</span>
                            at {{ width }}px. Tap targets stay at least 44px at every level.
                        </p>
                    </div>
                    <SegmentedControl v-model="densityMode" :options="densityOptions" />
                </div>
            </CardContent>
        </Card>

        <Card>
            <CardHeader><CardTitle>Printer</CardTitle></CardHeader>
            <CardContent>
                <dl class="grid gap-2 text-sm sm:grid-cols-2">
                    <div class="flex justify-between gap-4 sm:block">
                        <dt class="text-muted-foreground text-xs">Host</dt>
                        <dd class="font-medium">{{ connection.hostname ?? '—' }}</dd>
                    </div>
                    <div class="flex justify-between gap-4 sm:block">
                        <dt class="text-muted-foreground text-xs">Klipper</dt>
                        <dd class="font-medium">{{ connection.softwareVersion ?? '—' }}</dd>
                    </div>
                    <div class="flex justify-between gap-4 sm:block">
                        <dt class="text-muted-foreground text-xs">Connection</dt>
                        <dd class="font-medium">{{ connection.socketState }}</dd>
                    </div>
                    <div class="flex justify-between gap-4 sm:block">
                        <dt class="text-muted-foreground text-xs">Klippy state</dt>
                        <dd class="font-medium">{{ connection.klippyState ?? '—' }}</dd>
                    </div>
                </dl>
            </CardContent>
        </Card>
    </div>
</template>
