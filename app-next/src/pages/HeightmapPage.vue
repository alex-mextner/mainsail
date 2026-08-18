<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { useConnectionStore } from '@/stores/connection'
import { usePrinterStore } from '@/stores/printer'
import KlippyStatePanel from '@/components/panels/KlippyStatePanel.vue'
import HeightmapChartPanel from '@/components/panels/Heightmap/HeightmapChartPanel.vue'
import HeightmapCurrentProfilePanel from '@/components/panels/Heightmap/HeightmapCurrentProfilePanel.vue'
import HeightmapProfilesPanel from '@/components/panels/Heightmap/HeightmapProfilesPanel.vue'

/**
 * `/heightmap` -- upstream's `pages/Heightmap.vue`: the chart on the left at
 * 8/12, the current-mesh readout and the profile list stacked on the right.
 *
 * 🔴 FIRST OF QUEUE 2, AND NOT VERIFIABLE AGAINST THIS MACHINE YET
 * ---------------------------------------------------------------
 * This is the user's own ordering. The CR-Touch burnt out (H1) and
 * `[include cr-touch.cfg]` is commented out of printer.cfg, so Klipper here
 * publishes no `bed_mesh` object at all: every interesting state on this page
 * is unreachable against the live printer today. It was built and checked
 * against injected data instead -- see `scripts/shoot-heightmap.mjs`, which
 * patches the websocket reply in the browser and changes nothing on the
 * printer. What IS verified live is the state the user would see right now: no
 * `[bed_mesh]` section, said in words.
 *
 * Upstream gates the whole page behind a "Klipper is not ready" alert. That
 * alert is replaced with the KlippyStatePanel this fork already has, which
 * quotes Klipper's own `state_message` rather than saying only that something
 * is wrong.
 */
const { breakpoint } = useBreakpoint()
const connection = useConnectionStore()
const printer = usePrinterStore()
const { isReady } = storeToRefs(connection)

/**
 * With no `[bed_mesh]` section there are no profiles and there never can be, so
 * the right-hand column is dropped rather than shown holding an empty "No saved
 * profile." card -- a permanently empty panel reads as something that failed to
 * load. The chart panel then takes the full width and explains the situation in
 * one place.
 *
 * Note the `=== true`: before the object subscription lands, the answer is
 * "don't know yet", and "No saved profile." is as much a false claim as the
 * sentence in the chart panel. So the column waits for a real yes rather than
 * for the absence of a no. See `configLoaded` in stores/printer.ts.
 */
const hasBedMesh = computed(() => printer.configLoaded && printer.hasConfigSection('bed_mesh'))
</script>

<template>
    <div v-if="!isReady" class="w-full">
        <KlippyStatePanel />
    </div>

    <div v-else class="gap-dgap grid w-full grid-cols-12">
        <div
            :class="breakpoint === 'mobile' || !hasBedMesh ? 'col-span-12' : 'col-span-8'"
            class="gap-dgap flex flex-col">
            <HeightmapChartPanel />
        </div>

        <div
            v-if="hasBedMesh"
            :class="breakpoint === 'mobile' ? 'col-span-12' : 'col-span-4'"
            class="gap-dgap flex flex-col">
            <HeightmapCurrentProfilePanel />
            <HeightmapProfilesPanel />
        </div>
    </div>
</template>
