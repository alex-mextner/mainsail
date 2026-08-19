<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import FarmPrinterPanel from '@/components/panels/FarmPrinterPanel.vue'
import { useFarmStore } from '@/stores/farm'

/**
 * The farm grid -- Mainsail's `pages/Farm.vue` (route `/allPrinters`).
 *
 * 🔴 CONNECTIONS ARE OPENED ON MOUNT AND CLOSED ON UNMOUNT, which upstream
 * does not do -- it connects when a printer is registered and keeps the socket
 * for the session. Tying them to this page instead means leaving the page
 * actually stops the traffic, so a farm entry cannot quietly hold a socket and
 * a reconnect timer open behind the dashboard. On this deployment the list is
 * empty and `connectAll()` returns immediately, so neither path runs at all.
 *
 * The empty state says which of the two reasons applies, because "no printers"
 * and "this build does not do farms" are different problems and only one of
 * them is fixable by adding a printer.
 */
const farm = useFarmStore()

/**
 * 🔴 A DELIBERATE TEST SEAM, and the reason it is worth having.
 *
 * Every other panel in this port is verified by photographing it. Farm's risk
 * is the opposite shape: what could go wrong is INVISIBLE -- a websocket and a
 * reconnect timer left running against a 512 MB Orange Pi that has already
 * been driven out of memory once. A screenshot of an empty page cannot tell
 * you whether the page is quietly holding a socket open, and there is no UI
 * for adding a printer here to drive the guards through.
 *
 * So `scripts/check-farm.mjs` reaches the store directly and asserts that
 * `addPrinter` refuses an entry pointing back at this host, and that leaving
 * the page closes what it opened. It exposes nothing a user could not already
 * reach through Vue devtools, and only while this page is mounted.
 */
onMounted(() => {
    ;(window as unknown as Record<string, unknown>).__pinia_farm = farm
    farm.connectAll()
})

onBeforeUnmount(() => {
    farm.disconnectAll()
    delete (window as unknown as Record<string, unknown>).__pinia_farm
})
</script>

<template>
    <div class="w-full" data-page="farm">
        <div v-if="!farm.enabled" class="text-muted-foreground py-12 text-center" data-testid="farm-disabled">
            <p class="text-base">This interface is served by a single printer.</p>
            <p class="mt-1 text-sm">
                The farm view lists other Moonraker hosts, and is only available on a build configured for several
                printers.
            </p>
        </div>

        <div v-else-if="!farm.count" class="text-muted-foreground py-12 text-center" data-testid="farm-empty">
            <p class="text-base">No printers have been added yet.</p>
        </div>

        <div v-else class="gap-dgap grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
            <FarmPrinterPanel v-for="printer in farm.printers" :key="printer.config.id" :printer="printer" />
        </div>
    </div>
</template>
