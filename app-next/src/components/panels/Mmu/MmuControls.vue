<script setup lang="ts">
import { computed } from 'vue'
import { mdiDownloadOutline, mdiEject, mdiCheck, mdiAutoFix, mdiThermometerPlus, mdiDownload, mdiUpload } from '@mdi/js'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import {
    useMmu,
    TOOL_GATE_BYPASS,
    GATE_AVAILABLE,
    GATE_AVAILABLE_FROM_BUFFER,
    GATE_EMPTY,
    GATE_UNKNOWN,
    FILAMENT_POS_UNLOADED,
} from '@/composables/useMmu'

/**
 * The MMU command buttons -- Mainsail's `Mmu/MmuControls.vue` and its
 * `MmuControlsButton` child.
 *
 * 🔴 EVERY BUTTON'S DISABLED RULE IS UPSTREAM'S AND NONE OF THEM IS COSMETIC.
 * These commands move filament through a machine that jams for a living, and
 * each rule encodes a state where the command is known to make things worse:
 *
 *   Preload  pointless when the gate already reports filament available.
 *   Eject    pointless when the gate is empty.
 *   Load     only from FILAMENT_POS_UNLOADED -- loading on top of filament
 *            that is already partway up the bowden is how you get a jam.
 *   Unload   the exact inverse.
 *   Unlock   only while `print_state` is `pause_locked`. It re-heats and
 *            releases after an MMU error, and it means nothing otherwise.
 *
 * On top of all of them sits `canSend`, which additionally refuses while the
 * idle timeout says `Printing` -- that is what catches a macro or a manual
 * move running from somewhere else.
 */
const mmu = useMmu()

const isPausedAndLocked = computed(() => mmu.printState.value === 'pause_locked')

const currentGateStatus = computed(() => mmu.mmu.value?.gate_status?.[mmu.gate.value] ?? GATE_UNKNOWN)

const onBypass = computed(() => mmu.gate.value === TOOL_GATE_BYPASS)

const buttons = computed(() => [
    {
        id: 'preload',
        icon: mdiDownloadOutline,
        text: 'Preload',
        command: 'MMU_PRELOAD',
        disabled:
            !mmu.canSend.value || [GATE_AVAILABLE, GATE_AVAILABLE_FROM_BUFFER].includes(currentGateStatus.value),
        large: false,
    },
    {
        id: 'eject',
        icon: mdiEject,
        text: 'Eject',
        command: 'MMU_EJECT',
        disabled: !mmu.canSend.value || currentGateStatus.value === GATE_EMPTY,
        large: false,
    },
    {
        id: 'check-gate',
        icon: mdiCheck,
        text: 'Check gate',
        command: 'MMU_CHECK_GATE',
        disabled: !mmu.canSend.value,
        large: false,
    },
    {
        id: 'recover',
        icon: mdiAutoFix,
        text: 'Recover',
        command: 'MMU_RECOVER',
        disabled: !mmu.canSend.value,
        large: false,
    },
])

const unlock = computed(() => ({
    id: 'unlock',
    icon: mdiThermometerPlus,
    text: 'Unlock',
    command: 'MMU_UNLOCK',
    disabled: !mmu.canSend.value || !isPausedAndLocked.value,
}))

const loadUnload = computed(() => [
    {
        id: 'unload',
        icon: mdiUpload,
        text: onBypass.value ? 'Unload ext.' : 'Unload',
        command: 'MMU_UNLOAD',
        disabled: !mmu.canSend.value || mmu.filamentPos.value === FILAMENT_POS_UNLOADED,
    },
    {
        id: 'load',
        icon: mdiDownload,
        text: onBypass.value ? 'Load ext.' : 'Load',
        command: 'MMU_LOAD',
        disabled: !mmu.canSend.value || mmu.filamentPos.value !== FILAMENT_POS_UNLOADED,
    },
])

const run = (command: string, id: string) => mmu.send(command, `mmu_${id}`)
</script>

<template>
    <div class="flex flex-col gap-2 py-2">
        <div class="grid grid-cols-2 gap-2">
            <button
                v-for="button in buttons"
                :key="button.id"
                type="button"
                class="border-border hover:bg-accent inline-flex h-8 items-center justify-center gap-2 rounded-md border px-2 text-xs font-medium disabled:pointer-events-none disabled:opacity-50"
                :disabled="button.disabled"
                :data-mmu-button="button.id"
                @click="run(button.command, button.id)">
                <MdiIcon :path="button.icon" class="size-4" />
                {{ button.text }}
            </button>
        </div>

        <div class="grid grid-cols-6 gap-2">
            <button
                type="button"
                class="border-border hover:bg-accent col-span-4 col-start-2 inline-flex h-8 items-center justify-center gap-2 rounded-md border px-2 text-xs font-medium disabled:pointer-events-none disabled:opacity-50"
                :disabled="unlock.disabled"
                :data-mmu-button="unlock.id"
                @click="run(unlock.command, unlock.id)">
                <MdiIcon :path="unlock.icon" class="size-4" />
                {{ unlock.text }}
            </button>
        </div>

        <div class="mt-2 grid grid-cols-2 gap-2">
            <button
                v-for="button in loadUnload"
                :key="button.id"
                type="button"
                class="bg-secondary text-secondary-foreground hover:bg-secondary/80 inline-flex h-10 items-center justify-center gap-2 rounded-md px-2 text-sm font-medium disabled:pointer-events-none disabled:opacity-50"
                :disabled="button.disabled"
                :data-mmu-button="button.id"
                @click="run(button.command, button.id)">
                <MdiIcon :path="button.icon" class="size-5" />
                {{ button.text }}
            </button>
        </div>
    </div>
</template>
