<script setup lang="ts">
import { onMounted } from 'vue'
import HistoryListPanel from '@/components/panels/HistoryListPanel.vue'
import HistoryStatisticsPanel from '@/components/panels/HistoryStatisticsPanel.vue'
import { useHistoryStore } from '@/stores/history'

/**
 * `/history` -- upstream's `pages/History.vue`: the statistics panel above the
 * job list, in that order.
 *
 * The PAGE loads the data, not the panels. Both of them read the same
 * `pageJobs`, and two panels each kicking off their own paging would double
 * every request on a machine with a long history. `loadMore` is idempotent
 * while a request is in flight, but relying on that would be relying on a
 * guard instead of on a structure.
 */
const history = useHistoryStore()

onMounted(() => {
    void history.loadMore()
    void history.loadTotals()
})
</script>

<template>
    <div class="gap-dgap flex w-full flex-col">
        <HistoryStatisticsPanel />
        <HistoryListPanel />
    </div>
</template>
