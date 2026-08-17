<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { mdiChevronDown, mdiChevronUp, mdiRestart } from '@mdi/js'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import { cn } from '@/lib/utils'

/**
 * Labelled numeric field with optional spinner and a reset-to-config button --
 * Mainsail's `components/inputs/NumberInput.vue`.
 *
 * Used for pressure advance, smooth time, firmware retraction and the extruder
 * feed amount / feed rate. It emits rather than sending g-code itself, because
 * each caller sends a different command; that is upstream's split too.
 *
 * `spinnerFactor` is upstream's and is not cosmetic: the chevrons move by
 * `step * spinnerFactor`, so a field whose *typed* precision is 0.001 can still
 * be nudged in useful 0.01 increments without holding the button down thirty
 * times.
 */
const props = withDefaults(
    defineProps<{
        /** Identifier echoed back in the submit payload (a g-code parameter name). */
        param: string
        target: number
        label: string
        min: number
        max?: number | null
        dec: number
        step?: number
        unit?: string
        /** Config value; when set and different, a reset button appears. */
        defaultValue?: number | null
        hasSpinner?: boolean
        spinnerFactor?: number
        disabled?: boolean
        submitOnBlur?: boolean
    }>(),
    {
        max: null,
        step: 1,
        unit: '',
        defaultValue: null,
        hasSpinner: false,
        spinnerFactor: 1,
        disabled: false,
        submitOnBlur: false,
    }
)

const emit = defineEmits<{ submit: [payload: { name: string; value: number }] }>()

const text = ref(String(props.target))

// Follow the printer, but never while the field has focus -- otherwise a value
// being typed is replaced mid-keystroke by whatever Klipper last reported.
const focused = ref(false)
watch(
    () => props.target,
    (next) => {
        if (!focused.value) text.value = String(next)
    }
)

/** Comma decimal separators are accepted: the machine is used with a RU locale. */
const value = computed(() => {
    if (text.value.trim() === '') return 0
    return parseFloat(text.value.replace(',', '.'))
})

const errors = computed<string[]>(() => {
    if (Number.isNaN(value.value)) return ['Not a number']
    if (props.max === null) return value.value < props.min ? [`Must be ${props.min} or more`] : []
    return value.value > props.max || value.value < props.min ? [`Must be between ${props.min} and ${props.max}`] : []
})

const round = (input: number) => Math.round(input * 10 ** props.dec) / 10 ** props.dec

function submit(): void {
    if (errors.value.length) return
    emit('submit', { name: props.param, value: value.value })
}

function nudge(direction: 1 | -1): void {
    const next = value.value + direction * props.step * props.spinnerFactor

    if (direction === 1) text.value = String(props.max !== null && next > props.max ? props.max : round(next))
    else text.value = String(next < props.min ? props.min : round(next))

    submit()
}

function resetToDefault(): void {
    if (props.defaultValue === null) return
    text.value = String(props.defaultValue)
    submit()
}

const isModified = computed(() => props.defaultValue !== null && value.value !== props.defaultValue)

function onBlur(): void {
    focused.value = false
    if (props.submitOnBlur) submit()
    else if (errors.value.length) text.value = String(props.target)
}

/** `e`, `E` and `+` are legal in an <input type=number> but never meaningful
 *  here; `-` is blocked too when the field cannot go negative. */
function blockInvalidChars(event: KeyboardEvent): void {
    const blocked = ['e', 'E', '+', ...(props.min >= 0 ? ['-'] : [])]
    if (blocked.includes(event.key)) event.preventDefault()
}
</script>

<template>
    <form class="flex flex-col gap-1" @submit.prevent="submit">
        <label class="text-muted-foreground text-[11px]">{{ label }}</label>

        <div class="flex items-center gap-1">
            <div
                :class="
                    cn(
                        'border-input bg-background focus-within:ring-ring flex min-w-0 grow items-center rounded-md border pr-1.5 focus-within:ring-2',
                        errors.length && 'border-destructive'
                    )
                ">
                <input
                    v-model="text"
                    type="number"
                    inputmode="decimal"
                    :step="step"
                    :disabled="disabled"
                    :aria-label="label"
                    class="tabular w-full min-w-0 bg-transparent px-2 py-1.5 text-sm outline-none disabled:opacity-40"
                    @focus="focused = true"
                    @blur="onBlur"
                    @keydown="blockInvalidChars" />

                <span v-if="unit" class="text-muted-foreground shrink-0 text-[11px]">{{ unit }}</span>

                <button
                    v-if="isModified"
                    type="button"
                    class="text-muted-foreground hover:text-foreground ml-1 shrink-0"
                    :disabled="disabled"
                    :aria-label="`Reset ${label} to the configured value`"
                    @click="resetToDefault">
                    <MdiIcon :path="mdiRestart" class="size-4" />
                </button>
            </div>

            <div v-if="hasSpinner" class="flex shrink-0 flex-col">
                <button
                    type="button"
                    class="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    :disabled="disabled || errors.length > 0 || (max !== null && value >= max)"
                    :aria-label="`Increase ${label}`"
                    @click="nudge(1)">
                    <MdiIcon :path="mdiChevronUp" class="size-4" />
                </button>
                <button
                    type="button"
                    class="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    :disabled="disabled || errors.length > 0 || value <= min"
                    :aria-label="`Decrease ${label}`"
                    @click="nudge(-1)">
                    <MdiIcon :path="mdiChevronDown" class="size-4" />
                </button>
            </div>
        </div>

        <p v-if="errors.length" class="text-destructive text-[11px]">{{ errors[0] }}</p>
    </form>
</template>
