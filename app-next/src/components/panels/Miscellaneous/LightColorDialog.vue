<script setup lang="ts">
import { computed } from 'vue'
import Dialog from '@/components/ui/Dialog.vue'
import NumberInput from '@/components/ui/NumberInput.vue'
import ColorField from '@/components/ui/ColorField.vue'
import { rgbToCss, type Rgb } from '@/lib/color'
import { convertName } from '@/lib/format'

/**
 * The colour picker behind a light's swatch -- Mainsail's
 * `dialogs/MiscellaneousLightNeopixelDialog.vue`.
 *
 * Channels are addressed by what the light HAS, never by assumption: a strip
 * with no `white_pin` gets no white control, and one with only a red channel
 * gets one slider. This machine's `[led rgb_strip]` declares red/green/blue and
 * no white, so the W row never renders here -- upstream's `colorOrder` logic,
 * kept because it is exactly right.
 *
 * 🔴 DELIBERATE ADDITION: the preset row.
 * Upstream's presets are user-defined and stored in the Moonraker database --
 * the same namespace the working Mainsail on port 80 owns, which this app is
 * not allowed to write. So instead of an empty feature or a second settings
 * surface, the presets here are DERIVED: the saturated corners of the light's
 * own colour order, which is the set every RGB light can reach exactly.
 *
 * That is also the honest control for THIS strip. Its three channels are bare
 * MOSFET gates with no dimming stage; smoke-siren-daemon.py thresholds each
 * channel at 0.5 before mirroring it onto the real gate, so the wheel's
 * brightness axis snaps to full-on or full-off and only the eight corners are
 * physically distinct (printer-configs/rgb-status.cfg, "DIMMING: THRESHOLD, NOT
 * SMOOTH"). The wheel is still ported for any machine that can dim; the corners
 * are one tap away for the one that cannot.
 */
const props = defineProps<{
    name: string
    /** "RGB", "RGBW", "W", ... -- which channels exist. */
    colorOrder: string
    /** Current channel values, 0..1, in R G B W order. */
    current: number[]
    /** Configured `initial_*` values, 0..1, for the reset buttons. */
    initial: number[]
}>()

const emit = defineEmits<{ 'update-color': [red: number, green: number, blue: number, white: number] }>()

const open = defineModel<boolean>({ required: true })

const has = (channel: string) => props.colorOrder.includes(channel)

const to255 = (value: number | undefined) => Math.round((value ?? 0) * 255)

const rgb = computed<Rgb>(() => ({
    red: to255(props.current[0]),
    green: to255(props.current[1]),
    blue: to255(props.current[2]),
}))

const white = computed(() => to255(props.current[3]))

/** Emit in the 0..1 units SET_LED takes, two decimals like upstream. */
function push(next: { red?: number; green?: number; blue?: number; white?: number }): void {
    const round = (value: number) => Math.round((value / 255) * 100) / 100

    emit(
        'update-color',
        round(next.red ?? rgb.value.red),
        round(next.green ?? rgb.value.green),
        round(next.blue ?? rgb.value.blue),
        round(next.white ?? white.value)
    )
}

const onField = (value: Rgb) => push(value)

const onInput = (payload: { name: string; value: number }) => push({ [payload.name]: payload.value })

/**
 * Every combination of the channels this light has, off first. Three channels
 * give the familiar eight; a single-channel light gives off and on.
 */
const presets = computed(() => {
    const channels = ['R', 'G', 'B'].filter(has)
    const combinations: Rgb[] = []

    for (let mask = 0; mask < 2 ** channels.length; mask++) {
        const value: Rgb = { red: 0, green: 0, blue: 0 }
        channels.forEach((channel, index) => {
            if (!(mask & (1 << index))) return
            if (channel === 'R') value.red = 255
            if (channel === 'G') value.green = 255
            if (channel === 'B') value.blue = 255
        })
        combinations.push(value)
    }

    return combinations
})

const isCurrent = (preset: Rgb) =>
    preset.red === rgb.value.red && preset.green === rgb.value.green && preset.blue === rgb.value.blue

/** Klipper's config keys are lower-case: `initial_RED` arrives as `initial_red`. */
const initial255 = (index: number) => to255(props.initial[index])
</script>

<template>
    <Dialog v-model="open" :title="convertName(name)" description="Set this light's colour" content-class="w-[min(92vw,26rem)]">
        <div class="flex flex-col gap-4">
            <div v-if="presets.length > 1" class="flex flex-wrap justify-center gap-2">
                <button
                    v-for="preset in presets"
                    :key="rgbToCss(preset)"
                    type="button"
                    class="size-8 rounded-md border-2 transition-transform hover:scale-105"
                    :class="isCurrent(preset) ? 'border-primary' : 'border-border'"
                    :style="{ backgroundColor: rgbToCss(preset) }"
                    :aria-label="`Set ${rgbToCss(preset)}`"
                    @click="push(preset)" />
            </div>

            <ColorField v-if="has('R') && has('G') && has('B')" :model-value="rgb" @update:model-value="onField" />

            <div class="grid grid-cols-2 gap-2">
                <NumberInput
                    v-if="has('R')"
                    param="red"
                    label="Red"
                    :target="rgb.red"
                    :default-value="initial255(0)"
                    :min="0"
                    :max="255"
                    :dec="0"
                    :step="1"
                    has-spinner
                    submit-on-blur
                    @submit="onInput" />
                <NumberInput
                    v-if="has('G')"
                    param="green"
                    label="Green"
                    :target="rgb.green"
                    :default-value="initial255(1)"
                    :min="0"
                    :max="255"
                    :dec="0"
                    :step="1"
                    has-spinner
                    submit-on-blur
                    @submit="onInput" />
                <NumberInput
                    v-if="has('B')"
                    param="blue"
                    label="Blue"
                    :target="rgb.blue"
                    :default-value="initial255(2)"
                    :min="0"
                    :max="255"
                    :dec="0"
                    :step="1"
                    has-spinner
                    submit-on-blur
                    @submit="onInput" />
                <NumberInput
                    v-if="has('W')"
                    param="white"
                    label="White"
                    :target="white"
                    :default-value="initial255(3)"
                    :min="0"
                    :max="255"
                    :dec="0"
                    :step="1"
                    has-spinner
                    submit-on-blur
                    @submit="onInput" />
            </div>
        </div>
    </Dialog>
</template>
