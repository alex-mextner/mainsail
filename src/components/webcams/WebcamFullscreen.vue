<template>
    <div ref="container" class="webcam-fullscreen">
        <div class="webcam-fullscreen__stream">
            <webcam-wrapper :webcam="webcam" :show-fps="false" page="fullscreen" />
        </div>

        <div class="webcam-fullscreen__actions">
            <v-btn v-if="pinned" icon dark :title="$t('Panels.WebcamPanel.Hud.ResetPosition')" @click="resetPlacement">
                <v-icon>{{ mdiPinOffOutline }}</v-icon>
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

        <!-- the eight positions the hud snaps to, only while it is being dragged -->
        <template v-if="dragging">
            <div
                v-for="anchorName in anchors"
                :key="anchorName"
                class="webcam-fullscreen__snap"
                :class="{ 'webcam-fullscreen__snap--active': anchorName === dragAnchor }"
                :style="anchorStyle(anchorName)" />
        </template>

        <div
            v-if="showHud"
            ref="hud"
            class="webcam-fullscreen__hud"
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
import { webcamHudMargin, webcamHudMinDockHeight, webcamHudMinDockWidth } from '@/store/variables'
import { mdiClose, mdiEyeOffOutline, mdiEyeOutline, mdiFullscreen, mdiFullscreenExit, mdiPinOffOutline } from '@mdi/js'

type HudAnchor =
    | 'top-left'
    | 'top-center'
    | 'top-right'
    | 'right-center'
    | 'bottom-right'
    | 'bottom-center'
    | 'bottom-left'
    | 'left-center'

interface HudPlacement {
    pinned: boolean
    anchor: HudAnchor
}

// The placement is stored per browser, not in the moonraker database: which corner is free
// depends on the screen the user is looking at (phone, tablet at the printer, desktop), and
// the docked default is recomputed from the window size anyway. Mainsail already keeps this
// kind of per-device view state in localStorage (see naviDrawer in store/mutations.ts).
const hudPlacementKey = 'webcamHudPlacement'

// The action buttons live in the top right corner, so the hud keeps clear of them there.
const actionBarHeight = 56

// Streams that render into an iframe cannot be measured for letterboxing (cross origin), and
// the black bars are inside the iframe rather than around it.
const unmeasurableServices = ['iframe']

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

    showHud = true
    isBrowserFullscreen = false

    // user placement
    pinned = false
    anchor: HudAnchor = 'bottom-left'

    // measured geometry of the black bars around the image
    dockMode: 'none' | 'vertical' | 'horizontal' = 'none'
    dockSize = 0
    containerWidth = 0
    containerHeight = 0

    // drag state
    dragging = false
    dragAnchor: HudAnchor | null = null
    dragPointerId: number | null = null
    dragPos: { x: number; y: number } | null = null
    dragOffset = { x: 0, y: 0 }
    dragSize = { w: 0, h: 0 }

    resizeObserver: ResizeObserver | null = null
    measureTimers: number[] = []

    get docked() {
        return !this.pinned && this.dockMode !== 'none'
    }

    get hudLayout() {
        if (!this.docked) return 'floating'

        return this.dockMode
    }

    get hudClasses() {
        return {
            'webcam-fullscreen__hud--floating': !this.docked,
            'webcam-fullscreen__hud--docked': this.docked,
            'webcam-fullscreen__hud--dragging': this.dragging,
        }
    }

    // a very short window cannot show the chart and the numbers at the same time
    get showChart() {
        return this.containerHeight >= 320
    }

    get hudChartHeight() {
        if (this.docked && this.dockMode === 'horizontal') {
            return Math.min(150, Math.max(56, this.dockSize - 24))
        }

        if (this.docked && this.dockMode === 'vertical') {
            return Math.min(240, Math.max(90, Math.round(this.containerHeight * 0.28)))
        }

        return 110
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

        if (this.docked && this.dockMode === 'vertical') {
            return { top: '0px', bottom: '0px', left: '0px', width: `${this.dockSize}px` }
        }

        if (this.docked && this.dockMode === 'horizontal') {
            return { left: '0px', right: '0px', bottom: '0px', height: `${this.dockSize}px` }
        }

        return this.anchorStyle(this.anchor)
    }

    get hudButtonTitle() {
        return this.showHud ? this.$t('Panels.WebcamPanel.Hud.HideHud') : this.$t('Panels.WebcamPanel.Hud.ShowHud')
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

    measureGeometry() {
        const container = this.container
        if (!container) return

        this.containerWidth = container.clientWidth
        this.containerHeight = container.clientHeight

        if (unmeasurableServices.includes(this.webcam.service ?? '')) {
            this.dockMode = 'none'
            return
        }

        const media = container.querySelector('img.webcamImage, video.webcamImage, video') as
            HTMLImageElement | HTMLVideoElement | null

        const boxWidth = media?.offsetWidth ?? 0
        const boxHeight = media?.offsetHeight ?? 0
        if (!media || !boxWidth || !boxHeight) {
            this.dockMode = 'none'
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

        // no frame yet: re-measure as soon as one arrives, the configured aspect ratio is only
        // a stand-in until then (the streamers do not emit an event of their own)
        if (!naturalWidth || !naturalHeight) {
            media.addEventListener('load', this.onMediaLoaded, { once: true })
            media.addEventListener('loadedmetadata', this.onMediaLoaded, { once: true })

            const ratio = this.configuredAspectRatio
            if (!ratio) {
                this.dockMode = 'none'
                return
            }

            naturalWidth = ratio
            naturalHeight = 1
        }

        const rotation = this.webcam.rotation ?? 0
        if (rotation === 90 || rotation === 270) {
            const swap = naturalWidth
            naturalWidth = naturalHeight
            naturalHeight = swap
        }

        // object-fit: contain - the painted image is the largest box with the stream aspect
        // ratio that fits into the element box
        const scale = Math.min(boxWidth / naturalWidth, boxHeight / naturalHeight)
        const paintedWidth = naturalWidth * scale
        const paintedHeight = naturalHeight * scale

        let offsetLeft = 0
        let offsetTop = 0
        let element: HTMLElement | null = media
        while (element && element !== container) {
            offsetLeft += element.offsetLeft
            offsetTop += element.offsetTop
            element = element.offsetParent as HTMLElement | null
        }

        const sideBar = offsetLeft + (boxWidth - paintedWidth) / 2
        const bottomBar = this.containerHeight - (offsetTop + (boxHeight + paintedHeight) / 2)

        if (sideBar >= webcamHudMinDockWidth) {
            this.dockMode = 'vertical'
            this.dockSize = Math.floor(sideBar)
            return
        }

        if (bottomBar >= webcamHudMinDockHeight) {
            this.dockMode = 'horizontal'
            this.dockSize = Math.floor(bottomBar)
            return
        }

        this.dockMode = 'none'
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
        this.dragAnchor = this.nearestAnchor(this.dragPos.x + this.dragSize.w / 2, this.dragPos.y + this.dragSize.h / 2)
        this.dragPointerId = event.pointerId
        this.dragging = true

        card.setPointerCapture?.(event.pointerId)
        event.preventDefault()
    }

    onPointerMove(event: PointerEvent) {
        if (!this.dragging || event.pointerId !== this.dragPointerId) return

        const containerRect = this.container.getBoundingClientRect()
        const x = event.clientX - containerRect.left - this.dragOffset.x
        const y = event.clientY - containerRect.top - this.dragOffset.y

        this.dragPos = { x, y }
        this.dragAnchor = this.nearestAnchor(x + this.dragSize.w / 2, y + this.dragSize.h / 2)
    }

    onPointerUp(event: PointerEvent) {
        if (!this.dragging || event.pointerId !== this.dragPointerId) return

        this.hud?.releasePointerCapture?.(event.pointerId)

        if (this.dragAnchor) {
            this.anchor = this.dragAnchor
            this.pinned = true
            this.savePlacement()
        }

        this.dragging = false
        this.dragAnchor = null
        this.dragPos = null
        this.dragPointerId = null
    }

    loadPlacement() {
        try {
            const raw = localStorage.getItem(hudPlacementKey)
            if (!raw) return

            const placement = JSON.parse(raw) as HudPlacement
            if (!this.anchors.includes(placement.anchor)) return

            this.pinned = placement.pinned === true
            this.anchor = placement.anchor
        } catch {
            // corrupt entry, keep the defaults
        }
    }

    savePlacement() {
        try {
            localStorage.setItem(hudPlacementKey, JSON.stringify({ pinned: this.pinned, anchor: this.anchor }))
        } catch {
            // private mode / quota, the placement simply is not remembered
        }
    }

    // back to the automatic placement in the black bar
    resetPlacement() {
        this.pinned = false
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
    display: flex;
    align-items: center;
    justify-content: center;
    background: #000;
}

.webcam-fullscreen__stream {
    width: 100%;
    height: 100%;
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
</style>
