<script setup lang="ts">
import { DropdownMenuItem } from 'reka-ui'
import { cn } from '@/lib/utils'

defineProps<{ class?: string; disabled?: boolean }>()
const emit = defineEmits<{ select: [] }>()
</script>

<template>
    <DropdownMenuItem
        :disabled="disabled"
        :class="
            cn(
                'focus:bg-accent focus:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
                $props.class
            )
        "
        :style="{ minHeight: 'var(--density-control)' }"
        @select="emit('select')">
        <slot />
    </DropdownMenuItem>
</template>
