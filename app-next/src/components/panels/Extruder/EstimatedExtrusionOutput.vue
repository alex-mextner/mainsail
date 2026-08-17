<script setup lang="ts">
import { computed } from 'vue'
import { mdiDiameterVariant, mdiInformationOutline } from '@mdi/js'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import { useGuiStore } from '@/stores/gui'
import { useExtruder } from '@/composables/useExtruder'

/**
 * "~N mm @ F mm³/s" caption under the extrude buttons -- Mainsail's
 * `Extruder/EstimatedExtrusionOutput.vue`.
 *
 * Answers "what will pressing Extrude actually do", which the mm of filament on
 * the button does not: the same 25 mm of 1.75 mm filament is ~478 mm of extruded
 * line through a 0.4 mm nozzle but ~213 mm through the 0.6 mm one fitted here.
 *
 * Both figures move with the live factors, so the warning icon appears whenever
 * speed or flow is not 100 % -- otherwise the numbers would silently disagree
 * with what the machine does.
 */
const gui = useGuiStore()
const { feedamount, feedrate, extrudeFactor, speedFactor, filamentDiameter, nozzleDiameter } = useExtruder()

const show = computed(() => gui.state.control.extruder.showEstimatedExtrusionInfo ?? true)

/** Volume conservation: filament area in, nozzle area out. */
const extrudedLength = computed(() =>
    Math.round(feedamount.value * extrudeFactor.value * (filamentDiameter.value ** 2 / nozzleDiameter.value ** 2))
)

const volumetricFlow = computed(
    () => Math.round((filamentDiameter.value / 2) ** 2 * Math.PI * feedrate.value * speedFactor.value * 10) / 10
)

const showFactorHint = computed(() => speedFactor.value !== 1 || extrudeFactor.value !== 1)

const factorHint = computed(() =>
    [
        speedFactor.value !== 1 ? `Speed factor: ${(speedFactor.value * 100).toFixed(0)} %` : '',
        extrudeFactor.value !== 1 ? `Extrusion factor: ${(extrudeFactor.value * 100).toFixed(0)} %` : '',
    ]
        .filter(Boolean)
        .join(' · ')
)
</script>

<template>
    <p v-if="show" class="text-muted-foreground flex flex-wrap items-center justify-center gap-1 text-[11px]">
        <span class="tabular">Estimated extrusion ~ {{ extrudedLength }} mm @ {{ volumetricFlow }} mm³/s</span>
        <MdiIcon :path="mdiDiameterVariant" class="size-3 shrink-0 opacity-50" />
        <span class="tabular">{{ nozzleDiameter }} mm</span>
        <MdiIcon
            v-if="showFactorHint"
            :path="mdiInformationOutline"
            class="text-warn size-3.5 shrink-0"
            :title="factorHint" />
    </p>
</template>
