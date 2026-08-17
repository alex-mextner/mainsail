<script setup lang="ts">
import { computed, ref } from 'vue'
import { mdiFile, mdiFolder } from '@mdi/js'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import { escapePath } from '@/stores/files'
import type { GcodeRow } from '@/composables/useGcodefiles'

/**
 * The 32px preview in the file list, with the big one on hover -- Mainsail's
 * `GcodefilesThumbnail.vue`.
 *
 * Thumbnails come from the slicer, embedded in the g-code; Moonraker extracts
 * them into `.thumbs/` next to the file. `relative_path` is relative to the
 * FILE's directory, not to the gcodes root, which is why the file's own
 * subdirectory is prepended.
 *
 * Size bands are upstream's (`store/variables.ts`): 30..64px counts as the
 * small one, 128px and up as the big one. This machine's slicer writes 32, 48
 * and 300, so both bands are satisfied by real files.
 *
 * `?timestamp=` busts the browser cache when a file is re-sliced to the same
 * name -- without it the list keeps showing the previous model's picture, which
 * is the kind of wrong that gets a print started by mistake.
 */
const props = defineProps<{ row: GcodeRow }>()

const SMALL_MIN = 30
const SMALL_MAX = 64
const BIG_MIN = 128

const failed = ref(false)

/**
 * The big preview is teleported to <body> and positioned `fixed`.
 *
 * It cannot live next to the small image: that sits inside the table's
 * `overflow-x-auto` scroll container, which clips anything absolutely
 * positioned beyond its edge -- and the preview is 250px wide, so on the
 * rightmost columns it would be clipped to nothing.
 */
const preview = ref<{ top: number; left: number } | null>(null)

function showPreview(event: MouseEvent): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()

    // Flip to the left of the cell when there is no room to the right, so the
    // preview never lands off-screen on a narrow window.
    const width = 258
    const openLeft = rect.right + width + 8 > window.innerWidth

    preview.value = {
        top: Math.min(Math.max(8, rect.top + rect.height / 2 - 125), window.innerHeight - 258),
        left: openLeft ? Math.max(8, rect.left - width - 8) : rect.right + 8,
    }
}

const hidePreview = () => (preview.value = null)

const buildUrl = (relativePath: string): string => {
    const slash = props.row.fullPath.lastIndexOf('/')
    const subdirectory = slash === -1 ? '' : props.row.fullPath.slice(0, slash)
    const path = subdirectory ? `${subdirectory}/${relativePath}` : relativePath

    return `/server/files/gcodes/${escapePath(path)}?timestamp=${props.row.modified}`
}

const small = computed(() => {
    const found = props.row.thumbnails?.find(
        (thumb) =>
            thumb.width >= SMALL_MIN &&
            thumb.width <= SMALL_MAX &&
            thumb.height >= SMALL_MIN &&
            thumb.height <= SMALL_MAX
    )
    return found ? buildUrl(found.relative_path) : null
})

const big = computed(() => {
    const found = props.row.thumbnails?.find((thumb) => thumb.width >= BIG_MIN)
    return found ? buildUrl(found.relative_path) : null
})
</script>

<template>
    <MdiIcon v-if="row.isDirectory" :path="mdiFolder" class="text-muted-foreground size-5" />
    <MdiIcon v-else-if="!small || failed" :path="mdiFile" class="text-muted-foreground size-5" />
    <span v-else class="inline-flex" @mouseenter="showPreview" @mouseleave="hidePreview">
        <img
            :src="small"
            :alt="row.filename"
            width="32"
            height="32"
            loading="lazy"
            class="bg-muted size-8 rounded object-contain"
            @error="failed = true" />

        <Teleport to="body">
            <span
                v-if="preview && big"
                class="border-border bg-card pointer-events-none fixed z-50 rounded-lg border p-1 shadow-lg"
                :style="{ top: `${preview.top}px`, left: `${preview.left}px` }">
                <img :src="big" :alt="row.filename" class="block h-auto w-[250px] rounded" />
            </span>
        </Teleport>
    </span>
</template>
