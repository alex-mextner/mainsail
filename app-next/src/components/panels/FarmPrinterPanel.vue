<script setup lang="ts">
import { computed } from 'vue'
import { mdiPrinter3d, mdiCloseCircleOutline } from '@mdi/js'
import Panel from '@/components/ui/Panel.vue'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import { formatPrintTime } from '@/lib/format'
import type { FarmPrinterState } from '@/stores/farm'

/**
 * One printer in the farm grid -- Mainsail's `FarmPrinterPanel.vue`.
 *
 * NOT ported: the per-card webcam and its switcher. Upstream embeds a live
 * MJPEG stream per card, which on a grid of N printers is N simultaneous
 * streams. That is a deliberate omission rather than an oversight -- see the
 * store header for why anything holding an open connection per card is
 * treated carefully here. The card shows state, progress and temperatures,
 * which is what the grid is read for.
 */
const props = defineProps<{ printer: FarmPrinterState }>()

const objects = computed(() => props.printer.objects as Record<string, Record<string, unknown> | undefined>)

const printState = computed(() => (objects.value.print_stats?.state as string | undefined) ?? 'unknown')
const filename = computed(() => (objects.value.print_stats?.filename as string | undefined) || null)

const progress = computed(() => {
    const value = objects.value.virtual_sdcard?.progress as number | undefined
    return value === undefined ? 0 : Math.round(value * 100)
})

const printDuration = computed(() => (objects.value.print_stats?.print_duration as number | undefined) ?? 0)

const temperature = (name: string) => {
    const object = objects.value[name]
    if (!object) return null

    const actual = object.temperature as number | undefined
    const target = object.target as number | undefined
    if (actual === undefined) return null

    return `${Math.round(actual)}°C${target ? ` / ${Math.round(target)}°C` : ''}`
}

/** Upstream colours the card by state; these are the same five states. */
const stateClass = computed(
    () =>
        ({
            printing: 'text-primary',
            paused: 'text-amber-500',
            complete: 'text-primary',
            cancelled: 'text-muted-foreground',
            error: 'text-destructive',
        })[printState.value] ?? 'text-muted-foreground'
)

const status = computed(() => {
    if (props.printer.isConnecting) return 'Connecting...'
    if (!props.printer.isConnected) return props.printer.error ?? 'Offline'
    if (!props.printer.klippyConnected) return 'Klipper disconnected'

    return printState.value
})
</script>

<template>
    <Panel
        :panel-name="`farm-${printer.config.id}`"
        :title="printer.config.name"
        :icon="mdiPrinter3d"
        :loading="printer.isConnecting">
        <div class="flex flex-col gap-2 px-4 pb-4" :data-farm-printer="printer.config.id">
            <div class="flex items-center justify-between gap-2 text-sm">
                <span class="capitalize" :class="stateClass">{{ status }}</span>
                <span class="text-muted-foreground text-xs">
                    {{ printer.config.hostname }}:{{ printer.config.port }}
                </span>
            </div>

            <div v-if="!printer.isConnected" class="text-muted-foreground flex items-center gap-2 py-2 text-sm">
                <MdiIcon :path="mdiCloseCircleOutline" class="size-4" />
                <span>No connection to this printer.</span>
            </div>

            <template v-else>
                <div v-if="filename" class="truncate text-sm" :title="filename">{{ filename }}</div>

                <div v-if="printState === 'printing' || printState === 'paused'" class="flex flex-col gap-1">
                    <div class="bg-muted h-2 w-full overflow-hidden rounded-full">
                        <div class="bg-primary h-full rounded-full transition-all" :style="{ width: `${progress}%` }" />
                    </div>
                    <div class="text-muted-foreground flex justify-between text-xs">
                        <span>{{ progress }}%</span>
                        <span>{{ formatPrintTime(printDuration) }}</span>
                    </div>
                </div>

                <div class="text-muted-foreground flex gap-4 text-xs">
                    <span v-if="temperature('extruder')">Hotend {{ temperature('extruder') }}</span>
                    <span v-if="temperature('heater_bed')">Bed {{ temperature('heater_bed') }}</span>
                </div>
            </template>
        </div>
    </Panel>
</template>
