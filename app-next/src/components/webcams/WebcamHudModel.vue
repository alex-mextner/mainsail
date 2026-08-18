<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue'
import { mdiAlertOutline, mdiCameraRetake, mdiClose, mdiRotate3dVariant } from '@mdi/js'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import { usePrinterStore } from '@/stores/printer'
import { useCurrentFile } from '@/composables/useCurrentFile'
import { WEBCAM_HUD_MODEL_MIN_SIDE, WEBCAM_HUD_MODEL_RENDER_QUALITY } from '@/lib/webcam'

/**
 * The part being printed, in 3D, turnable with the mouse, in the middle of the
 * overlay bar -- between the readings and the temperature chart.
 *
 * It reuses the engine Mainsail already ships, `@sindarius/gcodeviewer`
 * (Babylon.js underneath), and NOT Mainsail's own /viewer wrapper. Everything
 * that made that wrapper hard to embed -- the file name read out of
 * `$route.query`, the height hard-wired to the viewport, the module-level
 * singleton plus a canvas cached in the store -- belongs to the wrapper and not
 * to the engine.
 *
 * What it costs, measured on this machine rather than assumed:
 *   code   330 kB gzipped (1.39 MB raw), behind a dynamic import, so a page
 *          that never turns the tile on never fetches it
 *   data   the whole g-code, because that is the only place the shape exists:
 *          3.99 MB raw is 1.13 MB on the wire (nginx gzips) in 0.45 s
 *   heap   +50 MB in the browser (98 MB -> 149 MB with a 4 MB file)
 *
 * The heap is why this is opt-in. /overcam is open permanently on the tablet at
 * the machine, so the tile shows the slicer thumbnail (13 kB, 19 ms) until
 * asked once, by a button that names the download size, and remembers the
 * answer per browser.
 */

const props = withDefaults(defineProps<{ minSide?: number }>(), { minSide: WEBCAM_HUD_MODEL_MIN_SIDE })

type ModelState = 'idle' | 'loading' | 'live' | 'error'

const OPT_IN_KEY = 'mainsail-next.webcamHudModelOptIn'

const printer = usePrinterStore()
const { meta, printStats, filename, thumbnailUrl } = useCurrentFile()

const root = ref<HTMLDivElement | null>(null)
const stage = ref<HTMLDivElement | null>(null)
const state = ref<ModelState>('idle')
const loadedFile = ref('')
const boxWidth = ref(0)
const boxHeight = ref(0)

/*
 * Deliberately NOT reactive refs: a Babylon viewer wrapped in Vue's reactivity
 * means the proxy walks the whole scene graph on every access. Plain module-
 * scoped-per-instance holders, cleared on unmount.
 */
let viewer: any = null
let canvas: HTMLCanvasElement | null = null
let observer: ResizeObserver | null = null
let gone = false

const fileSize = computed(() => meta.value?.size ?? 0)

/**
 * The tile is `flex-1 min-h-0`: it gets whatever the readings and the chart did
 * not want, and nothing else. Below the floor there is no scene worth drawing,
 * so nothing is drawn -- an empty frame is worse than no frame.
 */
const roomEnough = computed(() => boxWidth.value >= props.minSide && boxHeight.value >= props.minSide)

const sizeLabel = computed(() => {
    if (!fileSize.value) return ''
    const mb = fileSize.value / 1024 / 1024
    return mb >= 1 ? ` · ${mb.toFixed(1)} MB` : ` · ${(fileSize.value / 1024).toFixed(0)} kB`
})

const ctaLabel = computed(() => {
    if (state.value === 'loading') return 'Loading 3D model'
    if (state.value === 'error') return '3D model unavailable'
    return `Show in 3D${sizeLabel.value}`
})

function optedIn(): boolean {
    try {
        return window.localStorage.getItem(OPT_IN_KEY) === '1'
    } catch {
        return false
    }
}

function setOptedIn(value: boolean) {
    try {
        if (value) window.localStorage.setItem(OPT_IN_KEY, '1')
        else window.localStorage.removeItem(OPT_IN_KEY)
    } catch {
        /* private mode: the tile still works, it just forgets */
    }
}

/** Build volume, so the engine's bed matches this printer rather than its default. */
const bedMaxSize = computed<number[] | null>(() => {
    const settings = printer.config ?? {}
    const kinematics = String((settings.printer as Record<string, unknown>)?.kinematics ?? '')
    if (kinematics.includes('delta')) return null

    const axis = (name: string) => (settings[name] as Record<string, number> | undefined)?.position_max
    const x = axis('stepper_x')
    const y = axis('stepper_y')
    const z = axis('stepper_z')
    if (!x || !y || !z) return null

    return [x, y, z]
})

function measure() {
    const element = root.value
    if (!element) return

    const rect = element.getBoundingClientRect()
    boxWidth.value = Math.round(rect.width)
    boxHeight.value = Math.round(rect.height)

    // The canvas is absolutely positioned inside the stage and never takes part
    // in layout, so this can never feed back -- but Babylon still has to be told.
    if (state.value === 'live') viewer?.resize()
}

function attachCanvas() {
    if (!canvas || !stage.value) return
    if (canvas.parentElement !== stage.value) stage.value.appendChild(canvas)
}

async function ensureViewer() {
    if (viewer) {
        attachCanvas()
        return
    }

    // Dynamic: nothing of the engine is on the wire until this moment.
    const module = await import('@sindarius/gcodeviewer')
    if (gone) return

    const element = document.createElement('canvas')
    /*
     * Styled here, not in a class: `display: block` kills the inline line box,
     * absolute positioning keeps the canvas's pixel size out of the bar's
     * geometry entirely, and `touch-action: none` lets Babylon own the gesture.
     */
    element.style.cssText =
        'display:block;position:absolute;inset:0;width:100%;height:100%;outline:none;touch-action:none'
    canvas = element
    attachCanvas()

    const instance = new (module as any).default(element)
    await instance.init()
    if (gone) {
        disposeInstance(instance)
        return
    }

    /*
     * Fields, never the library's own `set...` / `update...` methods for the
     * same job: those persist to localStorage (renderQuality, sceneBackgroundColor,
     * bedLineColor, axesVisible, ...) and a 240px tile has no business deciding
     * what a full-page viewer renders at.
     */
    instance.renderQuality = WEBCAM_HUD_MODEL_RENDER_QUALITY
    instance.gcodeProcessor.setLiveTracking(false)
    /*
     * Not optional: the library only ever assigns scene.clipPlane from the render
     * observables of the meshes it marks "clip ignore" (the bed, the axes), so
     * with the untouched defaults the two planes clip away the one thing they
     * should not and the tile renders a black rectangle with the bed's "Back"
     * label floating in it. Sets scene fields only; nothing persists.
     */
    instance.setZClipPlane(1000000, -1000000)

    const bed = bedMaxSize.value
    if (bed) {
        instance.bed.buildVolume.x.max = bed[0]
        instance.bed.buildVolume.y.max = bed[1]
        instance.bed.buildVolume.z.max = bed[2]
    }

    viewer = instance
    watchCamera()
}

/*
 * The bed grid, the axis gizmo and the nozzle cursor are sized for a full page;
 * in a tile the size of a postage stamp they are all you can see. They are also
 * what wrecks the framing: the nozzle alone measured 220 mm of world extent
 * around a 190 mm part, because it sits at the origin and the part does not.
 * Turned off through calls that persist NOTHING.
 */
function hideScenery() {
    viewer?.bed?.bedMesh?.setEnabled(false)
    viewer?.axes?.axesMesh?.setEnabled(false)
    viewer?.setCursorVisiblity?.(false)
}

/*
 * The library's own resetCamera() frames the BED -- radius = 3 * bedCentre.x,
 * which on a 220 mm bed is 330 units of distance for a 30 mm cube. So point the
 * camera at the extents of what was actually loaded instead.
 */
function frameModel() {
    const scene = viewer?.scene
    const camera = scene?.activeCamera
    if (!scene || !camera) return

    const bed = viewer?.bed?.bedMesh
    const axes = viewer?.axes?.axesMesh

    let extents: { min: any; max: any } | null = null
    try {
        // isVisible as well as isEnabled: hiding the tool cursor only clears
        // isVisible, and an invisible nozzle that still counts is how this went
        // wrong the first time.
        extents = scene.getWorldExtends(
            (mesh: any) => mesh !== bed && mesh !== axes && mesh.isEnabled() && mesh.isVisible
        )
    } catch {
        extents = null
    }

    const span = extents
        ? Math.max(
              extents.max.x - extents.min.x,
              extents.max.y - extents.min.y,
              extents.max.z - extents.min.z
          )
        : 0

    if (!extents || !Number.isFinite(span) || span <= 0) {
        viewer.resetCamera()
        return
    }

    camera.target.copyFromFloats(
        (extents.min.x + extents.max.x) / 2,
        (extents.min.y + extents.max.y) / 2,
        (extents.min.z + extents.max.z) / 2
    )
    camera.alpha = Math.PI / 2
    camera.beta = 1.15
    // Babylon's default vertical fov is 0.8 rad, so the view is 0.845*r tall at
    // the target: 1.7 puts the longest side at about seven tenths of the tile.
    camera.radius = span * 1.7
    scene.render(true)
}

/*
 * The harness has to be able to tell "the pointer turned the model" from "the
 * pointer dragged the overlay out of its bar", and it reads the DOM rather than
 * the component -- the same rule the rest of the overcam checks follow. Written
 * straight to the attribute: an orbit fires this every frame.
 */
function watchCamera() {
    const camera = viewer?.scene?.activeCamera
    if (!camera?.onViewMatrixChangedObservable) return

    camera.onViewMatrixChangedObservable.add(() => {
        root.value?.setAttribute(
            'data-overcam-model-camera',
            `${camera.alpha.toFixed(3)},${camera.beta.toFixed(3)},${camera.radius.toFixed(1)}`
        )
    })
}

async function load() {
    if (state.value === 'loading' || state.value === 'live') return
    if (!filename.value) return

    state.value = 'loading'
    const wanted = filename.value

    // The printer can change the file out from under a load in progress. Give up
    // on the old one and go back to idle rather than sitting on 'loading' for
    // ever, which would leave a button nobody can press again.
    const stale = () => {
        if (!gone && filename.value !== wanted) state.value = 'idle'
        return gone || filename.value !== wanted
    }

    try {
        await ensureViewer()
        if (stale()) return

        const url = `/server/files/gcodes/${wanted.split('/').map(encodeURIComponent).join('/')}`
        const response = await fetch(url, { credentials: 'omit' })
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)

        const text = await response.text()
        if (stale() || !viewer) return

        await viewer.processFile(text)
        if (gone) return

        hideScenery()
        loadedFile.value = wanted
        state.value = 'live'
        setOptedIn(true)

        await nextTick()
        viewer.resize()
        frameModel()
    } catch (error) {
        // A file deleted while print_stats still names it, a printer that went
        // away, a diagnostic g-code with no extrusion at all (which the renderer
        // genuinely throws on): all of them end here, quietly, on the thumbnail.
        if (gone) return
        state.value = 'error'
        window.console.warn(
            '[overcam] 3D model could not be loaded:',
            error instanceof Error ? (error.stack ?? error.message) : error
        )
    }
}

/** "Not now" rather than "never": back to the thumbnail until asked again. */
function unload() {
    setOptedIn(false)
    state.value = 'idle'
    loadedFile.value = ''
    viewer?.clearScene(true)
}

/*
 * Auto-load is gated on three things, each deliberate:
 *   - the opt-in has been given once, by a click that named the download size
 *   - the metadata is in (without it there is no size and no thumbnail)
 *   - the print is actually under way, so a 4 MB read never lands in the
 *     start-of-print burst on the same SD card
 */
function maybeAutoLoad() {
    if (!optedIn() || state.value !== 'idle') return
    if (!filename.value || !roomEnough.value) return
    if (!meta.value) return

    const stats = printStats.value
    const printing = stats?.state === 'printing' || stats?.state === 'paused'
    if (printing && (stats?.print_duration ?? 0) <= 0) return

    void load()
}

function disposeInstance(instance: any) {
    if (!instance) return
    try {
        instance.scene?.dispose()
    } catch {
        /* already gone */
    }
    try {
        instance.engine?.stopRenderLoop?.()
        instance.engine?.dispose()
    } catch {
        /* already gone */
    }
}

watch(filename, () => {
    if (loadedFile.value && filename.value !== loadedFile.value) {
        state.value = 'idle'
        loadedFile.value = ''
        viewer?.clearScene(true)
    }
    maybeAutoLoad()
})

/*
 * The metadata always lands AFTER the file name: the front end only asks
 * Moonraker for it once print_stats names something new. Without this the one
 * chance to auto-load falls in the gap and nothing ever looks again -- which on
 * a page left open at the machine is every single print.
 */
watch(meta, () => maybeAutoLoad())

watch(roomEnough, (room) => {
    if (room) {
        void nextTick(() => {
            attachCanvas()
            viewer?.resize()
            maybeAutoLoad()
        })
        return
    }
    // the stage left the DOM; keep the engine but let go of its canvas
    canvas?.remove()
})

/*
 * The root element is behind `v-if="filename"`, so on a page opened while the
 * printer has nothing loaded there is no element to observe at mount time - and
 * when a file finally appears, an observer attached once in onMounted would
 * still be watching nothing. Then boxWidth stays 0, roomEnough stays false, and
 * the tile silently never draws. Re-attach whenever the element itself changes.
 */
watch(root, (element) => {
    observer?.disconnect()
    if (!element) return

    observer ??= new ResizeObserver(() => measure())
    observer.observe(element)
    measure()
    maybeAutoLoad()
})

onMounted(() => {
    observer = new ResizeObserver(() => measure())
    if (root.value) {
        observer.observe(root.value)
        measure()
    }
    maybeAutoLoad()
})

onBeforeUnmount(() => {
    gone = true
    observer?.disconnect()
    observer = null
    // The top-level class of @sindarius/gcodeviewer has no dispose() of its own
    // -- only its Bed and Axes helpers do -- so the engine goes by hand. Without
    // this every trip through /overcam leaks a webgl context, and browsers cap
    // those (tablets lowest).
    disposeInstance(viewer)
    viewer = null
    canvas?.remove()
    canvas = null
})
</script>

<template>
    <div
        v-if="filename"
        ref="root"
        class="relative my-2 min-h-0 min-w-0 flex-1 overflow-hidden"
        data-overcam-model
        :data-overcam-model-state="state"
        :data-overcam-model-file="filename">
        <!--
            Below the floor the tile still holds its share of the bar -- that is
            what pushes the chart to the bottom -- but draws nothing.
        -->
        <template v-if="roomEnough">
            <!--
                Always in the layout, never v-show'n away: Babylon reads the
                canvas size when the engine is created, and a canvas inside
                `display: none` is 0x0.
            -->
            <div ref="stage" class="absolute inset-0">
                <div v-if="state === 'live'" class="absolute top-0.5 left-0.5 z-2 flex gap-0.5 opacity-35 hover:opacity-100">
                    <button
                        type="button"
                        class="flex size-[26px] items-center justify-center rounded bg-black/45"
                        data-overcam-model-reset
                        title="Frame the model again"
                        @click="frameModel">
                        <MdiIcon :path="mdiCameraRetake" class="size-4 text-white" />
                    </button>
                    <button
                        type="button"
                        class="flex size-[26px] items-center justify-center rounded bg-black/45"
                        data-overcam-model-hide
                        title="Hide the 3D model"
                        @click="unload">
                        <MdiIcon :path="mdiClose" class="size-4 text-white" />
                    </button>
                </div>
            </div>

            <!--
                Idle, loading and error all show the slicer thumbnail, which is
                already in the g-code and costs 13 kB. The button on top of it is
                the ONE explicit click that buys the 3D scene, and it says what
                that click costs.
            -->
            <button
                v-if="state !== 'live'"
                type="button"
                class="absolute inset-0 z-1 flex size-full items-center justify-center bg-black/85"
                data-overcam-model-load
                :disabled="state === 'loading'"
                title="Download the g-code and show the part in 3D. Drag it with the mouse to turn it."
                @click="load">
                <img v-if="thumbnailUrl" :src="thumbnailUrl" :alt="filename" class="max-h-full max-w-full object-contain opacity-75" />
                <span
                    class="flex max-w-full items-center gap-1.5 rounded-xl bg-black/60 px-2.5 py-0.5 text-[0.7rem] tracking-[0.04em] whitespace-nowrap text-white"
                    :class="thumbnailUrl ? 'absolute bottom-1 left-1/2 -translate-x-1/2' : ''">
                    <MdiIcon :path="state === 'error' ? mdiAlertOutline : mdiRotate3dVariant" class="size-4" />
                    <span class="overflow-hidden text-ellipsis">{{ ctaLabel }}</span>
                </span>
            </button>
        </template>
    </div>
</template>
