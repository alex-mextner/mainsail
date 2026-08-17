<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { mdiCodeTags } from '@mdi/js'
import Panel from '@/components/ui/Panel.vue'
import MacroButton from '@/components/ui/MacroButton.vue'
import { usePrinterStore } from '@/stores/printer'
import { useConnectionStore } from '@/stores/connection'
import { useGuiStore, type MacroColor } from '@/stores/gui'

/**
 * One user-defined macro group -- Mainsail's `panels/MacrogroupPanel.vue`.
 *
 * A group is a named subset of macros with its own colour and its own rules
 * about WHEN it appears: separately for standby, printing and paused. That is
 * the point of the feature -- a "during print" group of babystep/pause macros
 * that is not in the way the rest of the time.
 *
 * The gating is applied twice on purpose, and that is upstream's design, not a
 * redundancy: the group as a whole has visibility flags, and so does every
 * macro inside it. A group visible while printing can still hide individual
 * members that make no sense mid-print.
 *
 * A macro listed in a group but no longer present in the config is dropped,
 * not rendered dead: groups are stored by name and survive config edits that
 * the macro itself does not.
 *
 * 🔴 REACHABILITY: the group EDITOR (upstream's Settings -> Macros, expert
 * mode) is not ported yet, so nothing in the UI can create a group -- this
 * panel renders correctly but has nothing to render until that lands. It was
 * verified by seeding a group into localStorage directly; see the commit.
 */
const props = defineProps<{ groupId: string }>()

const printer = usePrinterStore()
const connection = useConnectionStore()
const gui = useGuiStore()

const { macros, printerState } = storeToRefs(printer)
const { klippyState } = storeToRefs(connection)

const group = computed(() => gui.macrogroup(props.groupId))

/**
 * Upstream's state buckets: everything that is not printing and not paused
 * counts as standby, including `cancelled`, `complete` and `error`.
 */
const visibleInState = (rule: { showInStandby: boolean; showInPrinting: boolean; showInPause: boolean }): boolean => {
    if (printerState.value === 'printing') return rule.showInPrinting
    if (printerState.value === 'paused') return rule.showInPause
    return rule.showInStandby
}

const groupVisible = computed(() => (group.value ? visibleInState(group.value) : false))

const groupColor = computed<MacroColor>(() => {
    const color = group.value?.color ?? 'primary'
    // `custom` is a free-form hex upstream stores alongside; without the editor
    // there is no way to set one, and a hex would not survive the theme swap
    // anyway, so it falls back to the primary token.
    return color === 'custom' ? 'primary' : color
})

const entries = computed(() => {
    const list = group.value?.macros ?? []

    return list
        .filter((entry) => macros.value.some((macro) => macro.name.toLowerCase() === entry.name.toLowerCase()))
        .filter((entry) => visibleInState(entry))
        .slice()
        .sort((a, b) => a.pos - b.pos)
})

const colorOf = (entry: { color: MacroColor | 'group' }): MacroColor =>
    entry.color === 'group' ? groupColor.value : entry.color

const showPanel = computed(
    () => klippyState.value === 'ready' && groupVisible.value && entries.value.length > 0 && group.value !== undefined
)
</script>

<template>
    <Panel
        v-if="showPanel"
        :panel-name="`macrogroup-${groupId}`"
        :title="group?.name ?? 'Macros'"
        :icon="mdiCodeTags"
        collapsible
        content-class="flex flex-wrap justify-center gap-2">
        <MacroButton v-for="entry in entries" :key="entry.name" :macro="entry" :color="colorOf(entry)" />
    </Panel>
</template>
