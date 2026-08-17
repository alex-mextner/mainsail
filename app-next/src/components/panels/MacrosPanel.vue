<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { mdiCodeTags } from '@mdi/js'
import Panel from '@/components/ui/Panel.vue'
import MacroButton from '@/components/ui/MacroButton.vue'
import { usePrinterStore } from '@/stores/printer'
import { useConnectionStore } from '@/stores/connection'
import { useGuiStore } from '@/stores/gui'

/**
 * Macros -- Mainsail's `panels/MacrosPanel.vue`.
 *
 * Every user-facing macro Klipper has loaded, as one wrapping row of buttons.
 * "User-facing" is decided in the printer store, by upstream's two rules: a
 * leading underscore means internal, and `rename_existing` means the macro is
 * an override of a built-in (PAUSE, RESUME, CANCEL_PRINT) that already has its
 * own controls elsewhere. On this machine those two rules hide roughly half of
 * what is in the config -- all the `_TUNE_*` and `_PLR_*` helpers.
 *
 * Hidden macros come from the gui store and are matched case-insensitively,
 * exactly as upstream: Klipper is case-insensitive about command names, so a
 * stored "load_filament" has to hide LOAD_FILAMENT.
 *
 * The panel disappears entirely when there is nothing to show, rather than
 * rendering an empty card -- upstream's `v-if` and the same reasoning: an empty
 * card on the dashboard reads as a fault.
 */
const printer = usePrinterStore()
const connection = useConnectionStore()
const gui = useGuiStore()

const { macros } = storeToRefs(printer)
const { klippyState } = storeToRefs(connection)

const hiddenMacros = computed(() => gui.state.macros.hiddenMacros.map((name) => name.toLowerCase()))

const visibleMacros = computed(() =>
    macros.value.filter((macro) => !hiddenMacros.value.includes(macro.name.toLowerCase()))
)

const showPanel = computed(() => klippyState.value === 'ready' && visibleMacros.value.length > 0)
</script>

<template>
    <Panel
        v-if="showPanel"
        panel-name="macros"
        title="Macros"
        :icon="mdiCodeTags"
        collapsible
        content-class="flex flex-wrap justify-center gap-2">
        <MacroButton v-for="macro in visibleMacros" :key="macro.name" :macro="macro" />
    </Panel>
</template>
