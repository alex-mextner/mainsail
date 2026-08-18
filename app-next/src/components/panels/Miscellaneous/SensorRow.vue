<script setup lang="ts">
import { mdiGaugeLow } from '@mdi/js'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import { convertName } from '@/lib/format'

/**
 * A read-only reading -- Mainsail's `Miscellaneous/MiscellaneousSensor.vue` and
 * `MoonrakerSensor.vue` merged, because they render the same row and differ
 * only in where the number came from.
 *
 * `values` carries one line per reading: a Klipper `[load_cell]` publishes a
 * single force, while a Moonraker `[sensor]` can publish voltage, current and
 * power at once.
 */
defineProps<{ title: string; values: { label: string; value: number; unit: string | null }[] }>()

const format = (value: number) => (Number.isNaN(value) ? '--' : Math.round(value * 1000) / 1000)
</script>

<template>
    <div class="py-drow flex flex-col gap-1">
        <div class="flex items-center gap-2">
            <MdiIcon :path="mdiGaugeLow" class="text-muted-foreground size-4 shrink-0" />
            <span class="truncate text-sm">{{ convertName(title) }}</span>

            <span class="grow" />

            <span v-if="values.length === 1" class="tabular text-sm font-semibold">
                {{ format(values[0].value) }} {{ values[0].unit ?? '' }}
            </span>
        </div>

        <div v-if="values.length > 1" class="flex flex-col gap-0.5 pl-6">
            <div v-for="entry in values" :key="entry.label" class="flex items-baseline gap-2 text-xs">
                <span class="text-muted-foreground">{{ convertName(entry.label) }}</span>
                <span class="grow" />
                <span class="tabular">{{ format(entry.value) }} {{ entry.unit ?? '' }}</span>
            </div>
        </div>
    </div>
</template>
