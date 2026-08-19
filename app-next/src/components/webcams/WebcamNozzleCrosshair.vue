<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, useTemplateRef } from 'vue'
import type { WebcamConfig } from '@/lib/webcam'

/**
 * Crosshair over the camera image, marking where the nozzle sits --
 * Mainsail's `webcams/WebcamNozzleCrosshair.vue`.
 *
 * Two hairlines through the centre plus a circle whose diameter is a fraction
 * of the picture height. Used to park the nozzle and check it against a fixed
 * reference between prints. Settings come from the webcam's `extra_data`,
 * where upstream keeps them, so a camera configured in the other interface
 * brings its crosshair across unchanged.
 *
 * ONE DEPARTURE FROM UPSTREAM, and an honest note about its current value.
 * Upstream sizes the circle from the CONTAINER height. In this tree the image
 * is `object-contain`, so on a letterboxed frame the container would be taller
 * than the picture and the circle would grow with the black bars -- the same
 * camera showing a different-sized reference depending on the window. Here the
 * circle is sized from the RENDERED PICTURE instead (`width / aspect`, clamped
 * by the container), the same arithmetic the hud uses for its letterbox bars.
 *
 * 🔴 BUT ON TODAY'S LAYOUT THE TWO AGREE, and `check-crosshair.mjs` says so
 * out loud rather than claiming a fix. `webcamWrapperStyle` already puts the
 * camera's aspect ratio on the wrapper, so the container IS the picture and
 * there are no bars to be wrong about. Measured at 1600x700 and 700x1200: the
 * frame came out 4:3 both times and both formulas give the same number. This
 * is therefore a guard against a future surface that letterboxes, not a bug
 * anyone can currently see.
 *
 * The lines are unaffected either way: `object-contain` centres the picture,
 * so the picture's centre and the container's centre are the same point.
 */
const props = defineProps<{ webcam: WebcamConfig; aspectRatio?: number | null }>()

const container = useTemplateRef<HTMLDivElement>('container')

const width = ref(0)
const height = ref(0)

let observer: ResizeObserver | null = null

const measure = () => {
    if (!container.value) return
    width.value = container.value.clientWidth
    height.value = container.value.clientHeight
}

onMounted(() => {
    measure()
    observer = new ResizeObserver(measure)
    observer.observe(container.value!)
})

onBeforeUnmount(() => observer?.disconnect())

const color = computed(() => (props.webcam.extra_data?.nozzleCrosshairColor as string | undefined) ?? '#ff0000')

/** Height of the picture itself, once `object-contain` has letterboxed it. */
const pictureHeight = computed(() => {
    const aspect = props.aspectRatio
    if (!aspect || !width.value || !height.value) return height.value

    return Math.min(height.value, width.value / aspect)
})

const circleStyle = computed(() => {
    const fraction = (props.webcam.extra_data?.nozzleCrosshairSize as number | undefined) ?? 0.1
    const size = pictureHeight.value * fraction

    return {
        borderColor: color.value,
        width: `${size}px`,
        height: `${size}px`,
        marginLeft: `-${size / 2}px`,
        marginTop: `-${size / 2}px`,
    }
})
</script>

<template>
    <div ref="container" class="pointer-events-none absolute inset-0" data-testid="nozzle-crosshair">
        <div class="absolute right-0 left-0 top-1/2 h-px" :style="{ backgroundColor: color }" />
        <div class="absolute top-0 bottom-0 left-1/2 w-px" :style="{ backgroundColor: color }" />
        <div class="absolute top-1/2 left-1/2 box-border rounded-full border" :style="circleStyle" />
    </div>
</template>
