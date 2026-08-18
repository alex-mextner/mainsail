<script setup lang="ts">
import { ref, computed } from 'vue'
import { mdiLightbulbOutline, mdiLightbulbOnOutline } from '@mdi/js'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import MiscellaneousControl from './MiscellaneousControl.vue'
import LightColorDialog from './LightColorDialog.vue'
import { useConnectionStore } from '@/stores/connection'
import { useMiscellaneous, type LightEntry, type MiscellaneousEntry } from '@/composables/useMiscellaneous'
import { convertName } from '@/lib/format'
import { rgbToCss } from '@/lib/color'

/**
 * One `[led]` / `[neopixel]` / `[dotstar]` / `[pca95xx]` -- Mainsail's
 * `Miscellaneous/MiscellaneousLight.vue` plus its Neopixel child.
 *
 * Two shapes, decided by the light itself: a single-channel light is a
 * brightness slider (nothing to pick), anything with more is a bulb switch, a
 * swatch of the live colour, and a picker behind the swatch.
 *
 * NOT ported: light GROUPS (upstream lets you carve a 60-LED chain into named
 * ranges and colour them separately). They are configured in Settings and
 * stored in the Moonraker database this app must not write, and this machine's
 * strip is a single `[led]` with one element -- there is nothing to carve. The
 * chain length is read below rather than assumed, so a chain still colours as
 * a whole instead of colouring only its first pixel.
 */
const props = defineProps<{ light: LightEntry }>()

const connection = useConnectionStore()
const { colorOrder, colorData, chainCount, settingsOf } = useMiscellaneous()

const showDialog = ref(false)

const order = computed(() => colorOrder(props.light))
const current = computed(() => colorData(props.light, 0))

const isOn = computed(() => current.value.slice(0, 4).reduce((sum, value) => sum + (value ?? 0), 0) > 0)

const swatch = computed(() => {
    const [red = 0, green = 0, blue = 0, white = 0] = current.value
    // A white-only pixel would otherwise read as black; upstream's fallback.
    if (red === 0 && green === 0 && blue === 0 && white > 0) {
        const level = Math.round(white * 255)
        return rgbToCss({ red: level, green: level, blue: level })
    }
    return rgbToCss({ red: red * 255, green: green * 255, blue: blue * 255 })
})

/** Configured `initial_*`, for the dialog's reset-to-config buttons. */
const initial = computed(() => {
    const settings = settingsOf(props.light.key)
    const read = (key: string) => (typeof settings[key] === 'number' ? (settings[key] as number) : 0)
    return [read('initial_red'), read('initial_green'), read('initial_blue'), read('initial_white')]
})

function send(red: number, green: number, blue: number, white: number): void {
    const parts = ['SET_LED', `LED="${props.light.name}"`]

    if (order.value.includes('R')) parts.push(`RED=${red}`)
    if (order.value.includes('G')) parts.push(`GREEN=${green}`)
    if (order.value.includes('B')) parts.push(`BLUE=${blue}`)
    if (order.value.includes('W')) parts.push(`WHITE=${white}`)

    // See the SYNC note in MiscellaneousControl.vue.
    parts.push('SYNC=0')

    /**
     * A chain has to be written element by element -- SET_LED without INDEX
     * addresses the whole strip in recent Klipper, but INDEX is what upstream
     * uses and what works across versions. TRANSMIT=1 only on the last line, so
     * a 60-pixel chain is one transmission rather than sixty.
     */
    const count = chainCount(props.light)
    if (count <= 1) {
        void connection.sendGcode(`${parts.join(' ')} TRANSMIT=1`)
        return
    }

    const lines = Array.from({ length: count }, (_, index) => `${parts.join(' ')} INDEX=${index + 1}`)
    lines[lines.length - 1] += ' TRANSMIT=1'
    void connection.sendGcode(lines.join('\n'))
}

function toggle(): void {
    if (isOn.value) return send(0, 0, 0, 0)
    // Upstream: a light with a dedicated white channel turns on white, not
    // all-channels-white, because that is what the hardware is for.
    if (order.value.includes('W')) return send(0, 0, 0, 1)
    send(1, 1, 1, 1)
}

/** A one-channel light is a dimmer, so it renders as the ordinary slider row. */
const singleChannel = computed<MiscellaneousEntry | null>(() => {
    if (order.value.length !== 1) return null

    const channel = order.value
    const index = { R: 0, G: 1, B: 2, W: 3 }[channel] ?? 0

    return {
        key: props.light.key,
        name: props.light.name,
        type: 'led',
        power: current.value[index] ?? 0,
        rpm: null,
        controllable: true,
        pwm: true,
        scale: 1,
        offBelow: 0,
        maxPower: 1,
        readOnlyReason: null,
        ledChannel: ({ R: 'RED', G: 'GREEN', B: 'BLUE', W: 'WHITE' } as const)[channel] ?? 'WHITE',
    }
})
</script>

<template>
    <MiscellaneousControl v-if="singleChannel" :entry="singleChannel" />

    <div v-else class="py-drow flex items-center gap-2">
        <button
            type="button"
            class="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-md focus-visible:ring-2 focus-visible:outline-none"
            :aria-label="`Toggle ${light.name}`"
            :aria-pressed="isOn"
            @click="toggle">
            <MdiIcon :path="isOn ? mdiLightbulbOnOutline : mdiLightbulbOutline" class="size-4" :class="isOn ? 'text-primary' : ''" />
        </button>

        <span class="truncate text-sm">{{ convertName(light.name) }}</span>

        <span class="grow" />

        <button
            type="button"
            class="border-border focus-visible:ring-ring size-5 rounded-full border shadow-inner focus-visible:ring-2 focus-visible:outline-none"
            :style="{ backgroundColor: swatch }"
            :aria-label="`Pick a colour for ${light.name}`"
            @click="showDialog = true" />

        <LightColorDialog
            v-model="showDialog"
            :name="light.name"
            :color-order="order"
            :current="current"
            :initial="initial"
            @update-color="send" />
    </div>
</template>
