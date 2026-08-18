<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { SliderRoot, SliderTrack, SliderRange, SliderThumb } from 'reka-ui'
import { mdiFan, mdiToggleSwitch, mdiToggleSwitchOffOutline, mdiMinus, mdiPlus, mdiFlashOutline } from '@mdi/js'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import { useConnectionStore } from '@/stores/connection'
import { convertName } from '@/lib/format'
import type { MiscellaneousEntry } from '@/composables/useMiscellaneous'

/**
 * One fan or output pin -- Mainsail's `components/inputs/MiscellaneousSlider.vue`.
 *
 * Three shapes in one row, decided by the object rather than by a prop:
 *   read-only (heater_fan, controller_fan)  -> a percentage, no control
 *   on/off    (plain output_pin)            -> a switch
 *   continuous(fan, fan_generic, pwm pins)  -> a slider with a number field
 *
 * Upstream's `off_below` snapping is kept verbatim, and it is not cosmetic: a
 * fan below its stall threshold draws current, makes noise and does not turn,
 * so dragging DOWN past the threshold snaps to 0 and dragging UP from 0 snaps
 * to the threshold. Neither direction lets the slider rest in the dead band.
 *
 * NOT ported: upstream's `lockSlidersOnTouchDevices` (a padlock that disarms
 * sliders on touch screens). It hangs off a `uiSettings` branch that does not
 * exist in this store yet; worth revisiting for the tablet at the machine, and
 * called out here rather than left as a silent omission.
 */
const props = defineProps<{ entry: MiscellaneousEntry }>()

const connection = useConnectionStore()

/** Reported value normalised to 0..1, upstream's rounding included. */
const value = computed(() => Math.round((props.entry.power / props.entry.maxPower) * 100) / 100)

const sliderValue = ref(value.value)
const inputValue = ref(String(Math.round(value.value * 100)))
const dragging = ref(false)

watch(value, (next) => {
    if (dragging.value) return
    sliderValue.value = next
})

watch(sliderValue, (next) => {
    inputValue.value = String(Math.round(next * 100))
})

const isOn = computed(() => value.value > 0)

function send(next: number): void {
    if (value.value === next) return

    const scaled = next * props.entry.scale
    const { type, name, ledChannel } = props.entry

    let gcode = `SET_PIN PIN=${name} VALUE=${scaled.toFixed(2)}`
    if (type === 'fan') gcode = `M106 S${scaled.toFixed(0)}`
    if (type === 'fan_generic') gcode = `SET_FAN_SPEED FAN=${name} SPEED=${next}`
    // `SYNC=0` is upstream's, and it is the right one on this machine: SYNC=1
    // routes the change through `toolhead.register_lookahead_callback`, the
    // same path this project already had flip `idle_timeout` to "Printing".
    // rgb-status.cfg records that Mainsail's own value here had not been
    // checked against Mainsail's source -- it is SYNC=0, in both of upstream's
    // two SET_LED call sites.
    if (type === 'led') gcode = `SET_LED LED=${name} ${ledChannel}=${next.toFixed(2)} SYNC=0 TRANSMIT=1`

    void connection.sendGcode(gcode)
}

/** Upstream's rule: never come to rest inside the stall band. */
function snap(next: number): number {
    const { offBelow } = props.entry
    if (!offBelow) return next
    if (next < value.value && next < offBelow) return 0
    if (next > value.value && next < offBelow) return offBelow
    return next
}

let debounce: ReturnType<typeof setTimeout> | null = null
onUnmounted(() => {
    if (debounce) clearTimeout(debounce)
})

function commit(): void {
    if (debounce) clearTimeout(debounce)
    // 500 ms, upstream's own: a drag would otherwise queue one command per pixel
    // into the same gcode queue the print is moving through.
    debounce = setTimeout(() => {
        sliderValue.value = snap(sliderValue.value)
        send(sliderValue.value)
    }, 500)
}

function onSlide(next: number[] | undefined): void {
    if (!next?.length) return
    dragging.value = true
    sliderValue.value = next[0] / 100
    commit()
}

function nudge(delta: number): void {
    const next = Math.min(1, Math.max(0, Math.round((value.value + delta) * 100) / 100))
    sliderValue.value = snap(next)
    send(sliderValue.value)
}

function submitInput(): void {
    const parsed = Number(inputValue.value)
    if (Number.isNaN(parsed)) {
        inputValue.value = String(Math.round(value.value * 100))
        return
    }

    const next = Math.min(1, Math.max(0, parsed / 100))
    sliderValue.value = snap(next)
    send(sliderValue.value)
}

function toggle(): void {
    const next = isOn.value ? 0 : 1
    void connection.sendGcode(`SET_PIN PIN=${props.entry.name} VALUE=${(next * props.entry.scale).toFixed(2)}`)
}

const icon = computed(() => (props.entry.type.includes('fan') ? mdiFan : mdiFlashOutline))
/** A fan reporting 0 RPM while it is being driven is a dead fan, not a detail. */
const rpmStalled = computed(() => props.entry.rpm === 0 && value.value > 0)
</script>

<template>
    <div class="py-drow flex flex-col gap-1">
        <div class="flex items-center gap-2">
            <MdiIcon
                :path="icon"
                class="text-muted-foreground size-4 shrink-0"
                :class="entry.type.includes('fan') && isOn && value >= entry.offBelow ? 'animate-[misc-spin_1.4s_linear_infinite]' : ''" />
            <span class="truncate text-sm">{{ convertName(entry.name) }}</span>

            <span class="grow" />

            <small v-if="entry.rpm !== null" class="tabular text-xs" :class="rpmStalled ? 'text-destructive' : 'text-muted-foreground'">
                {{ Math.round(entry.rpm) }} RPM
            </small>

            <span v-if="!entry.controllable" class="tabular text-sm font-semibold">{{ Math.round(value * 100) }} %</span>

            <button
                v-else-if="!entry.pwm"
                type="button"
                class="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-md focus-visible:ring-2 focus-visible:outline-none"
                :aria-label="`Toggle ${entry.name}`"
                :aria-pressed="isOn"
                @click="toggle">
                <MdiIcon :path="isOn ? mdiToggleSwitch : mdiToggleSwitchOffOutline" class="size-6" :class="isOn ? 'text-primary' : ''" />
            </button>

            <form v-else class="flex items-center gap-1" @submit.prevent="submitInput">
                <input
                    v-model="inputValue"
                    type="number"
                    inputmode="numeric"
                    :aria-label="entry.name"
                    class="tabular border-input bg-background focus-visible:ring-ring w-14 rounded-md border px-2 py-1 text-right text-sm focus-visible:ring-2 focus-visible:outline-none"
                    @blur="submitInput"
                    @focus="($event.target as HTMLInputElement).select()" />
                <span class="text-muted-foreground text-xs">%</span>
            </form>
        </div>

        <!--
            The reason is rendered, not just enforced. A control that is simply
            missing reads as a porting gap; a control that explains itself reads
            as a decision -- and this one is about a fire alarm.
        -->
        <p v-if="entry.readOnlyReason" class="text-muted-foreground text-xs">{{ entry.readOnlyReason }}</p>

        <div v-if="entry.controllable && entry.pwm" class="flex items-center gap-2">
            <button
                type="button"
                class="text-muted-foreground hover:text-foreground disabled:opacity-30"
                :disabled="sliderValue <= 0"
                :aria-label="`Decrease ${entry.name}`"
                @click="nudge(-0.01)">
                <MdiIcon :path="mdiMinus" class="size-4" />
            </button>

            <SliderRoot
                class="relative flex h-5 w-full grow touch-none items-center select-none"
                :model-value="[Math.round(sliderValue * 100)]"
                :min="0"
                :max="100"
                :step="1"
                @update:model-value="onSlide"
                @value-commit="dragging = false">
                <SliderTrack class="bg-muted relative h-1.5 w-full grow rounded-full">
                    <!-- Red while the handle sits in the stall band it is about
                         to be snapped out of: the colour is the only warning
                         upstream gives, and it is the right one. -->
                    <SliderRange
                        class="absolute h-full rounded-full"
                        :class="sliderValue > 0 && sliderValue < entry.offBelow ? 'bg-destructive' : 'bg-primary'" />
                </SliderTrack>
                <SliderThumb
                    class="border-background focus-visible:ring-ring bg-primary block size-4 rounded-full border-2 shadow"
                    :aria-label="entry.name" />
            </SliderRoot>

            <button
                type="button"
                class="text-muted-foreground hover:text-foreground disabled:opacity-30"
                :disabled="sliderValue >= 1"
                :aria-label="`Increase ${entry.name}`"
                @click="nudge(0.01)">
                <MdiIcon :path="mdiPlus" class="size-4" />
            </button>
        </div>
    </div>
</template>

<style>
@keyframes misc-spin {
    from {
        transform: rotate(0deg);
    }
    to {
        transform: rotate(360deg);
    }
}
</style>
