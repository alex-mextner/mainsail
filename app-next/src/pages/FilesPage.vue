<script setup lang="ts">
import GcodefilesPanel from '@/components/panels/GcodefilesPanel.vue'

/**
 * G-code files -- Mainsail's `pages/Files.vue`.
 *
 * One panel across the full width. Upstream is the same: the table has up to
 * twenty columns, so there is nothing to put beside it.
 */
</script>

<template>
    <div class="gap-dgap @container flex w-full flex-col">
        <GcodefilesPanel />
    </div>
</template>
