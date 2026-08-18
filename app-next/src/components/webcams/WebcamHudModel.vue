<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue'
import { mdiAlertOutline, mdiCameraRetake, mdiClose, mdiCubeOffOutline, mdiRotate3dVariant } from '@mdi/js'
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

// 'empty' is not a failure: the file was read, and it genuinely has no shape in
// it. Kept apart from 'error' because the two need different words - see ctaLabel.
type ModelState = 'idle' | 'loading' | 'live' | 'empty' | 'error'

const OPT_IN_KEY = 'mainsail-next.webcamHudModelOptIn'

/*
 * Does this file ever push filament?
 *
 * It has to be answered from the g-code itself, because Moonraker's metadata
 * cannot answer it: `endurance_v300.gcode` on this machine is a real Orca print
 * with every E word stripped out for a motion test, and it reports the SAME
 * `filament_total: 4662.23` as the print it was made from - the header comments
 * the estimate is read from survived the stripping. Measured 2026-08-18, both
 * files, the same number to the second decimal.
 *
 * The scan stops at the first extruding move, so a real print costs almost
 * nothing (3.8 MB `cube_accel4000.gcode`: 0.03 ms); only a file that has none is
 * read to the end, and the largest one here, 3.0 MB of pure motion, takes < 10 ms.
 *
 * Deliberately narrow: it says "no move in this file ever advances the extruder",
 * which is exactly the sentence the tile then puts on the screen. Anything
 * subtler - a file with moves the renderer still cannot turn into geometry - is
 * left to the catch below and keeps saying "unavailable", because for that case
 * "there is nothing to draw" would be a guess.
 *
 * No whitespace is required in front of the E. Every slicer spaces its words and
 * every file on this machine does too (checked), but `G1X10E5` is legal g-code and
 * klipper takes it - and the diagnostics here are written by hand. Requiring the
 * space would answer "no extrusion" for a file that has plenty, which is a worse
 * lie than the one being fixed. It cannot over-match either: the search is anchored
 * to a G0/G1 and stops at the comment, so everything it walks is that move's own
 * words, where E means the extruder and nothing else.
 */
const EXTRUDING_MOVE = /(?:^|\n)[ \t]*[gG](?:0|1|00|01)(?![0-9.])[^;\n]*?[eE](-?[0-9]*\.?[0-9]+)/g

function hasExtrusion(gcode: string): boolean {
    EXTRUDING_MOVE.lastIndex = 0

    let match: RegExpExecArray | null
    while ((match = EXTRUDING_MOVE.exec(gcode)) !== null) {
        if (Number(match[1]) > 0) return true
    }

    return false
}

/*
 * The g-code roles OrcaSlicer writes that @sindarius/gcodeviewer 3.7.17 has no
 * entry for.
 *
 * The library keeps one colour table per slicer (`SlicerSpecific/*.js`) and looks
 * the `;TYPE:` value up in it. A value that is not in the table makes
 * `isPerimeter()` and `isSupport()` throw on `featureList[undefined].perimeter`;
 * the library catches that and calls `reportMissingFeature()`, which writes
 * **console.error**. Nothing else happens - the segment is drawn in fallback grey.
 *
 * That one red line is why this was reported as "the 3D model does not load": the
 * console showed `Missing feature Brim` and nothing else obvious, on a file that
 * also happened to have no extrusion. The two are unrelated.
 *
 * The names are not guessed - they are `ExtrusionEntity::role_to_string()` in
 * OrcaSlicer's own source (`src/libslic3r/ExtrusionEntity.cpp`), the function that
 * writes the `;TYPE:` comment. Of its twenty roles the library knows fourteen;
 * these are the six it does not, each pointed at the entry the library already has
 * for the closest role, so no colour is invented here and the perimeter/support
 * flags come from a real entry.
 */
const ORCA_FEATURE_ALIASES: Record<string, string> = {
    Brim: 'Skirt',
    Ironing: 'Top surface',
    'Gap infill': 'Internal solid infill',
    'Support transition': 'Support interface',
    Multiple: 'Custom',
    Undefined: 'Custom',
}

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
    if (state.value === 'empty') return 'Nothing to show in 3D: this file has no extrusion moves'
    if (state.value === 'error') return '3D model unavailable'
    return `Show in 3D${sizeLabel.value}`
})

const ctaIcon = computed(() => {
    if (state.value === 'empty') return mdiCubeOffOutline
    if (state.value === 'error') return mdiAlertOutline
    return mdiRotate3dVariant
})

const ctaTitle = computed(() =>
    state.value === 'empty'
        ? 'The whole g-code was read and no move in it feeds filament, so there is no shape to draw. This is normal for motion and calibration files.'
        : 'Download the g-code and show the part in 3D. Drag it with the mouse to turn it.'
)

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
    teachOrcaFeatures(instance.gcodeProcessor)
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
 * Teach the library the OrcaSlicer roles it does not know (ORCA_FEATURE_ALIASES).
 *
 * There is no public seam for this: the slicer object is built inside
 * processFile(), from a factory the package does not export, and thrown away on
 * the next file. So the FIELD it lands in is intercepted - `gcodeProcessor.slicer`
 * is a plain data property, and an accessor put on the instance sees every
 * assignment the library makes to it, in time to fill the table in before a single
 * `;TYPE:` line is looked up. Nothing is patched on a prototype, so no other user
 * of the package is affected.
 *
 * The entries are copied from ones the library already ships, so the
 * perimeter/support flags stay meaningful and no colour is invented; the Color4 is
 * cloned rather than shared, because the processor hands these objects out and a
 * shared one would tint two roles at once if anything ever wrote to it.
 *
 * reportMissingFeature() is replaced as well - not silenced. A role nobody has an
 * entry for is still worth knowing about, but it is a COLOUR falling back to grey,
 * and the library reports it with console.error. That single red line is what made
 * this look like a crashed viewer; it is now a console.debug that says what
 * actually happened.
 */
function teachOrcaFeatures(processor: any) {
    if (!processor) return

    let slicer: any = null
    try {
        Object.defineProperty(processor, 'slicer', {
            configurable: true,
            enumerable: true,
            get: () => slicer,
            set: (value: any) => {
                slicer = value
                if (!value) return

                const list = value.featureList
                if (list) {
                    for (const [role, alias] of Object.entries(ORCA_FEATURE_ALIASES)) {
                        if (Object.prototype.hasOwnProperty.call(list, role)) continue

                        const template = list[alias]
                        if (!template) continue

                        list[role] = { ...template, color: template.color?.clone?.() ?? template.color }
                    }
                }

                value.reportMissingFeature = (feature: string) => {
                    if (value.missingFeatures?.includes(feature)) return

                    value.missingFeatures?.push(feature)
                    window.console.debug(`[overcam] g-code feature drawn in the fallback grey: ${feature}`)
                }
            },
        })
    } catch {
        /* the library changed shape: the tile still works, it is just noisier */
    }
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
        ? Math.max(extents.max.x - extents.min.x, extents.max.y - extents.min.y, extents.max.z - extents.min.z)
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
        const url = `/server/files/gcodes/${wanted.split('/').map(encodeURIComponent).join('/')}`
        const response = await fetch(url, { credentials: 'omit' })
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)

        const text = await response.text()
        if (stale()) return

        /*
         * Read the file BEFORE the engine, and go no further when there is nothing
         * in it to draw. Half the g-code on this machine is a motion diagnostic
         * with the extruder never touched, and handing one of those to the library
         * throws inside babylon's CreateLineSystem - which used to land here as a
         * bare "3D model unavailable", i.e. as if something were broken. It is not:
         * there is simply no shape in the file, and the tile now says so.
         *
         * Bailing out here also means the 320 kB engine is never fetched and 4 MB
         * are never parsed for a file that has no geometry in it.
         */
        if (!hasExtrusion(text)) {
            loadedFile.value = wanted
            state.value = 'empty'
            // the click was answered, so the next file still auto-loads
            setOptedIn(true)
            return
        }

        await ensureViewer()
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
        // away, a browser without webgl: all of them end here, quietly, on the
        // thumbnail. "The file has no geometry in it" is NOT one of them any more -
        // that is caught above and gets its own words, because it is not a fault.
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
                <div
                    v-if="state === 'live'"
                    class="absolute top-0.5 left-0.5 z-2 flex gap-0.5 opacity-35 hover:opacity-100">
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
                Idle, loading, empty and error all show the slicer thumbnail, which
                is already in the g-code and costs 13 kB. The button on top of it is
                the ONE explicit click that buys the 3D scene, and it says what that
                click costs.

                'empty' is disabled on purpose: the file has been read and there is
                provably nothing in it to draw, so pressing again would only
                download it a second time. It stops being a button and becomes a
                caption - which is the point, since a thumbnail with no explanation
                is exactly what got read as "it is broken".
            -->
            <button
                v-if="state !== 'live'"
                type="button"
                class="absolute inset-0 z-1 flex size-full items-center justify-center bg-black/85"
                data-overcam-model-load
                :disabled="state === 'loading' || state === 'empty'"
                :title="ctaTitle"
                @click="load">
                <!--
                    draggable="false" is not cosmetic. An <img> is a native drag
                    source: pressing on the thumbnail and moving starts the
                    browser's own drag-and-drop with a ghost image, and while that
                    gesture is running every following click is swallowed - so the
                    button stops responding until the page is clicked somewhere
                    else. Reproduced with a real pointer; that press-and-move is
                    exactly what someone tries when they see a picture and expect
                    to be able to turn it.
                -->
                <img
                    v-if="thumbnailUrl"
                    :src="thumbnailUrl"
                    :alt="filename"
                    draggable="false"
                    class="max-h-full max-w-full [-webkit-user-drag:none] object-contain opacity-75 select-none" />
                <!--
                    "Show in 3D · 4.0 MB" is three words and stays on one line,
                    ellipsised when the bar is narrow. The empty-file message is a
                    SENTENCE, and a sentence cut off at "this file has no…" explains
                    nothing - which is the one thing that state exists to do. So it
                    wraps instead, and is given the room to.
                -->
                <span
                    class="flex max-w-full items-center gap-1.5 rounded-xl bg-black/60 px-2.5 py-0.5 text-[0.7rem] tracking-[0.04em] text-white"
                    :class="[
                        thumbnailUrl ? 'absolute bottom-1 left-1/2 -translate-x-1/2' : '',
                        state === 'empty'
                            ? 'max-w-[calc(100%-1rem)] text-center leading-tight whitespace-normal'
                            : 'whitespace-nowrap',
                    ]">
                    <MdiIcon :path="ctaIcon" class="size-4 shrink-0" />
                    <span :class="state === 'empty' ? '' : 'overflow-hidden text-ellipsis'">{{ ctaLabel }}</span>
                </span>
            </button>
        </template>
    </div>
</template>
