<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { mdiMenu } from '@mdi/js'
import { useConnectionStore } from '@/stores/connection'
import { usePrinterStore } from '@/stores/printer'
import { naviRoutes, type AppRouteMeta } from '@/router'
import { Badge } from '@/components/ui/badge'
import MdiIcon from '@/components/ui/MdiIcon.vue'

/**
 * Mainsail's shell: fixed top bar, collapsible navigation drawer, and a content
 * area that uses the FULL window width. The earlier attempt centred everything
 * in a narrow column, which is the single most visible way it stopped looking
 * like Mainsail.
 */
const route = useRoute()
const connection = useConnectionStore()
const printer = usePrinterStore()

const drawerOpen = ref(false)

const title = computed(() => (route.meta as AppRouteMeta | undefined)?.title ?? 'Mainsail Next')

const statusVariant = computed(() => {
    if (!connection.isConnected) return 'destructive' as const
    if (connection.klippyState === 'ready') return 'ok' as const
    return 'heating' as const
})

/** Extruder temperature in the top bar, as Mainsail does while printing. */
const topBarTemps = computed(() => printer.heaters.slice(0, 2))
</script>

<template>
    <div class="bg-background min-h-screen">
        <!-- top bar -->
        <header class="bg-card/95 supports-[backdrop-filter]:bg-card/80 sticky top-0 z-30 border-b backdrop-blur">
            <div class="flex h-14 items-center gap-3 px-dpx">
                <button
                    type="button"
                    class="hover:bg-accent -ml-1 rounded-md p-2 lg:hidden"
                    aria-label="Toggle navigation"
                    @click="drawerOpen = !drawerOpen">
                    <MdiIcon :path="mdiMenu" class="size-5" />
                </button>

                <h1 class="truncate text-base font-semibold tracking-tight">{{ title }}</h1>

                <div class="ml-auto flex items-center gap-3">
                    <span
                        v-for="heater in topBarTemps"
                        :key="heater.name"
                        class="text-muted-foreground tabular hidden text-xs sm:inline">
                        {{ heater.label }}
                        <span class="text-foreground font-medium">{{ heater.temperature.toFixed(0) }}°C</span>
                    </span>
                    <Badge :variant="statusVariant">{{ connection.statusLabel }}</Badge>
                </div>
            </div>
        </header>

        <div class="flex">
            <!-- navigation drawer -->
            <aside
                :class="[
                    'bg-card fixed inset-y-0 left-0 z-40 w-60 shrink-0 border-r pt-14 transition-transform lg:sticky lg:top-14 lg:z-0 lg:h-[calc(100vh-3.5rem)] lg:translate-x-0 lg:pt-0',
                    drawerOpen ? 'translate-x-0' : '-translate-x-full',
                ]">
                <nav class="flex flex-col gap-0.5 p-2">
                    <RouterLink
                        v-for="item in naviRoutes"
                        :key="String(item.name)"
                        :to="item.path"
                        class="hover:bg-accent flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors"
                        :class="
                            route.name === item.name
                                ? 'bg-accent text-accent-foreground font-medium'
                                : 'text-muted-foreground'
                        "
                        @click="drawerOpen = false">
                        <MdiIcon :path="(item.meta as AppRouteMeta).icon" class="size-5 shrink-0" />
                        <span class="truncate">{{ (item.meta as AppRouteMeta).title }}</span>
                        <!-- Honest marker: this route exists in the nav but its
                             panels are not rewritten yet. -->
                        <Badge v-if="!(item.meta as AppRouteMeta).ported" variant="muted" class="ml-auto">soon</Badge>
                    </RouterLink>
                </nav>

                <div class="text-muted-foreground mt-auto px-4 py-3 text-[11px]">
                    <div class="truncate">{{ connection.hostname ?? '—' }}</div>
                    <div class="truncate">{{ connection.softwareVersion ?? '' }}</div>
                </div>
            </aside>

            <!-- click-away backdrop for the mobile drawer -->
            <div
                v-if="drawerOpen"
                class="fixed inset-0 z-30 bg-black/50 lg:hidden"
                aria-hidden="true"
                @click="drawerOpen = false" />

            <!-- content: full width, no max-width cage -->
            <main class="min-w-0 flex-1 px-dpx py-dpy">
                <RouterView />
            </main>
        </div>
    </div>
</template>
