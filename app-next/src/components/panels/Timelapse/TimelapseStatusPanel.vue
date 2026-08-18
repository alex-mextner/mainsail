<script setup lang="ts">
import { ref, computed } from 'vue'
import { mdiInformation, mdiFileOutline } from '@mdi/js'
import Panel from '@/components/ui/Panel.vue'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import { Button } from '@/components/ui/button'
import TimelapseRenderSettingsDialog from './TimelapseRenderSettingsDialog.vue'
import { useTimelapseStore } from '@/stores/timelapse'
import { usePrinterStore } from '@/stores/printer'
import { useWebcamsStore } from '@/stores/webcams'

/**
 * "Status" -- Mainsail's `Timelapse/TimelapseStatusPanel.vue`.
 *
 * The last captured frame, how many there are, how long the video will be, and
 * the two things you can do between prints: render now, or zip the frames.
 * While a print IS running it becomes the two switches that decide whether this
 * print gets a timelapse at all -- which is upstream's split and the right one,
 * because those are the only settings that still matter once printing started.
 */
const timelapse = useTimelapseStore()
const printer = usePrinterStore()
const webcams = useWebcamsStore()

const showRenderDialog = ref(false)

const isPrinting = computed(() => ['printing', 'paused'].includes(printer.printerState))

/**
 * The frame is served over plain HTTP from the timelapse_frames root, on the
 * same origin as the app -- no proxy needed and no absolute host, which is what
 * lets this work identically on :8090 and behind the dev server.
 */
const frameUrl = computed(() =>
    timelapse.lastFrame.file ? `/server/files/timelapse_frames/${timelapse.lastFrame.file}` : null
)

const failedToLoad = ref(false)

/**
 * The frame comes off the camera unrotated, so it needs the same flip/rotate
 * the live view uses -- otherwise the preview and the stream disagree about
 * which way up the printer is. Upstream also honours `flip_x`/`flip_y` from
 * moonraker.conf's own `[timelapse]` section when a `snapshoturl` is pinned
 * there; that path is not ported, because it is only reachable on a machine
 * whose moonraker.conf configures the camera twice, and this one does not have
 * the component at all.
 */
const transform = computed(() => {
    const camera = webcams.byName(timelapse.settings.camera)
    if (!camera) return undefined

    const parts: string[] = []
    if (camera.flip_horizontal) parts.push('scaleX(-1)')
    if (camera.flip_vertical) parts.push('scaleY(-1)')
    if (camera.rotation) parts.push(`rotate(${camera.rotation}deg)`)

    return parts.length ? parts.join(' ') : undefined
})
</script>

<template>
    <Panel panel-name="timelapse-status" title="Status" :icon="mdiInformation">
        <div v-if="timelapse.lastFrame.count" class="gap-dgap flex flex-col">
            <div v-if="frameUrl" class="bg-muted flex items-center justify-center overflow-hidden rounded-lg">
                <img
                    v-if="!failedToLoad"
                    :src="frameUrl"
                    alt="Last captured frame"
                    class="w-full"
                    :style="{ transform }"
                    @error="failedToLoad = true" />
                <MdiIcon v-else :path="mdiFileOutline" class="text-muted-foreground m-6 size-8" />
            </div>

            <dl class="divide-border divide-y text-sm">
                <div class="py-drow flex items-center justify-between">
                    <dt class="text-muted-foreground">Frames</dt>
                    <dd class="tabular font-semibold">{{ timelapse.lastFrame.count }}</dd>
                </div>
                <div class="py-drow flex items-center justify-between">
                    <dt class="text-muted-foreground">Estimated length</dt>
                    <dd class="tabular font-semibold">{{ timelapse.estimatedLength }}</dd>
                </div>
            </dl>

            <div v-if="!isPrinting" class="flex flex-wrap justify-center gap-2">
                <Button variant="ghost" :disabled="timelapse.isRendering" @click="showRenderDialog = true">
                    Render
                </Button>
                <Button variant="ghost" @click="timelapse.saveFrames()">Save frames</Button>
            </div>
        </div>

        <p v-else class="text-muted-foreground py-drow text-center text-sm italic">
            No frames have been captured yet.
        </p>

        <!--
            Upstream shows the render result in a snackbar that expires. This
            machine is regularly left alone while it renders on a 512 MB Orange
            Pi, so the outcome is kept on the panel instead: a notice nobody was
            there to see is the same as no notice.
        -->
        <div v-if="timelapse.rendering.status" class="pt-dgap">
            <div class="flex items-center justify-between text-sm">
                <span class="text-muted-foreground">
                    {{ timelapse.isRendering ? 'Rendering' : `Render: ${timelapse.rendering.status}` }}
                </span>
                <span v-if="timelapse.isRendering" class="tabular">{{ timelapse.rendering.progress }} %</span>
            </div>
            <div v-if="timelapse.isRendering" class="bg-muted mt-1 h-1.5 w-full overflow-hidden rounded-full">
                <div class="bg-primary h-full rounded-full" :style="{ width: `${timelapse.rendering.progress}%` }" />
            </div>
            <p v-if="timelapse.rendering.filename" class="text-muted-foreground truncate pt-1 text-xs">
                {{ timelapse.rendering.filename }}
            </p>
        </div>

        <template v-if="isPrinting">
            <div class="divide-border border-border mt-dgap divide-y border-t">
                <div class="py-drow flex items-center justify-between">
                    <span class="text-sm">Enabled</span>
                    <button
                        type="button"
                        role="switch"
                        :aria-checked="timelapse.settings.enabled"
                        aria-label="Enable timelapse for this print"
                        class="focus-visible:ring-ring relative h-6 w-11 rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none"
                        :class="timelapse.settings.enabled ? 'bg-primary' : 'bg-muted'"
                        @click="timelapse.saveSetting({ enabled: !timelapse.settings.enabled })">
                        <span
                            class="bg-background absolute top-1 size-4 rounded-full transition-all"
                            :class="timelapse.settings.enabled ? 'left-6' : 'left-1'" />
                    </button>
                </div>
                <div v-if="timelapse.settings.enabled" class="py-drow flex items-center justify-between">
                    <span class="text-sm">Auto render</span>
                    <button
                        type="button"
                        role="switch"
                        :aria-checked="timelapse.settings.autorender"
                        aria-label="Render automatically when the print finishes"
                        class="focus-visible:ring-ring relative h-6 w-11 rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none"
                        :class="timelapse.settings.autorender ? 'bg-primary' : 'bg-muted'"
                        @click="timelapse.saveSetting({ autorender: !timelapse.settings.autorender })">
                        <span
                            class="bg-background absolute top-1 size-4 rounded-full transition-all"
                            :class="timelapse.settings.autorender ? 'left-6' : 'left-1'" />
                    </button>
                </div>
            </div>
        </template>

        <TimelapseRenderSettingsDialog v-model="showRenderDialog" />
    </Panel>
</template>
