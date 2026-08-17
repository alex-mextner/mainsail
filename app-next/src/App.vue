<script setup lang="ts">
import { computed } from 'vue'
import { useStore } from 'vuex'
import TemperaturePanel from '@/components/panels/TemperaturePanel.vue'
import type { RootState } from '@/store/types'

const store = useStore<RootState>()
const hostname = computed(() => store.state.hostname)
</script>

<template>
    <div class="min-h-screen p-4 sm:p-6">
        <header class="mx-auto mb-5 flex max-w-md items-baseline justify-between">
            <h1 class="text-lg font-semibold tracking-tight">Mainsail Next</h1>
            <span class="text-muted-foreground text-xs">{{ hostname ?? '—' }}</span>
        </header>

        <div class="mx-auto max-w-md">
            <TemperaturePanel />
        </div>
    </div>
</template>
