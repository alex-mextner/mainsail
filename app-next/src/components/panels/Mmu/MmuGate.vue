<script setup lang="ts">
import { computed } from 'vue'
import MmuGateSpool from './MmuGateSpool.vue'
import { useMmu, TOOL_GATE_BYPASS, type MmuMachineUnit } from '@/composables/useMmu'

/**
 * One gate: a spool sitting above a numbered box -- Mainsail's
 * `Mmu/MmuUnitGate.vue`.
 *
 * The boxes butt against each other to read as one physical unit, so only the
 * first and last get a rounded outer edge. `hasBypass` matters here for that
 * reason alone: with a bypass present the last NUMBERED gate is no longer the
 * right-hand end of the row.
 *
 * NOT ported yet: the right-click context menu (`MmuUnitGateMenu`), which is
 * the per-gate load/eject/check surface. Clicking selects the gate, which is
 * upstream's behaviour when the menu is off.
 */
const props = withDefaults(
    defineProps<{
        gateIndex: number
        selectedGate: number
        machineUnit?: MmuMachineUnit
        showDetails?: boolean
        unhighlightSpools?: boolean
        hasBypass?: boolean
    }>(),
    { showDetails: false, unhighlightSpools: false, hasBypass: false }
)

const emit = defineEmits<{ 'select-gate': [gate: number] }>()

const mmu = useMmu()

const isBypass = computed(() => props.gateIndex === TOOL_GATE_BYPASS)
const gateName = computed(() => (isBypass.value ? 'Bypass' : String(props.gateIndex)))

const status = computed(() => mmu.mmu.value?.gate_status?.[props.gateIndex] ?? 0)
const isSelected = computed(() => props.selectedGate === props.gateIndex)

/** 1-based position within this unit -- gates are numbered across all units. */
const gatePosition = computed(() => props.gateIndex + 1 - (props.machineUnit?.first_gate ?? 0))

const isFirst = computed(() => !props.machineUnit || gatePosition.value === 1)
const isLast = computed(() => {
    if (!props.machineUnit || isBypass.value) return true
    return gatePosition.value === props.machineUnit.num_gates && !props.hasBypass
})
</script>

<template>
    <div
        class="flex cursor-pointer flex-col items-center"
        :data-gate="gateIndex"
        :data-gate-status="status"
        :data-gate-selected="isSelected"
        @click="emit('select-gate', gateIndex)">
        <div class="relative z-10 -mb-5 flex flex-wrap pt-1">
            <MmuGateSpool
                :gate-index="gateIndex"
                :show-details="showDetails"
                :is-selected="isSelected"
                :unhighlight-spools="unhighlightSpools" />
        </div>

        <div
            class="mmu-gate-box relative z-20 flex pt-2 pb-1"
            :class="{ 'rounded-tl-lg': isFirst, 'rounded-tr-lg': isLast }">
            <div class="flex w-full justify-center">
                <span
                    class="mmu-gate-number rounded px-1.5 text-xs font-medium"
                    :class="{
                        'bg-primary text-primary-foreground': isSelected,
                        'border-b-2 border-dashed border-current': status < 0,
                        'border-primary border-b-2': status > 0,
                        italic: isBypass,
                    }">
                    {{ gateName }}
                </span>
            </div>
        </div>
    </div>
</template>

<style scoped>
/*
 * The dark trough the gates sit in. Deliberately a fixed colour rather than a
 * theme token: it represents the physical unit's body, and it sits behind
 * spools whose colours are arbitrary, so it has to stay neutral in both themes.
 */
.mmu-gate-box {
    min-width: 100%;
    background: #1c1c1c;
}

.mmu-gate-number {
    min-width: 1.6rem;
    text-align: center;
}
</style>
