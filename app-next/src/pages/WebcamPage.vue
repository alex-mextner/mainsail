<script setup lang="ts">
import WebcamPanel from '@/components/panels/WebcamPanel.vue'

/**
 * `/cam` -- upstream's `pages/Webcam.vue`, which is the same panel with
 * `current-page="page"`.
 *
 * It keeps its own camera selection, separate from the dashboard's: the
 * dashboard is a glance at the one camera that matters while something else is
 * on screen, this page is where you look at all of them.
 *
 * Distinct from `/overcam`, which is the same camera with no chrome at all and
 * the hud on top. This one is the ordinary page inside the app shell.
 */
</script>

<template>
    <WebcamPanel surface="page" />
</template>
