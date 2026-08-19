<script setup lang="ts">
import { onMounted } from 'vue'
import HistoryListPanel from '@/components/panels/HistoryListPanel.vue'
import HistoryStatisticsPanel from '@/components/panels/HistoryStatisticsPanel.vue'
import MaintenancePanel from '@/components/panels/MaintenancePanel.vue'
import { useHistoryStore } from '@/stores/history'

/**
 * `/history` -- upstream's `pages/History.vue`: the statistics panel above the
 * job list, in that order.
 *
 * The PAGE asks for the data, not the panels. Both of them read the same
 * `pageJobs`, and two panels each kicking off their own paging would double
 * every request on a machine with a long history.
 *
 * `ensurePage()` rather than `loadMore()` + `loadTotals()`: the store then owns
 * the retry, and a page opened before the socket is up still fills in when it
 * connects. Calling the loaders straight from `onMounted` did not -- the calls
 * rejected with "not connected", `onMounted` never runs again, and the page sat
 * empty for the rest of the session. Measured, not assumed.
 */
const history = useHistoryStore()

onMounted(() => history.ensurePage())
</script>

<template>
    <div class="gap-dgap flex w-full flex-col">
        <HistoryStatisticsPanel />
        <MaintenancePanel />
        <HistoryListPanel />
    </div>
</template>
