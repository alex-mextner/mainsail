<script setup lang="ts">
import { computed } from 'vue'
import { mdiMulticast, mdiDotsVertical, mdiCheckAll, mdiNoteText, mdiRefresh, mdiInformationOutline } from '@mdi/js'
import Panel from '@/components/ui/Panel.vue'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import { Menu, MenuItem, MenuCheckboxItem, MenuSeparator } from '@/components/ui/menu'
import MmuUnit from './Mmu/MmuUnit.vue'
import MmuControls from './Mmu/MmuControls.vue'
import MmuTtgMap from './Mmu/MmuTtgMap.vue'
import { useMmu, TOOL_GATE_BYPASS, TOOL_GATE_UNKNOWN } from '@/composables/useMmu'
import { useGuiStore } from '@/stores/gui'

/**
 * MMU (Happy Hare) -- Mainsail's `MmuPanel.vue` and the files under
 * `panels/Mmu/`.
 *
 * 🔴 NOT PRESENT ON THIS MACHINE, checked and not assumed: `printer/objects/list`
 * has no `mmu` and no `mmu_machine`. Happy Hare is a Klipper extra, so as with
 * AFC there is no Moonraker component to gate on and the panel gates on the
 * object. Everything here is exercised through `scripts/fixtures/mmu.mjs`.
 *
 * 🔴 DISABLED IS NOT ABSENT, and the difference is upstream's. `mmu.enabled`
 * false means the hardware is configured but switched off (`MMU ENABLE=0`), so
 * the panel STAYS VISIBLE with "(disabled)" in its title and its body dimmed
 * and inert. Hiding it would tell the user their MMU had vanished.
 *
 * PORTED SO FAR: the unit and its gates (with the spool gauges), the gate
 * summary line, the command buttons, the tool-to-gate map, the last-error
 * strip, and the menu.
 *
 * NOT PORTED YET, named rather than quietly missing -- each is its own piece
 * of work and none of them is reachable on this machine either:
 *   - `MmuFilamentStatus` (586 lines): the animated gate->nozzle filament path
 *   - `MmuClogMeter` / `MmuFlowguardMeter`: the encoder and sync-feedback dials
 *   - `MmuUnitFooter` / `MmuUnitFooterClimate`: selector graphic, dryer, humidity
 *   - `MmuUnitGateMenu`: the per-gate right-click menu
 *   - the four dialogs (edit TTG map, edit gate map, recover state, maintenance)
 */
const mmu = useMmu()
const gui = useGuiStore()

const view = computed(() => gui.state.view.mmu)

const title = computed(() => (mmu.enabled.value ? 'MMU' : 'MMU (disabled)'))

const lastTool = computed(() => mmu.mmu.value?.last_tool ?? TOOL_GATE_UNKNOWN)
const nextTool = computed(() => mmu.mmu.value?.next_tool ?? TOOL_GATE_UNKNOWN)

const toolchangeText = computed(() => {
    if (nextTool.value === TOOL_GATE_UNKNOWN) return ''

    const label = (tool: number) => (tool === TOOL_GATE_BYPASS ? 'Bypass' : `T${tool}`)
    const parts = ['Changing tool']
    if (lastTool.value !== TOOL_GATE_UNKNOWN) parts.push('from', label(lastTool.value))
    parts.push('to', label(nextTool.value))

    return parts.join(' ')
})

const reasonForPause = computed(() => mmu.mmu.value?.reason_for_pause || null)

/**
 * A bypass with no unit of its own gets rendered as a unit-less extra gate.
 * Upstream's test: show it only when NO unit claims a bypass.
 */
const showStandaloneBypass = computed(() => {
    for (let i = 0; i < mmu.numUnits.value; i++) {
        if (mmu.machineUnit(i)?.has_bypass) return false
    }
    return true
})

const activeGateSummary = computed(() => {
    const index = mmu.gate.value
    if (index === TOOL_GATE_UNKNOWN) return 'No gate selected'
    if (index === TOOL_GATE_BYPASS) return 'Bypass selected'

    const material = mmu.mmu.value?.gate_material?.[index] || 'Unknown'
    const name = mmu.mmu.value?.gate_filament_name?.[index]
    const temp = mmu.mmu.value?.gate_temperature?.[index] ?? -1

    return [`Gate ${index}`, name, material, temp > 0 ? `${temp}°C` : null].filter(Boolean).join(' | ')
})

const toggles = [
    { key: 'showDetails' as const, label: 'Gate details' },
    { key: 'showTtgMap' as const, label: 'Tool mapping' },
    { key: 'showClogDetection' as const, label: 'Clog detection' },
    { key: 'showUnavailableSpoolColor' as const, label: 'Colour empty gates' },
    { key: 'largeFilamentStatus' as const, label: 'Large filament status' },
]

const selectGate = (gate: number) =>
    mmu.send(gate === TOOL_GATE_BYPASS ? 'MMU_SELECT BYPASS=1' : `MMU_SELECT GATE=${gate}`, 'mmu_select')

const menuCommands = computed(() => [
    { id: 'stats', icon: mdiNoteText, label: 'Print stats', command: 'MMU_STATS SHOWCOUNTS=1', disabled: false },
    {
        id: 'spoolman',
        icon: mdiRefresh,
        label: 'Sync Spoolman',
        command: 'MMU_SPOOLMAN REFRESH=1 QUIET=1',
        disabled: mmu.spoolmanSupport.value === 'off',
    },
    {
        id: 'check-gates',
        icon: mdiCheckAll,
        label: 'Check all gates',
        command: 'MMU_CHECK_GATES',
        disabled: !mmu.canSend.value,
    },
])
</script>

<template>
    <Panel v-if="mmu.mmuExists.value" panel-name="mmu" :title="title" :icon="mdiMulticast" collapsible>
        <template #buttons>
            <Menu content-class="min-w-[13rem]">
                <template #trigger>
                    <button
                        type="button"
                        class="text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring inline-flex size-8 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
                        aria-label="MMU functions">
                        <MdiIcon :path="mdiDotsVertical" class="size-4" />
                    </button>
                </template>
                <MenuItem
                    v-for="entry in menuCommands"
                    :key="entry.id"
                    :disabled="!mmu.enabled.value || entry.disabled"
                    :data-mmu-menu="entry.id"
                    @select="mmu.send(entry.command, `mmu_${entry.id}`)">
                    <MdiIcon :path="entry.icon" class="size-4" />
                    <span>{{ entry.label }}</span>
                </MenuItem>
                <MenuSeparator class="bg-border -mx-1 my-1 h-px" />
                <MenuCheckboxItem
                    v-for="toggle in toggles"
                    :key="toggle.key"
                    :model-value="view[toggle.key]"
                    :label="toggle.label"
                    @update:model-value="gui.state.view.mmu[toggle.key] = $event" />
            </Menu>
        </template>

        <div
            class="px-4 pb-4"
            :class="{ 'pointer-events-none opacity-50': !mmu.enabled.value }"
            data-mmu-body=""
            :data-mmu-enabled="mmu.enabled.value">
            <div class="flex flex-wrap">
                <MmuUnit
                    v-for="i in mmu.numUnits.value"
                    :key="i"
                    :unit-index="i - 1"
                    :selected-gate="mmu.gate.value"
                    :show-details="true"
                    @select-gate="selectGate" />
                <MmuUnit
                    v-if="showStandaloneBypass"
                    key="bypass"
                    :unit-index="-1"
                    :selected-gate="mmu.gate.value"
                    :show-details="false"
                    :show-footer="false"
                    @select-gate="selectGate" />
            </div>

            <div class="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div class="flex flex-col gap-2">
                    <div v-if="toolchangeText" class="text-muted-foreground text-sm" data-testid="mmu-toolchange">
                        {{ toolchangeText }}
                    </div>
                    <div v-if="view.showDetails" class="text-sm" data-testid="mmu-gate-summary">
                        {{ activeGateSummary }}
                    </div>
                </div>

                <div class="flex flex-col gap-2">
                    <MmuControls />
                    <template v-if="view.showTtgMap">
                        <div class="flex flex-col items-center">
                            <MmuTtgMap
                                class="max-w-[75%]"
                                :selected-tool="mmu.tool.value"
                                :selected-gate="mmu.gate.value" />
                        </div>
                        <div class="text-muted-foreground text-center text-sm">Tool mapping</div>
                    </template>
                </div>
            </div>
        </div>

        <div v-if="reasonForPause" class="border-t px-4 py-3" data-testid="mmu-last-error">
            <div class="flex gap-2">
                <MdiIcon :path="mdiInformationOutline" class="text-destructive mt-0.5 size-5 shrink-0" />
                <div>
                    <div class="text-sm font-semibold">Last Error</div>
                    <div class="text-muted-foreground text-sm">{{ reasonForPause }}</div>
                </div>
            </div>
        </div>
    </Panel>
</template>
