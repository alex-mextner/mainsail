<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { rgbToHsv, hsvToRgb, rgbToCss, type Rgb } from '@/lib/color'

/**
 * Saturation/value square plus a hue strip -- what `@jaames/iro` gives upstream.
 *
 * Written here rather than pulled in as a dependency for the same reason every
 * Vuetify input in this rewrite was: iro owns its own DOM and its own colours,
 * and this app has to look right in light AND dark theme and at three interface
 * densities. See the note at the top of `lib/color.ts`.
 *
 * 🔴 Pointer events, not mouse events, and `setPointerCapture`: the primary
 * device for this page is the tablet at the machine. Without capture, a drag
 * that leaves the square stops updating instead of clamping -- which on a
 * small square is most drags.
 */
const props = defineProps<{ modelValue: Rgb; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [Rgb] }>()

/**
 * Hue is kept as its own state rather than derived on every render: black and
 * white have no hue, so round-tripping through RGB would reset the strip to red
 * as soon as the brightness reaches either end, and the user would lose the
 * colour they were adjusting.
 */
const hue = ref(rgbToHsv(props.modelValue).hue)
const dragging = ref(false)

watch(
    () => props.modelValue,
    (next) => {
        if (dragging.value) return
        const hsv = rgbToHsv(next)
        if (hsv.saturation > 0 && hsv.value > 0) hue.value = hsv.hue
    },
    { deep: true }
)

const hsv = computed(() => {
    const current = rgbToHsv(props.modelValue)
    return { hue: hue.value, saturation: current.saturation, value: current.value }
})

const hueCss = computed(() => rgbToCss(hsvToRgb({ hue: hue.value, saturation: 1, value: 1 })))
const swatchCss = computed(() => rgbToCss(props.modelValue))

const ratio = (event: PointerEvent, element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    return {
        x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
        y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    }
}

function track(event: PointerEvent, handler: (event: PointerEvent, element: HTMLElement) => void): void {
    if (props.disabled) return

    const element = event.currentTarget as HTMLElement
    element.setPointerCapture(event.pointerId)
    dragging.value = true
    handler(event, element)

    const move = (next: PointerEvent) => handler(next, element)
    const up = () => {
        dragging.value = false
        element.removeEventListener('pointermove', move)
        element.removeEventListener('pointerup', up)
        element.removeEventListener('pointercancel', up)
    }

    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', up)
    element.addEventListener('pointercancel', up)
}

const onSquare = (event: PointerEvent, element: HTMLElement) => {
    const { x, y } = ratio(event, element)
    emit('update:modelValue', hsvToRgb({ hue: hue.value, saturation: x, value: 1 - y }))
}

const onHue = (event: PointerEvent, element: HTMLElement) => {
    const { x } = ratio(event, element)
    hue.value = Math.round(x * 360)
    emit('update:modelValue', hsvToRgb({ hue: hue.value, saturation: hsv.value.saturation, value: hsv.value.value }))
}

/** Keyboard path: a colour picker that only answers to a pointer is unusable. */
function nudge(deltaSaturation: number, deltaValue: number): void {
    if (props.disabled) return
    const current = hsv.value
    emit(
        'update:modelValue',
        hsvToRgb({
            hue: hue.value,
            saturation: Math.min(1, Math.max(0, current.saturation + deltaSaturation)),
            value: Math.min(1, Math.max(0, current.value + deltaValue)),
        })
    )
}

function nudgeHue(delta: number): void {
    if (props.disabled) return
    hue.value = (hue.value + delta + 360) % 360
    emit('update:modelValue', hsvToRgb({ hue: hue.value, saturation: hsv.value.saturation, value: hsv.value.value }))
}
</script>

<template>
    <div class="flex flex-col gap-3" :class="disabled ? 'pointer-events-none opacity-50' : ''">
        <div
            role="slider"
            tabindex="0"
            aria-label="Saturation and brightness"
            :aria-valuetext="`saturation ${Math.round(hsv.saturation * 100)}%, brightness ${Math.round(hsv.value * 100)}%`"
            class="focus-visible:ring-ring relative h-40 w-full cursor-crosshair touch-none rounded-lg border focus-visible:ring-2 focus-visible:outline-none"
            :style="{ backgroundColor: hueCss }"
            @pointerdown="track($event, onSquare)"
            @keydown.left.prevent="nudge(-0.02, 0)"
            @keydown.right.prevent="nudge(0.02, 0)"
            @keydown.up.prevent="nudge(0, 0.02)"
            @keydown.down.prevent="nudge(0, -0.02)">
            <div class="absolute inset-0 rounded-lg bg-[linear-gradient(to_right,#fff,rgba(255,255,255,0))]" />
            <div class="absolute inset-0 rounded-lg bg-[linear-gradient(to_top,#000,rgba(0,0,0,0))]" />
            <div
                class="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
                :style="{
                    left: `${hsv.saturation * 100}%`,
                    top: `${(1 - hsv.value) * 100}%`,
                    backgroundColor: swatchCss,
                }" />
        </div>

        <div
            role="slider"
            tabindex="0"
            aria-label="Hue"
            :aria-valuenow="hue"
            :aria-valuemin="0"
            :aria-valuemax="360"
            class="focus-visible:ring-ring relative h-4 w-full cursor-pointer touch-none rounded-full border bg-[linear-gradient(to_right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)] focus-visible:ring-2 focus-visible:outline-none"
            @pointerdown="track($event, onHue)"
            @keydown.left.prevent="nudgeHue(-5)"
            @keydown.right.prevent="nudgeHue(5)">
            <div
                class="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
                :style="{ left: `${(hue / 360) * 100}%`, backgroundColor: hueCss }" />
        </div>
    </div>
</template>
