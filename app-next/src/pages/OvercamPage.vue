<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import WebcamOverlay from '@/components/webcams/WebcamOverlay.vue'
import { attachOvercamLight } from '@/components/webcams/overcam-light-browser'
import { useWebcamsStore } from '@/stores/webcams'
import { useConnectionStore } from '@/stores/connection'

/**
 * `/overcam/:name?` -- the fullscreen camera, as a route rather than a dialog.
 *
 * The user asked for the URL to change ("и пусть урл меняется на какой-то
 * специальный типа /overcam"), and making it a real route buys three things a
 * dialog cannot: the link can be bookmarked and opened directly, F5 does not
 * throw you out, and the browser's back button closes it.
 *
 * It is deliberately absent from the navigation -- the sidebar already has
 * "Webcam" for the same camera. A side effect worth keeping: leaving the
 * dashboard unmounts any inline player, so two streams are never pulling frames
 * off the same camera at once.
 */
const route = useRoute()
const router = useRouter()
const webcams = useWebcamsStore()
const connection = useConnectionStore()

const routeName = computed(() => {
    const name = route.params.name
    return typeof name === 'string' && name.length ? name : null
})

const currentCam = computed(() => {
    if (!webcams.webcams.length) return null

    // /overcam/<name> always wins, so a bookmarked link keeps pointing at the
    // camera it was made for.
    if (routeName.value) {
        const named = webcams.byName(routeName.value)
        if (named) return named
    }

    // Upstream shows a grid of all cameras when none is named. The grid is not
    // ported (this machine has one camera), so the first one is shown instead --
    // stated here rather than pretending the grid exists.
    return webcams.webcams[0]
})

/**
 * `history.state.back` is null only when this entry is the first of the
 * session -- i.e. the URL was opened directly or reloaded. In that case there
 * is no history entry of ours to go back to, so closing goes to the dashboard.
 */
const cameFromApp = router.options.history.state.back != null

function close() {
    if (cameFromApp) router.back()
    else void router.push('/')
}

/**
 * The work light: white while someone is watching, dark after five minutes
 * unfocused, back on activity (docs/tasks.md M2b). All of the interesting part
 * -- never darkening a light that is on for a reason -- lives in
 * components/webcams/overcam-light.ts, which is byte-identical to the Vue 2
 * build's copy so the two interfaces cannot disagree about who owns the strip.
 *
 * Mounted here rather than in WebcamOverlay.vue, which WebcamPage also uses:
 * the request was about opening /overcam, not about any fullscreen camera.
 */
let detachLight: (() => void) | null = null

onMounted(() => {
    detachLight = attachOvercamLight({
        transport: {
            queryObjects: (objects) => connection.call('printer.objects.query', { objects }),
            printerInfo: () => connection.call('printer.info'),
            sendGcode: async (script) => {
                await connection.call('printer.gcode.script', { script })
            },
        },
    })
})

onBeforeUnmount(() => {
    detachLight?.()
    detachLight = null
})
</script>

<template>
    <WebcamOverlay v-if="currentCam" :webcam="currentCam" @close="close" />

    <div v-else class="fixed inset-0 grid place-items-center bg-black px-6 text-center">
        <div class="text-sm text-white/70">
            <p v-if="!connection.isConnected">Not connected to Moonraker.</p>
            <p v-else-if="!webcams.loaded">Loading cameras…</p>
            <p v-else>No webcam is configured.</p>
            <button type="button" class="mt-4 rounded-md bg-white/15 px-3 py-1.5 text-white" @click="close">
                Back
            </button>
        </div>
    </div>
</template>
