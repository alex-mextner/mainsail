<template>
    <div
        ref="container"
        class="webcam-fullscreen"
        data-overcam-root
        :data-dock-axis="dockPlan.axis"
        :data-dock-side="dockPlan.side"
        :data-dock-size="dockPlan.size"
        :data-dock-shift="dockPlan.shift ? '1' : '0'"
        :data-frame-aspect="frameAspect"
        :data-hud-mode="mode"
        :data-hud-anchor="anchor">
        <div class="webcam-fullscreen__stream" :style="streamStyle">
            <webcam-wrapper :webcam="webcam" :show-fps="false" page="fullscreen" />
        </div>

        <div ref="actions" class="webcam-fullscreen__actions">
            <v-btn
                v-if="mode !== 'auto'"
                icon
                dark
                data-overcam-reset
                :title="$t('Panels.WebcamPanel.Hud.ResetPosition')"
                @click="resetPlacement">
                <v-icon>{{ mdiPinOffOutline }}</v-icon>
            </v-btn>
            <v-btn v-if="showHud" icon dark data-overcam-dock-toggle :title="dockButtonTitle" @click="toggleDock">
                <v-icon>{{ dockButtonIcon }}</v-icon>
            </v-btn>
            <v-btn icon dark :title="hudButtonTitle" @click="showHud = !showHud">
                <v-icon>{{ showHud ? mdiEyeOffOutline : mdiEyeOutline }}</v-icon>
            </v-btn>
            <v-btn
                v-if="browserFullscreenSupported"
                icon
                dark
                :title="$t('Panels.WebcamPanel.Hud.Fullscreen')"
                @click="toggleBrowserFullscreen">
                <v-icon>{{ isBrowserFullscreen ? mdiFullscreenExit : mdiFullscreen }}</v-icon>
            </v-btn>
            <v-btn icon dark :title="$t('Panels.WebcamPanel.Hud.Close')" @click="$emit('close')">
                <v-icon>{{ mdiClose }}</v-icon>
            </v-btn>
        </div>

        <!-- drop targets, only while the hud is being dragged: the four bars it can be docked
             into, and the eight positions it can float at -->
        <template v-if="dragging">
            <div
                v-for="sideName in sides"
                :key="`bar-${sideName}`"
                class="webcam-fullscreen__bar"
                data-overcam-bar
                :data-active="sideName === dragSide ? '1' : '0'"
                :class="{ 'webcam-fullscreen__bar--active': sideName === dragSide }"
                :style="barPreviewStyle(sideName)">
                <span class="webcam-fullscreen__bar-label">{{ $t('Panels.WebcamPanel.Hud.DockHere') }}</span>
            </div>
            <div
                v-for="anchorName in anchors"
                :key="anchorName"
                class="webcam-fullscreen__snap"
                data-overcam-snap
                :data-active="!dragSide && anchorName === dragAnchor ? '1' : '0'"
                :class="{ 'webcam-fullscreen__snap--active': !dragSide && anchorName === dragAnchor }"
                :style="anchorStyle(anchorName)" />
        </template>

        <div
            v-if="showHud"
            ref="hud"
            class="webcam-fullscreen__hud"
            data-overcam-hud
            :class="hudClasses"
            :style="hudStyle"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerUp">
            <webcam-hud :layout="hudLayout" :chart-height="hudChartHeight" :show-chart="showChart" />
        </div>
    </div>
</template>

<script lang="ts">
import Component from 'vue-class-component'
import { Mixins, Prop, Ref, Watch } from 'vue-property-decorator'
import BaseMixin from '@/components/mixins/base'
import WebcamWrapper from '@/components/webcams/WebcamWrapper.vue'
import WebcamHud from '@/components/webcams/WebcamHud.vue'
import { GuiWebcamStateWebcam } from '@/store/gui/webcams/types'
import {
    webcamHudDockZoneDepth,
    webcamHudMargin,
    webcamHudMinDockHeight,
    webcamHudMinDockWidth,
    webcamHudMinRowChartWidth,
} from '@/store/variables'
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

// 'auto'  - dock into a black bar when one is big enough, float otherwise (the default)
// 'float' - always a card on top of the image, at `anchor` (what a drag to the middle gives)
// 'dock'  - always in the bar on `side`, whatever the measurement says (the manual override)
type HudMode = 'auto' | 'float' | 'dock'

interface HudPlacement {
    mode: HudMode
    anchor: HudAnchor
    side: HudSide
}

interface DockPlan {
    axis: 'none' | 'vertical' | 'horizontal'
    side: HudSide
    size: number
    // true when the frame is pushed against the opposite edge so that the two bars
    // letterboxing would otherwise leave are handed to the hud as one
    shift: boolean
}

// The placement is stored per browser, not in the moonraker database: which corner is free
// depends on the screen the user is looking at (phone, tablet at the printer, desktop), and
// the docked default is recomputed from the window size anyway. Mainsail already keeps this
// kind of per-device view state in localStorage (see naviDrawer in store/mutations.ts).
const hudPlacementKey = 'webcamHudPlacement'

// The action buttons live in the top right corner, so the hud keeps clear of them there.
const actionBarHeight = 56

// Streams that render into an iframe cannot be measured for letterboxing (cross origin), and
// the black bars are inside the iframe rather than around it. A grid of several cameras has no
// single frame to measure either - every tile letterboxes on its own.
const unmeasurableServices = ['iframe', 'grid']

@Component({
    components: { WebcamHud, WebcamWrapper },
})
export default class WebcamFullscreen extends Mixins(BaseMixin) {
    mdiClose = mdiClose
    mdiEyeOutline = mdiEyeOutline
    mdiEyeOffOutline = mdiEyeOffOutline
    mdiFullscreen = mdiFullscreen
    mdiFullscreenExit = mdiFullscreenExit
    mdiPinOffOutline = mdiPinOffOutline

    @Prop({ type: Object, required: true }) declare readonly webcam: GuiWebcamStateWebcam

    @Ref('container') readonly container!: HTMLDivElement
    @Ref('hud') readonly hud!: HTMLDivElement
    @Ref('actions') readonly actions!: HTMLDivElement

    readonly anchors: HudAnchor[] = [
        'top-left',
        'top-center',
        'top-right',
        'right-center',
        'bottom-right',
        'bottom-center',
        'bottom-left',
        'left-center',
    ]

    readonly sides: HudSide[] = ['left', 'right', 'top', 'bottom']

    showHud = true
    isBrowserFullscreen = false

    // user placement
    mode: HudMode = 'auto'
    anchor: HudAnchor = 'bottom-left'
    side: HudSide = 'left'

    // measured geometry. Only the container and the aspect ratio of the frame are measured:
    // everything else is derived from those two. Measuring the image box instead would be
    // circular, because docking changes that box - see measureGeometry().
    frameAspect: number | null = null
    containerWidth = 0
    containerHeight = 0
    actionBarWidth = 0

    // drag state
    dragging = false
    dragAnchor: HudAnchor | null = null
    dragSide: HudSide | null = null
    dragPointerId: number | null = null
    dragPos: { x: number; y: number } | null = null
    dragOffset = { x: 0, y: 0 }
    dragSize = { w: 0, h: 0 }

    resizeObserver: ResizeObserver | null = null
    measureTimers: number[] = []

    get measurable() {
        return !unmeasurableServices.includes(this.webcam.service ?? '')
    }

    // total slack left over by `object-fit: contain`, i.e. BOTH bars added together. One of
    // the two is always zero: a frame either pillarboxes or letterboxes, never both.
    get freeHorizontal() {
        if (!this.frameAspect || !this.containerWidth || !this.containerHeight) return 0

        return Math.max(0, this.containerWidth - this.containerHeight * this.frameAspect)
    }

    get freeVertical() {
        if (!this.frameAspect || !this.containerWidth || !this.containerHeight) return 0

        return Math.max(0, this.containerHeight - this.containerWidth / this.frameAspect)
    }

    // which edge a vertical / horizontal dock goes to. The stored side wins when it belongs to
    // that axis, otherwise the floating anchor decides - so a hud that used to sit bottom-left
    // docks into the left column and the bottom row, exactly as it did before.
    get verticalSide(): HudSide {
        if (this.side === 'left' || this.side === 'right') return this.side

        return this.anchor.includes('right') ? 'right' : 'left'
    }

    get horizontalSide(): HudSide {
        if (this.side === 'top' || this.side === 'bottom') return this.side

        return this.anchor.startsWith('top') ? 'top' : 'bottom'
    }

    get dockPlan(): DockPlan {
        const idle: DockPlan = { axis: 'none', side: this.side, size: 0, shift: false }
        if (this.mode === 'float') return idle
        if (!this.containerWidth || !this.containerHeight) return idle

        // The manual dock always happens - that is the whole point of it. If the bar the
        // frame leaves is thinner than the readable minimum (or the frame cannot be measured
        // at all), the bar is reserved anyway and the frame is scaled down into what is left.
        // An override that silently does nothing would be worse than no override.
        if (this.mode === 'dock') {
            const axis = this.side === 'left' || this.side === 'right' ? 'vertical' : 'horizontal'
            const minimum = axis === 'vertical' ? webcamHudMinDockWidth : webcamHudMinDockHeight
            const free = axis === 'vertical' ? this.freeHorizontal : this.freeVertical

            return { axis, side: this.side, size: Math.round(Math.max(minimum, free)), shift: true }
        }

        if (!this.measurable || !this.frameAspect) return idle

        // Automatic. Whenever the hud docks it gets the SUM of what letterboxing leaves, never
        // one of the two bars: the frame is pushed flush against the opposite edge and the two
        // strips are handed over as a single one.
        //
        // The threshold below decides whether there is enough room to dock AT ALL. It used to
        // decide something else as well - a bar that cleared it on its own was taken alone and
        // the frame left centred, which is only defensible if the far strip is worth keeping.
        // It is not: it is black, it is empty, and it is exactly as wide as the one the hud is
        // squeezed into. Measured in the user's own window, 1568x774 with a 4:3 camera: 268px
        // of column on the left, and 268px of black thrown away on the right.
        //
        // Note the gate itself is unchanged by this - `free/2 >= T` implies `free >= T`, so the
        // same window shapes dock as before. Only the size of the bar, and where the frame
        // sits, are different. Nothing is ever cropped: the frame is moved, and only scaled
        // down when a manual dock reserved more than the letterboxing gave.
        if (this.freeHorizontal >= webcamHudMinDockWidth) {
            return { axis: 'vertical', side: this.verticalSide, size: Math.floor(this.freeHorizontal), shift: true }
        }

        if (this.freeVertical >= webcamHudMinDockHeight) {
            return { axis: 'horizontal', side: this.horizontalSide, size: Math.floor(this.freeVertical), shift: true }
        }

        return idle
    }

    get docked() {
        return this.dockPlan.axis !== 'none'
    }

    get hudLayout() {
        if (!this.docked) return 'floating'

        return this.dockPlan.axis
    }

    get hudClasses() {
        return {
            'webcam-fullscreen__hud--floating': !this.docked,
            'webcam-fullscreen__hud--docked': this.docked,
            'webcam-fullscreen__hud--dragging': this.dragging,
        }
    }

    // A very short window cannot show the chart and the numbers at the same time, and neither
    // can a letterbox row too narrow to hold both on one line - see webcamHudMinRowChartWidth.
    // Dropping the chart is the right sacrifice either way: it is the extra, the readings are
    // the point.
    get showChart() {
        if (this.containerHeight < 320) return false

        if (this.dockPlan.axis === 'horizontal') {
            return this.containerWidth >= webcamHudMinRowChartWidth
        }

        return true
    }

    get hudChartHeight() {
        const plan = this.dockPlan

        if (plan.axis === 'horizontal') {
            return Math.min(150, Math.max(56, plan.size - 24))
        }

        if (plan.axis === 'vertical') {
            return Math.min(240, Math.max(90, Math.round(this.containerHeight * 0.28)))
        }

        return 110
    }

    // the frame is inset by the width of the bar the hud sits in, so `object-fit: contain`
    // paints it flush against the opposite edge. Nothing is cropped - the frame is only ever
    // moved, and scaled down when the bar had to be made bigger than the letterboxing gave.
    get streamStyle(): Record<string, string> {
        const plan = this.dockPlan
        if (!plan.shift || plan.axis === 'none' || !plan.size) return {}

        return { [plan.side]: `${plan.size}px` }
    }

    get hudStyle(): Record<string, string> {
        // while dragging the card follows the pointer in plain container coordinates
        if (this.dragging && this.dragPos) {
            return {
                top: `${this.dragPos.y}px`,
                left: `${this.dragPos.x}px`,
                width: `${this.dragSize.w}px`,
            }
        }

        const plan = this.dockPlan

        if (plan.axis === 'vertical') {
            const style: Record<string, string> = {
                top: '0px',
                bottom: '0px',
                width: `${plan.size}px`,
                [plan.side]: '0px',
            }
            // the action buttons sit in the top right corner, so a right hand column starts
            // below them rather than under them
            if (plan.side === 'right') style.paddingTop = `${actionBarHeight}px`

            return style
        }

        if (plan.axis === 'horizontal') {
            const style: Record<string, string> = {
                left: '0px',
                right: '0px',
                height: `${plan.size}px`,
                [plan.side]: '0px',
            }
            if (plan.side === 'top') style.paddingRight = `${this.actionBarWidth}px`

            return style
        }

        return this.anchorStyle(this.anchor)
    }

    get hudButtonTitle() {
        return this.showHud ? this.$t('Panels.WebcamPanel.Hud.HideHud') : this.$t('Panels.WebcamPanel.Hud.ShowHud')
    }

    get dockButtonTitle() {
        return this.docked ? this.$t('Panels.WebcamPanel.Hud.Undock') : this.$t('Panels.WebcamPanel.Hud.Dock')
    }

    get dockButtonIcon() {
        if (this.docked) return mdiDockWindow

        switch (this.dockSideFromAnchor()) {
            case 'right':
                return mdiDockRight
            case 'top':
                return mdiDockTop
            case 'bottom':
                return mdiDockBottom
            default:
                return mdiDockLeft
        }
    }

    get browserFullscreenSupported() {
        return typeof document !== 'undefined' && document.fullscreenEnabled
    }

    get configuredAspectRatio(): number | null {
        const ratio = this.webcam.aspect_ratio ?? null
        if (!ratio) return null

        const parts = ratio.split(':')
        if (parts.length !== 2) return null

        const width = parseFloat(parts[0])
        const height = parseFloat(parts[1])
        if (!width || !height) return null

        return width / height
    }

    anchorStyle(anchor: HudAnchor): Record<string, string> {
        const margin = `${webcamHudMargin}px`
        const topClear = `${webcamHudMargin + actionBarHeight}px`

        switch (anchor) {
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

    // the bar that dropping on this edge would produce, drawn to scale while dragging so the
    // preview does not promise something else than the drop delivers
    barPreviewStyle(side: HudSide): Record<string, string> {
        const vertical = side === 'left' || side === 'right'
        const minimum = vertical ? webcamHudMinDockWidth : webcamHudMinDockHeight
        const free = vertical ? this.freeHorizontal : this.freeVertical
        const size = Math.round(Math.max(minimum, free))

        if (vertical) return { top: '0px', bottom: '0px', width: `${size}px`, [side]: '0px' }

        return { left: '0px', right: '0px', height: `${size}px`, [side]: '0px' }
    }

    // center point of every anchor slot for a card of the given size, in container coordinates
    anchorCenters(width: number, height: number): Record<HudAnchor, [number, number]> {
        const margin = webcamHudMargin
        const left = margin + width / 2
        const right = this.containerWidth - margin - width / 2
        const centerX = this.containerWidth / 2
        const top = margin + height / 2
        const bottom = this.containerHeight - margin - height / 2
        const centerY = this.containerHeight / 2

        return {
            'top-left': [left, top],
            'top-center': [centerX, top],
            'top-right': [right, top + actionBarHeight],
            'right-center': [right, centerY],
            'bottom-right': [right, bottom],
            'bottom-center': [centerX, bottom],
            'bottom-left': [left, bottom],
            'left-center': [left, centerY],
        }
    }

    nearestAnchor(centerX: number, centerY: number): HudAnchor {
        const centers = this.anchorCenters(this.dragSize.w, this.dragSize.h)

        let best: HudAnchor = this.anchor
        let bestDistance = Number.POSITIVE_INFINITY

        this.anchors.forEach((anchor) => {
            const [x, y] = centers[anchor]
            const distance = Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2)
            if (distance < bestDistance) {
                bestDistance = distance
                best = anchor
            }
        })

        return best
    }

    // dragging the hud right up against an edge means "put it into the bar there". The pointer
    // decides, not the card: the card is 420px wide, so its own position cannot tell the two
    // gestures apart.
    dockZoneAt(x: number, y: number): HudSide | null {
        const distance: Record<HudSide, number> = {
            left: x,
            right: this.containerWidth - x,
            top: y,
            bottom: this.containerHeight - y,
        }

        let best: HudSide | null = null
        let bestDistance = webcamHudDockZoneDepth

        for (const side of this.sides) {
            if (distance[side] < bestDistance) {
                bestDistance = distance[side]
                best = side
            }
        }

        return best
    }

    dockSideFromAnchor(): HudSide {
        if (this.anchor.includes('left')) return 'left'
        if (this.anchor.includes('right')) return 'right'
        if (this.anchor === 'top-center') return 'top'

        return 'bottom'
    }

    anchorForSide(side: HudSide): HudAnchor {
        switch (side) {
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

    mounted() {
        this.loadPlacement()

        document.addEventListener('fullscreenchange', this.fullscreenChanged)

        this.resizeObserver = new ResizeObserver(() => this.measureGeometry())
        this.resizeObserver.observe(this.container)

        // the natural size of the stream is only known once the first frame arrived, and the
        // streamers do not expose an event for it. re-measure a few times after opening.
        this.measureTimers = [100, 400, 1000, 2500, 5000].map((delay) =>
            window.setTimeout(() => this.measureGeometry(), delay)
        )
    }

    beforeDestroy() {
        document.removeEventListener('fullscreenchange', this.fullscreenChanged)
        this.resizeObserver?.disconnect()
        this.measureTimers.forEach((timer) => window.clearTimeout(timer))

        if (document.fullscreenElement !== null) {
            document.exitFullscreen().catch(() => {
                /* the browser may refuse, nothing to do about it */
            })
        }
    }

    /*
     * Measures the two inputs the layout is built from: the container, and the aspect ratio of
     * the frame inside it.
     *
     * It deliberately does NOT read the size of the image box. Docking now insets that box by
     * the width of the bar, so a measurement taken from it would feed back into itself: inset
     * applied -> box narrower -> no slack left -> dock dropped -> inset removed -> slack back.
     * The container is `position: fixed; inset: 0`, so its size depends on the viewport only,
     * and the ResizeObserver on it cannot be retriggered by our own layout.
     */
    measureGeometry() {
        const container = this.container
        if (!container) return

        this.containerWidth = container.clientWidth
        this.containerHeight = container.clientHeight
        // +16 for the 8px the bar is inset from the corner plus a little air, so a
        // top-docked row ends clear of the buttons rather than flush under them
        this.actionBarWidth = (this.actions?.offsetWidth ?? 0) + 16

        if (!this.measurable) {
            this.frameAspect = null
            return
        }

        const media = container.querySelector('img.webcamImage, video.webcamImage, video') as
            HTMLImageElement | HTMLVideoElement | null

        if (!media) {
            this.frameAspect = this.configuredAspectRatio
            return
        }

        let naturalWidth = 0
        let naturalHeight = 0

        if (media instanceof HTMLImageElement) {
            naturalWidth = media.naturalWidth
            naturalHeight = media.naturalHeight
        } else if (media instanceof HTMLVideoElement) {
            naturalWidth = media.videoWidth
            naturalHeight = media.videoHeight
        }

        // No frame yet - and with mjpegstreamer-adaptive that is not a startup-only state: the
        // img is re-pointed at a new snapshot several times a second, and it was measured at 0
        // seconds after a resize. So the configured aspect ratio is a real fallback, not just a
        // placeholder until the first frame.
        if (!naturalWidth || !naturalHeight) {
            media.addEventListener('load', this.onMediaLoaded, { once: true })
            media.addEventListener('loadedmetadata', this.onMediaLoaded, { once: true })

            this.frameAspect = this.configuredAspectRatio
            return
        }

        const rotation = this.webcam.rotation ?? 0
        if (rotation === 90 || rotation === 270) {
            const swap = naturalWidth
            naturalWidth = naturalHeight
            naturalHeight = swap
        }

        this.frameAspect = naturalWidth / naturalHeight
    }

    onMediaLoaded() {
        this.$nextTick(() => this.measureGeometry())
    }

    onPointerDown(event: PointerEvent) {
        // the chart keeps its own pointer handling (tooltip)
        if ((event.target as HTMLElement)?.closest?.('.webcam-hud-chart')) return
        if (this.dragging) return

        const card = this.hud
        const container = this.container
        if (!card || !container) return

        const cardRect = card.getBoundingClientRect()
        const containerRect = container.getBoundingClientRect()

        this.dragSize = { w: cardRect.width, h: cardRect.height }
        this.dragOffset = { x: event.clientX - cardRect.left, y: event.clientY - cardRect.top }
        this.dragPos = { x: cardRect.left - containerRect.left, y: cardRect.top - containerRect.top }
        this.dragSide = this.dockZoneAt(event.clientX - containerRect.left, event.clientY - containerRect.top)
        this.dragAnchor = this.nearestAnchor(this.dragPos.x + this.dragSize.w / 2, this.dragPos.y + this.dragSize.h / 2)
        this.dragPointerId = event.pointerId
        this.dragging = true

        card.setPointerCapture?.(event.pointerId)
        event.preventDefault()
    }

    onPointerMove(event: PointerEvent) {
        if (!this.dragging || event.pointerId !== this.dragPointerId) return

        const containerRect = this.container.getBoundingClientRect()
        const pointerX = event.clientX - containerRect.left
        const pointerY = event.clientY - containerRect.top
        const x = pointerX - this.dragOffset.x
        const y = pointerY - this.dragOffset.y

        this.dragPos = { x, y }
        this.dragSide = this.dockZoneAt(pointerX, pointerY)
        this.dragAnchor = this.nearestAnchor(x + this.dragSize.w / 2, y + this.dragSize.h / 2)
    }

    onPointerUp(event: PointerEvent) {
        if (!this.dragging || event.pointerId !== this.dragPointerId) return

        this.hud?.releasePointerCapture?.(event.pointerId)

        if (this.dragSide) {
            // dropped on an edge: into the bar there, whatever the automatic measurement thinks
            this.side = this.dragSide
            this.anchor = this.anchorForSide(this.dragSide)
            this.mode = 'dock'
            this.savePlacement()
        } else if (this.dragAnchor) {
            this.anchor = this.dragAnchor
            this.mode = 'float'
            this.savePlacement()
        }

        this.dragging = false
        this.dragAnchor = null
        this.dragSide = null
        this.dragPos = null
        this.dragPointerId = null
    }

    // the always available way in and out of the bar, for when dragging is awkward (touch) or
    // the automatic placement simply picked the other answer
    toggleDock() {
        if (this.docked) {
            this.mode = 'float'
        } else {
            this.mode = 'dock'
            this.side = this.dockSideFromAnchor()
        }

        this.savePlacement()
    }

    loadPlacement() {
        try {
            const raw = localStorage.getItem(hudPlacementKey)
            if (!raw) return

            const placement = JSON.parse(raw) as Partial<HudPlacement> & { pinned?: boolean }
            if (placement.anchor && this.anchors.includes(placement.anchor)) this.anchor = placement.anchor
            if (placement.side && this.sides.includes(placement.side)) this.side = placement.side

            if (placement.mode && ['auto', 'float', 'dock'].includes(placement.mode)) {
                this.mode = placement.mode
                return
            }

            // Entry from the previous version, which only knew `pinned`. A stored `pinned: true`
            // is dropped on purpose rather than translated to 'float': back then ANY drag set it,
            // and it then suppressed docking for good, at every window size. That is one of the
            // two ways to end up with "the overlay will not go into the black area", and the user
            // cannot tell it apart from the threshold bug or clear it without knowing about
            // localStorage. The chosen corner is kept, only the veto is dropped.
            this.mode = 'auto'
        } catch {
            // corrupt entry, keep the defaults
        }
    }

    savePlacement() {
        try {
            const placement: HudPlacement = { mode: this.mode, anchor: this.anchor, side: this.side }
            localStorage.setItem(hudPlacementKey, JSON.stringify(placement))
        } catch {
            // private mode / quota, the placement simply is not remembered
        }
    }

    // back to the automatic placement
    resetPlacement() {
        this.mode = 'auto'
        try {
            localStorage.removeItem(hudPlacementKey)
        } catch {
            // nothing to clean up
        }

        this.$nextTick(() => this.measureGeometry())
    }

    fullscreenChanged() {
        this.isBrowserFullscreen = document.fullscreenElement !== null
        this.$nextTick(() => this.measureGeometry())
    }

    async toggleBrowserFullscreen() {
        try {
            if (document.fullscreenElement === null) await this.container?.requestFullscreen()
            else await document.exitFullscreen()
        } catch {
            // the browser may refuse fullscreen (permission policy, ios safari). the page
            // already covers the viewport, so this is only a nice-to-have.
        }
    }

    // rotation or a different stream changes the letterboxing
    @Watch('webcam', { deep: true })
    webcamChanged() {
        this.$nextTick(() => this.measureGeometry())
    }
}
</script>

<style scoped>
.webcam-fullscreen {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 100;
    background: #000;
}

/*
 * The frame box, not the frame. It fills the overlay, except that docking insets it by the
 * width of the bar the hud takes - which is what collects the two letterbox bars into one.
 */
.webcam-fullscreen__stream {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
}

/*
 * `height: 100%` only resolves against a parent with a definite height. WebcamWrapper and
 * WebcamWrapperItem each add a plain auto-height div between the overlay and the image, so
 * without this the image falls back to `width: 100%` plus its natural aspect ratio, ends up
 * taller than the viewport and is cropped by the overflow of .webcamBackground.
 */
.webcam-fullscreen__stream ::v-deep > div,
.webcam-fullscreen__stream ::v-deep > div > div {
    height: 100%;
}

/*
 * the streamer components cap themselves at `calc(100vh - 155px)` to leave room for the
 * dashboard around them. here there is nothing else on screen, so the image may use the whole
 * viewport. !important is needed because the streamer sets that cap from its own scoped style
 * with the same specificity.
 */
.webcam-fullscreen__stream ::v-deep .webcamBackground {
    max-height: 100% !important;
    height: 100%;
    background: transparent;
}

.webcam-fullscreen__stream ::v-deep .webcamImage {
    width: 100%;
    height: 100%;
    /* never crop the print: letterbox instead */
    object-fit: contain;
}

.webcam-fullscreen__actions {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 4;
    display: flex;
    gap: 4px;
    padding: 2px;
    border-radius: 24px;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(6px);
}

.webcam-fullscreen__hud {
    position: absolute;
    z-index: 2;
    box-sizing: border-box;
    touch-action: none;
}

.webcam-fullscreen__hud--floating {
    width: 420px;
    max-width: calc(100% - 32px);
    cursor: grab;
}

.webcam-fullscreen__hud--docked {
    cursor: grab;
}

.webcam-fullscreen__hud--dragging {
    cursor: grabbing;
    opacity: 0.92;
    transition: none;
}

.webcam-fullscreen__snap {
    position: absolute;
    z-index: 3;
    width: 52px;
    height: 34px;
    border: 2px dashed rgba(255, 255, 255, 0.45);
    border-radius: 6px;
    pointer-events: none;
}

.webcam-fullscreen__snap--active {
    border-color: rgba(255, 255, 255, 0.95);
    background: rgba(255, 255, 255, 0.22);
}

.webcam-fullscreen__bar {
    position: absolute;
    z-index: 3;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px dashed rgba(255, 255, 255, 0.3);
    pointer-events: none;
}

.webcam-fullscreen__bar--active {
    border-color: rgba(255, 255, 255, 0.95);
    background: rgba(255, 255, 255, 0.18);
}

.webcam-fullscreen__bar-label {
    padding: 2px 8px;
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.5);
    color: rgba(255, 255, 255, 0.85);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    opacity: 0;
}

.webcam-fullscreen__bar--active .webcam-fullscreen__bar-label {
    opacity: 1;
}
</style>
