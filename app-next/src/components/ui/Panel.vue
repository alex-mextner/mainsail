<script setup lang="ts">
import { computed, useSlots } from 'vue'
import { mdiChevronDown } from '@mdi/js'
import { cn } from '@/lib/utils'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import { useGuiStore } from '@/stores/gui'
import { useBreakpoint } from '@/composables/useBreakpoint'

/**
 * The card every dashboard panel lives in -- Mainsail's `components/ui/Panel.vue`.
 *
 * Kept as its own component for the same reason upstream did: the header
 * (icon + title + right-aligned buttons + collapse chevron) and the collapse
 * state that survives a reload are identical across all ~20 dashboard panels,
 * and `panelName` is what identifies a panel in the persisted state.
 *
 * Collapse state is per viewport, exactly like upstream: a panel you collapse on
 * the tablet at the machine stays open on the desktop.
 */
const props = withDefaults(
    defineProps<{
        /** Stable id used to persist collapse state. Upstream calls it card-class. */
        panelName: string
        title: string
        icon?: string | null
        collapsible?: boolean
        loading?: boolean
        class?: string
        contentClass?: string
        /** Hide the #buttons slot while collapsed (upstream hideButtonsOnCollapse). */
        hideButtonsOnCollapse?: boolean
    }>(),
    { icon: null, collapsible: false, loading: false, hideButtonsOnCollapse: false }
)

const gui = useGuiStore()
const { breakpoint } = useBreakpoint()
const slots = useSlots()

const expanded = computed({
    get: () => (props.collapsible ? gui.isPanelExpanded(props.panelName, breakpoint.value) : true),
    set: (value: boolean) => gui.setPanelExpanded(props.panelName, breakpoint.value, value),
})

const hasButtons = computed(() => !!slots.buttons)
</script>

<template>
    <section
        :class="
            cn(
                // `overflow-x-clip` and not `overflow-x-hidden`: `hidden` on one
                // axis forces the other to `auto`, which would turn every panel
                // into a vertical scroll container. `clip` leaves the y axis
                // `visible`.
                //
                // It is here because a panel whose content is wider than the card
                // -- the file table is 2500px of columns -- otherwise pushes the
                // whole PAGE sideways even though the table has its own
                // `overflow-x-auto`. Measured: document scrollWidth 2783 at a
                // 1400px viewport, and the page really did scroll.
                'bg-card text-card-foreground relative flex flex-col overflow-x-clip rounded-xl border shadow-sm',
                props.class
            )
        "
        :data-panel="panelName">
        <!-- Indeterminate progress line, same place Vuetify's card loader sits. -->
        <div v-if="loading" class="bg-primary/20 absolute inset-x-0 top-0 h-0.5 overflow-hidden rounded-t-xl">
            <div class="bg-primary h-full w-1/3 animate-[panel-loading_1.4s_ease-in-out_infinite]" />
        </div>

        <!--
            The header is its own container-query context, for the same reason
            the body below is one: a button in the #buttons slot has to decide
            whether it can afford a text label, and the only honest input for
            that is how wide THIS PANEL is, not how wide the window is.

            Found by measurement, not by reading: the webcam switcher's camera
            name was written `@md:inline` and never appeared at any width,
            because the nearest container was the body div -- a sibling, not an
            ancestor -- so the query had nothing to resolve against and silently
            stayed false. A container query with no container never matches; it
            does not fall back to the viewport.
        -->
        <header class="gap-dgap px-dpx pt-dpy pb-dgap @container flex items-center justify-between">
            <h3 class="flex min-w-0 items-center gap-2 leading-none font-semibold tracking-tight">
                <slot name="icon">
                    <MdiIcon v-if="icon" :path="icon" class="text-muted-foreground size-4 shrink-0" />
                </slot>
                <span class="truncate">{{ title }}</span>
            </h3>

            <div v-if="hasButtons || collapsible" class="flex shrink-0 items-center gap-1">
                <div v-if="hasButtons && (expanded || !hideButtonsOnCollapse)" class="flex items-center gap-1">
                    <slot name="buttons" />
                </div>
                <button
                    v-if="collapsible"
                    type="button"
                    class="text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring inline-flex size-8 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
                    :aria-expanded="expanded"
                    :aria-label="expanded ? `Collapse ${title}` : `Expand ${title}`"
                    @click="expanded = !expanded">
                    <MdiIcon
                        :path="mdiChevronDown"
                        class="size-5 transition-transform duration-300"
                        :class="expanded ? '' : '-rotate-90'" />
                </button>
            </div>
        </header>

        <!--
            `@container` makes the panel body a container-query context, so the
            panels inside can lay themselves out by THEIR OWN width rather than
            the window's. This is what Mainsail's `components/ui/Responsive.vue`
            did with a ResizeObserver and a slot prop; container queries are the
            same idea in CSS, with no JS and no re-render on resize.

            It matters because every dashboard panel lives in a 3/12..7/12 column:
            a window that is `sm` by viewport can still hold a 340px panel, and
            laying that out as if it were 640px wide is exactly how the Z-offset
            row ended up clipping "+0.005" to "+0.00".
        -->
        <div v-show="expanded" :class="cn('px-dpx pb-dpy @container', contentClass)">
            <slot />
        </div>
    </section>
</template>

<style>
@keyframes panel-loading {
    0% {
        transform: translateX(-100%);
    }
    100% {
        transform: translateX(300%);
    }
}
</style>
