<script setup lang="ts">
import { computed } from 'vue'
import WebcamStream from '@/components/webcams/WebcamStream.vue'
import { useWebcamsStore } from '@/stores/webcams'
import type { WebcamConfig } from '@/lib/webcam'

/**
 * One camera, or all of them in a grid -- upstream's `WebcamWrapper.vue`.
 *
 * The grid is selected the way upstream selects it: by a pseudo-camera whose
 * `service` is the literal string `grid`. That is not a Moonraker service, it
 * is a sentinel the panel constructs when the user picks "All" from the camera
 * menu, and keeping the same sentinel means the panel's stored state ('all' vs
 * a camera name) round-trips exactly as it does in the interface the user
 * prints with.
 *
 * 🔴 THE GRID BREAKS AT THE PANEL'S WIDTH, NOT THE WINDOW'S
 * --------------------------------------------------------
 * Upstream uses `col-12 col-md-6` -- Vuetify's WINDOW breakpoints. On the
 * dashboard this panel lives inside a 3/12..7/12 column, so at 1400px of window
 * upstream drops two cameras side by side into a ~340px column and each ends up
 * ~165px wide. Here the break is a container query on this element, per the
 * layout decision for this rewrite: two-up only once the panel itself is
 * genuinely wide enough for two.
 *
 * 512px is the threshold because a 4:3 camera at two columns with the 12px gap
 * gets (512 - 12) / 2 = 250px of width -> ~188px of height, below which the fps
 * badge starts eating a visible share of the picture.
 *
 * `bg-black/80` with a light-theme counterpart is upstream's `.webcamBackground`
 * (which flips to `rgba(255,255,255,.7)` under `theme--light`). It matters
 * because `object-contain` letterboxes the image, and without it those bars are
 * a hole in the card rather than part of it. A black slab inside a white card is
 * exactly the contrast problem the light theme exists to avoid, so the light
 * value is a light grey rather than upstream's near-white -- on this card colour
 * near-white would make the bars invisible and the image look unaligned.
 */
const props = withDefaults(
    defineProps<{
        webcam: WebcamConfig
        showFps?: boolean
    }>(),
    { showFps: true }
)

const webcams = useWebcamsStore()

const isGrid = computed(() => props.webcam.service === 'grid')

const surface = 'flex items-center justify-center overflow-hidden rounded-md bg-black/10 dark:bg-black/80'
</script>

<template>
    <div v-if="isGrid" class="@container w-full">
        <div class="grid grid-cols-1 gap-3 @[512px]:grid-cols-2">
            <div v-for="cam in webcams.webcams" :key="cam.name" class="relative">
                <div :class="surface">
                    <WebcamStream :webcam="cam" :show-fps="showFps" />
                </div>
                <!--
                    A grid tile has to say which camera it is; a single camera
                    does not, because the panel header already names it.
                -->
                <span
                    class="pointer-events-none absolute top-0 left-0 rounded-tl-md rounded-br bg-black/70 px-2 py-0.5 text-xs text-white">
                    {{ cam.name }}
                </span>
            </div>
        </div>
    </div>

    <div v-else :class="[surface, 'w-full']">
        <WebcamStream :webcam="webcam" :show-fps="showFps" />
    </div>
</template>
