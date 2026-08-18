<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import { useTheme, type ThemeMode } from '@/composables/useTheme'
import { useDensity, type DensityMode, DENSITY_BREAKPOINTS } from '@/composables/useDensity'
import { useConnectionStore } from '@/stores/connection'
import { usePrinterStore } from '@/stores/printer'
import { useGuiStore } from '@/stores/gui'
import {
    colorSchemeList,
    HEIGHTMAP_COLOR_SCHEME_OPTIONS,
    HEIGHTMAP_ORIENTATION_OPTIONS,
} from '@/lib/heightmapColors'

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

/**
 * Macros -- Mainsail's `Settings -> Macros`, simple mode
 * (`SettingsMacrosTabSimple.vue`): search plus one switch per macro, writing
 * into `gui.macros.hiddenMacros`.
 *
 * Expert mode -- the macro GROUP editor, where a group gets a name, a colour
 * and per-state visibility -- is not ported yet. `MacrogroupPanel` renders
 * groups correctly, but until this editor exists there is no way to create one
 * from the UI.
 */
const printer = usePrinterStore()
const gui = useGuiStore()
const { macros } = storeToRefs(printer)

const macroSearch = ref('')

/**
 * Heightmap appearance -- Mainsail's `Settings -> Heightmap` tab. Two settings,
 * both of them about how the 3D surface is drawn rather than about the mesh.
 *
 * The colour ramp is previewed next to the picker instead of being named only.
 * Upstream lists five names in a dropdown, and "Portland" versus "HSV" means
 * nothing until you see them; the swatch is the setting.
 */
const colorSchemeOptions = HEIGHTMAP_COLOR_SCHEME_OPTIONS
const orientationOptions = HEIGHTMAP_ORIENTATION_OPTIONS

const heightmapScheme = computed({
    get: () => gui.state.heightmap.activecolorscheme.toLowerCase(),
    // Normalised on write, so the case-insensitive lookup in
    // lib/heightmapColors.ts only has to cover values written by older builds.
    set: (value: string) => gui.saveSetting('heightmap.activecolorscheme', value.toLowerCase()),
})

const heightmapOrientation = computed({
    get: () => gui.state.heightmap.defaultOrientation,
    set: (value: string) => gui.saveSetting('heightmap.defaultOrientation', value),
})

const schemeSwatch = computed(() => `linear-gradient(to right, ${colorSchemeList(heightmapScheme.value).join(', ')})`)

const filteredMacros = computed(() => {
    const needle = macroSearch.value.trim().toLowerCase()
    if (!needle) return macros.value
    return macros.value.filter((macro) => macro.name.toLowerCase().includes(needle))
})

const hiddenMacros = computed(() => gui.state.macros.hiddenMacros.map((name) => name.toLowerCase()))

const isMacroVisible = (name: string) => !hiddenMacros.value.includes(name.toLowerCase())

/** Stored lower-cased, because Klipper command names are case-insensitive and
 *  the panel matches the same way. */
function toggleMacro(name: string): void {
    const lower = name.toLowerCase()
    const list = gui.state.macros.hiddenMacros
    const index = list.findIndex((entry) => entry.toLowerCase() === lower)

    if (index === -1) list.push(lower)
    else list.splice(index, 1)
}
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

        <Card v-if="macros.length">
            <CardHeader><CardTitle>Macros</CardTitle></CardHeader>
            <CardContent class="flex flex-col gap-3">
                <p class="text-muted-foreground text-xs">
                    Which macros appear on the dashboard. Klipper's own helpers — anything starting with an underscore,
                    and overrides of built-ins such as PAUSE — are never listed here; they are filtered out before this
                    point.
                </p>

                <input
                    v-model="macroSearch"
                    type="search"
                    placeholder="Search macros"
                    aria-label="Search macros"
                    class="border-input bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-1.5 text-sm outline-none focus-visible:ring-2" />

                <ul class="divide-border divide-y">
                    <li v-for="macro in filteredMacros" :key="macro.name" class="flex items-start gap-3 py-2">
                        <input
                            :id="`macro-visible-${macro.name}`"
                            type="checkbox"
                            :checked="isMacroVisible(macro.name)"
                            class="accent-primary mt-0.5 size-4 shrink-0"
                            @change="toggleMacro(macro.name)" />
                        <label :for="`macro-visible-${macro.name}`" class="min-w-0 flex-1 cursor-pointer">
                            <span class="block text-sm font-medium">{{ macro.name }}</span>
                            <!-- Klipper's description as text, not a tooltip: the
                                 tablet at the machine has no hover. -->
                            <span v-if="macro.description" class="text-muted-foreground block text-xs leading-snug">
                                {{ macro.description }}
                            </span>
                        </label>
                    </li>
                </ul>

                <p v-if="!filteredMacros.length" class="text-muted-foreground py-2 text-center text-sm italic">
                    No macro matches “{{ macroSearch }}”.
                </p>
            </CardContent>
        </Card>

        <Card>
            <CardHeader><CardTitle>Heightmap</CardTitle></CardHeader>
            <CardContent class="flex flex-col gap-6">
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <div class="min-w-0">
                        <p class="text-sm font-medium">Colour scheme</p>
                        <p class="text-muted-foreground text-xs">
                            How deviation is coloured on the 3D surface. Portland is diverging around its middle stop,
                            which is why it is the default: the neutral band is where the bed is flat.
                        </p>
                    </div>
                    <div class="flex items-center gap-2">
                        <span
                            class="border-input h-6 w-24 shrink-0 rounded border"
                            :style="{ background: schemeSwatch }"
                            aria-hidden="true" />
                        <select
                            v-model="heightmapScheme"
                            aria-label="Heightmap colour scheme"
                            class="border-input bg-background focus-visible:ring-ring rounded-md border px-2 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-none">
                            <option v-for="option in colorSchemeOptions" :key="option.value" :value="option.value">
                                {{ option.label }}
                            </option>
                        </select>
                    </div>
                </div>

                <div class="flex flex-wrap items-center justify-between gap-3">
                    <div class="min-w-0">
                        <p class="text-sm font-medium">Default orientation</p>
                        <p class="text-muted-foreground text-xs">
                            Which way the box faces when the page opens. It can still be dragged; this is only where it
                            starts.
                        </p>
                    </div>
                    <select
                        v-model="heightmapOrientation"
                        aria-label="Heightmap default orientation"
                        class="border-input bg-background focus-visible:ring-ring rounded-md border px-2 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-none">
                        <option v-for="option in orientationOptions" :key="option.value" :value="option.value">
                            {{ option.label }}
                        </option>
                    </select>
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
