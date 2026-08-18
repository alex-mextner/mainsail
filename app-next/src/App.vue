<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AppShell from '@/components/layout/AppShell.vue'
import type { AppRouteMeta } from '@/router'

/**
 * Two layouts, chosen by route meta.
 *
 * Most routes render inside the shell (top bar, drawer, padded content area).
 * A `fullscreen` route -- currently only `/overcam` -- renders bare, because it
 * covers the whole viewport with a camera image and every pixel of chrome is a
 * pixel of print you cannot see. Both branches contain a RouterView; only one
 * of them is mounted at a time.
 */
const route = useRoute()

const fullscreen = computed(() => (route.meta as AppRouteMeta | undefined)?.fullscreen === true)
</script>

<template>
    <RouterView v-if="fullscreen" />
    <AppShell v-else />
</template>
