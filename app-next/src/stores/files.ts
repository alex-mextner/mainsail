import { ref } from 'vue'
import { defineStore } from 'pinia'
import { useConnectionStore } from './connection'

/**
 * The g-code file tree, one directory at a time.
 *
 * 🔴 THIS IS NOT UPSTREAM'S SHAPE, AND THE DIFFERENCE IS DELIBERATE
 * ----------------------------------------------------------------
 * Mainsail keeps a full recursive mirror of every root in Vuex: opening the
 * app walks `gcodes` breadth-first, issuing one `server.files.get_directory`
 * per subdirectory, and then asks for `server.files.metadata` per file in
 * batches of a hundred.
 *
 * This store fetches ONE directory, the one being looked at, and asks for it
 * with `extended: true`. Moonraker then returns each file's cached metadata
 * inline -- slicer, layer height, temperatures, filament, thumbnails -- in the
 * same response. Measured on this machine: one request instead of one per
 * directory plus one per file.
 *
 * That matters here specifically. The gcodes root is an SD card that the print
 * itself is streaming from, and this app runs beside the Mainsail the user
 * actually prints with. Walking the tree eagerly is I/O the machine is already
 * using.
 *
 * What this gives up, honestly: Moonraker's `extended` listing returns the
 * metadata it has ALREADY extracted. A file that was never scanned comes back
 * with no metadata fields, and unlike upstream nothing here re-requests them in
 * the background. The manual path is kept -- "Scan metadata" in the row menu
 * calls `server.files.metascan` -- so such a file is one click from complete,
 * rather than silently blank forever.
 */

export interface FileThumbnail {
    width: number
    height: number
    size: number
    relative_path: string
}

/** One row: a directory, or a file with whatever metadata Moonraker had. */
export interface FileEntry {
    isDirectory: boolean
    /** Base name only. The path it lives in is the directory it came from. */
    filename: string
    /** Milliseconds since the epoch (Moonraker sends float seconds). */
    modified: number
    size: number
    permissions: string

    uuid?: string | null
    job_id?: string | null
    slicer?: string
    slicer_version?: string
    layer_count?: number
    object_height?: number
    estimated_time?: number
    nozzle_diameter?: number
    layer_height?: number
    first_layer_height?: number
    first_layer_extr_temp?: number
    first_layer_bed_temp?: number
    chamber_temp?: number
    filament_name?: string
    filament_type?: string
    filament_colors?: string[]
    filament_total?: number
    filament_weight_total?: number
    thumbnails?: FileThumbnail[]
    [key: string]: unknown
}

export interface DiskUsage {
    free: number
    total: number
    used: number
}

interface DirectoryState {
    entries: FileEntry[]
    diskUsage: DiskUsage | null
    /** Permissions of the ROOT ("gcodes"), which is what gates writing. */
    rootPermissions: string
    loading: boolean
    error: string | null
    loadedAt: number
}

interface ApiDirectoryEntry {
    modified: number
    size: number
    permissions: string
    dirname?: string
    filename?: string
    [key: string]: unknown
}

interface ApiDirectoryResponse {
    dirs?: ApiDirectoryEntry[]
    files?: ApiDirectoryEntry[]
    disk_usage?: DiskUsage
    root_info?: { name: string; permissions: string }
}

/** Extensions Klipper will actually print. Upstream's list, verbatim. */
export const VALID_GCODE_EXTENSIONS = ['.gcode', '.g', '.gco', '.ufp', '.nc']

export const isGcodeFilename = (filename: string): boolean => {
    const dot = filename.lastIndexOf('.')
    return dot !== -1 && VALID_GCODE_EXTENSIONS.includes(filename.slice(dot).toLowerCase())
}

/**
 * Percent-encode each path SEGMENT but keep the slashes -- upstream's
 * `escapePath`. `encodeURIComponent` on the whole path would escape the
 * separators and Moonraker would look for one absurdly named file.
 */
export const escapePath = (path: string): string => path.split('/').map(encodeURIComponent).join('/')

/** Absolute path Moonraker understands, from a path relative to the root. */
const absolute = (root: string, path: string): string => (path ? `${root}/${path}` : root)

export const useFilesStore = defineStore('files', () => {
    const connection = useConnectionStore()

    /** Keyed by path relative to the gcodes root; '' is the root itself. */
    const directories = ref<Record<string, DirectoryState>>({})

    const root = 'gcodes'

    function stateFor(path: string): DirectoryState | undefined {
        return directories.value[path]
    }

    async function loadDirectory(path: string, force = false): Promise<void> {
        const existing = directories.value[path]
        if (existing?.loading) return
        if (existing && !force) return

        directories.value[path] = {
            entries: existing?.entries ?? [],
            diskUsage: existing?.diskUsage ?? null,
            rootPermissions: existing?.rootPermissions ?? 'rw',
            loading: true,
            error: null,
            loadedAt: existing?.loadedAt ?? 0,
        }

        try {
            const result = await connection.call<ApiDirectoryResponse>('server.files.get_directory', {
                path: absolute(root, path),
                // The whole reason this store can be one request deep.
                extended: true,
            })

            const dirs = (result.dirs ?? []).map<FileEntry>((dir) => ({
                isDirectory: true,
                filename: String(dir.dirname ?? ''),
                modified: (dir.modified ?? 0) * 1000,
                size: dir.size ?? 0,
                permissions: dir.permissions ?? '',
            }))

            const files = (result.files ?? []).map<FileEntry>((file) => ({
                ...file,
                isDirectory: false,
                filename: String(file.filename ?? ''),
                modified: (file.modified ?? 0) * 1000,
                size: file.size ?? 0,
                permissions: file.permissions ?? '',
            }))

            directories.value[path] = {
                entries: [...dirs, ...files],
                diskUsage: result.disk_usage ?? null,
                rootPermissions: result.root_info?.permissions ?? 'rw',
                loading: false,
                error: null,
                loadedAt: Date.now(),
            }
        } catch (error) {
            directories.value[path] = {
                entries: [],
                diskUsage: null,
                rootPermissions: 'rw',
                loading: false,
                // Shown in place of the table. A directory that was deleted
                // while being looked at is the common case, and silently
                // showing an empty list would read as "no files here".
                error: (error as { message?: string })?.message ?? 'could not read directory',
                loadedAt: Date.now(),
            }
        }
    }

    function invalidate(path: string): void {
        delete directories.value[path]
    }

    /** Directory part of a Moonraker path like `gcodes/sub/dir/file.gcode`. */
    function relativeDirOf(fullPath: string): string | null {
        if (fullPath === root) return ''
        if (!fullPath.startsWith(`${root}/`)) return null

        const rest = fullPath.slice(root.length + 1)
        const slash = rest.lastIndexOf('/')
        return slash === -1 ? '' : rest.slice(0, slash)
    }

    // --- commands -----------------------------------------------------------

    const deleteFile = (path: string, filename: string) =>
        connection.call('server.files.delete_file', { path: `${absolute(root, path)}/${filename}` })

    const deleteDirectory = (path: string, dirname: string) =>
        connection.call('server.files.delete_directory', { path: `${absolute(root, path)}/${dirname}`, force: true })

    const createDirectory = (path: string, dirname: string) =>
        connection.call('server.files.post_directory', { path: `${absolute(root, path)}/${dirname}` })

    const move = (source: string, dest: string) => connection.call('server.files.move', { source, dest })

    const copy = (source: string, dest: string) => connection.call('server.files.copy', { source, dest })

    /** Ask Moonraker to (re)extract metadata for one file. */
    const metascan = (path: string, filename: string) =>
        connection.call('server.files.metascan', { filename: path ? `${path}/${filename}` : filename })

    const startPrint = (path: string, filename: string) =>
        connection.call('printer.print.start', { filename: path ? `${path}/${filename}` : filename })

    /** Download URL. Relative, so it goes through whichever host serves the app. */
    const downloadUrl = (path: string, filename: string): string =>
        `/server/files/${root}/${escapePath(path ? `${path}/${filename}` : filename)}`

    /**
     * Upload through XHR rather than fetch: only XHR reports upload progress,
     * and a 4 MB g-code over the printer's Wi-Fi is long enough that a bar is
     * the difference between "working" and "frozen".
     */
    const upload = ref<{ filename: string; percent: number; index: number; total: number } | null>(null)

    function uploadFile(path: string, file: File, index = 1, total = 1): Promise<string> {
        return new Promise((resolve, reject) => {
            const form = new FormData()
            form.append('file', file)
            form.append('root', root)
            if (path) form.append('path', path)

            const request = new XMLHttpRequest()
            request.open('POST', '/server/files/upload')

            request.upload.addEventListener('progress', (event) => {
                if (!event.lengthComputable) return
                upload.value = {
                    filename: file.name,
                    percent: Math.round((event.loaded / event.total) * 100),
                    index,
                    total,
                }
            })

            request.addEventListener('load', () => {
                upload.value = null
                if (request.status >= 200 && request.status < 300) resolve(file.name)
                else reject(new Error(`upload failed (${request.status})`))
            })

            request.addEventListener('error', () => {
                upload.value = null
                reject(new Error('upload failed'))
            })

            upload.value = { filename: file.name, percent: 0, index, total }
            request.send(form)
        })
    }

    function reset(): void {
        directories.value = {}
        upload.value = null
    }

    /**
     * Moonraker announces every create / delete / move / metadata update. Only
     * the directories actually affected are dropped, so looking at one folder
     * while a file lands in another costs nothing.
     */
    connection.onNotify(({ method, params }) => {
        if (method !== 'notify_filelist_changed') return

        const payload = params[0] as
            { action?: string; item?: { path?: string; root?: string }; source_item?: { path?: string } } | undefined
        if (!payload?.item) return

        for (const candidate of [payload.item.path, payload.source_item?.path]) {
            if (!candidate) continue

            const dir = relativeDirOf(candidate)
            if (dir === null) continue

            // Only directories that have actually been opened. Re-fetching one
            // nobody has looked at would spend exactly the SD-card I/O this
            // store exists to avoid -- and it would load on first visit anyway.
            if (!(dir in directories.value)) continue

            // Re-fetch rather than just dropping: the user is most likely
            // looking at the directory that just changed.
            void loadDirectory(dir, true)
        }
    })

    return {
        directories,
        upload,
        stateFor,
        loadDirectory,
        invalidate,
        deleteFile,
        deleteDirectory,
        createDirectory,
        move,
        copy,
        metascan,
        startPrint,
        downloadUrl,
        uploadFile,
        reset,
    }
})
