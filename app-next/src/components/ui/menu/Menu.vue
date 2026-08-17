<script setup lang="ts">
import { DropdownMenuRoot, DropdownMenuTrigger, DropdownMenuPortal, DropdownMenuContent } from 'reka-ui'
import { cn } from '@/lib/utils'

/**
 * Panel header menu -- the Vuetify `v-menu` the panels used, on reka-ui.
 *
 * reka-ui rather than a hand-rolled popover because these menus need focus
 * trapping, Escape-to-close, outside-click and arrow-key navigation, and getting
 * those wrong on the tablet at the machine is how a button becomes untappable.
 */
withDefaults(
    defineProps<{
        align?: 'start' | 'center' | 'end'
        contentClass?: string
        /** Keep open after picking an item (upstream's :close-on-content-click="false"). */
        persistent?: boolean
    }>(),
    { align: 'end', persistent: false }
)
</script>

<template>
    <DropdownMenuRoot>
        <DropdownMenuTrigger as-child>
            <slot name="trigger" />
        </DropdownMenuTrigger>

        <DropdownMenuPortal>
            <DropdownMenuContent
                :align="align"
                :side-offset="4"
                :class="
                    cn(
                        'bg-popover text-popover-foreground z-50 min-w-[11rem] overflow-hidden rounded-md border p-1 shadow-md',
                        contentClass
                    )
                "
                @click="persistent && $event.stopPropagation()">
                <slot />
            </DropdownMenuContent>
        </DropdownMenuPortal>
    </DropdownMenuRoot>
</template>
