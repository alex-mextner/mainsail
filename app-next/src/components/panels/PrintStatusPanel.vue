<script setup lang="ts">
import { computed } from 'vue'
import { mdiLayers, mdiClockOutline, mdiTimerSandComplete, mdiFileAlert } from '@mdi/js'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { useCurrentFile, formatDuration } from '@/composables/useCurrentFile'

const { meta, printStats, filename, thumbnail, thumbnailUrl, progress } = useCurrentFile()

const shortName = computed(() => filename.value.split('/').pop() ?? '')

const state = computed(() => printStats.value?.state ?? 'standby')

const stateBadge = computed(() => {
    switch (state.value) {
        case 'printing':
            return { label: 'printing', variant: 'heating' as const }
        case 'paused':
            return { label: 'paused', variant: 'muted' as const }
        case 'complete':
            return { label: 'complete', variant: 'ok' as const }
        case 'error':
            return { label: 'error', variant: 'destructive' as const }
        case 'cancelled':
            return { label: 'cancelled', variant: 'muted' as const }
        default:
            return { label: 'standby', variant: 'muted' as const }
    }
})

const layer = computed(() => {
    const info = printStats.value?.info
    if (info?.current_layer && info?.total_layer) return `${info.current_layer} / ${info.total_layer}`
    if (meta.value?.layer_count) return `— / ${meta.value.layer_count}`
    return '—'
})

/** Only these two states have a job still in flight. */
const isLive = computed(() => state.value === 'printing' || state.value === 'paused')

const elapsed = computed(() => formatDuration(printStats.value?.print_duration ?? 0))

/**
 * "Remaining" is meaningless once the job has stopped -- a cancelled print was
 * showing "13m 17s remaining" purely because print_stats keeps the last
 * duration around after the job ends. Only quote it while something is running.
 */
const remaining = computed(() => {
    if (!isLive.value) return '—'

    const estimated = meta.value?.estimated_time ?? 0
    const done = printStats.value?.print_duration ?? 0
    if (!estimated || done <= 0) return '—'
    return formatDuration(Math.max(0, estimated - done))
})

/**
 * The slicer embeds at most a 300x300 thumbnail, so anything wider is an
 * upscale and will look soft. Surfaced rather than hidden: the user's
 * complaint about a blurry preview cannot be fixed in CSS, it needs either a
 * larger thumbnail from the slicer or a real gcode renderer.
 */
const isUpscaled = computed(() => (thumbnail.value?.width ?? 0) < 420)
</script>

<template>
    <Card class="overflow-hidden">
        <!-- Model preview.
             The frame is filled by a blurred, scaled copy of the same image, and
             the model itself sits on top with object-contain. So the card has no
             empty letterbox bars, and the model is still shown WHOLE -- it is
             never cropped to fill the frame. That was an explicit instruction
             and it applies to every preview in this UI. -->
        <div class="bg-muted relative aspect-[4/3] w-full overflow-hidden">
            <template v-if="thumbnailUrl">
                <img
                    :src="thumbnailUrl"
                    alt=""
                    aria-hidden="true"
                    class="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-xl" />
                <img :src="thumbnailUrl" :alt="shortName" class="relative h-full w-full object-contain p-3" />
            </template>

            <!-- pb-24 keeps the placeholder clear of the overlay below. Without
                 it the two collide at S density, where the box is short enough
                 that a vertically centred placeholder lands under the scrim. -->
            <div class="text-muted-foreground grid h-full place-items-center gap-2 pb-24 text-sm" v-else>
                <MdiIcon :path="mdiFileAlert" class="size-6" />
                <span>no preview in this file</span>
            </div>

            <!-- Readings overlaid on the image, bottom-anchored over a scrim so
                 they stay legible on both light and dark thumbnails. -->
            <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent p-3">
                <div class="mb-1.5 flex items-center justify-between gap-2">
                    <span class="truncate text-sm font-medium text-white">{{ shortName || 'no file loaded' }}</span>
                    <Badge :variant="stateBadge.variant">{{ stateBadge.label }}</Badge>
                </div>

                <Progress :model-value="progress" class="h-1.5 bg-white/25" indicator-class="bg-white" />

                <div class="mt-1.5 flex items-center justify-between text-[11px] text-white/80">
                    <span class="tabular">{{ progress }}%</span>
                    <span v-if="isUpscaled && thumbnail" class="text-white/50">
                        preview {{ thumbnail.width }}×{{ thumbnail.height }}
                    </span>
                </div>
            </div>
        </div>

        <CardContent class="pt-4">
            <dl class="grid grid-cols-3 gap-3 text-center">
                <div>
                    <dt class="text-muted-foreground flex items-center justify-center gap-1 text-[11px]">
                        <MdiIcon :path="mdiLayers" class="size-3" />
                        Layer
                    </dt>
                    <dd class="tabular mt-1 text-sm font-medium">{{ layer }}</dd>
                </div>
                <div>
                    <dt class="text-muted-foreground flex items-center justify-center gap-1 text-[11px]">
                        <MdiIcon :path="mdiClockOutline" class="size-3" />
                        Elapsed
                    </dt>
                    <dd class="tabular mt-1 text-sm font-medium">{{ elapsed }}</dd>
                </div>
                <div>
                    <dt class="text-muted-foreground flex items-center justify-center gap-1 text-[11px]">
                        <MdiIcon :path="mdiTimerSandComplete" class="size-3" />
                        Remaining
                    </dt>
                    <dd class="tabular mt-1 text-sm font-medium">{{ remaining }}</dd>
                </div>
            </dl>
        </CardContent>
    </Card>
</template>
