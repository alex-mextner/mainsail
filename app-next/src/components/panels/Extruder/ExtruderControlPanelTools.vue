<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { usePrinterStore } from '@/stores/printer'
import { useConnectionStore } from '@/stores/connection'
import { useControl } from '@/composables/useControl'

/**
 * T0 / T1 / ... tool-change buttons -- Mainsail's
 * `Extruder/ExtruderControlPanelTools.vue` plus its item component, merged:
 * the item was a component only to carry per-macro colour state, and that fits
 * in a computed here.
 *
 * The row-splitting arithmetic is upstream's: at most six per row, but balanced
 * rather than greedy, so eight tools give 4 + 4 and not 6 + 2.
 *
 * A macro can expose `variable_active` and `variable_color`, which is how
 * multi-tool setups mark the selected tool and its filament colour. Spoolman
 * lookup is deliberately not ported here -- that is queue 2.
 */
const printer = usePrinterStore()
const connection = useConnectionStore()
const { isPrinting } = useControl()

const { toolchangeMacros } = storeToRefs(printer)

const rows = computed(() => {
    const total = toolchangeMacros.value.length
    if (total === 0) return []

    const perRow = Math.ceil(total / Math.ceil(total / 6))
    const result: string[][] = []
    for (let index = 0; index < total; index += perRow) {
        result.push(toolchangeMacros.value.slice(index, index + perRow))
    }
    return result
})

const macroObject = (name: string) => {
    const key = Object.keys(printer.objects).find(
        (candidate) => candidate.toLowerCase() === `gcode_macro ${name.toLowerCase()}`
    )
    return key ? ((printer.objects[key] ?? {}) as Record<string, unknown>) : undefined
}

const isActive = (name: string) => macroObject(name)?.active === true

const colourOf = (name: string) => {
    const macro = macroObject(name)
    const colour = (macro?.color ?? macro?.colour ?? null) as string | null
    if (!colour || colour === 'undefined') return null
    return colour.startsWith('#') ? colour : `#${colour}`
}

const changeTool = (name: string) => connection.sendGcode(name.toUpperCase())
</script>

<template>
    <div class="flex flex-col gap-1">
        <div v-for="(row, index) in rows" :key="`tool-row-${index}`" class="seg-group">
            <button
                v-for="name in row"
                :key="name"
                type="button"
                class="seg-btn"
                :data-state="isActive(name) ? 'homed' : undefined"
                :disabled="isPrinting"
                @click="changeTool(name)">
                <span
                    v-if="colourOf(name)"
                    class="size-3 shrink-0 rounded-full border border-current/40"
                    :style="{ backgroundColor: colourOf(name) as string }" />
                {{ name.toUpperCase() }}
            </button>
        </div>
    </div>
</template>
