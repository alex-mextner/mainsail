<script setup lang="ts">
import TimelapseFilesPanel from '@/components/panels/Timelapse/TimelapseFilesPanel.vue'
import TimelapseStatusPanel from '@/components/panels/Timelapse/TimelapseStatusPanel.vue'
import { useTimelapseStore } from '@/stores/timelapse'
import { useConnectionStore } from '@/stores/connection'

/**
 * /timelapse -- Mainsail's `pages/Timelapse.vue`: the file list beside the
 * status panel, and on a narrow screen the status ABOVE the list (upstream
 * flips the order at `mdAndUp`, because the thing you came to check on a phone
 * mid-print is the frame counter, not the archive).
 *
 * 🔴 REACHABLE EVEN THOUGH THE SIDEBAR ENTRY IS NOT. moonraker-timelapse is not
 * installed on this printer, so the router hides the navigation item -- but the
 * route still resolves, because a link can be bookmarked and "page not found"
 * would be the wrong answer to a question the machine CAN answer. What it says
 * instead is what is actually true: the component is missing, and here is what
 * would install it.
 */
const timelapse = useTimelapseStore()
const connection = useConnectionStore()

/**
 * Three-valued, the lesson from the heightmap page: `available` is false both
 * when Moonraker lacks the component and when `server.info` has not come back
 * yet, and stating the first while the second is true is a confident lie on
 * every single load.
 */
</script>

<template>
    <div v-if="!connection.moonrakerComponents.length" class="text-muted-foreground py-8 text-center text-sm">
        Asking Moonraker what it can do…
    </div>

    <div v-else-if="!timelapse.available" class="mx-auto max-w-prose py-8">
        <h2 class="text-lg font-semibold">No timelapse component</h2>
        <p class="text-muted-foreground pt-2 text-sm">
            This printer's Moonraker does not have the <code>timelapse</code> component loaded, so there is nothing to
            configure and nothing to list. It is a separate project
            (<code>mainsail-crew/moonraker-timelapse</code>), installed alongside Moonraker rather than shipped with it,
            and it needs both a <code>[timelapse]</code> section in <code>moonraker.conf</code> and its macros included
            in <code>printer.cfg</code>.
        </p>
        <p class="text-muted-foreground pt-2 text-sm">
            Everything on this page works as soon as the component answers — it is the printer that is missing the
            feature, not this interface.
        </p>
    </div>

    <div v-else class="gap-dgap grid grid-cols-12">
        <div class="gap-dgap order-1 col-span-12 flex flex-col md:order-2 md:col-span-4">
            <TimelapseStatusPanel />
        </div>
        <div class="gap-dgap order-2 col-span-12 flex flex-col md:order-1 md:col-span-8">
            <TimelapseFilesPanel />
        </div>
    </div>
</template>
