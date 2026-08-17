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

/**
 * Upstream colours these `primary` when satisfied and `warning` when not, and
 * both are SOLID fills on a Vuetify `v-btn` -- the amber is meant to be seen
 * across the room, not read as a subtle outline. Expressed explicitly here so
 * the fill is a decision rather than a side effect of class merging.
 */
const stateClass = (ok: boolean) =>
    ok ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-warn text-background hover:bg-warn/90'

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
                :class="stateClass(homedAxes.includes('xyz'))"
                @click="doHome">
                <MdiIcon :path="mdiHome" class="size-4" />
                ALL
            </Button>

            <Button
                v-if="enableXYHoming"
                size="sm"
                :disabled="isPrinting || isLoading('homeXY')"
                :class="stateClass(homedAxes.includes('xy'))"
                @click="doHomeXY">
                <MdiIcon :path="mdiHome" class="size-4" />
                XY
            </Button>

            <Button
                v-if="capabilities.qgl"
                size="sm"
                :disabled="isPrinting || isLoading('qgl')"
                :class="stateClass(qglState === 'ok')"
                @click="doQGL">
                QGL
            </Button>

            <Button
                v-if="capabilities.zTilt"
                size="sm"
                :disabled="isPrinting || isLoading('zTilt')"
                :class="stateClass(zTiltState === 'ok')"
                @click="doZtilt">
                Z-Tilt
            </Button>

            <Button
                size="sm"
                :disabled="isPrinting"
                :class="stateClass(homedAxes !== '')"
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
