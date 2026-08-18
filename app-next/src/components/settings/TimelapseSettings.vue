<script setup lang="ts">
import { computed } from 'vue'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import SettingRow from '@/components/ui/SettingRow.vue'
import Switch from '@/components/ui/Switch.vue'
import { useTimelapseStore } from '@/stores/timelapse'
import { useWebcamsStore } from '@/stores/webcams'
import { usePrinterStore } from '@/stores/printer'

/**
 * Settings → Timelapse -- Mainsail's `settings/SettingsTimelapseTab.vue`.
 *
 * Every control writes straight through `machine.timelapse.post_settings`, and
 * Moonraker answers with the whole settings object, so there is no local copy
 * to get out of sync. That is upstream's design and it is kept.
 *
 * 🔴 UPSTREAM BUG, FIXED HERE. Three rows check `blockedsettings` against the
 * wrong string: `modeOptions` and `parkposOptions` (the names of the OPTION
 * ARRAYS, not of the settings) and `hyperlapseCycle` (the camelCase computed,
 * where the setting is `hyperlapse_cycle`). moonraker-timelapse fills
 * `blockedsettings` with the snake_case keys it read out of moonraker.conf, so
 * upstream leaves those three editable when they are pinned -- the write is
 * then silently discarded by the component, and the UI shows the old value
 * again on the next reply. Here every row is gated on its own real key, which
 * is possible because the rows are a list rather than 900 lines of markup.
 *
 * NOT ported: nothing. Every row of upstream's tab is here.
 */
const timelapse = useTimelapseStore()
const webcams = useWebcamsStore()
const printer = usePrinterStore()

const settings = computed(() => timelapse.settings)

const set = (key: string, value: unknown) => timelapse.saveSetting({ [key]: value })

const blocked = (key: string) => timelapse.isBlocked(key)

/**
 * Only cameras with a snapshot URL: timelapse grabs stills, and a stream-only
 * camera would silently produce no frames. Upstream filters the same way.
 */
const cameraOptions = computed(() =>
    webcams.webcams
        .filter((webcam) => (webcam.snapshot_url ?? '') !== '')
        .map((webcam) => webcam.name)
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
)

/**
 * The park position has to land inside the printable area, so the bounds come
 * from the machine's own `toolhead` limits rather than from a guess.
 */
const axisRange = (index: number) => {
    const toolhead = printer.objects.toolhead as { axis_minimum?: number[]; axis_maximum?: number[] } | undefined
    return {
        min: toolhead?.axis_minimum?.[index] ?? 0,
        max: toolhead?.axis_maximum?.[index] ?? 0,
    }
}

const PARK_POSITIONS = ['center', 'front_left', 'front_right', 'back_left', 'back_right', 'x_only', 'y_only', 'custom']

const showX = computed(() => ['x_only', 'custom'].includes(settings.value.parkpos))
const showY = computed(() => ['y_only', 'custom'].includes(settings.value.parkpos))
const showDz = computed(() => ['x_only', 'y_only', 'custom'].includes(settings.value.parkpos))

/** Number rows: same shape repeated, so they are data rather than markup. */
interface NumberRow {
    key: string
    title: string
    description: string
    unit?: string
    step?: number
    min?: number
    max?: number
}

const renderNumbers = computed<NumberRow[]>(() => [
    ...(settings.value.variable_fps
        ? [
              {
                  key: 'targetlength',
                  title: 'Target length',
                  description: 'How long the finished video should be. The framerate is derived from it.',
                  unit: 's',
                  min: 1,
              },
              {
                  key: 'variable_fps_min',
                  title: 'Minimum framerate',
                  description: 'Floor for the derived framerate, so a short print does not become a slideshow.',
                  unit: 'fps',
                  min: 1,
              },
              {
                  key: 'variable_fps_max',
                  title: 'Maximum framerate',
                  description: 'Ceiling for the derived framerate.',
                  unit: 'fps',
                  min: 1,
              },
          ]
        : [
              {
                  key: 'output_framerate',
                  title: 'Framerate',
                  description: 'Frames per second of the finished video.',
                  unit: 'fps',
                  min: 1,
              },
          ]),
    {
        key: 'duplicatelastframe',
        title: 'Duplicate last frame',
        description: 'Extra copies of the final frame, so the video ends on the finished part instead of cutting away.',
        min: 0,
    },
    {
        key: 'constant_rate_factor',
        title: 'Constant rate factor',
        description: 'ffmpeg quality: lower is better and bigger. 23 is ffmpeg’s own default.',
        min: 0,
        max: 51,
    },
])

const parkNumbers = computed<NumberRow[]>(() => [
    ...(showX.value
        ? [
              {
                  key: 'park_custom_pos_x',
                  title: 'Park X',
                  description: `Within the machine’s X travel, ${axisRange(0).min}–${axisRange(0).max} mm.`,
                  unit: 'mm',
                  min: axisRange(0).min,
                  max: axisRange(0).max,
              },
          ]
        : []),
    ...(showY.value
        ? [
              {
                  key: 'park_custom_pos_y',
                  title: 'Park Y',
                  description: `Within the machine’s Y travel, ${axisRange(1).min}–${axisRange(1).max} mm.`,
                  unit: 'mm',
                  min: axisRange(1).min,
                  max: axisRange(1).max,
              },
          ]
        : []),
    ...(showDz.value
        ? [
              {
                  key: 'park_custom_pos_dz',
                  title: 'Park Z lift',
                  description: 'Raised by this much before parking, so the nozzle does not drag over the part.',
                  unit: 'mm',
                  min: 0,
              },
          ]
        : []),
    { key: 'park_travel_speed', title: 'Travel speed', description: 'Speed of the move to the park position.', unit: 'mm/s', min: 1 },
    ...(settings.value.fw_retract
        ? []
        : [
              { key: 'park_retract_speed', title: 'Retract speed', description: 'Retraction before parking.', unit: 'mm/s', min: 1 },
              { key: 'park_retract_distance', title: 'Retract distance', description: 'Filament pulled back before parking.', unit: 'mm', min: 0 },
              { key: 'park_extrude_speed', title: 'Unretract speed', description: 'Priming again after the frame is taken.', unit: 'mm/s', min: 1 },
              { key: 'park_extrude_distance', title: 'Unretract distance', description: 'Filament pushed back after the frame.', unit: 'mm', min: 0 },
          ]),
    {
        key: 'park_time',
        title: 'Park dwell',
        description: 'Time to stand still before the shutter, so the frame is not blurred by the move.',
        unit: 's',
        step: 0.01,
        min: 0,
    },
])

const textRows = [
    {
        key: 'pixelformat',
        title: 'Pixel format',
        description: 'ffmpeg pixel format. yuv420p is what plays everywhere.',
    },
    {
        key: 'time_format_code',
        title: 'Filename time format',
        description: 'strftime pattern the output file is named with.',
    },
    {
        key: 'extraoutputparams',
        title: 'Extra ffmpeg parameters',
        description: 'Appended to the ffmpeg command line, verbatim.',
    },
]

const onNumber = (key: string, event: Event) => {
    const value = Number((event.target as HTMLInputElement).value)
    if (!Number.isNaN(value)) set(key, value)
}

const onText = (key: string, event: Event) => set(key, (event.target as HTMLInputElement).value)

const inputClass =
    'tabular border-input bg-background focus-visible:ring-ring w-full rounded-md border px-2 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-40'
</script>

<template>
    <Card v-if="timelapse.available">
        <CardHeader><CardTitle>Timelapse</CardTitle></CardHeader>
        <CardContent class="@container flex flex-col">
            <div class="divide-border divide-y">
                <SettingRow
                    title="Enabled"
                    description="Capture frames during a print at all."
                    :blocked="blocked('enabled')">
                    <Switch
                        :model-value="settings.enabled"
                        :disabled="blocked('enabled')"
                        label="Enabled"
                        @update:model-value="set('enabled', $event)" />
                </SettingRow>

                <SettingRow
                    title="Auto render"
                    description="Render the video as soon as the print finishes."
                    :blocked="blocked('autorender')">
                    <Switch
                        :model-value="settings.autorender"
                        :disabled="blocked('autorender')"
                        label="Auto render"
                        @update:model-value="set('autorender', $event)" />
                </SettingRow>

                <SettingRow
                    title="Camera"
                    description="Only cameras that offer a snapshot URL can be used — a stream-only camera would produce no frames."
                    :blocked="blocked('camera')">
                    <select
                        :value="settings.camera"
                        :disabled="blocked('camera') || !cameraOptions.length"
                        aria-label="Camera"
                        :class="inputClass"
                        @change="onText('camera', $event)">
                        <option v-if="!cameraOptions.length" value="">No camera with a snapshot URL</option>
                        <option v-for="name in cameraOptions" :key="name" :value="name">{{ name }}</option>
                    </select>
                </SettingRow>

                <SettingRow
                    title="Mode"
                    description="layermacro takes a frame per layer; hyperlapse takes one on a timer, for prints whose layers are very fast or very slow."
                    :blocked="blocked('mode')">
                    <select
                        :value="settings.mode"
                        :disabled="blocked('mode')"
                        aria-label="Mode"
                        :class="inputClass"
                        @change="onText('mode', $event)">
                        <option value="layermacro">layermacro</option>
                        <option value="hyperlapse">hyperlapse</option>
                    </select>
                </SettingRow>

                <SettingRow
                    v-if="settings.mode === 'hyperlapse'"
                    title="Hyperlapse cycle"
                    description="Seconds between frames in hyperlapse mode."
                    :blocked="blocked('hyperlapse_cycle')">
                    <input
                        type="number"
                        :value="settings.hyperlapse_cycle"
                        :disabled="blocked('hyperlapse_cycle')"
                        :min="1"
                        aria-label="Hyperlapse cycle"
                        :class="inputClass"
                        @change="onNumber('hyperlapse_cycle', $event)" />
                </SettingRow>

                <SettingRow
                    title="Preview image"
                    description="Write a thumbnail beside the video."
                    :blocked="blocked('previewimage')">
                    <Switch
                        :model-value="settings.previewimage"
                        :disabled="blocked('previewimage')"
                        label="Preview image"
                        @update:model-value="set('previewimage', $event)" />
                </SettingRow>

                <SettingRow
                    title="Keep frames"
                    description="Zip the raw frames next to the video instead of deleting them. They are large."
                    :blocked="blocked('saveframes')">
                    <Switch
                        :model-value="settings.saveframes"
                        :disabled="blocked('saveframes')"
                        label="Keep frames"
                        @update:model-value="set('saveframes', $event)" />
                </SettingRow>

                <SettingRow
                    title="Stream delay compensation"
                    description="How long the camera lags behind reality. The frame is taken this much later so the toolhead is really parked in it."
                    :blocked="blocked('stream_delay_compensation')">
                    <input
                        type="number"
                        step="0.01"
                        :value="settings.stream_delay_compensation"
                        :disabled="blocked('stream_delay_compensation')"
                        aria-label="Stream delay compensation"
                        :class="inputClass"
                        @change="onNumber('stream_delay_compensation', $event)" />
                </SettingRow>

                <SettingRow
                    title="Verbose g-code"
                    description="Log each captured frame to the console. Useful once, noisy afterwards."
                    :blocked="blocked('gcode_verbose')">
                    <Switch
                        :model-value="settings.gcode_verbose"
                        :disabled="blocked('gcode_verbose')"
                        label="Verbose g-code"
                        @update:model-value="set('gcode_verbose', $event)" />
                </SettingRow>
            </div>

            <h4 class="pt-dpy pb-dgap text-sm font-semibold">Park head</h4>
            <div class="divide-border divide-y">
                <SettingRow
                    title="Park before each frame"
                    description="Move the toolhead out of shot before the shutter. Adds a move per layer."
                    :blocked="blocked('parkhead')">
                    <Switch
                        :model-value="settings.parkhead"
                        :disabled="blocked('parkhead')"
                        label="Park before each frame"
                        @update:model-value="set('parkhead', $event)" />
                </SettingRow>

                <template v-if="settings.parkhead">
                    <SettingRow title="Park position" description="Where the toolhead waits." :blocked="blocked('parkpos')">
                        <select
                            :value="settings.parkpos"
                            :disabled="blocked('parkpos')"
                            aria-label="Park position"
                            :class="inputClass"
                            @change="onText('parkpos', $event)">
                            <option v-for="option in PARK_POSITIONS" :key="option" :value="option">{{ option }}</option>
                        </select>
                    </SettingRow>

                    <SettingRow
                        title="Firmware retraction"
                        description="Use the printer's own G10/G11 instead of the four values below."
                        :blocked="blocked('fw_retract')">
                        <Switch
                            :model-value="settings.fw_retract"
                            :disabled="blocked('fw_retract')"
                            label="Firmware retraction"
                            @update:model-value="set('fw_retract', $event)" />
                    </SettingRow>

                    <SettingRow
                        v-for="row in parkNumbers"
                        :key="row.key"
                        :title="row.title"
                        :description="row.description"
                        :blocked="blocked(row.key)">
                        <input
                            type="number"
                            :value="settings[row.key]"
                            :disabled="blocked(row.key)"
                            :step="row.step ?? 1"
                            :min="row.min"
                            :max="row.max"
                            :aria-label="row.title"
                            :class="inputClass"
                            @change="onNumber(row.key, $event)" />
                    </SettingRow>
                </template>
            </div>

            <h4 class="pt-dpy pb-dgap text-sm font-semibold">Render</h4>
            <div class="divide-border divide-y">
                <SettingRow
                    title="Variable framerate"
                    description="Pick the framerate from the frame count so every video comes out about the same length."
                    :blocked="blocked('variable_fps')">
                    <Switch
                        :model-value="settings.variable_fps"
                        :disabled="blocked('variable_fps')"
                        label="Variable framerate"
                        @update:model-value="set('variable_fps', $event)" />
                </SettingRow>

                <SettingRow
                    v-for="row in renderNumbers"
                    :key="row.key"
                    :title="row.title"
                    :description="row.description"
                    :blocked="blocked(row.key)">
                    <input
                        type="number"
                        :value="settings[row.key]"
                        :disabled="blocked(row.key)"
                        :step="row.step ?? 1"
                        :min="row.min"
                        :max="row.max"
                        :aria-label="row.title"
                        :class="inputClass"
                        @change="onNumber(row.key, $event)" />
                </SettingRow>

                <SettingRow
                    v-for="row in textRows"
                    :key="row.key"
                    :title="row.title"
                    :description="row.description"
                    :blocked="blocked(row.key)">
                    <input
                        type="text"
                        :value="settings[row.key]"
                        :disabled="blocked(row.key)"
                        :aria-label="row.title"
                        :class="inputClass"
                        @change="onText(row.key, $event)" />
                </SettingRow>
            </div>
        </CardContent>
    </Card>
</template>
