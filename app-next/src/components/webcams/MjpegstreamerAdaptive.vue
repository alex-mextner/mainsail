<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useDocumentVisibility, useElementVisibility } from '@vueuse/core'
import { resolveWebcamUrl, webcamTransform, webcamWrapperStyle, type WebcamConfig } from '@/lib/webcam'
import WebcamNozzleCrosshair from './WebcamNozzleCrosshair.vue'

/**
 * `mjpegstreamer-adaptive` -- the service this printer's camera actually uses.
 *
 * It does NOT open the MJPEG stream. It requests a single JPEG
 * (`?action=snapshot`) over and over, measuring how long each one took and
 * spacing the next request so the arrival rate lands near `target_fps` instead
 * of overrunning the link. That is what "adaptive" means, and it is why this
 * component polls `snapshot_url` and never touches `stream_url`.
 *
 * Ported from the Vue 2 tree's `streamers/MjpegstreamerAdaptive.vue`, with the
 * `v-observe-visibility` directive replaced by @vueuse's observers. The
 * visibility gate is not cosmetic: without it a camera in a background tab keeps
 * pulling frames off an Orange Pi that has 512 MB and a print running.
 */
const props = withDefaults(
    defineProps<{
        webcam: WebcamConfig
        showFps?: boolean
    }>(),
    { showFps: true }
)

const root = ref<HTMLDivElement | null>(null)
const image = ref<HTMLImageElement | null>(null)

const status = ref<'connecting' | 'connected' | 'error'>('connecting')
const statusMessage = ref('')

/** Measured from the first decoded frame; the configured ratio is only a hint. */
const aspectRatio = ref<number | null>(null)

let timer: ReturnType<typeof setTimeout> | null = null
let fpsTimer: ReturnType<typeof setInterval> | null = null
let requestStartTime = 0
let requestTime = 0
const REQUEST_TIME_SMOOTHING = 0.2

const currentFps = ref<number | null>(null)
let frames = 0

const documentVisibility = useDocumentVisibility()
const elementVisible = useElementVisibility(root)
const isVisible = computed(() => documentVisibility.value === 'visible' && elementVisible.value)

const url = computed(() => resolveWebcamUrl(props.webcam.snapshot_url))

const wrapperStyle = computed(() => webcamWrapperStyle(aspectRatio.value, props.webcam.rotation ?? 0))

const imageStyle = computed(() => ({
    transform: webcamTransform(
        props.webcam.flip_horizontal ?? false,
        props.webcam.flip_vertical ?? false,
        props.webcam.rotation ?? 0,
        aspectRatio.value ?? 1
    ),
}))

const fpsOutput = computed(() => {
    if (currentFps.value === null) return '--'
    return currentFps.value < 10 ? `0${currentFps.value}` : String(currentFps.value)
})

const showFpsCounter = computed(() => props.showFps && !(props.webcam.extra_data?.hideFps ?? false))

/**
 * The nozzle crosshair is off unless the camera's `extra_data` turns it on --
 * upstream's flag, in upstream's place, so a camera configured in the other
 * interface carries its setting across.
 */
const showNozzleCrosshair = computed(() => (props.webcam.extra_data?.nozzleCrosshair as boolean | undefined) ?? false)

function clearTimers() {
    if (timer) {
        clearTimeout(timer)
        timer = null
    }
    if (fpsTimer) {
        clearInterval(fpsTimer)
        fpsTimer = null
        frames = 0
    }
}

function refreshFrame() {
    if (!isVisible.value || !image.value) return

    if (timer) {
        clearTimeout(timer)
        timer = null
    }

    const next = new URL(url.value)
    // mjpg-streamer answers snapshots with a cacheable response; without a
    // unique parameter the browser serves the same frame forever.
    next.searchParams.append('bypassCache', String(Date.now()))
    image.value.src = next.toString()
    requestStartTime = performance.now()
}

function onLoad() {
    if (status.value !== 'connected') {
        status.value = 'connected'
        statusMessage.value = ''
    }
    frames++

    if (aspectRatio.value === null && image.value?.naturalWidth && image.value?.naturalHeight) {
        aspectRatio.value = image.value.naturalWidth / image.value.naturalHeight
    }

    const targetFps = props.webcam.target_fps || 10
    const targetTime = 1000 / targetFps

    const thisRequest = performance.now() - requestStartTime
    requestTime = requestTime * REQUEST_TIME_SMOOTHING + thisRequest * (1 - REQUEST_TIME_SMOOTHING)

    timer = setTimeout(refreshFrame, Math.max(0, targetTime - requestTime))
}

function onError() {
    status.value = 'error'
    statusMessage.value = `Could not connect to ${url.value}`

    // One retry per second, and only if nothing is already scheduled -- a
    // camera that is unplugged must not turn into a request storm.
    if (timer) return
    timer = setTimeout(refreshFrame, 1000)
}

function startStream() {
    if (!isVisible.value) return

    if (status.value !== 'connected') {
        status.value = 'connecting'
        statusMessage.value = `Connecting to ${url.value}`
    }

    clearTimers()

    fpsTimer = setInterval(() => {
        currentFps.value = frames
        frames = 0
    }, 1000)

    refreshFrame()
}

watch(isVisible, (visible) => (visible ? startStream() : clearTimers()), { immediate: true })

watch(
    () => props.webcam,
    () => {
        aspectRatio.value = null
        clearTimers()
        status.value = 'connecting'
        startStream()
    },
    { deep: true }
)

onMounted(() => {
    if (isVisible.value) startStream()
})

onBeforeUnmount(clearTimers)

/** The overlay measures this element to find the letterbox bars. */
defineExpose({ image })
</script>

<template>
    <div ref="root" class="webcam-frame relative flex h-full w-full items-center justify-center" :style="wrapperStyle">
        <!--
            `object-contain` is the whole point: the camera image is shown WHOLE
            and letterboxed, never cropped to fill. The black bars that leaves
            are what the hud docks into.
        -->
        <img
            v-show="status === 'connected'"
            ref="image"
            class="webcam-image h-full w-full object-contain"
            draggable="false"
            :style="imageStyle"
            :alt="webcam.name"
            @load="onLoad"
            @error="onError" />

        <!--
            The nozzle crosshair. Only while CONNECTED: upstream's rule, and the
            right one -- hairlines over a "connecting" spinner look like the
            camera is showing something it is not.
        -->
        <WebcamNozzleCrosshair
            v-if="status === 'connected' && showNozzleCrosshair"
            :webcam="webcam"
            :aspect-ratio="aspectRatio" />

        <span
            v-if="status === 'connected' && showFpsCounter"
            class="tabular absolute right-0 bottom-0 rounded-tl bg-black/70 px-2.5 py-0.5 text-xs text-white">
            FPS: {{ fpsOutput }}
        </span>

        <div v-if="status !== 'connected'" class="absolute inset-0 grid place-items-center px-6 text-center">
            <div class="flex flex-col items-center gap-3">
                <div
                    v-if="status === 'connecting'"
                    class="size-8 animate-spin rounded-full border-2 border-white/25 border-t-white/80" />
                <span class="text-sm text-white/70">{{ statusMessage }}</span>
            </div>
        </div>
    </div>
</template>
