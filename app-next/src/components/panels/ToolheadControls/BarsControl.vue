<script setup lang="ts">
import { computed } from 'vue'
import { mdiEngineOff, mdiHome } from '@mdi/js'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import { Button } from '@/components/ui/button'
import { useControl } from '@/composables/useControl'

/**
 * The default axis control -- Mainsail's `ToolheadControls/BarsControl.vue`.
 *
 * One row per axis: descending steps, the home button for that axis in the
 * middle, ascending steps. The middle button doubles as the homed indicator,
 * which is why it is coloured rather than merely labelled.
 */
const {
    control,
    homedAxes,
    isPrinting,
    isLoading,
    capabilities,
    qglState,
    zTiltState,
    enableXYHoming,
    feedrateXY,
    feedrateZ,
    doHome,
    doHomeX,
    doHomeY,
    doHomeXY,
    doHomeZ,
    doQGL,
    doZtilt,
    doMotorsOff,
    doSendMove,
} = useControl()

const descending = (steps: number[]) => [...steps].sort((a, b) => b - a)
const ascending = (steps: number[]) => [...steps].sort((a, b) => a - b)

const rows = computed(() => [
    {
        axis: 'X',
        homed: homedAxes.value.includes('x'),
        loadingKey: 'homeX',
        home: doHomeX,
        steps: control.value.stepsXY,
        feedrate: feedrateXY.value,
    },
    {
        axis: 'Y',
        homed: homedAxes.value.includes('y'),
        loadingKey: 'homeY',
        home: doHomeY,
        steps: control.value.stepsXY,
        feedrate: feedrateXY.value,
    },
    {
        axis: 'Z',
        homed: homedAxes.value.includes('z'),
        loadingKey: 'homeZ',
        home: doHomeZ,
        steps: control.value.stepsZ,
        feedrate: feedrateZ.value,
    },
])
</script>

<template>
    <div class="flex flex-col gap-2">
        <!-- HOME ALL / LEVELLING / MOTORS OFF -->
        <div class="flex flex-wrap justify-center gap-2">
            <Button
                size="sm"
                :disabled="isPrinting || isLoading('homeAll')"
                :variant="homedAxes.includes('xyz') ? 'default' : 'outline'"
                :class="homedAxes.includes('xyz') ? '' : 'border-warn text-warn'"
                @click="doHome">
                <MdiIcon :path="mdiHome" class="size-4" />
                ALL
            </Button>

            <Button
                v-if="enableXYHoming"
                size="sm"
                :disabled="isPrinting || isLoading('homeXY')"
                :variant="homedAxes.includes('xy') ? 'default' : 'outline'"
                :class="homedAxes.includes('xy') ? '' : 'border-warn text-warn'"
                @click="doHomeXY">
                <MdiIcon :path="mdiHome" class="size-4" />
                XY
            </Button>

            <Button
                v-if="capabilities.qgl"
                size="sm"
                :disabled="isPrinting || isLoading('qgl')"
                :variant="qglState === 'ok' ? 'default' : 'outline'"
                :class="qglState === 'ok' ? '' : 'border-warn text-warn'"
                @click="doQGL">
                QGL
            </Button>

            <Button
                v-if="capabilities.zTilt"
                size="sm"
                :disabled="isPrinting || isLoading('zTilt')"
                :variant="zTiltState === 'ok' ? 'default' : 'outline'"
                :class="zTiltState === 'ok' ? '' : 'border-warn text-warn'"
                @click="doZtilt">
                Z-Tilt
            </Button>

            <Button
                size="sm"
                :disabled="isPrinting"
                :variant="homedAxes !== '' ? 'default' : 'outline'"
                :class="homedAxes !== '' ? '' : 'border-warn text-warn'"
                aria-label="Motors off"
                @click="doMotorsOff">
                <MdiIcon :path="mdiEngineOff" class="size-4" />
            </Button>
        </div>

        <!-- ONE ROW PER AXIS -->
        <div v-for="row in rows" :key="row.axis" class="seg-group">
            <button
                v-for="step of descending(row.steps)"
                :key="`${row.axis}-${step}`"
                type="button"
                class="seg-btn"
                :disabled="isPrinting"
                @click="doSendMove(`${row.axis}-${step}`, row.feedrate)">
                &ndash;{{ step }}
            </button>

            <button
                type="button"
                class="seg-btn font-bold"
                style="flex: 0 0 36px"
                :data-state="row.homed ? 'homed' : 'unhomed'"
                :disabled="isPrinting || isLoading(row.loadingKey)"
                :aria-label="`Home ${row.axis}`"
                @click="row.home()">
                {{ row.axis }}
            </button>

            <button
                v-for="step of ascending(row.steps)"
                :key="`${row.axis}+${step}`"
                type="button"
                class="seg-btn"
                :disabled="isPrinting"
                @click="doSendMove(`${row.axis}+${step}`, row.feedrate)">
                +{{ step }}
            </button>
        </div>
    </div>
</template>
