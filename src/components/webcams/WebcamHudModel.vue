<template>
    <div
        v-if="filename"
        ref="root"
        class="webcam-hud-model"
        data-overcam-model
        :data-overcam-model-state="state"
        :data-overcam-model-file="filename">
        <!--
            Below the floor the tile still holds its share of the bar (that is what pushes the
            chart to the bottom), but draws nothing: a 60px sliver of a 3D scene is noise, and
            an empty frame is exactly what requirement "be quiet when there is nothing" rules
            out. Same when the printer has no file at all - then the whole element is gone.
        -->
        <template v-if="roomEnough">
            <!--
                The stage is always in the layout, never `v-show`n away: babylon reads the
                canvas size when the engine is created, and a canvas inside `display: none` is
                0x0 - which is how the first working version ended up rendering the scene into
                a 40px corner. It costs nothing to keep: until the model is live it is a black
                rectangle behind the preview, on a black bar.
            -->
            <div ref="stage" class="webcam-hud-model__stage">
                <div v-if="state === 'live'" class="webcam-hud-model__tools">
                    <button
                        type="button"
                        class="webcam-hud-model__tool"
                        data-overcam-model-reset
                        :title="$t('Panels.WebcamPanel.Hud.ModelReset')"
                        @click="frameModel">
                        <v-icon small dark>{{ mdiCameraRetake }}</v-icon>
                    </button>
                    <button
                        type="button"
                        class="webcam-hud-model__tool"
                        data-overcam-model-hide
                        :title="$t('Panels.WebcamPanel.Hud.ModelHide')"
                        @click="unload">
                        <v-icon small dark>{{ mdiClose }}</v-icon>
                    </button>
                </div>
            </div>

            <!--
                Idle / loading / empty / error all show the slicer thumbnail, which is already
                in the gcode and costs 13 kB. The button on top of it is the ONE explicit click
                that buys the 3D scene, and it says what that click costs.

                'empty' is disabled on purpose: the file has been read and there is provably
                nothing in it to draw, so pressing again would only download it a second time.
                It stops being a button and becomes a caption - which is the whole point, since
                a thumbnail with no explanation is exactly what got read as "it is broken".
            -->
            <button
                v-if="state !== 'live'"
                type="button"
                class="webcam-hud-model__preview"
                :class="{ 'webcam-hud-model__preview--bare': !thumbnail }"
                data-overcam-model-load
                :disabled="state === 'loading' || state === 'empty'"
                :title="loadTitle"
                @click="load">
                <!--
                    draggable="false" is not cosmetic. An <img> is a native drag
                    source: pressing on the thumbnail and moving starts the
                    browser's own drag-and-drop with a ghost image, and while
                    that gesture is running every following click is swallowed -
                    so the button stops responding until the page is clicked
                    somewhere else. Reproduced with a real pointer; the same
                    press-and-move is exactly what someone tries when they see a
                    picture and expect to turn it.
                -->
                <img
                    v-if="thumbnail"
                    class="webcam-hud-model__thumb"
                    :src="thumbnail"
                    :alt="filename"
                    draggable="false" />
                <span class="webcam-hud-model__cta" :class="{ 'webcam-hud-model__cta--wrap': state === 'empty' }">
                    <v-progress-circular v-if="state === 'loading'" indeterminate size="18" width="2" color="white" />
                    <v-icon v-else small dark>{{ ctaIcon }}</v-icon>
                    <!--
                        The empty message is a whole sentence, so it is allowed to wrap and to
                        take the width it needs; every other label here is two or three words.
                    -->
                    <span class="webcam-hud-model__cta-text">{{ ctaLabel }}</span>
                </span>
            </button>
        </template>
    </div>
</template>

<script lang="ts">
import Component from 'vue-class-component'
import { Mixins, Ref, Watch } from 'vue-property-decorator'
import BaseMixin from '@/components/mixins/base'
import { escapePath, formatFilesize } from '@/plugins/helpers'
import { FileStateFileThumbnail } from '@/store/files/types'
import { webcamHudModelMinSide, webcamHudModelRenderQuality } from '@/store/variables'
import { mdiAlertOutline, mdiCameraRetake, mdiClose, mdiCubeOffOutline, mdiRotate3dVariant } from '@mdi/js'
import type { GCodeViewerInstance } from '@/store/gcodeviewer/types'

// 'empty' is not a failure: the file was read, and it genuinely has no shape in it.
// It is kept apart from 'error' because the two need different words - see ctaLabel.
type ModelState = 'idle' | 'loading' | 'live' | 'empty' | 'error'

// Whether the user has already paid the one explicit click. Per browser, like the hud
// placement next to it: the tablet at the machine wants the model up permanently, a phone
// looking in over mobile data does not, and that is a property of the device, not of the
// printer. Once it is on, every following file loads by itself - the click is a decision,
// not a chore to repeat.
const modelOptInKey = 'webcamHudModelOptIn'

/*
 * Does this file ever push filament?
 *
 * It has to be answered from the g-code itself, because Moonraker's metadata cannot answer
 * it: `endurance_v300.gcode` on this machine is a real Orca print with every E word stripped
 * out for a motion test, and it reports the SAME `filament_total: 4662.23` as the print it
 * was made from - the header comments the estimate is read from survived the stripping.
 * Measured 2026-08-18, both files, same number to the second decimal.
 *
 * The scan stops at the first extruding move, so a real print costs a few kilobytes of regexp
 * (3.8 MB `cube_accel4000.gcode`: 0.1 ms); only a file that has none is read to the end, and
 * the largest one on this machine, 3.0 MB of pure motion, takes 9.5 ms. Both measured.
 *
 * Deliberately narrow: it says "no move in this file ever advances the extruder", which is
 * exactly the sentence the tile then puts on the screen. Anything subtler - a file with
 * moves the renderer still cannot turn into geometry - is left to the catch below and keeps
 * saying "unavailable", because for that case "there is nothing to draw" would be a guess.
 */
const extrudingMove = /(?:^|\n)[ \t]*[gG](?:0|1|00|01)(?![0-9.])[^;\n]*?[ \t][eE](-?[0-9]*\.?[0-9]+)/g

function hasExtrusion(gcode: string): boolean {
    extrudingMove.lastIndex = 0

    let match: RegExpExecArray | null
    while ((match = extrudingMove.exec(gcode)) !== null) {
        if (Number(match[1]) > 0) return true
    }

    return false
}

/*
 * The g-code roles OrcaSlicer writes that @sindarius/gcodeviewer 3.7.17 has no entry for.
 *
 * The library keeps one colour table per slicer (`SlicerSpecific/*.js`) and looks the
 * `;TYPE:` value up in it. A value that is not in the table makes `isPerimeter()` and
 * `isSupport()` throw on `featureList[undefined].perimeter`; the library catches that and
 * calls `reportMissingFeature()`, which writes **console.error**. Nothing else happens - the
 * segment is simply drawn in the fallback grey.
 *
 * That one red line is why this bug was reported as "the 3D model does not load": the user's
 * console showed `Missing feature Brim` and nothing else obvious, on a file that also
 * happened to have no extrusion. The two are unrelated. Registering the roles removes the
 * red herring AND gives the brim a colour.
 *
 * The names are not guessed - they are `ExtrusionEntity::role_to_string()` in OrcaSlicer's
 * own source (`src/libslic3r/ExtrusionEntity.cpp`), which is the function that writes the
 * `;TYPE:` comment. Of its twenty roles the library knows fourteen; these are the six it
 * does not, each pointed at the entry the library already has for the closest role, so no
 * colour is invented here and the `perimeter`/`support` flags come from a real entry.
 */
const orcaFeatureAliases: Record<string, string> = {
    Brim: 'Skirt',
    Ironing: 'Top surface',
    'Gap infill': 'Internal solid infill',
    'Support transition': 'Support interface',
    Multiple: 'Custom',
    Undefined: 'Custom',
}

@Component
export default class WebcamHudModel extends Mixins(BaseMixin) {
    mdiAlertOutline = mdiAlertOutline
    mdiCameraRetake = mdiCameraRetake
    mdiClose = mdiClose
    mdiCubeOffOutline = mdiCubeOffOutline
    mdiRotate3dVariant = mdiRotate3dVariant

    @Ref('root') readonly root!: HTMLDivElement
    @Ref('stage') readonly stage!: HTMLDivElement

    state: ModelState = 'idle'
    loadedFile = ''
    boxWidth = 0
    boxHeight = 0

    /*
     * `declare`, and assigned in created(), for a reason that costs an afternoon to find the
     * hard way: vue-class-component turns every INITIALISED class field into reactive data,
     * and Vue 2's observe() treats any class instance as a plain object - so `viewer = null`
     * as a field would make Vue walk the entire babylon scene graph installing getters and
     * setters on it. A `declare` field emits no initialiser, so it never becomes data, and
     * properties added after created() are never retro-observed.
     *
     * The instance is per component, NOT vuex and NOT a module singleton. Mainsail's own
     * /viewer keeps both (`gcodeviewer/viewerBackup` + `canvasBackup`), which is precisely why
     * two viewers could never coexist there. Nothing here is shared with that route.
     */
    declare viewer: GCodeViewerInstance | null
    declare canvas: HTMLCanvasElement | null
    declare resizeObserver: ResizeObserver | null
    declare destroyed: boolean

    created() {
        this.viewer = null
        this.canvas = null
        this.resizeObserver = null
        this.destroyed = false
    }

    get filename(): string {
        return this.$store.state.printer.print_stats?.filename ?? ''
    }

    get currentFile(): Record<string, any> {
        return this.$store.state.printer.current_file ?? {}
    }

    get fileSize(): number {
        return this.currentFile.size ?? 0
    }

    // The tile owes the bar nothing but its share of the leftover space: it is `flex: 1 1 auto`
    // with `min-height: 0`, so the readings and the chart are served first and whatever is left
    // is the tile. Below the floor there is no scene worth drawing, so nothing is drawn.
    get roomEnough(): boolean {
        return this.boxWidth >= webcamHudModelMinSide && this.boxHeight >= webcamHudModelMinSide
    }

    get thumbnail(): string {
        const thumbnails: FileStateFileThumbnail[] = this.currentFile.thumbnails ?? []
        if (!thumbnails.length) return ''

        // biggest one wins - it is 300x300 at most (measured 2026-08-17), 13 kB on the wire
        const thumbnail = [...thumbnails].sort((a, b) => b.width - a.width)[0]
        if (!thumbnail?.relative_path) return ''

        const path: string = this.currentFile.filename ?? ''
        const directory = path.lastIndexOf('/') !== -1 ? path.slice(0, path.lastIndexOf('/') + 1) : ''

        return `${this.apiUrl}/server/files/gcodes/${escapePath(directory + thumbnail.relative_path)}?timestamp=${
            this.currentFile.modified ?? 0
        }`
    }

    get ctaLabel(): string {
        if (this.state === 'loading') return this.$t('Panels.WebcamPanel.Hud.ModelLoading').toString()
        if (this.state === 'empty') return this.$t('Panels.WebcamPanel.Hud.ModelEmpty').toString()
        if (this.state === 'error') return this.$t('Panels.WebcamPanel.Hud.ModelFailed').toString()

        const size = this.fileSize ? ` · ${formatFilesize(this.fileSize)}` : ''

        return `${this.$t('Panels.WebcamPanel.Hud.ModelShow')}${size}`
    }

    get ctaIcon(): string {
        if (this.state === 'empty') return this.mdiCubeOffOutline
        if (this.state === 'error') return this.mdiAlertOutline

        return this.mdiRotate3dVariant
    }

    get loadTitle(): string {
        if (this.state === 'empty') return this.$t('Panels.WebcamPanel.Hud.ModelEmptyTitle').toString()

        return this.$t('Panels.WebcamPanel.Hud.ModelShowTitle').toString()
    }

    get optedIn(): boolean {
        try {
            return window.localStorage.getItem(modelOptInKey) === '1'
        } catch {
            return false
        }
    }

    set optedIn(value: boolean) {
        try {
            if (value) window.localStorage.setItem(modelOptInKey, '1')
            else window.localStorage.removeItem(modelOptInKey)
        } catch {
            /* private mode, storage full - the tile still works, it just forgets */
        }
    }

    mounted() {
        this.resizeObserver = new ResizeObserver(() => this.measure())
        this.attachObserver()
        this.maybeAutoLoad()
    }

    /*
     * The root element is behind `v-if="filename"`, so on a page opened while the printer has
     * nothing loaded there is no element to observe at mount time - and when a file finally
     * appears, an observer attached once in mounted() would still be watching nothing. Then
     * boxWidth stays 0, roomEnough stays false, and the tile silently never draws. So this is
     * re-run whenever the file changes, after the element has had a chance to appear.
     */
    attachObserver() {
        if (!this.resizeObserver) return

        this.resizeObserver.disconnect()
        if (!this.root) return

        this.resizeObserver.observe(this.root)
        this.measure()
    }

    beforeDestroy() {
        this.destroyed = true
        this.resizeObserver?.disconnect()
        this.disposeViewer()
    }

    measure() {
        if (!this.root) return

        const rect = this.root.getBoundingClientRect()
        this.boxWidth = Math.round(rect.width)
        this.boxHeight = Math.round(rect.height)

        // the canvas is `position: absolute; inset: 0` inside the stage, so it never feeds its
        // own size back into the layout - but babylon still has to be told the box moved
        if (this.state === 'live') this.viewer?.resize()
    }

    @Watch('filename')
    onFilenameChanged() {
        if (this.loadedFile && this.filename !== this.loadedFile) {
            this.state = 'idle'
            this.loadedFile = ''
            this.viewer?.clearScene(true)
        }

        this.$nextTick(() => {
            this.attachObserver()
            this.maybeAutoLoad()
        })
    }

    /*
     * The metadata for a file always lands AFTER the file name does - the front end only asks
     * Moonraker for it once print_stats names something new. Without this watcher the one
     * chance to auto-load falls in the gap: the name arrives, the size and the thumbnail are
     * not there yet, and nothing looks again. On a page opened at the machine and left open,
     * that gap is every single print.
     */
    @Watch('currentFile.filename')
    onMetadataArrived() {
        this.maybeAutoLoad()
    }

    @Watch('roomEnough')
    onRoomChanged(room: boolean) {
        if (room) {
            this.$nextTick(() => {
                this.attachCanvas()
                this.viewer?.resize()
            })
            this.maybeAutoLoad()
            return
        }

        // the stage is gone from the DOM; keep the engine but let go of its canvas, so the next
        // time there is room the canvas is re-attached rather than orphaned
        this.canvas?.remove()
    }

    /*
     * Auto-load is gated on three things, and every one of them is deliberate:
     *
     *   - the user has opted in once, by clicking a button that names the download size. The
     *     repo's own M1b analysis settled on "explicit click" because the viewer reads the
     *     whole gcode file, and that read competes with the SD reads the print itself is doing.
     *     The click is what makes that informed; remembering it is what makes the permanently
     *     open page at the machine usable.
     *   - the metadata is in. Without it there is no size to name and no thumbnail to show.
     *   - the print is actually under way (or over). During the first seconds of a job klipper
     *     is streaming the start gcode off the same card; a 4 MB read at that exact moment is
     *     the one moment worth avoiding, and it costs nothing to wait for it.
     */
    maybeAutoLoad() {
        if (!this.optedIn || this.state !== 'idle') return
        if (!this.filename || !this.roomEnough) return
        if (this.currentFile.filename !== this.filename) return

        const printDuration = this.$store.state.printer.print_stats?.print_duration ?? 0
        const printing = ['printing', 'paused'].includes(this.printer_state)
        if (printing && printDuration <= 0) return

        this.load()
    }

    async load() {
        if (this.state === 'loading' || this.state === 'live') return
        if (!this.filename) return

        this.state = 'loading'
        const wanted = this.filename

        // the printer can change the file out from under a load in progress - a job finishing,
        // a klipper restart, the next print starting. Give up on the old one, and go back to
        // idle rather than sitting on 'loading' for ever, so the button works again.
        const stale = () => {
            if (!this.destroyed && this.filename !== wanted) this.state = 'idle'
            return this.destroyed || this.filename !== wanted
        }

        try {
            const url = `${this.apiUrl}/server/files/gcodes/${escapePath(wanted)}`
            const response = await fetch(url, { credentials: 'omit' })
            if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)

            const text = await response.text()
            if (stale()) return

            /*
             * Read the file BEFORE the engine, and go no further when there is nothing in it
             * to draw. Half the g-code on this machine is a motion diagnostic with the
             * extruder never touched, and handing one of those to the library throws inside
             * babylon's CreateLineSystem - which is what used to land here as a bare "3D
             * model unavailable", i.e. as if something were broken. It is not: there is
             * simply no shape in the file, and the tile now says so.
             *
             * Bailing out here also means the 320 kB engine is never fetched and 4 MB are
             * never parsed for a file that has no geometry in it.
             */
            if (!hasExtrusion(text)) {
                this.loadedFile = wanted
                this.state = 'empty'
                // the click was answered, so the next file still auto-loads
                this.optedIn = true
                return
            }

            await this.ensureViewer()
            if (stale() || !this.viewer) return

            await this.viewer.processFile(text)
            if (this.destroyed) return

            this.hideScenery()
            this.loadedFile = wanted
            this.state = 'live'
            this.optedIn = true

            await this.$nextTick()
            this.viewer.resize()
            this.frameModel()
        } catch (error) {
            // a file deleted while print_stats still names it, a printer that went away, a
            // browser without webgl: all of them end here, quietly, back on the thumbnail.
            // "the file has no geometry in it" is NOT one of them any more - that is caught
            // above and gets its own words, because it is not a fault.
            if (this.destroyed) return
            this.state = 'error'
            window.console.warn(
                '[overcam] 3D model could not be loaded:',
                error instanceof Error ? (error.stack ?? error.message) : error
            )
        }
    }

    // "not now" rather than "never": the opt-in is dropped, so the tile goes back to the cheap
    // thumbnail and stays there until the button is pressed again
    unload() {
        this.optedIn = false
        this.state = 'idle'
        this.loadedFile = ''
        this.viewer?.clearScene(true)
    }

    attachCanvas() {
        if (!this.canvas || !this.stage) return
        if (this.canvas.parentElement !== this.stage) this.stage.appendChild(this.canvas)
    }

    async ensureViewer() {
        if (this.viewer) {
            this.attachCanvas()
            return
        }

        // The engine is behind a dynamic import so none of it is on the wire until this exact
        // moment: ~320 kB gzipped (1.25 MB raw), measured off the built bundle. The permanently
        // open /overcam page pays nothing for a tile it never turns on.
        const module = await import('@sindarius/gcodeviewer')
        if (this.destroyed) return

        const canvas = document.createElement('canvas')
        canvas.className = 'webcam-hud-model__canvas'
        /*
         * Styled here rather than in the stylesheet: this element is built by hand, so it
         * carries no `data-v-` attribute and scoped CSS cannot reach it at all. The rules
         * themselves are the ones that keep a canvas out of the layout - `display: block`
         * kills the inline line box, absolute positioning keeps its pixel size from ever
         * feeding back into the bar's geometry, and `touch-action: none` lets babylon own
         * the gesture instead of the page scrolling under a finger.
         */
        canvas.style.cssText =
            'display:block;position:absolute;inset:0;width:100%;height:100%;outline:none;touch-action:none'
        this.canvas = canvas
        this.attachCanvas()

        const viewer = new module.default(canvas)
        await viewer.init()
        if (this.destroyed) {
            this.disposeViewerInstance(viewer)
            return
        }

        /*
         * Everything below sets FIELDS, and calls no `update*`/`set*` method that the library
         * offers for the same job. That is not style: those setters write to localStorage
         * (`renderQuality`, `sceneBackgroundColor`, `bedLineColor`, `axesVisible`, ...) and
         * Mainsail's /viewer route reads those very keys back on open. A 240px tile has no
         * business deciding what the full page renders at, so it changes nothing that persists.
         */
        viewer.renderQuality = webcamHudModelRenderQuality
        viewer.gcodeProcessor.setLiveTracking(false)
        this.teachOrcaFeatures(viewer.gcodeProcessor)
        /*
         * Not optional, and not obvious. The library only ever assigns scene.clipPlane from
         * the render observables of the meshes it marks "clip ignore" (bed, axes) - so with
         * the untouched defaults the two planes end up clipping the ONE thing they should not,
         * and the tile renders a black rectangle with the bed's "Back" label floating in it.
         * That is exactly what happened here, and it is why Mainsail's own wrapper opens the
         * clip range wide at init. Sets scene fields only; nothing persists.
         */
        viewer.setZClipPlane(1000000, -1000000)

        if (this.bedMaxSize) {
            viewer.bed.buildVolume.x.max = this.bedMaxSize[0]
            viewer.bed.buildVolume.y.max = this.bedMaxSize[1]
            viewer.bed.buildVolume.z.max = this.bedMaxSize[2]
        }

        this.viewer = viewer
        this.watchCamera()
    }

    /*
     * Teach the library the OrcaSlicer roles it does not know (see orcaFeatureAliases above).
     *
     * There is no public seam for this: the slicer object is built inside processFile(), from
     * a factory the package does not export, and thrown away on the next file. So the FIELD it
     * lands in is intercepted - `gcodeProcessor.slicer` is a plain data property, and an
     * accessor put on the instance sees every assignment the library makes to it, in time to
     * fill in the table before a single `;TYPE:` line is looked up. Nothing is monkey-patched
     * on the prototype, so no other user of the package is affected.
     *
     * The entries are copied from ones the library already ships, so the `perimeter`/`support`
     * flags stay meaningful and no colour is invented; the Color4 is cloned rather than shared,
     * because the processor hands these objects out and a shared one would tint two roles at
     * once if anything ever wrote to it.
     *
     * reportMissingFeature() is replaced as well - not silenced. A role nobody has heard of is
     * still worth knowing about, but it is a COLOUR falling back to grey, and the library
     * reports it with console.error. That single red line is what made this look like a
     * crashed viewer; it is now a console.debug that says what actually happened.
     */
    teachOrcaFeatures(processor: any) {
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
                        for (const [role, alias] of Object.entries(orcaFeatureAliases)) {
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
     * The bed grid, the axis gizmo and the nozzle cursor are sized for a full page; in a tile
     * the size of a postage stamp they are all you can see. They are also what would wreck the
     * framing below: the nozzle model alone measured 220mm of world extent around a 190mm part,
     * because it sits at the origin and the part does not.
     *
     * All three are turned off through calls that write NOTHING to localStorage - setEnabled()
     * and setCursorVisiblity(), never bed.setRenderMode() / axes.show(), which persist and
     * would silently change what Mainsail's own /viewer route shows.
     */
    hideScenery() {
        const viewer = this.viewer as any
        viewer?.bed?.bedMesh?.setEnabled(false)
        viewer?.axes?.axesMesh?.setEnabled(false)
        viewer?.setCursorVisiblity?.(false)
    }

    /*
     * The library's own resetCamera() frames the BED - `radius = 3 * bedCenter.x`, which on a
     * 220mm bed is 330mm of view for a 30mm part. In a tile that is a speck. So the camera is
     * pointed at the extents of what was actually loaded instead, with the bed and the axes
     * filtered out (they are the whole build volume and would put us right back).
     */
    frameModel() {
        const viewer = this.viewer as any
        const scene = viewer?.scene
        const camera = scene?.activeCamera
        if (!scene || !camera) return

        const bed = viewer?.bed?.bedMesh
        const axes = viewer?.axes?.axesMesh

        let extents: { min: any; max: any } | null = null
        try {
            // isVisible as well as isEnabled: hiding the tool cursor only clears isVisible, and
            // an invisible nozzle that still counts towards the extents is how this went wrong
            // the first time - 419 units of camera distance for a 190mm part.
            extents = scene.getWorldExtends(
                (mesh: any) => mesh !== bed && mesh !== axes && mesh.isEnabled() && mesh.isVisible
            )
        } catch {
            extents = null
        }

        const span = extents
            ? Math.max(extents.max.x - extents.min.x, extents.max.y - extents.min.y, extents.max.z - extents.min.z)
            : 0

        if (!extents || !isFinite(span) || span <= 0) {
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
        // babylon's default vertical fov is 0.8 rad, so the view is 2*r*tan(0.4) = 0.845*r tall
        // at the target: 1.7 puts the longest side of the part at about seven tenths of the tile
        camera.radius = span * 1.7
        scene.render(true)
    }

    /*
     * The harness has to be able to tell "the pointer rotated the model" from "the pointer
     * dragged the overlay out of its bar", and it reads the DOM rather than the Vue instance -
     * same rule the rest of the overcam checks follow. Written straight to the attribute and
     * not through a reactive field: an orbit fires this on every frame.
     */
    watchCamera() {
        const camera = (this.viewer as any)?.scene?.activeCamera
        if (!camera?.onViewMatrixChangedObservable) return

        camera.onViewMatrixChangedObservable.add(() => {
            this.root?.setAttribute(
                'data-overcam-model-camera',
                `${camera.alpha.toFixed(3)},${camera.beta.toFixed(3)},${camera.radius.toFixed(1)}`
            )
        })
    }

    // the top level class of @sindarius/gcodeviewer has no dispose() of its own - only its Bed
    // and Axes helpers do - so the engine and the scene are released by hand. Without this,
    // every trip through /overcam leaks a webgl context, and browsers cap those (tablets low).
    disposeViewer() {
        this.disposeViewerInstance(this.viewer)
        this.viewer = null
        this.canvas?.remove()
        this.canvas = null
    }

    disposeViewerInstance(viewer: any) {
        if (!viewer) return

        try {
            viewer.scene?.dispose()
        } catch {
            /* already gone */
        }
        try {
            viewer.engine?.stopRenderLoop?.()
            viewer.engine?.dispose()
        } catch {
            /* already gone */
        }
    }

    get bedMaxSize(): number[] | null {
        const settings = this.$store.state.printer.configfile?.settings ?? {}
        const kinematics = settings.printer?.kinematics ?? ''
        if (kinematics.includes('delta')) return null

        const stepperX = settings.stepper_x
        const stepperY = settings.stepper_y
        const stepperZ = settings.stepper_z
        if (!stepperX || !stepperY || !stepperZ) return null

        return [stepperX.position_max ?? 200, stepperY.position_max ?? 200, stepperZ.position_max ?? 200]
    }
}
</script>

<style scoped>
.webcam-hud-model {
    position: relative;
    /*
     * The tile takes the leftover of the bar and nothing else: `min-height: 0` means the
     * readings and the chart are laid out first, and `flex-basis: auto` with grow 1 means the
     * tile's own content never pushes the column taller. Nothing here can feed back into the
     * geometry the dock is computed from - see measureGeometry() in WebcamFullscreen.vue for
     * why that mattered enough to write down.
     */
    flex: 1 1 auto;
    min-height: 0;
    min-width: 0;
    margin: 8px 0;
    overflow: hidden;
}

.webcam-hud-model__stage {
    position: absolute;
    inset: 0;
}

/* top LEFT, not right: @sindarius/gcodeviewer draws its own orientation cube ("Front", "Back",
   click a face to snap the camera) into the top right corner of the canvas, from a scene of its
   own that survives any clear. Buttons there would sit on top of it. */
.webcam-hud-model__tools {
    position: absolute;
    top: 2px;
    left: 2px;
    z-index: 2;
    display: flex;
    gap: 2px;
    opacity: 0.35;
    transition: opacity 0.15s;
}

.webcam-hud-model__stage:hover .webcam-hud-model__tools {
    opacity: 1;
}

.webcam-hud-model__tool {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.45);
}

/* covers the (black, empty) canvas until the scene is live */
.webcam-hud-model__preview {
    position: absolute;
    inset: 0;
    z-index: 1;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
}

.webcam-hud-model__thumb {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    opacity: 0.75;
    /* belt and braces with draggable="false" above: webkit needs this one too */
    -webkit-user-drag: none;
    user-select: none;
}

.webcam-hud-model__cta {
    position: absolute;
    bottom: 4px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    padding: 3px 10px;
    border-radius: 12px;
    background: rgba(0, 0, 0, 0.6);
    font-size: 0.7rem;
    letter-spacing: 0.04em;
    white-space: nowrap;
}

.webcam-hud-model__cta-text {
    overflow: hidden;
    text-overflow: ellipsis;
}

/* "Show in 3D · 4.0 MB" is three words and is meant to stay on one line, ellipsised if the
   bar is narrow. The empty-file message is a SENTENCE, and a sentence cut off at "this file
   has no…" would explain nothing - which is the one thing this state exists to do. So it
   wraps instead, and is given the room to. */
.webcam-hud-model__cta--wrap {
    max-width: calc(100% - 16px);
    white-space: normal;
    text-align: center;
    line-height: 1.25;
}

.webcam-hud-model__cta--wrap .webcam-hud-model__cta-text {
    overflow: visible;
    text-overflow: clip;
}

/* nothing to sit under: files sliced without a thumbnail (hand written test gcode, and every
   file from a slicer with previews turned off) get the button in the middle instead of a
   caption floating under an empty rectangle */
.webcam-hud-model__preview--bare .webcam-hud-model__cta {
    position: static;
    transform: none;
}
</style>
