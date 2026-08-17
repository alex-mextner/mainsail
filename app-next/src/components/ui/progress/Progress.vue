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
        <!-- 150ms, not shadcn's default 500ms. A heater duty cycle changes
             several times a second, and a half-second ease means the bar is
             almost always mid-animation and disagreeing with its own label. -->
        <ProgressIndicator
            :class="cn('bg-primary h-full w-full flex-1 transition-transform duration-150', props.indicatorClass)"
            :style="`transform: translateX(-${100 - (props.modelValue ?? 0)}%)`" />
    </ProgressRoot>
</template>
