<script setup lang="ts">
import { computed } from 'vue'
import MmuGate from './MmuGate.vue'
import { useMmu, TOOL_GATE_BYPASS } from '@/composables/useMmu'

/**
 * One MMU unit and its row of gates -- Mainsail's `Mmu/MmuUnit.vue`.
 *
 * `unitIndex: -1` is not an error case: it renders a STANDALONE BYPASS, for
 * machines whose bypass belongs to no unit. That variant drops the unit body
 * styling, which is why the background is conditional.
 *
 * The footer (`MmuUnitFooter`, vendor name + selector graphic + climate
 * readouts) is not ported yet; the unit renders its gates and its name.
 */
const props = withDefaults(
    defineProps<{
        unitIndex: number
        selectedGate: number
        showDetails?: boolean
        showFooter?: boolean
        hideBypass?: boolean
        unhighlightSpools?: boolean
    }>(),
    { showDetails: false, showFooter: true, hideBypass: false, unhighlightSpools: false }
)

const emit = defineEmits<{ 'select-gate': [gate: number] }>()

const mmu = useMmu()

const machineUnit = computed(() => mmu.machineUnit(props.unitIndex))
const numGates = computed(() => machineUnit.value?.num_gates ?? 0)
const firstGate = computed(() => machineUnit.value?.first_gate ?? 0)

const hasBypass = computed(() => {
    if (props.hideBypass) return false
    return machineUnit.value?.has_bypass ?? true
})

/** Upstream caps the footer to the width the spools actually occupy. */
const maxWidth = computed(() => `${mmu.spoolWidth.value * (numGates.value + (hasBypass.value ? 1 : 0)) + 32}px`)

const isStandaloneBypass = computed(() => props.unitIndex < 0)
</script>

<template>
    <div
        class="mx-1 mb-3 inline-flex flex-col overflow-hidden"
        :class="isStandaloneBypass ? '' : 'mmu-unit'"
        :data-mmu-unit="unitIndex">
        <div class="relative flex flex-wrap px-4 pt-3">
            <MmuGate
                v-for="i in numGates"
                :key="i"
                :gate-index="i - 1 + firstGate"
                :machine-unit="machineUnit"
                :selected-gate="selectedGate"
                :show-details="showDetails"
                :unhighlight-spools="unhighlightSpools"
                :has-bypass="hasBypass"
                @select-gate="emit('select-gate', $event)" />
            <MmuGate
                v-if="hasBypass"
                :gate-index="TOOL_GATE_BYPASS"
                :machine-unit="machineUnit"
                :selected-gate="selectedGate"
                @select-gate="emit('select-gate', $event)" />
        </div>
        <div
            v-if="showFooter && machineUnit"
            class="text-muted-foreground px-4 pt-1 pb-2 text-center text-xs"
            :style="{ maxWidth }">
            {{ machineUnit.name || machineUnit.vendor }}
            <span v-if="machineUnit.version" class="opacity-70">v{{ machineUnit.version }}</span>
        </div>
    </div>
</template>

<style scoped>
/*
 * The unit's body. Rounded hard at the top and softly at the bottom so a row
 * of gates reads as a box the spools sit IN rather than a list of cards, and
 * an inset highlight along the top edge to suggest the lid. Fixed colours for
 * the same reason as the gate trough: arbitrary spool colours sit on top.
 */
.mmu-unit {
    background: #2c2c2c;
    border-radius: 32px 32px 8px 8px;
    box-shadow: inset 0 4px 4px -4px #ffffff80;
}

:root[data-theme='light'] .mmu-unit,
html.light .mmu-unit {
    background: #f0f0f0;
    box-shadow: inset 0 4px 2px -4px #2c2c2c80;
}
</style>
