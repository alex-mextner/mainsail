<script setup lang="ts">
import { computed } from 'vue'
import { useBreakpoint } from '@/composables/useBreakpoint'
import KlippyStatePanel from '@/components/panels/KlippyStatePanel.vue'
import PrintStatusPanel from '@/components/panels/PrintStatusPanel.vue'
import TemperaturePanel from '@/components/panels/TemperaturePanel.vue'
import ToolheadControlPanel from '@/components/panels/ToolheadControlPanel.vue'

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
 * the control panels sit in the first column, temperature in the second.
 *
 * Mainsail lets the user reorder panels and persists that in the Moonraker
 * database. That is not wired up yet, so the order below is the default one;
 * the column-distribution shape is already the same, which is what the
 * reordering will plug into.
 */
const { breakpoint } = useBreakpoint()

type PanelName = 'status' | 'temperature' | 'toolhead'

const columns = computed<{ span: string; panels: PanelName[] }[]>(() => {
    switch (breakpoint.value) {
        case 'mobile':
            return [{ span: 'col-span-12', panels: ['status', 'toolhead', 'temperature'] }]
        case 'tablet':
            return [
                { span: 'col-span-6', panels: ['status', 'toolhead'] },
                { span: 'col-span-6', panels: ['temperature'] },
            ]
        case 'desktop':
            return [
                { span: 'col-span-5', panels: ['status', 'toolhead'] },
                { span: 'col-span-7', panels: ['temperature'] },
            ]
        case 'widescreen':
            return [
                { span: 'col-span-3', panels: ['status'] },
                { span: 'col-span-5', panels: ['toolhead'] },
                { span: 'col-span-4', panels: ['temperature'] },
            ]
    }
})
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
                <template v-for="panel in column.panels" :key="panel">
                    <PrintStatusPanel v-if="panel === 'status'" />
                    <ToolheadControlPanel v-else-if="panel === 'toolhead'" />
                    <TemperaturePanel v-else-if="panel === 'temperature'" />
                </template>
            </div>
        </div>
    </div>
</template>
