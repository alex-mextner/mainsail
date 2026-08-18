<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import {
    mdiClose,
    mdiEyeOffOutline,
    mdiEyeOutline,
    mdiFullscreen,
    mdiFullscreenExit,
    mdiPinOffOutline,
} from '@mdi/js'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import WebcamStream from '@/components/webcams/WebcamStream.vue'
import WebcamHud from '@/components/webcams/WebcamHud.vue'
import {
    parseAspectRatio,
    WEBCAM_HUD_MARGIN,
    WEBCAM_HUD_MIN_DOCK_HEIGHT,
    WEBCAM_HUD_MIN_DOCK_WIDTH,
    WEBCAM_HUD_MIN_ROW_CHART_WIDTH,
    type WebcamConfig,
} from '@/lib/webcam'

/**
 * Fullscreen camera with the hud on top -- the whole of M2.
 *
 * Two things it does that a plain overlay does not:
 *
 * 1. IT MEASURES THE LETTERBOX. `object-fit: contain` paints the image whole,
 *    which leaves black bars wherever the window and the camera disagree about
 *    aspect ratio. When a bar is wide/tall enough to stay readable the hud is
 *    docked INTO it and stretched along it, so the readings cost nothing of the
 *    picture. Otherwise it falls back to a floating card over the image.
 *
 * 2. IT CAN BE DRAGGED, and snaps to one of eight anchors -- four corners and
 *    four edge centres. The placement is remembered as an ANCHOR NAME rather
 *    than as pixels, so resizing the window can never leave it off-screen or in
 *    a position that no longer means what it meant.
 *
 * Ported from the Vue 2 tree's `webcams/WebcamFullscreen.vue` (commits
 * 5844d3d4 / fd9c8023 / ec9c89bd). The one deliberate deviation is the
 * measurement: the original walked `offsetParent` up from the image because Vue
 * 2's wrapper components inserted auto-height divs it could not control. This
 * tree owns the markup, so the image sits one hop inside `.webcam-frame` and
 * the geometry comes from that single hop.
 */
const props = defineProps<{ webcam: WebcamConfig }>()
const emit = defineEmits<{ close: [] }>()

type HudAnchor =
    | 'top-left'
    | 'top-center'
    | 'top-right'
    | 'right-center'
    | 'bottom-right'
    | 'bottom-center'
    | 'bottom-left'
    | 'left-center'

const anchors: HudAnchor[] = [
    'top-left',
    'top-center',
    'top-right',
    'right-center',
    'bottom-right',
    'bottom-center',
    'bottom-left',
    'left-center',
]

/** Per-browser, not per-printer: which corner is free depends on the screen in
 *  front of you (phone, the tablet at the machine, desktop). Same prefix the
 *  rest of app-next's local state uses. */
const PLACEMENT_KEY = 'mainsail-next.webcamHudPlacement'

/** Streams that render into an iframe cannot be measured (cross origin), and
 *  their black bars are inside the iframe rather than around it. */
const UNMEASURABLE = ['iframe']

const container = ref<HTMLDivElement | null>(null)
const hud = ref<HTMLDivElement | null>(null)
const actions = ref<HTMLDivElement | null>(null)

const showHud = ref(true)
const isBrowserFullscreen = ref(false)

// user placement
const pinned = ref(false)
const anchor = ref<HudAnchor>('bottom-left')

// measured geometry of the black bars around the image
const dockMode = ref<'none' | 'vertical' | 'horizontal'>('none')
const dockSize = ref(0)
const containerWidth = ref(0)
const containerHeight = ref(0)

/**
 * Height of the button row, measured rather than assumed. The `top-right`
 * anchor has to clear it, and a hardcoded number silently misplaces the hud the
 * moment the buttons change size.
 */
const actionBarHeight = ref(56)

// drag state
const dragging = ref(false)
const dragAnchor = ref<HudAnchor | null>(null)
const dragPos = ref<{ x: number; y: number } | null>(null)
let dragPointerId: number | null = null
let dragOffset = { x: 0, y: 0 }
let dragSize = { w: 0, h: 0 }

let resizeObserver: ResizeObserver | null = null
let measureTimers: ReturnType<typeof setTimeout>[] = []

const docked = computed(() => !pinned.value && dockMode.value !== 'none')

const hudLayout = computed<'floating' | 'vertical' | 'horizontal'>(() =>
    docked.value ? dockMode.value as 'vertical' | 'horizontal' : 'floating'
)

/**
 * A very short window cannot show the chart and the numbers at the same time,
 * and neither can a letterbox bar too narrow to hold both on one line -- see
 * WEBCAM_HUD_MIN_ROW_CHART_WIDTH. Dropping the chart is the right sacrifice
 * either way: it is the extra, the readings are the point.
 */
const showChart = computed(() => {
    if (containerHeight.value < 320) return false

    if (docked.value && dockMode.value === 'horizontal') {
        return containerWidth.value >= WEBCAM_HUD_MIN_ROW_CHART_WIDTH
    }

    return true
})

const hudChartHeight = computed(() => {
    if (docked.value && dockMode.value === 'horizontal') {
        return Math.min(150, Math.max(56, dockSize.value - 24))
    }
    if (docked.value && dockMode.value === 'vertical') {
        return Math.min(240, Math.max(90, Math.round(containerHeight.value * 0.28)))
    }
    return 110
})

function anchorStyle(name: HudAnchor): Record<string, string> {
    const margin = `${WEBCAM_HUD_MARGIN}px`
    const topClear = `${WEBCAM_HUD_MARGIN + actionBarHeight.value}px`

    switch (name) {
        case 'top-left':
            return { top: margin, left: margin }
        case 'top-center':
            return { top: margin, left: '50%', transform: 'translateX(-50%)' }
        case 'top-right':
            return { top: topClear, right: margin }
        case 'right-center':
            return { top: '50%', right: margin, transform: 'translateY(-50%)' }
        case 'bottom-right':
            return { bottom: margin, right: margin }
        case 'bottom-center':
            return { bottom: margin, left: '50%', transform: 'translateX(-50%)' }
        case 'left-center':
            return { top: '50%', left: margin, transform: 'translateY(-50%)' }
        default:
            return { bottom: margin, left: margin }
    }
}

/** Centre point of every anchor slot for a card of the given size, in
 *  container coordinates. */
function anchorCenters(width: number, height: number): Record<HudAnchor, [number, number]> {
    const margin = WEBCAM_HUD_MARGIN
    const left = margin + width / 2
    const right = containerWidth.value - margin - width / 2
    const centerX = containerWidth.value / 2
    const top = margin + height / 2
    const bottom = containerHeight.value - margin - height / 2
    const centerY = containerHeight.value / 2

    return {
        'top-left': [left, top],
        'top-center': [centerX, top],
        'top-right': [right, top + actionBarHeight.value],
        'right-center': [right, centerY],
        'bottom-right': [right, bottom],
        'bottom-center': [centerX, bottom],
        'bottom-left': [left, bottom],
        'left-center': [left, centerY],
    }
}

function nearestAnchor(centerX: number, centerY: number): HudAnchor {
    const centers = anchorCenters(dragSize.w, dragSize.h)

    let best: HudAnchor = anchor.value
    let bestDistance = Number.POSITIVE_INFINITY

    for (const name of anchors) {
        const [x, y] = centers[name]
        const distance = (x - centerX) ** 2 + (y - centerY) ** 2
        if (distance < bestDistance) {
            bestDistance = distance
            best = name
        }
    }

    return best
}

const hudStyle = computed<Record<string, string>>(() => {
    // While dragging the card follows the pointer in plain container coordinates.
    if (dragging.value && dragPos.value) {
        return {
            top: `${dragPos.value.y}px`,
            left: `${dragPos.value.x}px`,
            width: `${dragSize.w}px`,
        }
    }

    if (docked.value && dockMode.value === 'vertical') {
        return { top: '0px', bottom: '0px', left: '0px', width: `${dockSize.value}px` }
    }

    if (docked.value && dockMode.value === 'horizontal') {
        return { left: '0px', right: '0px', bottom: '0px', height: `${dockSize.value}px` }
    }

    return anchorStyle(anchor.value)
})

function onMediaLoaded() {
    void nextTick(measureGeometry)
}

function measureGeometry() {
    const root = container.value
    if (!root) return

    containerWidth.value = root.clientWidth
    containerHeight.value = root.clientHeight

    if (actions.value) actionBarHeight.value = actions.value.offsetHeight + 16

    if (UNMEASURABLE.includes(props.webcam.service ?? '')) {
        dockMode.value = 'none'
        return
    }

    const frame = root.querySelector('.webcam-frame') as HTMLElement | null
    const media = root.querySelector('img.webcam-image') as HTMLImageElement | null

    // `offsetWidth/Height`, not `getBoundingClientRect()`: the image carries the
    // rotation/flip transform, and a rect would report the ROTATED bounding box
    // while the letterbox maths needs the layout box.
    const boxWidth = media?.offsetWidth ?? 0
    const boxHeight = media?.offsetHeight ?? 0

    if (!frame || !media || !boxWidth || !boxHeight) {
        dockMode.value = 'none'
        return
    }

    let naturalWidth = media.naturalWidth
    let naturalHeight = media.naturalHeight

    // No frame yet: re-measure as soon as one arrives. The streamers expose no
    // event of their own, so the image's own `load` is the signal. Until then
    // the configured aspect ratio is a stand-in.
    if (!naturalWidth || !naturalHeight) {
        media.addEventListener('load', onMediaLoaded, { once: true })

        const ratio = parseAspectRatio(props.webcam.aspect_ratio)
        if (!ratio) {
            dockMode.value = 'none'
            return
        }

        naturalWidth = ratio
        naturalHeight = 1
    }

    const rotation = props.webcam.rotation ?? 0
    if (rotation === 90 || rotation === 270) {
        const swap = naturalWidth
        naturalWidth = naturalHeight
        naturalHeight = swap
    }

    // object-fit: contain -- the painted image is the largest box with the
    // stream's aspect ratio that fits into the element box.
    const scale = Math.min(boxWidth / naturalWidth, boxHeight / naturalHeight)
    const paintedWidth = naturalWidth * scale
    const paintedHeight = naturalHeight * scale

    const containerRect = root.getBoundingClientRect()
    const frameRect = frame.getBoundingClientRect()
    const boxLeft = frameRect.left - containerRect.left + media.offsetLeft
    const boxTop = frameRect.top - containerRect.top + media.offsetTop

    const sideBar = boxLeft + (boxWidth - paintedWidth) / 2
    const bottomBar = containerHeight.value - (boxTop + (boxHeight + paintedHeight) / 2)

    if (sideBar >= WEBCAM_HUD_MIN_DOCK_WIDTH) {
        dockMode.value = 'vertical'
        dockSize.value = Math.floor(sideBar)
        return
    }

    if (bottomBar >= WEBCAM_HUD_MIN_DOCK_HEIGHT) {
        dockMode.value = 'horizontal'
        dockSize.value = Math.floor(bottomBar)
        return
    }

    dockMode.value = 'none'
}

function onPointerDown(event: PointerEvent) {
    // The chart keeps its own pointer handling (tooltip).
    if ((event.target as HTMLElement)?.closest?.('.webcam-hud-chart')) return
    if (dragging.value) return

    const card = hud.value
    const root = container.value
    if (!card || !root) return

    const cardRect = card.getBoundingClientRect()
    const containerRect = root.getBoundingClientRect()

    dragSize = { w: cardRect.width, h: cardRect.height }
    dragOffset = { x: event.clientX - cardRect.left, y: event.clientY - cardRect.top }
    dragPos.value = { x: cardRect.left - containerRect.left, y: cardRect.top - containerRect.top }
    dragAnchor.value = nearestAnchor(dragPos.value.x + dragSize.w / 2, dragPos.value.y + dragSize.h / 2)
    dragPointerId = event.pointerId
    dragging.value = true

    card.setPointerCapture?.(event.pointerId)
    event.preventDefault()
}

function onPointerMove(event: PointerEvent) {
    if (!dragging.value || event.pointerId !== dragPointerId || !container.value) return

    const containerRect = container.value.getBoundingClientRect()
    const x = event.clientX - containerRect.left - dragOffset.x
    const y = event.clientY - containerRect.top - dragOffset.y

    dragPos.value = { x, y }
    dragAnchor.value = nearestAnchor(x + dragSize.w / 2, y + dragSize.h / 2)
}

function onPointerUp(event: PointerEvent) {
    if (!dragging.value || event.pointerId !== dragPointerId) return

    hud.value?.releasePointerCapture?.(event.pointerId)

    if (dragAnchor.value) {
        anchor.value = dragAnchor.value
        pinned.value = true
        savePlacement()
    }

    dragging.value = false
    dragAnchor.value = null
    dragPos.value = null
    dragPointerId = null
}

function loadPlacement() {
    try {
        const raw = localStorage.getItem(PLACEMENT_KEY)
        if (!raw) return

        const placement = JSON.parse(raw) as { pinned?: boolean; anchor?: HudAnchor }
        if (!placement.anchor || !anchors.includes(placement.anchor)) return

        pinned.value = placement.pinned === true
        anchor.value = placement.anchor
    } catch {
        // Corrupt entry: keep the defaults.
    }
}

function savePlacement() {
    try {
        localStorage.setItem(PLACEMENT_KEY, JSON.stringify({ pinned: pinned.value, anchor: anchor.value }))
    } catch {
        // Private mode / quota: the placement simply is not remembered.
    }
}

/** Back to the automatic placement in the black bar. */
function resetPlacement() {
    pinned.value = false
    try {
        localStorage.removeItem(PLACEMENT_KEY)
    } catch {
        // Nothing to clean up.
    }
    void nextTick(measureGeometry)
}

const browserFullscreenSupported = computed(() => typeof document !== 'undefined' && document.fullscreenEnabled)

function fullscreenChanged() {
    isBrowserFullscreen.value = document.fullscreenElement !== null
    void nextTick(measureGeometry)
}

async function toggleBrowserFullscreen() {
    try {
        if (document.fullscreenElement === null) await container.value?.requestFullscreen()
        else await document.exitFullscreen()
    } catch {
        // The browser may refuse (permission policy, iOS Safari). The page
        // already covers the viewport, so this is only a nice-to-have.
    }
}

onMounted(() => {
    loadPlacement()

    document.addEventListener('fullscreenchange', fullscreenChanged)

    if (container.value) {
        resizeObserver = new ResizeObserver(() => measureGeometry())
        resizeObserver.observe(container.value)
    }

    // The natural size of the stream is only known once the first frame has
    // arrived, and the streamers expose no event for it. Re-measure a few times
    // after opening.
    measureTimers = [100, 400, 1000, 2500, 5000].map((delay) => setTimeout(measureGeometry, delay))
})

onBeforeUnmount(() => {
    document.removeEventListener('fullscreenchange', fullscreenChanged)
    resizeObserver?.disconnect()
    measureTimers.forEach(clearTimeout)

    if (document.fullscreenElement !== null) {
        void document.exitFullscreen().catch(() => {
            /* the browser may refuse, nothing to do about it */
        })
    }
})

/** Rotation or a different stream changes the letterboxing. */
watch(() => props.webcam, () => void nextTick(measureGeometry), { deep: true })
</script>

<template>
    <div ref="container" class="fixed inset-0 z-100 flex items-center justify-center bg-black">
        <div class="h-full w-full">
            <WebcamStream :webcam="webcam" :show-fps="false" />
        </div>

        <div
            ref="actions"
            class="absolute top-2 right-2 z-4 flex gap-1 rounded-3xl bg-black/45 p-0.5 backdrop-blur-sm">
            <button
                v-if="pinned"
                type="button"
                class="grid size-10 place-items-center rounded-full text-white/85 hover:bg-white/15 hover:text-white"
                title="Dock overlay back to the black bar"
                @click="resetPlacement">
                <MdiIcon :path="mdiPinOffOutline" class="size-5" />
            </button>
            <button
                type="button"
                class="grid size-10 place-items-center rounded-full text-white/85 hover:bg-white/15 hover:text-white"
                :title="showHud ? 'Hide overlay' : 'Show overlay'"
                @click="showHud = !showHud">
                <MdiIcon :path="showHud ? mdiEyeOffOutline : mdiEyeOutline" class="size-5" />
            </button>
            <button
                v-if="browserFullscreenSupported"
                type="button"
                class="grid size-10 place-items-center rounded-full text-white/85 hover:bg-white/15 hover:text-white"
                title="Fullscreen"
                @click="toggleBrowserFullscreen">
                <MdiIcon :path="isBrowserFullscreen ? mdiFullscreenExit : mdiFullscreen" class="size-5" />
            </button>
            <button
                type="button"
                class="grid size-10 place-items-center rounded-full text-white/85 hover:bg-white/15 hover:text-white"
                title="Close"
                @click="emit('close')">
                <MdiIcon :path="mdiClose" class="size-5" />
            </button>
        </div>

        <!-- The eight positions the hud snaps to, shown only while dragging so
             the target is never a guess. -->
        <template v-if="dragging">
            <div
                v-for="name in anchors"
                :key="name"
                class="pointer-events-none absolute z-3 h-[34px] w-[52px] rounded-md border-2 border-dashed"
                :class="name === dragAnchor ? 'border-white/95 bg-white/20' : 'border-white/45'"
                :style="anchorStyle(name)" />
        </template>

        <div
            v-if="showHud"
            ref="hud"
            class="absolute z-2 touch-none"
            :class="[
                docked ? 'cursor-grab' : 'w-[420px] max-w-[calc(100%-32px)] cursor-grab',
                dragging ? 'cursor-grabbing opacity-92' : '',
            ]"
            :style="hudStyle"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerUp">
            <WebcamHud :layout="hudLayout" :chart-height="hudChartHeight" :show-chart="showChart" />
        </div>
    </div>
</template>
