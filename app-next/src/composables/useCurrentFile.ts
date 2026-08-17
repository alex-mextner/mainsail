import { ref, computed, watch } from 'vue'
import { useStore } from 'vuex'
import type { RootState } from '@/store/types'
import type { PrintStats } from '@/store/printer/types'

export interface GcodeThumbnail {
    width: number
    height: number
    size: number
    relative_path: string
}

export interface GcodeMeta {
    size?: number
    layer_count?: number
    object_height?: number
    estimated_time?: number
    filament_total?: number
    thumbnails?: GcodeThumbnail[]
}

/**
 * Metadata for whatever file `print_stats` is pointing at, fetched once per
 * filename change (it cannot change while a file is printing).
 *
 * Thumbnails are produced by the slicer and embedded in the gcode; Moonraker
 * extracts them to `.thumbs/`. This printer's files top out at 300x300, so any
 * display larger than that is an upscale -- see `thumbnailUrl`.
 */
export function useCurrentFile() {
    const store = useStore<RootState>()
    const meta = ref<GcodeMeta | null>(null)

    const printStats = computed<PrintStats | null>(() => store.getters['printer/getPrintStats'])
    const filename = computed(() => printStats.value?.filename || '')

    watch(
        filename,
        async (name) => {
            meta.value = null
            if (!name) return

            const socket = store.getters.socketClient
            if (!socket) return

            try {
                meta.value = await socket.emitAndWait('server.files.metadata', { filename: name })
            } catch {
                // A file can vanish between the status update and this call.
                meta.value = null
            }
        },
        { immediate: true }
    )

    /** Largest available thumbnail, and whether showing it bigger is an upscale. */
    const thumbnail = computed(() => {
        const list = meta.value?.thumbnails ?? []
        if (!list.length) return null

        return list.reduce((best, t) => (t.width > best.width ? t : best), list[0])
    })

    const thumbnailUrl = computed(() => {
        const thumb = thumbnail.value
        if (!thumb) return null

        // Thumbnail paths are relative to the gcode file's own directory.
        const dir = filename.value.includes('/') ? filename.value.replace(/\/[^/]*$/, '/') : ''
        return `/server/files/gcodes/${encodeURI(dir + thumb.relative_path)}`
    })

    const progress = computed(() => {
        const stats = printStats.value
        if (!stats) return 0

        // A finished job is 100% by definition; a stopped one should not keep
        // advancing off the last known duration.
        if (stats.state === 'complete') return 100
        if (stats.state !== 'printing' && stats.state !== 'paused') return 0

        // Prefer the slicer's own time estimate; fall back to filament used.
        const estimated = meta.value?.estimated_time ?? 0
        if (estimated > 0 && stats.print_duration > 0) {
            return Math.min(100, Math.round((stats.print_duration / estimated) * 100))
        }

        const total = meta.value?.filament_total ?? 0
        if (total > 0) return Math.min(100, Math.round((stats.filament_used / total) * 100))

        return 0
    })

    return { meta, printStats, filename, thumbnail, thumbnailUrl, progress }
}

/** "1h 04m", "43s" -- compact enough for an overlay chip. */
export function formatDuration(seconds: number): string {
    if (!seconds || seconds < 0) return '—'

    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)

    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
    if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`
    return `${s}s`
}
