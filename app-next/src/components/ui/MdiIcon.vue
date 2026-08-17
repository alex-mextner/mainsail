<script setup lang="ts">
/** Renders an @mdi/js path string. Same icon set Mainsail uses. */
defineProps<{ path: string }>()
</script>

<template>
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path :d="path" />
    </svg>
</template>
