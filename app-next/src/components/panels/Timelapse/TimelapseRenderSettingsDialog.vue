<script setup lang="ts">
import { computed } from 'vue'
import Dialog from '@/components/ui/Dialog.vue'
import NumberInput from '@/components/ui/NumberInput.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import { Button } from '@/components/ui/button'
import { useTimelapseStore } from '@/stores/timelapse'

/**
 * "Render settings" -- Mainsail's `dialogs/TimelapseRenderingsettingsDialog.vue`.
 *
 * 🔴 EVERY FIELD HERE WRITES IMMEDIATELY, before Render is pressed. That is
 * upstream's behaviour (each field is a computed setter that dispatches
 * `saveSetting`) and it is kept, because these are the SAME stored settings the
 * settings page edits -- a dialog that buffered them would silently disagree
 * with the other page until Cancel. So Cancel closes; it does not undo.
 * Upstream does not say this anywhere. Here the buttons say it.
 */
const timelapse = useTimelapseStore()

const open = defineModel<boolean>({ required: true })

const settings = computed(() => timelapse.settings)

const set = (name: string, value: unknown) => timelapse.saveSetting({ [name]: value })

const onNumber = (payload: { name: string; value: number }) => set(payload.name, payload.value)

/**
 * The FPS the variable mode will actually pick, shown read-only -- it is
 * derived from the frame count, so it is the number that explains why the
 * estimate says what it says.
 */
const variableTargetFps = computed(() =>
    Math.min(
        settings.value.variable_fps_max,
        Math.max(settings.value.variable_fps_min, Math.floor(timelapse.lastFrame.count / settings.value.targetlength))
    )
)

function startRender(): void {
    void timelapse.render()
    open.value = false
}
</script>

<template>
    <Dialog v-model="open" title="Render settings" description="How the frames are turned into a video">
        <div class="gap-dgap flex flex-col">
            <SegmentedControl
                :model-value="settings.variable_fps ? 'variable' : 'fixed'"
                :options="[
                    { value: 'fixed', label: 'Fixed framerate' },
                    { value: 'variable', label: 'Variable framerate' },
                ]"
                @update:model-value="set('variable_fps', $event === 'variable')" />

            <div class="grid grid-cols-2 gap-3">
                <template v-if="settings.variable_fps">
                    <NumberInput
                        param="variable_fps_min"
                        label="Min framerate"
                        :target="settings.variable_fps_min"
                        :min="1"
                        :dec="0"
                        submit-on-blur
                        @submit="onNumber" />
                    <NumberInput
                        param="variable_fps_max"
                        label="Max framerate"
                        :target="settings.variable_fps_max"
                        :min="1"
                        :dec="0"
                        submit-on-blur
                        @submit="onNumber" />
                    <NumberInput
                        param="targetlength"
                        label="Target length"
                        unit="s"
                        :target="settings.targetlength"
                        :min="1"
                        :dec="0"
                        submit-on-blur
                        @submit="onNumber" />
                </template>

                <NumberInput
                    v-else
                    param="output_framerate"
                    label="Framerate"
                    unit="fps"
                    :target="settings.output_framerate"
                    :min="1"
                    :dec="0"
                    submit-on-blur
                    @submit="onNumber" />

                <NumberInput
                    param="duplicatelastframe"
                    label="Duplicate last frame"
                    :target="settings.duplicatelastframe"
                    :min="0"
                    :dec="0"
                    submit-on-blur
                    @submit="onNumber" />
            </div>

            <dl class="divide-border divide-y text-sm">
                <div v-if="settings.variable_fps" class="py-drow flex items-center justify-between">
                    <dt class="text-muted-foreground">Resulting framerate</dt>
                    <dd class="tabular font-semibold">{{ variableTargetFps }} fps</dd>
                </div>
                <div class="py-drow flex items-center justify-between">
                    <dt class="text-muted-foreground">Estimated length</dt>
                    <dd class="tabular font-semibold">{{ timelapse.estimatedLength }}</dd>
                </div>
            </dl>

            <p class="text-muted-foreground text-xs">
                These are the stored render settings, shared with the settings page — each field is saved as you leave
                it, so closing this dialog does not undo a change.
            </p>
        </div>

        <template #footer>
            <Button variant="ghost" @click="open = false">Close</Button>
            <Button :disabled="timelapse.isRendering" @click="startRender">Start render</Button>
        </template>
    </Dialog>
</template>
