<script setup lang="ts">
import HistoryListPanel from '@/components/panels/HistoryListPanel.vue'

/**
 * `/history` -- upstream's `pages/History.vue`: the statistics panel above the
 * job list.
 *
 * Only the list is here so far. The statistics panel is the next unit of work
 * and is listed in the docs rather than stubbed on screen, because a panel that
 * renders an empty box is a worse answer than a page that shows what it has.
 */
</script>

<template>
    <div class="gap-dgap flex w-full flex-col">
        <HistoryListPanel />
    </div>
</template>
