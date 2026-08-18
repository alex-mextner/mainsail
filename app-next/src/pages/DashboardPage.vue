<script setup lang="ts">
import { computed } from 'vue'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { useGuiStore } from '@/stores/gui'
import KlippyStatePanel from '@/components/panels/KlippyStatePanel.vue'
import ExtruderControlPanel from '@/components/panels/ExtruderControlPanel.vue'
import MacrosPanel from '@/components/panels/MacrosPanel.vue'
import MacrogroupPanel from '@/components/panels/MacrogroupPanel.vue'
import MiniconsolePanel from '@/components/panels/MiniconsolePanel.vue'
import PrintStatusPanel from '@/components/panels/PrintStatusPanel.vue'
import TemperaturePanel from '@/components/panels/TemperaturePanel.vue'
import ToolheadControlPanel from '@/components/panels/ToolheadControlPanel.vue'
import WebcamPanel from '@/components/panels/WebcamPanel.vue'
import MiscellaneousPanel from '@/components/panels/MiscellaneousPanel.vue'
import LedEffectsPanel from '@/components/panels/LedEffectsPanel.vue'
import SpoolmanPanel from '@/components/panels/SpoolmanPanel.vue'

/**
 * Mainsail's dashboard: panels distributed across 1-3 columns depending on the
 * breakpoint, spanning the full window width.
 *
 * Column ratios are Mainsail's own (src/pages/Dashboard.vue):
 *   mobile      1 column
 *   tablet      6 / 6
 *   desktop     5 / 7
 *   widescreen  3 / 5 / 4
 *
 * Panel-to-column assignment follows upstream's default layouts
 * (store/gui/index.ts, `desktopLayout1` / `desktopLayout2` / `widescreen*`):
 * the control panels sit in the first column, temperature in the second, and
 * macros directly after the extruder in every one of them.
 *
 * Panels that appear in NO default layout -- led-effects, spoolman, and later
 * afc / mmu -- are not homeless upstream either: `gui/getters.getPanels` appends
 * everything from `allDashboardPanels` that the stored layout does not mention
 * to the END of column 1, visible. That is where they go here, for the same
 * reason: those panels only exist when the hardware does, so they cannot be in
 * a default layout, and each one hides itself when its objects are absent.
 *
 * Mainsail lets the user reorder panels and persists that in the Moonraker
 * database. That is not wired up yet, so the order below is the default one;
 * the column-distribution shape is already the same, which is what the
 * reordering will plug into.
 */
const { breakpoint } = useBreakpoint()
const gui = useGuiStore()

type FixedPanel =
    | 'status'
    | 'temperature'
    | 'toolhead'
    | 'extruder'
    | 'macros'
    | 'miniconsole'
    | 'webcam'
    | 'miscellaneous'
    | 'ledeffects'
    | 'spoolman'

/** A macro group renders one panel each, so the list cannot be a fixed union. */
type PanelEntry = { kind: FixedPanel } | { kind: 'macrogroup'; id: string }

/**
 * Simple vs expert, upstream's rule (store/gui/getters.ts): in `simple` mode
 * one panel holds every macro and the groups are not rendered at all; in
 * `expert` mode that panel is replaced by one panel per group. They are never
 * both on the dashboard.
 */
const macroPanels = computed<PanelEntry[]>(() => {
    if (gui.state.macros.mode === 'simple') return [{ kind: 'macros' }]

    return gui.macrogroups.flatMap((group) => (group.id ? [{ kind: 'macrogroup' as const, id: group.id }] : []))
})

const columns = computed<{ span: string; panels: PanelEntry[] }[]>(() => {
    const macros = macroPanels.value

    switch (breakpoint.value) {
        case 'mobile':
            // No webcam here, and that is upstream's default too
            // (`mobileLayout`, the one entry with `visible: false`). Worth
            // stating because it is the only layout that differs: a phone is
            // usually on mobile data, and a camera panel scrolled off screen
            // still costs frames. It stays one tap away in the sidebar.
            return [
                {
                    span: 'col-span-12',
                    panels: [
                        { kind: 'status' },
                        { kind: 'toolhead' },
                        { kind: 'extruder' },
                        ...macros,
                        { kind: 'miscellaneous' },
                        { kind: 'ledeffects' },
                        { kind: 'spoolman' },
                        { kind: 'temperature' },
                        { kind: 'miniconsole' },
                    ],
                },
            ]
        case 'tablet':
            return [
                {
                    span: 'col-span-6',
                    panels: [
                        { kind: 'status' },
                        { kind: 'webcam' },
                        { kind: 'toolhead' },
                        { kind: 'extruder' },
                        ...macros,
                        { kind: 'miscellaneous' },
                        { kind: 'ledeffects' },
                        { kind: 'spoolman' },
                    ],
                },
                { span: 'col-span-6', panels: [{ kind: 'temperature' }, { kind: 'miniconsole' }] },
            ]
        case 'desktop':
            return [
                {
                    span: 'col-span-5',
                    panels: [
                        { kind: 'status' },
                        { kind: 'webcam' },
                        { kind: 'toolhead' },
                        { kind: 'extruder' },
                        ...macros,
                        { kind: 'miscellaneous' },
                        { kind: 'ledeffects' },
                        { kind: 'spoolman' },
                    ],
                },
                { span: 'col-span-7', panels: [{ kind: 'temperature' }, { kind: 'miniconsole' }] },
            ]
        case 'widescreen':
            return [
                { span: 'col-span-3', panels: [{ kind: 'status' }] },
                {
                    span: 'col-span-5',
                    panels: [
                        { kind: 'toolhead' },
                        { kind: 'extruder' },
                        ...macros,
                        { kind: 'miscellaneous' },
                        { kind: 'ledeffects' },
                        { kind: 'spoolman' },
                    ],
                },
                // Upstream's widescreen third column starts with the webcam and
                // ends with the console (widescreenLayout3). Temperature is in
                // it too only because upstream's second column also holds
                // machine-settings, which is not ported yet.
                { span: 'col-span-4', panels: [{ kind: 'webcam' }, { kind: 'temperature' }, { kind: 'miniconsole' }] },
            ]
    }
})

/** Stable key: two macro groups are distinguished by id, not by position. */
const keyOf = (panel: PanelEntry) => (panel.kind === 'macrogroup' ? `macrogroup-${panel.id}` : panel.kind)
</script>

<template>
    <div class="gap-dgap @container flex w-full flex-col">
        <!--
            Upstream nests this inside StatusPanel, so on a widescreen it lands
            in the narrow 3/12 column. It is full width here instead: the thing
            it renders is a multi-line Klipper error, and a config error wrapped
            into a 300px column is materially harder to read than the same text
            across the page. It occupies no space when Klippy is ready.
        -->
        <KlippyStatePanel />

        <div class="gap-dgap grid w-full grid-cols-12">
            <div v-for="(column, index) in columns" :key="index" :class="[column.span, 'gap-dgap flex flex-col']">
                <template v-for="panel in column.panels" :key="keyOf(panel)">
                    <PrintStatusPanel v-if="panel.kind === 'status'" />
                    <WebcamPanel v-else-if="panel.kind === 'webcam'" surface="dashboard" />
                    <ToolheadControlPanel v-else-if="panel.kind === 'toolhead'" />
                    <ExtruderControlPanel v-else-if="panel.kind === 'extruder'" />
                    <MacrosPanel v-else-if="panel.kind === 'macros'" />
                    <MacrogroupPanel v-else-if="panel.kind === 'macrogroup'" :group-id="panel.id" />
                    <MiscellaneousPanel v-else-if="panel.kind === 'miscellaneous'" />
                    <LedEffectsPanel v-else-if="panel.kind === 'ledeffects'" />
                    <SpoolmanPanel v-else-if="panel.kind === 'spoolman'" />
                    <TemperaturePanel v-else-if="panel.kind === 'temperature'" />
                    <MiniconsolePanel v-else-if="panel.kind === 'miniconsole'" />
                </template>
            </div>
        </div>
    </div>
</template>
