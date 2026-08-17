<script setup lang="ts">
import { ProgressRoot, ProgressIndicator } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = withDefaults(
    defineProps<{
        /** 0..100. */
        modelValue?: number
        class?: string
        /** Tailwind background class for the filled part. */
        indicatorClass?: string
    }>(),
    { modelValue: 0 }
)
</script>

<template>
    <ProgressRoot
        :model-value="props.modelValue"
        :class="cn('bg-secondary relative h-1.5 w-full overflow-hidden rounded-full', props.class)">
        <ProgressIndicator
            :class="cn('bg-primary h-full w-full flex-1 transition-transform duration-500', props.indicatorClass)"
            :style="`transform: translateX(-${100 - (props.modelValue ?? 0)}%)`" />
    </ProgressRoot>
</template>
