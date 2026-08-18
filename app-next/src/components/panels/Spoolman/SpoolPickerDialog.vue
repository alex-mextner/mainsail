<script setup lang="ts">
import { ref, computed } from 'vue'
import { mdiMagnify, mdiRefresh, mdiOpenInNew } from '@mdi/js'
import Dialog from '@/components/ui/Dialog.vue'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import SpoolIcon from '@/components/ui/SpoolIcon.vue'
import { useSpoolmanStore, type SpoolmanSpool } from '@/stores/spoolman'

/**
 * Pick the spool that is loaded -- Mainsail's `SpoolmanChangeSpoolDialog`.
 *
 * Sorted most-recently-used first, which is upstream's default and the right
 * one: the spool you are about to load is usually the one you just took off.
 * Archived spools are hidden -- Spoolman's own "archived" means "gone", and
 * offering one would write an id the database considers retired.
 */
const spoolman = useSpoolmanStore()

const open = defineModel<boolean>({ required: true })

const search = ref('')

const visible = computed(() => {
    const needle = search.value.trim().toLowerCase()

    return spoolman.spools
        .filter((spool) => !spool.archived)
        .filter((spool) => {
            if (!needle) return true
            // Searching by vendor, material and id as well as name, because
            // "PLA", "Prusament" and "#14" are all things people look for.
            const haystack = [
                spool.filament?.name,
                spool.filament?.material,
                spool.filament?.vendor?.name,
                spool.location,
                spool.comment,
                `#${spool.id}`,
            ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase()

            return haystack.includes(needle)
        })
        .sort((a, b) => (b.last_used ?? '').localeCompare(a.last_used ?? ''))
})

const remaining = (spool: SpoolmanSpool) => {
    const left = spool.remaining_weight
    const total = spool.filament?.weight

    if (left === undefined) return null
    if (total === undefined) return `${Math.round(left)} g`
    return `${Math.round(left)} / ${Math.round(total)} g`
}

async function choose(spool: SpoolmanSpool): Promise<void> {
    await spoolman.setActiveSpool(spool.id)
    open.value = false
}
</script>

<template>
    <Dialog v-model="open" title="Select spool" description="Which spool is loaded" content-class="w-[min(94vw,44rem)]">
        <div class="gap-dgap flex flex-col">
            <div class="flex items-center gap-2">
                <div class="relative flex-1">
                    <MdiIcon
                        :path="mdiMagnify"
                        class="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2" />
                    <input
                        v-model="search"
                        type="search"
                        placeholder="Search by name, material, vendor or #id"
                        aria-label="Search spools"
                        class="border-input bg-background focus-visible:ring-ring h-(--density-control) w-full rounded-md border pr-2 pl-8 text-sm focus-visible:ring-2 focus-visible:outline-none" />
                </div>

                <button
                    type="button"
                    class="text-muted-foreground hover:text-foreground hover:bg-accent inline-flex size-9 items-center justify-center rounded-md"
                    aria-label="Refresh spools"
                    :disabled="spoolman.loading"
                    @click="spoolman.loadSpools()">
                    <MdiIcon :path="mdiRefresh" class="size-5" :class="spoolman.loading ? 'animate-spin' : ''" />
                </button>

                <a
                    v-if="spoolman.managerUrl"
                    :href="spoolman.managerUrl"
                    target="_blank"
                    rel="noopener"
                    class="text-muted-foreground hover:text-foreground hover:bg-accent inline-flex size-9 items-center justify-center rounded-md"
                    aria-label="Open Spoolman">
                    <MdiIcon :path="mdiOpenInNew" class="size-5" />
                </a>
            </div>

            <ul class="divide-border max-h-[60vh] divide-y overflow-y-auto">
                <li v-for="spool in visible" :key="spool.id">
                    <button
                        type="button"
                        class="hover:bg-accent/50 flex w-full items-center gap-3 px-1 py-2 text-left"
                        :class="spool.id === spoolman.activeSpoolId ? 'bg-accent/40' : ''"
                        @click="choose(spool)">
                        <SpoolIcon
                            class="size-10 shrink-0"
                            :color="spool.filament?.color_hex ? `#${spool.filament.color_hex}` : '#888888'"
                            :multi-color-hexes="spool.filament?.multi_color_hexes"
                            :multi-color-direction="spool.filament?.multi_color_direction" />

                        <span class="min-w-0 flex-1">
                            <span class="text-muted-foreground block text-xs">
                                #{{ spool.id }} · {{ spool.filament?.vendor?.name ?? 'Unknown vendor' }}
                            </span>
                            <span class="block truncate text-sm font-medium">
                                {{ spool.filament?.name ?? 'Unknown filament' }}
                            </span>
                            <span class="text-muted-foreground block text-xs">
                                {{ [spool.filament?.material, remaining(spool), spool.location].filter(Boolean).join(' · ') }}
                            </span>
                        </span>
                    </button>
                </li>

                <li v-if="!visible.length" class="text-muted-foreground py-6 text-center text-sm italic">
                    {{ search ? 'Nothing matches that search.' : 'Spoolman has no spools.' }}
                </li>
            </ul>
        </div>
    </Dialog>
</template>
