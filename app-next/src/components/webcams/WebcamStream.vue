<script setup lang="ts">
import MjpegstreamerAdaptive from '@/components/webcams/MjpegstreamerAdaptive.vue'
import type { WebcamConfig } from '@/lib/webcam'

/**
 * Picks the player for a camera's `service`.
 *
 * Only `mjpegstreamer-adaptive` is ported so far -- it is what this machine's
 * camera is configured as, and it is the only path that has been exercised
 * against real hardware. Every other service gets a message that names itself
 * rather than a black rectangle: the Vue 2 tree has eight more streamers
 * (janus, webrtc x3, hls, jmuxer, iframe, uv4l), and pretending they work here
 * would be a worse lie than saying they do not.
 *
 * 🔴 WHY THE OTHER EIGHT ARE STILL NOT HERE, decided 2026-08-19 rather than
 * drifted into. Four of them (hls, jmuxer, janus, and the webrtc trio) need
 * external libraries added as dependencies for backends that do not exist on
 * this machine, so nothing about them could be exercised beyond "the component
 * mounted and failed". The plain `mjpegstreamer` is the tempting one, since
 * this printer's mjpg-streamer does serve `?action=stream` -- but it is a
 * Web Worker plus OffscreenCanvas plus a 10-second stall-restart timer, and an
 * unattended retry loop against a 512 MB host is the same hazard the farm
 * store is written to avoid. Left for a session that can watch it.
 */
defineProps<{
    webcam: WebcamConfig
    showFps?: boolean
}>()

const ported = ['mjpegstreamer-adaptive']
</script>

<template>
    <MjpegstreamerAdaptive v-if="ported.includes(webcam.service)" :webcam="webcam" :show-fps="showFps" />

    <div v-else class="grid h-full w-full place-items-center px-6 text-center">
        <div class="text-sm text-white/70">
            <p class="mb-1 font-medium text-white/85">This camera uses “{{ webcam.service }}”.</p>
            <p>Only mjpegstreamer-adaptive is ported so far. Use the old Mainsail on port 8090 for this one.</p>
        </div>
    </div>
</template>
