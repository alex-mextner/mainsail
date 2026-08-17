<script setup lang="ts">
import { cn } from '@/lib/utils'
const props = defineProps<{ class?: string }>()
</script>

<template>
    <div :class="cn('bg-card text-card-foreground flex flex-col rounded-xl border shadow-sm', props.class)">
        <slot />
    </div>
</template>
