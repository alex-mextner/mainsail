<script setup lang="ts" generic="T extends string">
import { cn } from '@/lib/utils'

defineProps<{
    modelValue: T
    options: { value: T; label: string; title?: string }[]
    class?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: T] }>()
</script>

<template>
    <div :class="cn('bg-muted inline-flex rounded-md p-0.5', $props.class)" role="group">
        <button
            v-for="option in options"
            :key="option.value"
            type="button"
            :title="option.title ?? option.label"
            :aria-pressed="modelValue === option.value"
            :class="
                cn(
                    // The 44px touch floor lives on the control itself, so it
                    // survives every density level.
                    'focus-visible:ring-ring rounded px-2.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none',
                    modelValue === option.value
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                )
            "
            :style="{ minHeight: 'var(--density-control)' }"
            @click="emit('update:modelValue', option.value)">
            {{ option.label }}
        </button>
    </div>
</template>
