<script setup lang="ts">
import { computed } from 'vue'
import { mdiFire, mdiCheckboxBlankOutline, mdiThermometer } from '@mdi/js'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import type { Heater } from '@/types/printer'
import { useSensorColors } from '@/composables/useSensorColors'

const props = defineProps<{ heater: Heater }>()

const icon = computed(() => {
    if (props.heater.kind === 'bed') return mdiCheckboxBlankOutline
    if (props.heater.kind === 'hotend') return mdiFire
    return mdiThermometer
})

/**
 * The same colour this sensor has on the chart -- Mainsail's, per series rather
 * than per role, so the row icon and the chart legend identify the same line.
 */
const { colorOf } = useSensorColors()
const accent = computed(() => colorOf(props.heater.name))

const isActive = computed(() => props.heater.target > 0)

/** Within 1 K of target counts as arrived -- Klipper's own settling band. */
const atTarget = computed(() => isActive.value && Math.abs(props.heater.temperature - props.heater.target) <= 1)

/**
 * Sensors are read-only, so "off" would be meaningless noise on every row --
 * they have no target to be off from. Only controllable heaters get a badge.
 */
const state = computed(() => {
    if (props.heater.kind === 'sensor') return null
    if (!isActive.value) return { label: 'off', variant: 'muted' as const }
    if (atTarget.value) return { label: 'at target', variant: 'ok' as const }
    return {
        label: props.heater.temperature < props.heater.target ? 'heating' : 'cooling',
        variant: 'heating' as const,
    }
})
</script>

<template>
    <div class="grid grid-cols-[1fr_auto] items-center gap-x-dgap gap-y-2 py-drow">
        <div class="flex min-w-0 items-center gap-2">
            <MdiIcon :path="icon" class="size-4 shrink-0" :style="{ color: accent }" />
            <span class="truncate text-sm font-medium">{{ heater.label }}</span>
            <Badge v-if="state" :variant="state.variant">{{ state.label }}</Badge>
        </div>

        <div class="flex items-baseline justify-end gap-1">
            <span class="tabular text-reading leading-none font-semibold">{{ heater.temperature.toFixed(1) }}</span>
            <span class="text-muted-foreground text-sm">°C</span>
            <span v-if="isActive" class="text-muted-foreground tabular ml-1 text-sm">
                / {{ heater.target.toFixed(0) }}°C
            </span>
        </div>

        <div v-if="heater.kind !== 'sensor'" class="col-span-2 flex items-center gap-2">
            <Progress
                :model-value="Math.round(heater.power * 100)"
                class="h-1"
                :indicator-style="{ backgroundColor: accent }" />
            <span class="text-muted-foreground tabular w-10 shrink-0 text-right text-[11px]">
                {{ Math.round(heater.power * 100) }}%
            </span>
        </div>
    </div>
</template>
