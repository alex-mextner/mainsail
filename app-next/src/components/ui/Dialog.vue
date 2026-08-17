<script setup lang="ts">
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription } from 'reka-ui'
import { cn } from '@/lib/utils'

/**
 * Modal dialog -- Vuetify's `v-dialog`, on reka-ui.
 *
 * reka-ui rather than a hand-rolled overlay for the same reason as the menus:
 * focus trapping, Escape, scroll locking and `aria-modal` are exactly the
 * things that are easy to get wrong and impossible to notice on a mouse-driven
 * desktop while being unusable on the tablet at the machine.
 *
 * `DialogDescription` is always rendered (visually hidden when there is no
 * description) because reka-ui warns about a missing one, and a warning that
 * appears on every dialog trains people to ignore the console.
 */
defineProps<{ title: string; description?: string; contentClass?: string }>()

const open = defineModel<boolean>({ required: true })
</script>

<template>
    <DialogRoot v-model:open="open">
        <DialogPortal>
            <DialogOverlay class="fixed inset-0 z-50 bg-black/60 backdrop-blur-[1px]" />
            <DialogContent
                :class="
                    cn(
                        'bg-card text-card-foreground fixed top-1/2 left-1/2 z-50 flex w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border p-5 shadow-lg',
                        contentClass
                    )
                ">
                <DialogTitle class="text-base leading-none font-semibold tracking-tight">{{ title }}</DialogTitle>
                <DialogDescription :class="description ? 'text-muted-foreground text-sm' : 'sr-only'">
                    {{ description ?? title }}
                </DialogDescription>

                <slot />

                <div v-if="$slots.footer" class="flex flex-wrap justify-end gap-2">
                    <slot name="footer" />
                </div>
            </DialogContent>
        </DialogPortal>
    </DialogRoot>
</template>
