<script setup lang="ts">
import { cn } from '@/lib/utils'
const props = defineProps<{ class?: string }>()
</script>

<template>
    <div :class="cn('flex items-center justify-between gap-3 px-5 pt-4 pb-3', props.class)">
        <slot />
    </div>
</template>
