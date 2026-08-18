<script setup lang="ts">
import { ref, computed } from 'vue'
import { mdiAdjust, mdiSwapVertical, mdiEject, mdiOpenInNew } from '@mdi/js'
import Panel from '@/components/ui/Panel.vue'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import Dialog from '@/components/ui/Dialog.vue'
import { Button } from '@/components/ui/button'
import SpoolIcon from '@/components/ui/SpoolIcon.vue'
import SpoolPickerDialog from './Spoolman/SpoolPickerDialog.vue'
import { useSpoolmanStore } from '@/stores/spoolman'

/**
 * Spoolman -- Mainsail's `panels/SpoolmanPanel.vue` plus its active-spool row.
 *
 * 🔴 NOT PRESENT ON THIS MACHINE, and this is the one queue-2 item that is not
 * even a Klipper plugin: Spoolman is a SEPARATE SERVER with its own database
 * and web UI, which Moonraker reaches through an optional `spoolman` component.
 * That component is not among the 25 loaded here, so the panel hides itself --
 * upstream's own rule (`getAllPossiblePanels` drops it on the same condition).
 * Everything below is exercised by the rig.
 *
 * NOT ported: the per-tool spool dropdown. It exists for machines whose `T0`,
 * `T1`, ... macros carry a `spool_id` variable -- a toolchanger or an AFC/MMU
 * unit -- and it is the same "hardware that is not here" rule that puts AFC and
 * MMU in the remaining queue. Recorded rather than silently dropped: when
 * either of those is ported, this dropdown belongs with it.
 */
const spoolman = useSpoolmanStore()

const showPicker = ref(false)
const showEject = ref(false)

/** Upstream puts a non-healthy status in the title, where it cannot be missed. */
const title = computed(() =>
    spoolman.health && spoolman.health !== 'healthy' ? `Spoolman (${spoolman.health})` : 'Spoolman'
)

const spool = computed(() => spoolman.activeSpool)

const color = computed(() => {
    const hex = spool.value?.filament?.color_hex
    return hex ? `#${hex}` : '#888888'
})

/**
 * Upstream's formatting, kept because it is genuinely the readable one: a
 * 1 kg spool reads "742g / 1kg", an odd size reads "742 / 750g".
 */
const weight = computed(() => {
    const left = spool.value?.remaining_weight
    const total = spool.value?.filament?.weight

    if (left === undefined || total === undefined) return null

    const rounded = Math.round(left)
    if (total < 1000) return `${rounded} / ${total}g`

    const whole = total / 1000
    return `${rounded}g / ${Number.isInteger(whole) ? whole : Math.round(total / 100) / 10}kg`
})

const length = computed(() => {
    const left = spool.value?.remaining_length
    return left === undefined ? null : `${Math.round(left / 1000)}m`
})

const subtitle = computed(() =>
    [spool.value?.filament?.material, weight.value, length.value].filter(Boolean).join(' | ')
)

async function eject(): Promise<void> {
    showEject.value = false
    await spoolman.setActiveSpool(null)
}
</script>

<template>
    <Panel v-if="spoolman.available" panel-name="spoolman" :title="title" :icon="mdiAdjust" collapsible>
        <template #buttons>
            <button
                type="button"
                class="text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring inline-flex size-8 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
                :aria-label="spool ? 'Change spool' : 'Select spool'"
                @click="showPicker = true">
                <MdiIcon :path="mdiSwapVertical" class="size-5" />
            </button>
            <button
                v-if="spool"
                type="button"
                class="text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring inline-flex size-8 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
                aria-label="Eject spool"
                @click="showEject = true">
                <MdiIcon :path="mdiEject" class="size-5" />
            </button>
            <a
                v-if="spoolman.managerUrl"
                :href="spoolman.managerUrl"
                target="_blank"
                rel="noopener"
                class="text-muted-foreground hover:text-foreground hover:bg-accent inline-flex size-8 items-center justify-center rounded-md"
                aria-label="Open Spoolman">
                <MdiIcon :path="mdiOpenInNew" class="size-5" />
            </a>
        </template>

        <div v-if="spool" class="flex items-center gap-3">
            <button
                type="button"
                class="min-w-0 flex-1 text-left"
                aria-label="Change spool"
                @click="showPicker = true">
                <span class="text-muted-foreground block text-xs tracking-wide uppercase">
                    #{{ spool.id }} | {{ spool.filament?.vendor?.name ?? 'Unknown' }}
                </span>
                <span class="block truncate text-lg font-semibold">
                    {{ spool.filament?.name ?? 'Unknown' }}
                </span>
                <span class="text-muted-foreground block truncate text-sm">{{ subtitle }}</span>
            </button>

            <SpoolIcon
                class="size-16 shrink-0 cursor-pointer"
                :color="color"
                :multi-color-hexes="spool.filament?.multi_color_hexes"
                :multi-color-direction="spool.filament?.multi_color_direction"
                @click="showPicker = true" />
        </div>

        <div v-else class="py-drow flex flex-col items-center gap-2">
            <p class="text-muted-foreground text-sm">No spool selected.</p>
            <Button size="sm" @click="showPicker = true">Select spool</Button>
        </div>

        <!-- The proxy can answer while Spoolman itself is unwell, so the error
             is shown rather than left as an empty list that looks like "you own
             no filament". -->
        <p v-if="spoolman.error" class="text-warn pt-dgap text-xs">{{ spoolman.error }}</p>

        <SpoolPickerDialog v-model="showPicker" />

        <Dialog
            v-model="showEject"
            title="Eject spool"
            description="Clear the loaded spool, so nothing is tracked against it until another is chosen.">
            <template #footer>
                <Button variant="ghost" @click="showEject = false">Cancel</Button>
                <Button @click="eject">Eject</Button>
            </template>
        </Dialog>
    </Panel>
</template>
