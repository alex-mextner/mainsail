<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { SliderRoot, SliderTrack, SliderRange, SliderThumb } from 'reka-ui'
import { mdiMinus, mdiPlus, mdiRestart } from '@mdi/js'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import { useConnectionStore } from '@/stores/connection'

/**
 * Percentage slider that sends a g-code on change -- Mainsail's
 * `components/inputs/ToolSlider.vue`.
 *
 * Used by speed factor (M220), extrusion factor (M221) and the fan sliders, so
 * the behaviours below are worth keeping exactly: the 250 ms debounce (dragging
 * a slider would otherwise queue a command per pixel), and the "dynamic range"
 * that lets the track grow past `max` when the printer reports a factor above
 * it -- a slicer can set 150 % speed and the slider must be able to show it.
 */
const props = withDefaults(
    defineProps<{
        /** Live value from the printer, in printer units (0..1 for factors). */
        target: number
        /** Command to send, e.g. "M220". */
        command: string
        /** Parameter letter, e.g. "S". */
        attributeName?: string
        label?: string
        icon?: string
        unit?: string
        min?: number
        max?: number
        /** target * multi = displayed value. 100 turns 0..1 into a percentage. */
        multi?: number
        step?: number
        defaultValue?: number
        attributeScale?: number
        dynamicRange?: boolean
        hasInputField?: boolean
        disabled?: boolean
    }>(),
    {
        attributeName: '',
        label: '',
        icon: '',
        unit: '%',
        min: 0,
        max: 100,
        multi: 1,
        step: 1,
        defaultValue: 100,
        attributeScale: 1,
        dynamicRange: false,
        hasInputField: false,
        disabled: false,
    }
)

const connection = useConnectionStore()

const value = ref(Math.round(props.target * props.multi))
const numInput = ref(String(value.value))
/** Half of `max`, upstream's growth quantum for the dynamic range. */
const dynamicStep = computed(() => Math.max(1, Math.floor(props.max / 2)))
const processedMax = ref(props.max)

const growToFit = (candidate: number) => {
    if (!props.dynamicRange) return
    if (candidate >= processedMax.value) processedMax.value = candidate + dynamicStep.value
}

growToFit(value.value)

/** Follow the printer unless the user is mid-drag. */
const dragging = ref(false)
watch(
    () => props.target,
    (next) => {
        if (dragging.value) return
        value.value = Math.round(next * props.multi)
        growToFit(value.value)
    }
)

watch(
    () => props.max,
    (next) => {
        processedMax.value = next > value.value ? next : Math.ceil(value.value / dynamicStep.value) * dynamicStep.value
    }
)

watch(value, (next) => {
    numInput.value = String(next)
})

const errors = computed<string[]>(() => {
    const parsed = Number(numInput.value)
    if (numInput.value.trim() === '') return ['Input must not be empty']
    if (Number.isNaN(parsed)) return ['Not a number']
    if (parsed < props.min) return [`Must be ${props.min} or more`]
    if (!props.dynamicRange && parsed > props.max) return [`Must be between ${props.min} and ${props.max}`]
    return []
})

let debounce: ReturnType<typeof setTimeout> | null = null
onUnmounted(() => {
    if (debounce) clearTimeout(debounce)
})

function sendCmd(): void {
    // Upstream floors at 1 so a factor of 0 -- which would stop the printer dead
    // -- can never be sent from a slider.
    const scaled = (Math.max(1, value.value) * props.attributeScale).toFixed(0)
    void connection.sendGcode(`${props.command} ${props.attributeName}${scaled}`)
}

function commit(): void {
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => {
        sendCmd()
        growToFit(value.value)
    }, 250)
}

function onSlide(next: number[] | undefined): void {
    if (!next?.length) return
    dragging.value = true
    value.value = next[0]
    commit()
}

function onSlideCommit(): void {
    dragging.value = false
}

function submitInput(): void {
    if (errors.value.length) return
    const parsed = Number(numInput.value)
    value.value = !props.dynamicRange && parsed > props.max ? props.max : parsed
    growToFit(value.value)
    sendCmd()
}

function reset(): void {
    value.value = props.defaultValue
    processedMax.value = props.max
    growToFit(value.value)
    sendCmd()
}

function nudge(delta: number): void {
    const next = value.value + delta
    value.value = Math.max(props.min, props.dynamicRange ? next : Math.min(processedMax.value, next))
    growToFit(value.value)
    sendCmd()
}

const isModified = computed(() => value.value !== props.defaultValue)
/** Over the nominal max: worth flagging, not an error. */
const overRange = computed(() => value.value > props.max)
</script>

<template>
    <div class="flex flex-col gap-1">
        <div class="flex items-center gap-2">
            <MdiIcon v-if="icon" :path="icon" class="text-muted-foreground size-4 shrink-0" />
            <span class="text-muted-foreground text-dlabel">{{ label }}</span>

            <button
                v-if="isModified && !hasInputField"
                type="button"
                class="text-muted-foreground hover:text-foreground"
                :disabled="disabled"
                :aria-label="`Reset ${label}`"
                @click="reset">
                <MdiIcon :path="mdiRestart" class="size-4" />
            </button>

            <span class="grow" />

            <span v-if="!hasInputField" class="tabular text-sm font-semibold" :class="overRange ? 'text-warn' : ''">
                {{ value }} {{ unit }}
            </span>

            <form v-else class="flex items-center gap-1" @submit.prevent="submitInput">
                <input
                    v-model="numInput"
                    type="number"
                    inputmode="numeric"
                    :aria-label="label"
                    :disabled="disabled"
                    class="tabular border-input bg-background focus-visible:ring-ring w-16 rounded-md border px-2 py-1 text-right text-sm focus-visible:ring-2 focus-visible:outline-none"
                    :class="errors.length ? 'border-destructive' : ''"
                    @blur="submitInput"
                    @focus="($event.target as HTMLInputElement).select()" />
                <span class="text-muted-foreground text-xs">{{ unit }}</span>
                <button
                    v-if="isModified"
                    type="button"
                    class="text-muted-foreground hover:text-foreground"
                    :disabled="disabled"
                    :aria-label="`Reset ${label}`"
                    @click="reset">
                    <MdiIcon :path="mdiRestart" class="size-4" />
                </button>
            </form>
        </div>

        <p v-if="errors.length" class="text-destructive text-right text-xs">{{ errors[0] }}</p>

        <div class="flex items-center gap-2">
            <button
                type="button"
                class="text-muted-foreground hover:text-foreground disabled:opacity-30"
                :disabled="disabled || value <= min"
                :aria-label="`Decrease ${label}`"
                @click="nudge(-step)">
                <MdiIcon :path="mdiMinus" class="size-4" />
            </button>

            <SliderRoot
                class="relative flex h-5 w-full grow touch-none items-center select-none"
                :model-value="[value]"
                :min="min"
                :max="processedMax"
                :step="1"
                :disabled="disabled"
                @update:model-value="onSlide"
                @value-commit="onSlideCommit">
                <SliderTrack class="bg-muted relative h-1.5 w-full grow rounded-full">
                    <SliderRange class="absolute h-full rounded-full" :class="overRange ? 'bg-warn' : 'bg-primary'" />
                </SliderTrack>
                <SliderThumb
                    class="border-background focus-visible:ring-ring block size-4 rounded-full border-2 shadow"
                    :class="overRange ? 'bg-warn' : 'bg-primary'"
                    :aria-label="label" />
            </SliderRoot>

            <button
                type="button"
                class="text-muted-foreground hover:text-foreground disabled:opacity-30"
                :disabled="disabled || (value >= max && !dynamicRange)"
                :aria-label="`Increase ${label}`"
                @click="nudge(step)">
                <MdiIcon :path="mdiPlus" class="size-4" />
            </button>
        </div>
    </div>
</template>
