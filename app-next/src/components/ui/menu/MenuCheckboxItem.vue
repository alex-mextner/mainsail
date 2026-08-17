<script setup lang="ts">
import { DropdownMenuCheckboxItem } from 'reka-ui'
import { mdiCheck } from '@mdi/js'
import MdiIcon from '@/components/ui/MdiIcon.vue'

/**
 * Checkbox row inside a panel's settings menu.
 *
 * `@select.prevent` is what keeps the menu open after a toggle -- upstream got
 * the same effect from `:close-on-content-click="false"` on the v-menu. Without
 * it, showing four view toggles would mean reopening the menu four times.
 */
defineProps<{ modelValue: boolean; label: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
    <DropdownMenuCheckboxItem
        :model-value="modelValue"
        class="focus:bg-accent focus:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 text-sm outline-none select-none"
        :style="{ minHeight: 'var(--density-control)' }"
        @select="$event.preventDefault()"
        @update:model-value="emit('update:modelValue', $event)">
        <span class="border-input flex size-4 shrink-0 items-center justify-center rounded-[3px] border">
            <MdiIcon v-if="modelValue" :path="mdiCheck" class="text-primary size-3.5" />
        </span>
        <span>{{ label }}</span>
    </DropdownMenuCheckboxItem>
</template>
