<script setup lang="ts">
import { computed } from 'vue'
import Dialog from '@/components/ui/Dialog.vue'
import { Button } from '@/components/ui/button'
import { useAfc } from '@/composables/useAfc'
import { useConnectionStore } from '@/stores/connection'

/**
 * Infinite spool -- which lane takes over when this one runs out.
 * Mainsail's `AfcUnitLaneInfiniteDialog`.
 *
 * Only lanes that are actually READY can be offered (`prep && load`, the same
 * test the lane card uses), because a runout partner that has no filament in
 * it would turn one runout into two. `NONE` is always first, so switching the
 * feature off is never further away than switching it on.
 */
const props = defineProps<{ name: string }>()
const open = defineModel<boolean>({ required: true })

const afc = useAfc()
const connection = useConnectionStore()

const runoutLane = computed(() => afc.laneObject(props.name).runout_lane ?? 'NONE')

const laneList = computed(() => {
    const ready = afc.lanes.value
        .filter((candidate) => candidate !== props.name)
        .filter((candidate) => {
            const lane = afc.laneObject(candidate)
            return Boolean(lane.prep && lane.load)
        })
        .sort((a, b) => a.localeCompare(b))

    return ['NONE', ...ready]
})

function setRunout(lane: string): void {
    void connection.sendGcode(`SET_RUNOUT LANE=${props.name} RUNOUT=${lane}`)
    open.value = false
}
</script>

<template>
    <Dialog
        v-model="open"
        title="Infinite spool"
        :description="`Choose the lane that continues the print when ${name} runs out.`">
        <div class="flex flex-wrap justify-center gap-2" data-testid="afc-runout-lanes">
            <Button
                v-for="lane in laneList"
                :key="lane"
                size="sm"
                :disabled="runoutLane === lane"
                @click="setRunout(lane)">
                {{ lane }}
            </Button>
        </div>
    </Dialog>
</template>
