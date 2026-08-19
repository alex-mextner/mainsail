<script setup lang="ts">
import { computed } from 'vue'
import Dialog from '@/components/ui/Dialog.vue'
import { Button } from '@/components/ui/button'
import { useAfc } from '@/composables/useAfc'
import { useConnectionStore } from '@/stores/connection'

/**
 * Point a lane at a tool number -- Mainsail's `AfcUnitLaneMappingToolDialog`.
 *
 * The tool list is not configured anywhere: it is every tool ANY lane is
 * currently mapped to (`mapList`). So a machine with T0..T3 offers those four,
 * and a lane already holding one shows it disabled rather than hidden --
 * upstream's choice, and the right one, because a missing button reads as a
 * bug while a disabled one reads as "already there".
 */
const props = defineProps<{ name: string }>()
const open = defineModel<boolean>({ required: true })

const afc = useAfc()
const connection = useConnectionStore()

const mappedTools = computed(() => {
    const map = afc.laneObject(props.name).map
    if (!map) return []
    return (Array.isArray(map) ? map : [map]).map((tool) => tool.toLowerCase())
})

function mapTool(tool: string): void {
    void connection.sendGcode(`SET_MAP LANE=${props.name} MAP=${tool}`)
    open.value = false
}
</script>

<template>
    <Dialog v-model="open" title="Lane mapping" :description="`Map a tool command to lane ${name}.`">
        <div class="flex flex-wrap justify-center gap-2" data-testid="afc-map-tools">
            <Button
                v-for="tool in afc.mapList.value"
                :key="tool"
                size="sm"
                :disabled="mappedTools.includes(tool.toLowerCase())"
                @click="mapTool(tool)">
                {{ tool.toUpperCase() }}
            </Button>
            <p v-if="!afc.mapList.value.length" class="text-muted-foreground text-sm">
                No lane on this machine is mapped to a tool yet, so there is nothing to choose from.
            </p>
        </div>
    </Dialog>
</template>
