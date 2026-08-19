<script setup lang="ts">
import { computed } from 'vue'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import AfcLane from './AfcLane.vue'
import { useAfc } from '@/composables/useAfc'
import { convertName } from '@/lib/format'
import { afcIconBoxTurtle, afcIconHtlf, afcIconNightOwl, afcIconQuattroBox } from '@/lib/afcIcons'
import { useGuiStore } from '@/stores/gui'

/**
 * One physical AFC box and its lanes -- Mainsail's `AfcPanelUnit` and
 * `AfcPanelUnitHub`.
 *
 * The hub dot is per unit, not per lane: a hub is the single filament path out
 * of the box, so "hub loaded" means filament is somewhere between the lanes and
 * the toolhead. That is why it sits in the unit header rather than on a card.
 */
const props = defineProps<{ name: string }>()

const afc = useAfc()
const gui = useGuiStore()

const unit = computed(() => afc.unitObject(props.name))
const lanes = computed(() => unit.value.lanes ?? [])
const hubs = computed(() => unit.value.hubs ?? [])

const title = computed(() => convertName(afc.unitShortName(props.name)))

const icon = computed(() => {
    if (!gui.state.view.afc.showUnitIcons) return null

    switch (afc.unitType(props.name)) {
        case 'boxturtle':
            return afcIconBoxTurtle
        case 'htlf':
            return afcIconHtlf
        case 'nightowl':
            return afcIconNightOwl
        case 'quattrobox':
            return afcIconQuattroBox
        default:
            return null
    }
})

const hubState = (hub: string) => afc.hubObject(hub).state ?? false
</script>

<template>
    <div :data-afc-unit="name">
        <div class="flex flex-row items-center justify-between gap-2">
            <h3 class="flex items-center gap-2 text-base font-medium">
                <MdiIcon v-if="icon" :path="icon" class="size-5" />
                {{ title }}
            </h3>
            <div class="flex items-center gap-3">
                <div v-for="hub in hubs" :key="hub" class="flex items-center gap-2">
                    <span
                        class="inline-block size-2.5 rounded-full"
                        :class="hubState(hub) ? 'bg-primary' : 'bg-destructive'"
                        :title="`${hub} hub load - ${hubState(hub) ? 'Detected' : 'Empty'}`" />
                    <span class="text-sm">Hub</span>
                </div>
            </div>
        </div>
        <div class="mt-2 flex flex-row flex-wrap gap-4">
            <AfcLane v-for="lane in lanes" :key="lane" :name="lane" />
        </div>
    </div>
</template>
