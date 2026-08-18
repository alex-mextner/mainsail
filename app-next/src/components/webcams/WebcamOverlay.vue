<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import {
    mdiClose,
    mdiDockBottom,
    mdiDockLeft,
    mdiDockRight,
    mdiDockTop,
    mdiDockWindow,
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
    WEBCAM_HUD_DOCK_ZONE_DEPTH,
    WEBCAM_HUD_MARGIN,
    WEBCAM_HUD_MIN_DOCK_HEIGHT,
    WEBCAM_HUD_MIN_DOCK_WIDTH,
    WEBCAM_HUD_MIN_ROW_CHART_WIDTH,
    type WebcamConfig,
} from '@/lib/webcam'

/**
 * Fullscreen camera with the hud on top -- the whole of M2, plus the M2a fix.
 *
 * Three things it does that a plain overlay does not:
 *
 * 1. IT MEASURES THE LETTERBOX. `object-fit: contain` paints the image whole,
 *    which leaves black bars wherever the window and the camera disagree about
 *    aspect ratio. When a bar is wide/tall enough to stay readable the hud is
 *    docked INTO it and stretched along it, so the readings cost nothing of the
 *    picture. Otherwise it falls back to a floating card over the image.
 *
 * 2. IT MOVES THE FRAME ASIDE when neither bar is enough on its own. Centring
 *    splits the free space into two bars, and each half can miss the threshold
 *    while the two together clear it easily -- at 1366x768 with a 4:3 camera the
 *    halves are 171px against a 200px threshold, with 342px going unused. So the
 *    frame box is inset by the width of the bar and the frame is painted flush
 *    against the far edge. Nothing is cropped; `object-fit: contain` still
 *    paints the whole picture, only smaller when the bar had to be made bigger
 *    than the letterboxing gave.
 *
 * 3. IT CAN BE DRAGGED, and snaps either to one of eight anchors -- four corners
 *    and four edge centres -- or into one of the four bars, whichever the
 *    pointer was over on release. The placement is remembered as NAMES (mode,
 *    anchor, side) rather than as pixels, so resizing the window can never leave
 *    it off-screen or in a position that no longer means what it meant.
 *
 * Ported from the Vue 2 tree's `webcams/WebcamFullscreen.vue` (commits
 * 5844d3d4 / fd9c8023 / ec9c89bd, and 1590c1eb for the above). The one
 * deliberate deviation is which element the aspect ratio is read from: this
 * tree owns the markup, so the image is found by its own class rather than by
 * walking `offsetParent` up from it.
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

type HudSide = 'left' | 'right' | 'top' | 'bottom'

/**
 * 'auto'  dock into a black bar when one is big enough, float otherwise (default)
 * 'float' always a card over the image, at `anchor` (what a drag to the middle gives)
 * 'dock'  always in the bar on `side`, whatever the measurement says (the manual override)
 */
type HudMode = 'auto' | 'float' | 'dock'

interface DockPlan {
    axis: 'none' | 'vertical' | 'horizontal'
    side: HudSide
    size: number
    /** frame pushed against the opposite edge, so both bars become one */
    shift: boolean
}

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

const sides: HudSide[] = ['left', 'right', 'top', 'bottom']
const modes: HudMode[] = ['auto', 'float', 'dock']

/** Per-browser, not per-printer: which corner is free depends on the screen in
 *  front of you (phone, the tablet at the machine, desktop). Same prefix the
 *  rest of app-next's local state uses. */
const PLACEMENT_KEY = 'mainsail-next.webcamHudPlacement'

/** Streams that render into an iframe cannot be measured (cross origin), and
 *  their black bars are inside the iframe rather than around it. A grid of
 *  several cameras has no single frame either -- every tile letterboxes alone. */
const UNMEASURABLE = ['iframe', 'grid']

const container = ref<HTMLDivElement | null>(null)
const hud = ref<HTMLDivElement | null>(null)
const actions = ref<HTMLDivElement | null>(null)

const showHud = ref(true)
const isBrowserFullscreen = ref(false)

// user placement
const mode = ref<HudMode>('auto')
const anchor = ref<HudAnchor>('bottom-left')
const side = ref<HudSide>('left')

/**
 * Measured geometry -- and only these two things are measured. Everything else
 * is derived. Reading the IMAGE box instead would be circular, because docking
 * insets that box: inset applied -> box narrower -> no slack left -> dock
 * dropped -> inset removed -> slack back. The container is `fixed inset-0`, so
 * its size depends on the viewport alone and the ResizeObserver watching it
 * cannot be retriggered by our own layout.
 */
const frameAspect = ref<number | null>(null)
const containerWidth = ref(0)
const containerHeight = ref(0)

/**
 * Size of the button row, measured rather than assumed. The `top-right` anchor
 * has to clear its height and a top-docked row has to clear its width; a
 * hardcoded number silently misplaces the hud the moment the buttons change.
 */
const actionBarHeight = ref(56)
const actionBarWidth = ref(0)

// drag state
const dragging = ref(false)
const dragAnchor = ref<HudAnchor | null>(null)
const dragSide = ref<HudSide | null>(null)
const dragPos = ref<{ x: number; y: number } | null>(null)
let dragPointerId: number | null = null
let dragOffset = { x: 0, y: 0 }
let dragSize = { w: 0, h: 0 }

let resizeObserver: ResizeObserver | null = null
let measureTimers: ReturnType<typeof setTimeout>[] = []

const measurable = computed(() => !UNMEASURABLE.includes(props.webcam.service ?? ''))

/**
 * Total slack left over by `object-fit: contain` -- BOTH bars added together.
 * One of the two is always zero: a frame either pillarboxes or letterboxes.
 */
const freeHorizontal = computed(() => {
    if (!frameAspect.value || !containerWidth.value || !containerHeight.value) return 0
    return Math.max(0, containerWidth.value - containerHeight.value * frameAspect.value)
})

const freeVertical = computed(() => {
    if (!frameAspect.value || !containerWidth.value || !containerHeight.value) return 0
    return Math.max(0, containerHeight.value - containerWidth.value / frameAspect.value)
})

/**
 * Which edge a dock goes to. The stored side wins when it belongs to that axis,
 * otherwise the floating anchor decides -- so a hud that used to sit bottom-left
 * docks into the left column and the bottom row, exactly as it did before.
 */
const verticalSide = computed<HudSide>(() => {
    if (side.value === 'left' || side.value === 'right') return side.value
    return anchor.value.includes('right') ? 'right' : 'left'
})

const horizontalSide = computed<HudSide>(() => {
    if (side.value === 'top' || side.value === 'bottom') return side.value
    return anchor.value.startsWith('top') ? 'top' : 'bottom'
})

const dockPlan = computed<DockPlan>(() => {
    const idle: DockPlan = { axis: 'none', side: side.value, size: 0, shift: false }
    if (mode.value === 'float') return idle
    if (!containerWidth.value || !containerHeight.value) return idle

    // The manual dock ALWAYS happens -- that is the whole point of it. If the bar
    // the frame leaves is thinner than the readable minimum, or the frame cannot
    // be measured at all, the bar is reserved anyway and the frame is scaled into
    // what is left. An override that silently did nothing would be worse than
    // not having one.
    if (mode.value === 'dock') {
        const axis = side.value === 'left' || side.value === 'right' ? 'vertical' : 'horizontal'
        const minimum = axis === 'vertical' ? WEBCAM_HUD_MIN_DOCK_WIDTH : WEBCAM_HUD_MIN_DOCK_HEIGHT
        const free = axis === 'vertical' ? freeHorizontal.value : freeVertical.value

        return { axis, side: side.value, size: Math.round(Math.max(minimum, free)), shift: true }
    }

    if (!measurable.value || !frameAspect.value) return idle

    // Automatic. A single untouched bar is tried first, so every window shape
    // that already docked keeps its centred frame. Only when neither half
    // reaches the threshold is the frame pushed aside and the hud handed both
    // bars as one -- the case the thresholds used to reject with the room
    // sitting right there.
    if (freeHorizontal.value / 2 >= WEBCAM_HUD_MIN_DOCK_WIDTH) {
        return {
            axis: 'vertical',
            side: verticalSide.value,
            size: Math.floor(freeHorizontal.value / 2),
            shift: false,
        }
    }

    if (freeVertical.value / 2 >= WEBCAM_HUD_MIN_DOCK_HEIGHT) {
        return {
            axis: 'horizontal',
            side: horizontalSide.value,
            size: Math.floor(freeVertical.value / 2),
            shift: false,
        }
    }

    if (freeHorizontal.value >= WEBCAM_HUD_MIN_DOCK_WIDTH) {
        return { axis: 'vertical', side: verticalSide.value, size: Math.floor(freeHorizontal.value), shift: true }
    }

    if (freeVertical.value >= WEBCAM_HUD_MIN_DOCK_HEIGHT) {
        return { axis: 'horizontal', side: horizontalSide.value, size: Math.floor(freeVertical.value), shift: true }
    }

    return idle
})

const docked = computed(() => dockPlan.value.axis !== 'none')

const hudLayout = computed<'floating' | 'vertical' | 'horizontal'>(() =>
    docked.value ? (dockPlan.value.axis as 'vertical' | 'horizontal') : 'floating'
)

/**
 * A very short window cannot show the chart and the numbers at the same time,
 * and neither can a letterbox bar too narrow to hold both on one line -- see
 * WEBCAM_HUD_MIN_ROW_CHART_WIDTH. Dropping the chart is the right sacrifice
 * either way: it is the extra, the readings are the point.
 */
const showChart = computed(() => {
    if (containerHeight.value < 320) return false

    if (dockPlan.value.axis === 'horizontal') {
        return containerWidth.value >= WEBCAM_HUD_MIN_ROW_CHART_WIDTH
    }

    return true
})

const hudChartHeight = computed(() => {
    if (dockPlan.value.axis === 'horizontal') {
        return Math.min(150, Math.max(56, dockPlan.value.size - 24))
    }
    if (dockPlan.value.axis === 'vertical') {
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

/** The bar that dropping on this edge would produce, drawn to scale while
 *  dragging so the preview does not promise something the drop will not give. */
function barPreviewStyle(name: HudSide): Record<string, string> {
    const vertical = name === 'left' || name === 'right'
    const minimum = vertical ? WEBCAM_HUD_MIN_DOCK_WIDTH : WEBCAM_HUD_MIN_DOCK_HEIGHT
    const free = vertical ? freeHorizontal.value : freeVertical.value
    const size = Math.round(Math.max(minimum, free))

    if (vertical) return { top: '0px', bottom: '0px', width: `${size}px`, [name]: '0px' }
    return { left: '0px', right: '0px', height: `${size}px`, [name]: '0px' }
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

/** Dragging the hud right up against an edge means "put it into the bar there".
 *  The pointer decides, not the card: the card is 420px wide, so its own
 *  position cannot tell the two gestures apart. */
function dockZoneAt(x: number, y: number): HudSide | null {
    const distance: Record<HudSide, number> = {
        left: x,
        right: containerWidth.value - x,
        top: y,
        bottom: containerHeight.value - y,
    }

    let best: HudSide | null = null
    let bestDistance = WEBCAM_HUD_DOCK_ZONE_DEPTH

    for (const name of sides) {
        if (distance[name] < bestDistance) {
            bestDistance = distance[name]
            best = name
        }
    }

    return best
}

function dockSideFromAnchor(): HudSide {
    if (anchor.value.includes('left')) return 'left'
    if (anchor.value.includes('right')) return 'right'
    if (anchor.value === 'top-center') return 'top'
    return 'bottom'
}

function anchorForSide(name: HudSide): HudAnchor {
    switch (name) {
        case 'right':
            return 'right-center'
        case 'top':
            return 'top-center'
        case 'bottom':
            return 'bottom-center'
        default:
            return 'left-center'
    }
}

/** The frame box is inset by the width of the bar the hud sits in, so
 *  `object-fit: contain` paints it flush against the opposite edge. */
const streamStyle = computed<Record<string, string>>(() => {
    const plan = dockPlan.value
    if (!plan.shift || plan.axis === 'none' || !plan.size) return {}
    return { [plan.side]: `${plan.size}px` }
})

const hudStyle = computed<Record<string, string>>(() => {
    // While dragging the card follows the pointer in plain container coordinates.
    if (dragging.value && dragPos.value) {
        return {
            top: `${dragPos.value.y}px`,
            left: `${dragPos.value.x}px`,
            width: `${dragSize.w}px`,
        }
    }

    const plan = dockPlan.value

    if (plan.axis === 'vertical') {
        const style: Record<string, string> = {
            top: '0px',
            bottom: '0px',
            width: `${plan.size}px`,
            [plan.side]: '0px',
        }
        // the buttons sit in the top right corner, so a right hand column starts
        // below them rather than under them
        if (plan.side === 'right') style.paddingTop = `${actionBarHeight.value}px`
        return style
    }

    if (plan.axis === 'horizontal') {
        const style: Record<string, string> = {
            left: '0px',
            right: '0px',
            height: `${plan.size}px`,
            [plan.side]: '0px',
        }
        if (plan.side === 'top') style.paddingRight = `${actionBarWidth.value}px`
        return style
    }

    return anchorStyle(anchor.value)
})

const dockButtonTitle = computed(() =>
    docked.value ? 'Move overlay back onto the image' : 'Move overlay into the black bar'
)

const dockButtonIcon = computed(() => {
    if (docked.value) return mdiDockWindow

    switch (dockSideFromAnchor()) {
        case 'right':
            return mdiDockRight
        case 'top':
            return mdiDockTop
        case 'bottom':
            return mdiDockBottom
        default:
            return mdiDockLeft
    }
})

function onMediaLoaded() {
    void nextTick(measureGeometry)
}

function measureGeometry() {
    const root = container.value
    if (!root) return

    containerWidth.value = root.clientWidth
    containerHeight.value = root.clientHeight

    if (actions.value) {
        actionBarHeight.value = actions.value.offsetHeight + 16
        actionBarWidth.value = actions.value.offsetWidth + 16
    }

    if (!measurable.value) {
        frameAspect.value = null
        return
    }

    const media = root.querySelector('img.webcam-image') as HTMLImageElement | null
    if (!media) {
        frameAspect.value = parseAspectRatio(props.webcam.aspect_ratio)
        return
    }

    let naturalWidth = media.naturalWidth
    let naturalHeight = media.naturalHeight

    // No frame right now -- and with mjpegstreamer-adaptive that is not a
    // startup-only state: the img is re-pointed at a new snapshot several times
    // a second, and it measured 0 whole seconds after a resize. So the
    // configured aspect ratio is a real fallback, not a placeholder until the
    // first frame.
    if (!naturalWidth || !naturalHeight) {
        media.addEventListener('load', onMediaLoaded, { once: true })
        frameAspect.value = parseAspectRatio(props.webcam.aspect_ratio)
        return
    }

    const rotation = props.webcam.rotation ?? 0
    if (rotation === 90 || rotation === 270) {
        const swap = naturalWidth
        naturalWidth = naturalHeight
        naturalHeight = swap
    }

    frameAspect.value = naturalWidth / naturalHeight
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
    dragSide.value = dockZoneAt(event.clientX - containerRect.left, event.clientY - containerRect.top)
    dragAnchor.value = nearestAnchor(dragPos.value.x + dragSize.w / 2, dragPos.value.y + dragSize.h / 2)
    dragPointerId = event.pointerId
    dragging.value = true

    card.setPointerCapture?.(event.pointerId)
    event.preventDefault()

    /**
     * Re-measure once the drag style has actually been applied.
     *
     * The rect above is the card as it was BEFORE the drag: dragging one out of
     * a vertical dock measures a full-height 280x900 column, but the moment
     * `hudStyle` switches to pointer coordinates the card collapses to its
     * content height (~460px). `nearestAnchor` centres the card on the pointer
     * using that height, so with the stale 900 the midpoint sat 220px above
     * where the card really was -- drag to the bottom right corner, release,
     * and it snapped to the TOP right. Caught by driving a real drag against
     * the printer (scripts/drag-overcam.mjs), not by reading the code.
     */
    void nextTick(() => {
        if (!dragging.value || !hud.value) return

        const rect = hud.value.getBoundingClientRect()
        dragSize = { w: rect.width, h: rect.height }
    })
}

function onPointerMove(event: PointerEvent) {
    if (!dragging.value || event.pointerId !== dragPointerId || !container.value) return

    const containerRect = container.value.getBoundingClientRect()
    const pointerX = event.clientX - containerRect.left
    const pointerY = event.clientY - containerRect.top
    const x = pointerX - dragOffset.x
    const y = pointerY - dragOffset.y

    dragPos.value = { x, y }
    dragSide.value = dockZoneAt(pointerX, pointerY)
    dragAnchor.value = nearestAnchor(x + dragSize.w / 2, y + dragSize.h / 2)
}

function onPointerUp(event: PointerEvent) {
    if (!dragging.value || event.pointerId !== dragPointerId) return

    hud.value?.releasePointerCapture?.(event.pointerId)

    if (dragSide.value) {
        // dropped on an edge: into the bar there, whatever the measurement thinks
        side.value = dragSide.value
        anchor.value = anchorForSide(dragSide.value)
        mode.value = 'dock'
        savePlacement()
    } else if (dragAnchor.value) {
        anchor.value = dragAnchor.value
        mode.value = 'float'
        savePlacement()
    }

    dragging.value = false
    dragAnchor.value = null
    dragSide.value = null
    dragPos.value = null
    dragPointerId = null
}

/** The always available way in and out of the bar, for when dragging is awkward
 *  (touch) or the automatic placement simply picked the other answer. */
function toggleDock() {
    if (docked.value) {
        mode.value = 'float'
    } else {
        mode.value = 'dock'
        side.value = dockSideFromAnchor()
    }

    savePlacement()
}

function loadPlacement() {
    try {
        const raw = localStorage.getItem(PLACEMENT_KEY)
        if (!raw) return

        const placement = JSON.parse(raw) as { mode?: HudMode; anchor?: HudAnchor; side?: HudSide; pinned?: boolean }
        if (placement.anchor && anchors.includes(placement.anchor)) anchor.value = placement.anchor
        if (placement.side && sides.includes(placement.side)) side.value = placement.side

        if (placement.mode && modes.includes(placement.mode)) {
            mode.value = placement.mode
            return
        }

        // Entry from the previous version, which only knew `pinned`. A stored
        // `pinned: true` is dropped on purpose rather than translated to
        // 'float': back then ANY drag set it, and it then suppressed docking for
        // good, at every window size. That is one of the two ways to end up with
        // "the overlay will not go into the black area", and a user cannot tell
        // it apart from the threshold bug or clear it without knowing about
        // localStorage. The chosen corner is kept, only the veto is dropped.
        mode.value = 'auto'
    } catch {
        // Corrupt entry: keep the defaults.
    }
}

function savePlacement() {
    try {
        localStorage.setItem(
            PLACEMENT_KEY,
            JSON.stringify({ mode: mode.value, anchor: anchor.value, side: side.value })
        )
    } catch {
        // Private mode / quota: the placement simply is not remembered.
    }
}

/** Back to the automatic placement. */
function resetPlacement() {
    mode.value = 'auto'
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
watch(
    () => props.webcam,
    () => void nextTick(measureGeometry),
    { deep: true }
)
</script>

<template>
    <div
        ref="container"
        class="fixed inset-0 z-100 bg-black"
        data-overcam-root
        :data-dock-axis="dockPlan.axis"
        :data-dock-side="dockPlan.side"
        :data-dock-size="dockPlan.size"
        :data-dock-shift="dockPlan.shift ? '1' : '0'"
        :data-frame-aspect="frameAspect"
        :data-hud-mode="mode"
        :data-hud-anchor="anchor">
        <div class="absolute inset-0" :style="streamStyle">
            <WebcamStream :webcam="webcam" :show-fps="false" />
        </div>

        <div ref="actions" class="absolute top-2 right-2 z-4 flex gap-1 rounded-3xl bg-black/45 p-0.5 backdrop-blur-sm">
            <button
                v-if="mode !== 'auto'"
                type="button"
                data-overcam-reset
                class="grid size-10 place-items-center rounded-full text-white/85 hover:bg-white/15 hover:text-white"
                title="Place the overlay automatically again"
                @click="resetPlacement">
                <MdiIcon :path="mdiPinOffOutline" class="size-5" />
            </button>
            <button
                v-if="showHud"
                type="button"
                data-overcam-dock-toggle
                class="grid size-10 place-items-center rounded-full text-white/85 hover:bg-white/15 hover:text-white"
                :title="dockButtonTitle"
                @click="toggleDock">
                <MdiIcon :path="dockButtonIcon" class="size-5" />
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

        <!-- Drop targets, shown only while dragging so the target is never a
             guess: the four bars the hud can be docked into, and the eight
             positions it can float at. -->
        <template v-if="dragging">
            <div
                v-for="name in sides"
                :key="`bar-${name}`"
                data-overcam-bar
                :data-active="name === dragSide ? '1' : '0'"
                class="pointer-events-none absolute z-3 flex items-center justify-center border-2 border-dashed"
                :class="name === dragSide ? 'border-white/95 bg-white/18' : 'border-white/30'"
                :style="barPreviewStyle(name)">
                <span
                    class="rounded-xl bg-black/50 px-2 py-0.5 text-xs tracking-wider text-white/85 uppercase"
                    :class="name === dragSide ? 'opacity-100' : 'opacity-0'">
                    Dock here
                </span>
            </div>
            <div
                v-for="name in anchors"
                :key="name"
                data-overcam-snap
                :data-active="!dragSide && name === dragAnchor ? '1' : '0'"
                class="pointer-events-none absolute z-3 h-[34px] w-[52px] rounded-md border-2 border-dashed"
                :class="!dragSide && name === dragAnchor ? 'border-white/95 bg-white/20' : 'border-white/45'"
                :style="anchorStyle(name)" />
        </template>

        <div
            v-if="showHud"
            ref="hud"
            data-overcam-hud
            class="absolute z-2 box-border touch-none"
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
