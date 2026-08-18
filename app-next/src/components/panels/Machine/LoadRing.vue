<script setup lang="ts">
import { computed } from 'vue'

/**
 * The circular load gauge -- Vuetify's `v-progress-circular` as an inline SVG.
 *
 * A hand-rolled SVG rather than a component from the kit because there is
 * nothing to it: one background ring, one dashed arc, one number. Pulling in a
 * progress-circle dependency for three elements would cost more than it saves.
 *
 * Colour thresholds are upstream's (`loadProgressColor`): amber over 80,
 * red over 95. They are semantic tokens here so both themes are covered.
 */
const props = withDefaults(defineProps<{ value: number; label: string; size?: number }>(), { size: 56 })

const RADIUS = 20
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

const clamped = computed(() => Math.max(0, Math.min(100, Math.round(props.value))))

const stroke = computed(() => {
    if (clamped.value > 95) return 'var(--destructive)'
    if (clamped.value > 80) return 'var(--warn)'
    return 'var(--primary)'
})
</script>

<template>
    <div class="flex flex-col items-center gap-1">
        <div class="relative" :style="{ width: `${size}px`, height: `${size}px` }">
            <svg :width="size" :height="size" viewBox="0 0 48 48" class="-rotate-90">
                <circle cx="24" cy="24" :r="RADIUS" fill="none" stroke="currentColor" stroke-width="4" opacity="0.15" />
                <circle
                    cx="24"
                    cy="24"
                    :r="RADIUS"
                    fill="none"
                    :stroke="stroke"
                    stroke-width="4"
                    stroke-linecap="round"
                    :stroke-dasharray="CIRCUMFERENCE"
                    :stroke-dashoffset="CIRCUMFERENCE * (1 - clamped / 100)" />
            </svg>
            <span class="tabular absolute inset-0 grid place-items-center text-xs font-medium">{{ clamped }}</span>
        </div>
        <span class="text-muted-foreground text-xs">{{ label }}</span>
    </div>
</template>
