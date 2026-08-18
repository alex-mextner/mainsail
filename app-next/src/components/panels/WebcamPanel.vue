<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { mdiArrowExpand, mdiMenuDown, mdiViewGrid, mdiWebcam } from '@mdi/js'
import Panel from '@/components/ui/Panel.vue'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import { Menu, MenuItem } from '@/components/ui/menu'
import WebcamWrapper from '@/components/webcams/WebcamWrapper.vue'
import { useWebcamsStore } from '@/stores/webcams'
import { useConnectionStore } from '@/stores/connection'
import { useGuiStore } from '@/stores/gui'
import { webcamIcon, type WebcamConfig } from '@/lib/webcam'

/**
 * The camera, inline -- upstream's `panels/WebcamPanel.vue`.
 *
 * One component serves two surfaces, as upstream's does: the dashboard panel
 * (collapsible, remembers being collapsed) and the /cam page (never
 * collapsible -- collapsing the only thing on a page leaves an empty page).
 * Which one is in play is the `surface` prop, upstream's `currentPage`.
 *
 * The fullscreen view is NOT duplicated here. The expand button routes to
 * `/overcam/<name>`, which already exists with the hud, the docking and the
 * drag-to-anchor behaviour; a second fullscreen implementation inside the panel
 * would be a second thing to keep correct.
 */
const props = withDefaults(defineProps<{ surface?: 'dashboard' | 'page' }>(), { surface: 'dashboard' })

const router = useRouter()
const webcams = useWebcamsStore()
const connection = useConnectionStore()
const gui = useGuiStore()

/** Upstream shows the switcher only when there is something to switch between. */
const showSwitch = computed(() => webcams.webcams.length > 1)

/**
 * Upstream's `currentCamId` getter, including its one non-obvious rule: with
 * exactly ONE camera the stored value is ignored and that camera is shown. A
 * stored 'all' would otherwise render a one-tile "grid", which is a worse
 * version of just showing the camera.
 *
 * A stored name that no longer resolves falls back to 'all' rather than to
 * nothing -- renaming a camera in Moonraker must not leave a blank panel.
 */
const currentCamId = computed<string>({
    get() {
        if (webcams.webcams.length === 1) return webcams.webcams[0].name

        const stored = gui.state.view.webcam.currentCam[props.surface] ?? 'all'
        return webcams.webcams.some((cam) => cam.name === stored) ? stored : 'all'
    },
    set(value: string) {
        gui.saveSetting(`view.webcam.currentCam.${props.surface}`, value)
    },
})

/**
 * The pseudo-camera for the grid is upstream's, `service: 'grid'` and all --
 * see WebcamWrapper for why the sentinel is kept rather than a boolean flag.
 */
const currentCam = computed<WebcamConfig>(() => {
    const found = webcams.webcams.find((cam) => cam.name === currentCamId.value)
    if (found) return found

    return { name: 'All', service: 'grid', icon: 'mdiViewGrid', stream_url: '', snapshot_url: '' }
})

const isGrid = computed(() => currentCam.value.service === 'grid')

/**
 * Expanding a grid has no single camera to expand to, so it opens `/overcam`
 * without a name and the fullscreen view picks the first one -- the same choice
 * OvercamPage already documents for a bare `/overcam`.
 */
function expand() {
    void router.push(isGrid.value ? '/overcam' : `/overcam/${encodeURIComponent(currentCam.value.name)}`)
}
</script>

<template>
    <Panel
        v-if="connection.isConnected"
        panel-name="webcam"
        title="Webcam"
        :icon="mdiWebcam"
        :collapsible="surface !== 'page'"
        hide-buttons-on-collapse
        content-class="px-0">
        <template #buttons>
            <Menu v-if="showSwitch">
                <template #trigger>
                    <button
                        type="button"
                        class="text-muted-foreground hover:text-foreground hover:bg-accent inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm transition-colors">
                        <MdiIcon :path="webcamIcon(currentCam.icon)" class="size-4 shrink-0" />
                        <!--
                            The name is dropped on a narrow panel, upstream's
                            `d-none d-md-block`. The query resolves against the
                            PANEL HEADER (Panel.vue makes it a container), not
                            the window: this panel sits in a 3/12 column on a
                            widescreen, where a window-width rule would happily
                            show a label that does not fit.
                        -->
                        <span class="hidden max-w-28 truncate @sm:inline">{{ currentCam.name }}</span>
                        <MdiIcon :path="mdiMenuDown" class="size-4 shrink-0" />
                    </button>
                </template>

                <MenuItem class="py-1.5" @select="currentCamId = 'all'">
                    <MdiIcon :path="mdiViewGrid" class="size-4" />
                    <span>All</span>
                </MenuItem>
                <MenuItem
                    v-for="cam in webcams.webcams"
                    :key="cam.name"
                    class="py-1.5"
                    @select="currentCamId = cam.name">
                    <MdiIcon :path="webcamIcon(cam.icon)" class="size-4" />
                    <span>{{ cam.name }}</span>
                </MenuItem>
            </Menu>

            <!--
                Fullscreen. A tooltip is deliberately absent: the screen at the
                machine is a touch tablet, where hover never fires and a
                hover-only tooltip is simply invisible. The aria-label carries
                the same text for screen readers.
            -->
            <button
                v-if="webcams.webcams.length"
                type="button"
                aria-label="Open fullscreen webcam"
                class="text-muted-foreground hover:text-foreground hover:bg-accent inline-flex size-8 items-center justify-center rounded-md transition-colors"
                @click="expand">
                <MdiIcon :path="mdiArrowExpand" class="size-5" />
            </button>
        </template>

        <div v-if="webcams.webcams.length" class="px-dpx">
            <WebcamWrapper :webcam="currentCam" />
        </div>
        <p v-else class="text-muted-foreground px-dpx py-6 text-center text-sm">
            {{ webcams.loaded ? 'No webcam is configured.' : 'Loading cameras…' }}
        </p>
    </Panel>
</template>
