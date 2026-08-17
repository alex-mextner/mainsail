<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { mdiRestart } from '@mdi/js'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import PressureAdvanceSettings from './PressureAdvanceSettings.vue'
import { usePrinterStore } from '@/stores/printer'

/**
 * Extruder picker in front of the pressure-advance fields -- Mainsail's
 * `Extruder/ExtruderPressureAdvanceSettings.vue`.
 *
 * The selector only appears on a multi-extruder machine; with one extruder the
 * fields stand alone. The reset arrow jumps back to whichever extruder is
 * actually active, which matters because the selection is deliberately sticky:
 * you can inspect extruder 1 while extruder 0 prints.
 */
const printer = usePrinterStore()
const { activeExtruder } = storeToRefs(printer)

/** Live objects, not config -- upstream lists what the printer currently has. */
const extruders = computed(() =>
    Object.keys(printer.objects)
        .filter((key) => key.startsWith('extruder') && !key.startsWith('extruder_stepper'))
        .sort((a, b) => a.localeCompare(b))
)

const selected = ref(activeExtruder.value)

watch(activeExtruder, (next) => {
    selected.value = next
})

// A tool change can remove the extruder being inspected.
watch(extruders, (list) => {
    if (!list.includes(selected.value)) selected.value = activeExtruder.value
})
</script>

<template>
    <div class="@sm:flex-row @sm:items-end flex flex-col gap-2">
        <div v-if="extruders.length > 1" class="flex shrink-0 items-end gap-1">
            <label class="flex flex-col gap-1">
                <span class="text-muted-foreground text-[11px]">Extruder</span>
                <select
                    v-model="selected"
                    class="border-input bg-background focus-visible:ring-ring rounded-md border px-2 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-none">
                    <option v-for="name in extruders" :key="name" :value="name">{{ name }}</option>
                </select>
            </label>

            <button
                v-if="selected !== activeExtruder"
                type="button"
                class="text-muted-foreground hover:text-foreground pb-2"
                aria-label="Back to the active extruder"
                @click="selected = activeExtruder">
                <MdiIcon :path="mdiRestart" class="size-4" />
            </button>
        </div>

        <div class="min-w-0 grow">
            <PressureAdvanceSettings :extruder="selected" />
        </div>
    </div>
</template>
