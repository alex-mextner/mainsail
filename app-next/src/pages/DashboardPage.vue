<script setup lang="ts">
import { computed } from 'vue'
import { useBreakpoint } from '@/composables/useBreakpoint'
import PrintStatusPanel from '@/components/panels/PrintStatusPanel.vue'
import TemperaturePanel from '@/components/panels/TemperaturePanel.vue'

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
 * Mainsail lets the user reorder panels and persists that in the Moonraker
 * database. That is not wired up yet, so the order below is the default one;
 * the column-distribution shape is already the same, which is what the
 * reordering will plug into.
 */
const { breakpoint } = useBreakpoint()

type PanelName = 'status' | 'temperature'

const columns = computed<{ span: string; panels: PanelName[] }[]>(() => {
    switch (breakpoint.value) {
        case 'mobile':
            return [{ span: 'col-span-12', panels: ['status', 'temperature'] }]
        case 'tablet':
            return [
                { span: 'col-span-6', panels: ['status'] },
                { span: 'col-span-6', panels: ['temperature'] },
            ]
        case 'desktop':
            return [
                { span: 'col-span-5', panels: ['status'] },
                { span: 'col-span-7', panels: ['temperature'] },
            ]
        case 'widescreen':
            return [
                { span: 'col-span-3', panels: ['status'] },
                { span: 'col-span-5', panels: ['temperature'] },
                { span: 'col-span-4', panels: [] },
            ]
    }
})
</script>

<template>
    <div class="grid w-full grid-cols-12 gap-dgap">
        <div v-for="(column, index) in columns" :key="index" :class="[column.span, 'flex flex-col gap-dgap']">
            <template v-for="panel in column.panels" :key="panel">
                <PrintStatusPanel v-if="panel === 'status'" />
                <TemperaturePanel v-else-if="panel === 'temperature'" />
            </template>
        </div>
    </div>
</template>
