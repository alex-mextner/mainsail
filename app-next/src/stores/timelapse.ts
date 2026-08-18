import { ref, computed, watch } from 'vue'
import { defineStore } from 'pinia'
import { useConnectionStore } from './connection'

/**
 * moonraker-timelapse -- Mainsail's `server/timelapse` Vuex module.
 *
 * 🔴 NOT INSTALLED ON THIS PRINTER. `timelapse` is a third-party Moonraker
 * component (mainsail-crew/moonraker-timelapse); `server.info` here lists 25
 * components and it is not among them, `GET /machine/timelapse/settings`
 * answers 404, and `timelapse` is not one of the registered directories either.
 * So the store gates every call on the component being loaded, exactly like
 * `sensors.ts` and for the same reason: a call that is known to fail on every
 * connect writes a rejected-RPC line into the console scrollback the user walks
 * up to the machine to read.
 *
 * Defaults below are moonraker-timelapse's own, copied from upstream's
 * `getDefaultState`. They matter: `machine.timelapse.get_settings` returns only
 * what the component knows, and a UI that rendered `undefined` for the rest
 * would look broken rather than unconfigured.
 */

export interface TimelapseSettings {
    mode: 'layermacro' | 'hyperlapse'
    enabled: boolean
    camera: string
    autorender: boolean
    autorenderOnce: boolean
    saveframes: boolean
    stream_delay_compensation: number
    gcode_verbose: boolean
    parkhead: boolean
    parkpos: 'center' | 'front_left' | 'front_right' | 'back_left' | 'back_right' | 'custom'
    park_custom_pos_x: number
    park_custom_pos_y: number
    park_custom_pos_dz: number
    park_travel_speed: number
    park_retract_speed: number
    park_retract_distance: number
    park_extrude_speed: number
    park_extrude_distance: number
    park_time: number
    fw_retract: boolean
    hyperlapse_cycle: number
    constant_rate_factor: number
    output_framerate: number
    pixelformat: string
    extraoutputparams: string
    variable_fps: boolean
    targetlength: number
    variable_fps_min: number
    variable_fps_max: number
    rotation: number
    duplicatelastframe: number
    previewimage: boolean
    time_format_code: string
    /** Settings pinned in moonraker.conf; the UI must not offer to change them. */
    blockedsettings: string[]
    [key: string]: unknown
}

export interface TimelapseFile {
    /** Path relative to the timelapse root, e.g. `2026-08-18/print.mp4`. */
    path: string
    /** Last path segment -- what the table shows. */
    filename: string
    size: number
    /** Seconds since the epoch, as Moonraker reports it. */
    modified: number
}

const defaultSettings = (): TimelapseSettings => ({
    mode: 'layermacro',
    enabled: true,
    camera: '',
    autorender: true,
    autorenderOnce: false,
    saveframes: false,
    stream_delay_compensation: 0.05,
    gcode_verbose: true,
    parkhead: false,
    parkpos: 'back_left',
    park_custom_pos_x: 0,
    park_custom_pos_y: 0,
    park_custom_pos_dz: 0,
    park_travel_speed: 100,
    park_retract_speed: 15,
    park_retract_distance: 1,
    park_extrude_speed: 15,
    park_extrude_distance: 1,
    park_time: 0.1,
    fw_retract: false,
    hyperlapse_cycle: 30,
    constant_rate_factor: 23,
    output_framerate: 30,
    pixelformat: 'yuv420p',
    extraoutputparams: '',
    variable_fps: false,
    targetlength: 60,
    variable_fps_min: 5,
    variable_fps_max: 60,
    rotation: 0,
    duplicatelastframe: 0,
    previewimage: true,
    time_format_code: '%Y%m%d_%H%M',
    blockedsettings: [],
})

export const useTimelapseStore = defineStore('timelapse', () => {
    const connection = useConnectionStore()

    const settings = ref<TimelapseSettings>(defaultSettings())
    const lastFrame = ref({ count: 0, file: '' })
    const rendering = ref({ status: '', progress: 0, filename: '' })
    const loaded = ref(false)
    const files = ref<TimelapseFile[]>([])
    const filesLoaded = ref(false)

    const available = computed(() => connection.moonrakerComponents.includes('timelapse'))

    function applySettings(payload: Record<string, unknown> | null): void {
        if (!payload) return
        // Moonraker echoes the request back under this key on a POST; it is not
        // a setting and would end up rendered as one.
        const { requestParams: _ignored, ...rest } = payload
        settings.value = { ...settings.value, ...(rest as Partial<TimelapseSettings>) }
        loaded.value = true
    }

    async function load(): Promise<void> {
        if (!available.value) return

        applySettings(await connection.call<Record<string, unknown>>('machine.timelapse.get_settings').catch(() => null))

        await loadFiles()

        const frame = await connection
            .call<{ framecount?: number; lastframefile?: string }>('machine.timelapse.lastframeinfo')
            .catch(() => null)

        if (frame) lastFrame.value = { count: frame.framecount ?? 0, file: frame.lastframefile ?? '' }
    }

    /**
     * The rendered videos and frame archives.
     *
     * 🔴 `server.files.list` on the whole root, NOT a directory walk. Upstream
     * mirrors the tree directory by directory with `get_directory` and gives
     * the panel breadcrumb navigation. One flat call is used here for the same
     * reason the g-code file store makes one call instead of dozens -- this SD
     * card is the one the printer is printing from -- and for a second reason
     * that is specific to this root: what you want from a timelapse list is
     * every video, and a video filed under a per-print subdirectory would be
     * hidden behind a folder click. The path is shown when there is one, so
     * nothing becomes ambiguous.
     */
    async function loadFiles(): Promise<void> {
        if (!available.value) return

        const result = await connection
            .call<{ path: string; modified: number; size: number }[]>('server.files.list', { root: 'timelapse' })
            .catch(() => null)

        if (!result) return

        files.value = result
            // Upstream's filter: the root also holds .jpg frames when
            // `saveframes` is off but a render failed, and they are not videos.
            .filter((file) => file.path.endsWith('.mp4') || file.path.endsWith('.zip'))
            .map((file) => ({
                path: file.path,
                filename: file.path.split('/').pop() ?? file.path,
                size: file.size ?? 0,
                modified: file.modified ?? 0,
            }))

        filesLoaded.value = true
    }

    const deleteFile = async (path: string): Promise<void> => {
        await connection.call('server.files.delete_file', { path: `timelapse/${path}` }).catch(() => null)
        await loadFiles()
    }

    /** Same-origin URL; works identically behind the dev proxy and on :8090. */
    const fileUrl = (path: string) => `/server/files/timelapse/${path.split('/').map(encodeURIComponent).join('/')}`

    /** One setting, or several at once. Moonraker replies with the full set. */
    async function saveSetting(patch: Partial<TimelapseSettings>): Promise<void> {
        if (!available.value) return

        applySettings(
            await connection.call<Record<string, unknown>>('machine.timelapse.post_settings', patch).catch(() => null)
        )
    }

    const saveFrames = () => connection.call('machine.timelapse.saveframes').catch(() => null)
    const render = () => connection.call('machine.timelapse.render').catch(() => null)

    connection.onNotify((notification) => {
        /**
         * A finished render is a new file in this root, and Moonraker announces
         * it here rather than in the timelapse event. Without this the list
         * would still be showing yesterday's videos after a render completed in
         * front of the user. Scoped to the timelapse root: the g-code store
         * already listens for its own, and reloading on every gcode upload
         * would spend the SD-card I/O this store is careful with.
         */
        if (notification.method === 'notify_filelist_changed') {
            const payload = notification.params?.[0] as { item?: { root?: string } } | undefined
            if (payload?.item?.root === 'timelapse') void loadFiles()
            return
        }

        if (notification.method !== 'notify_timelapse_event') return

        const payload = notification.params?.[0] as Record<string, unknown> | undefined
        if (!payload) return

        if (payload.action === 'newframe') {
            lastFrame.value = {
                count: Number(payload.frame ?? 0),
                file: String(payload.framefile ?? ''),
            }
            return
        }

        if (payload.action === 'render') {
            /**
             * An error ends the render; upstream clears the snackbar and shows a
             * toast. Here the message is kept in `rendering.status` so the panel
             * can say what happened instead of the notice vanishing -- the
             * machine is often left rendering unattended, and a toast that
             * expired while nobody was looking is the same as no message.
             */
            rendering.value = {
                status: String(payload.status ?? ''),
                progress: Number(payload.progress ?? 0),
                filename: String(payload.filename ?? rendering.value.filename),
            }
        }
    })

    const isRendering = computed(() => rendering.value.status === 'running')

    /**
     * How long the finished video will be -- upstream's `timelapse` mixin,
     * including its two quirks: the duplicated last frame counts, and variable
     * FPS never produces a video SHORTER than the target length.
     */
    const estimatedLength = computed(() => {
        const frames = lastFrame.value.count + settings.value.duplicatelastframe

        let seconds = Math.round(frames / settings.value.output_framerate)

        if (settings.value.variable_fps) {
            const targetFps = Math.min(
                settings.value.variable_fps_max,
                Math.max(settings.value.variable_fps_min, Math.floor(lastFrame.value.count / settings.value.targetlength))
            )
            seconds = Math.round(frames / targetFps)
            if (seconds < settings.value.targetlength) seconds = settings.value.targetlength
        }

        if (seconds <= 60) return `${seconds}s`
        return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    })

    /** A setting pinned in moonraker.conf cannot be changed from here. */
    const isBlocked = (name: string) => settings.value.blockedsettings?.includes(name) ?? false

    function reset(): void {
        settings.value = defaultSettings()
        lastFrame.value = { count: 0, file: '' }
        rendering.value = { status: '', progress: 0, filename: '' }
        loaded.value = false
        files.value = []
        filesLoaded.value = false
    }

    /**
     * 🔴 WATCHES `available` AS WELL AS THE SOCKET, and that is not belt and
     * braces -- watching the socket alone is a race this port already lost once.
     *
     * `moonrakerComponents` is filled by `server.info`, which runs INSIDE
     * `initialise()` -- i.e. after `socketState` is already `connected`. A store
     * that fires on the connect and then gates on the component list therefore
     * reads an empty list, returns early, and never tries again: the feature is
     * silently absent for the whole session. Whether it wins or loses depends on
     * when the page's lazy chunk finishes loading, which is why the timelapse
     * PAGE worked and the settings CARD did not, from identical code.
     *
     * Same class as the heightmap's `configLoaded`: treating "not known yet" as
     * "not there".
     */
    watch(
        [() => connection.isConnected, available],
        ([connected, ready]) => {
            if (connected && ready) void load()
        },
        { immediate: true }
    )

    return {
        settings,
        files,
        filesLoaded,
        loadFiles,
        deleteFile,
        fileUrl,
        lastFrame,
        rendering,
        isRendering,
        available,
        loaded,
        estimatedLength,
        isBlocked,
        load,
        saveSetting,
        saveFrames,
        render,
        reset,
    }
})
