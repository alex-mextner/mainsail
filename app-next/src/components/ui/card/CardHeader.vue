<script setup lang="ts">
import { cn } from '@/lib/utils'
const props = defineProps<{ class?: string }>()
</script>

<template>
    <div :class="cn('flex items-center justify-between gap-dgap px-dpx pt-dpy pb-dgap', props.class)">
        <slot />
    </div>
</template>
