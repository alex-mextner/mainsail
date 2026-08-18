<script setup lang="ts">
import { computed } from 'vue'
import { mdiFileOutline } from '@mdi/js'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import { Progress } from '@/components/ui/progress'
import WebcamHudChart from '@/components/webcams/WebcamHudChart.vue'
import WebcamHudModel from '@/components/webcams/WebcamHudModel.vue'
import { usePrinterStore } from '@/stores/printer'
import { useSensorColors } from '@/composables/useSensorColors'
import { useCurrentFile, formatDuration } from '@/composables/useCurrentFile'

/**
 * The readings overlaid on the fullscreen camera: what is printing, how far it
 * got, the two heaters, layer, speed, remaining, ETA, and a short temperature
 * chart.
 *
 * Three layouts, chosen by the overlay from the measured black bars:
 *   floating   -- a card on top of the image (no bar big enough)
 *   vertical   -- a column filling a pillarbox bar
 *   horizontal -- a row filling a letterbox bar
 *
 * The hud is always on a dark surface, so it does NOT follow the light/dark
 * theme: white text and translucent black throughout.
 */
const props = withDefaults(
    defineProps<{
        layout?: 'floating' | 'vertical' | 'horizontal'
        chartHeight?: number
        showChart?: boolean
        showModel?: boolean
    }>(),
    { layout: 'floating', chartHeight: 110, showChart: true, showModel: false }
)

const printer = usePrinterStore()
const { colorOf } = useSensorColors()
const { meta, printStats, filename, progress } = useCurrentFile()

const shortName = computed(() => filename.value.split('/').pop() ?? '')

const state = computed(() => printStats.value?.state ?? 'standby')

/** Only these two states have a job still in flight. */
const isLive = computed(() => state.value === 'printing' || state.value === 'paused')

/** Nozzle and bed only. Nobody watches the host thermometer over a camera. */
const heaters = computed(() =>
    printer.heaters
        .filter((heater) => heater.name === 'extruder' || heater.name === 'heater_bed')
        .map((heater) => ({
            key: heater.name,
            label: heater.name === 'heater_bed' ? 'Bed' : 'Nozzle',
            color: colorOf(heater.name),
            temperature: heater.temperature.toFixed(0),
            target: heater.target.toFixed(0),
        }))
)

/**
 * Klipper only publishes layer numbers when the slicer emits
 * `SET_PRINT_STATS_INFO`. This machine's profile does not, so the metadata's
 * layer count is the honest fallback and a dash is the honest answer -- same
 * rule as the dashboard status panel, deliberately not "fixed" with a guess
 * derived from Z height.
 */
const layer = computed(() => {
    const info = printStats.value?.info
    if (info?.current_layer && info?.total_layer) return `${info.current_layer} / ${info.total_layer}`
    if (meta.value?.layer_count) return `— / ${meta.value.layer_count}`
    return '—'
})

const speed = computed(() => {
    const velocity = printer.motionReport?.live_velocity
    if (typeof velocity !== 'number') return '—'
    return Math.abs(velocity).toFixed(0)
})

const remainingSeconds = computed(() => {
    if (!isLive.value) return null

    const estimated = meta.value?.estimated_time ?? 0
    const done = printStats.value?.print_duration ?? 0
    if (!estimated || done <= 0) return null

    return Math.max(0, estimated - done)
})

const remaining = computed(() => (remainingSeconds.value === null ? '—' : formatDuration(remainingSeconds.value)))

/** Wall-clock finish time, which is what you want when deciding to walk away. */
const eta = computed(() => {
    if (remainingSeconds.value === null) return '—'

    const finish = new Date(Date.now() + remainingSeconds.value * 1000)
    return `${String(finish.getHours()).padStart(2, '0')}:${String(finish.getMinutes()).padStart(2, '0')}`
})

const isHorizontal = computed(() => props.layout === 'horizontal')
const isDocked = computed(() => props.layout !== 'floating')

const rootClass = computed(() => [
    'flex text-white',
    isDocked.value
        ? // No scrim when docked: there is no image behind the hud in a black
          // bar, and a drop shadow would only smear onto it.
          //
          // `overflow-hidden` is a backstop, not the layout. The bar has a fixed
          // measured height, and content that outgrows it used to run off the
          // bottom of the screen -- clipped is bad, off-screen is worse. The
          // actual fix is WEBCAM_HUD_MIN_ROW_CHART_WIDTH, which keeps the
          // readings on one line; this only catches whatever comes next.
          'h-full overflow-hidden bg-black/35'
        : 'rounded-lg bg-black/55 shadow-[0_2px_18px_rgba(0,0,0,0.45)] backdrop-blur-sm',
    isHorizontal.value ? 'flex-row items-center gap-x-6 px-4 py-2' : 'flex-col px-4 pt-3 pb-1',
])
</script>

<template>
    <div :class="rootClass">
        <div :class="isHorizontal ? 'min-w-0 flex-[0_1_260px]' : 'mb-0.5'">
            <div class="mb-2 flex items-center">
                <MdiIcon :path="mdiFileOutline" class="mr-2 size-4 shrink-0 text-white/60" />
                <span class="min-w-0 flex-1 truncate text-[0.85rem] text-white/75">
                    {{ shortName || 'No file loaded' }}
                </span>
                <span
                    class="ml-3 shrink-0 rounded-[10px] bg-white/12 px-2 py-px text-[0.7rem] tracking-[0.06em] uppercase">
                    {{ state }}
                </span>
            </div>

            <div v-if="isLive" class="flex items-center" :class="isHorizontal ? '' : 'mb-2.5'">
                <Progress :model-value="progress" class="h-1.5 bg-white/15" indicator-class="bg-white" />
                <span class="tabular ml-2.5 shrink-0 text-[0.8rem]">{{ progress }} %</span>
            </div>
        </div>

        <!--
            In a letterbox bar these six readings have to stay on ONE line: the
            bar's height is whatever the window gives it, and a wrapped second
            line runs off the bottom of the screen. Hence the tighter gap here
            than in the other two layouts, and `justify-between` rather than
            `justify-around` -- `around` spends the slack on outer margins,
            which is exactly the space the sixth reading needs.
        -->
        <div
            class="flex flex-wrap gap-y-1.5"
            data-overcam-stats
            :class="
                isHorizontal
                    ? 'flex-1 justify-between gap-x-4'
                    : layout === 'vertical'
                      ? 'gap-x-6 gap-y-2.5'
                      : 'gap-x-6'
            ">
            <div v-for="heater in heaters" :key="heater.key" class="flex min-w-[72px] flex-col">
                <span class="flex items-center text-[0.65rem] tracking-[0.06em] text-white/60 uppercase">
                    <span class="mr-1.5 inline-block size-2 rounded-full" :style="{ backgroundColor: heater.color }" />
                    {{ heater.label }}
                </span>
                <span class="tabular text-[1.15rem] leading-[1.3]">
                    {{ heater.temperature }}
                    <small class="text-[0.7rem] text-white/60">/ {{ heater.target }} °C</small>
                </span>
            </div>

            <div class="flex min-w-[72px] flex-col">
                <span class="text-[0.65rem] tracking-[0.06em] text-white/60 uppercase">Layer</span>
                <span class="tabular text-[1.15rem] leading-[1.3]">{{ layer }}</span>
            </div>

            <div class="flex min-w-[72px] flex-col">
                <span class="text-[0.65rem] tracking-[0.06em] text-white/60 uppercase">Speed</span>
                <span class="tabular text-[1.15rem] leading-[1.3]">
                    {{ speed }}
                    <small class="text-[0.7rem] text-white/60">mm/s</small>
                </span>
            </div>

            <div class="flex min-w-[72px] flex-col">
                <span class="text-[0.65rem] tracking-[0.06em] text-white/60 uppercase">Remaining</span>
                <span class="tabular text-[1.15rem] leading-[1.3]">{{ remaining }}</span>
            </div>

            <div class="flex min-w-[72px] flex-col">
                <span class="text-[0.65rem] tracking-[0.06em] text-white/60 uppercase">ETA</span>
                <span class="tabular text-[1.15rem] leading-[1.3]">{{ eta }}</span>
            </div>
        </div>

        <!--
            Between the readings and the chart, which in a docked bar is the
            vertical middle - and, since the bar became the sum of both
            letterbox strips, the empty half of it. In a column the tile eats
            whatever gap `mt-auto` used to leave; in a row it is a square as
            tall as the row, which only appears above the width gate so it can
            never squeeze the numbers onto a second line.

            Floating over the image the tile is left out on purpose: that card
            is 420px wide and sits ON the picture, so a model there would cover
            the very thing being watched.
        -->
        <WebcamHudModel v-if="showModel" :class="isHorizontal ? 'my-0 aspect-square max-w-[40%] flex-none self-stretch' : ''" />

        <!-- In a side bar the chart is pushed to the bottom so the column fills
             the whole bar instead of leaving a gap under the numbers. -->
        <WebcamHudChart
            v-if="showChart"
            :height="chartHeight"
            data-overcam-chart
            :class="
                isHorizontal ? 'mt-0 min-w-[160px] flex-[0_1_340px]' : layout === 'vertical' ? 'mt-auto' : 'mt-1'
            " />
    </div>
</template>
