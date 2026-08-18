<script setup lang="ts">
/**
 * On/off switch -- Vuetify's `v-switch`.
 *
 * A button with `role="switch"` rather than a styled checkbox: the track is
 * 44px of touch target at every density (the tablet at the machine), and
 * `aria-checked` is what a screen reader and a test both read. Emits rather
 * than using v-model on a ref, because every caller here writes through a
 * store action and needs to know the intent, not the new value.
 */
withDefaults(defineProps<{ modelValue: boolean; disabled?: boolean; label?: string }>(), { disabled: false })

const emit = defineEmits<{ 'update:modelValue': [boolean] }>()
</script>

<template>
    <button
        type="button"
        role="switch"
        :aria-checked="modelValue"
        :aria-label="label"
        :disabled="disabled"
        class="focus-visible:ring-ring relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-40"
        :class="modelValue ? 'bg-primary' : 'bg-muted'"
        @click="emit('update:modelValue', !modelValue)">
        <span
            class="bg-background absolute size-4 rounded-full shadow transition-all"
            :class="modelValue ? 'left-6' : 'left-1'" />
    </button>
</template>
