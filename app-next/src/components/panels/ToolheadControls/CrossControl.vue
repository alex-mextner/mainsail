<script setup lang="ts">
import { computed } from 'vue'
import { mdiChevronUp, mdiChevronDown, mdiChevronLeft, mdiChevronRight, mdiEngineOff, mdiHome } from '@mdi/js'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import { Button } from '@/components/ui/button'
import { useGuiStore } from '@/stores/gui'
import { useControl } from '@/composables/useControl'

/**
 * Directional-pad axis control -- Mainsail's `ToolheadControls/CrossControl.vue`.
 *
 * Differs from bars in that one step size is *selected* and the arrows apply it,
 * which is what makes the per-axis reverse flags meaningful: on a machine where
 * the bed moves instead of the gantry, "up" on screen can be -Y in g-code, and
 * the user sets that once in settings rather than thinking about it every jog.
 */
const gui = useGuiStore()
const {
    control,
    homedAxes,
    isPrinting,
    isLoading,
    actionButton,
    qglState,
    zTiltState,
    enableXYHoming,
    feedrateXY,
    feedrateZ,
    xAxisHomed,
    yAxisHomed,
    zAxisHomed,
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

/** Deduplicated and ascending, as upstream. */
const steps = computed(() => Array.from(new Set(control.value.stepsAll ?? [])).sort((a, b) => a - b))

const selectedIndex = computed({
    get: () => control.value.selectedCrossStep,
    set: (value: number | null) => gui.saveSetting('control.selectedCrossStep', value),
})

const stepSize = computed(() => (selectedIndex.value === null ? null : (steps.value[selectedIndex.value] ?? null)))

/** No step chosen yet means the arrows would send "X+undefined". */
const noStep = computed(() => stepSize.value === null)

const sign = (reversed: boolean, positive: boolean) => (reversed === positive ? '-' : '+')

const jog = (axis: 'X' | 'Y' | 'Z', positive: boolean, reversed: boolean) => {
    if (stepSize.value === null) return
    doSendMove(`${axis}${sign(reversed, positive)}${stepSize.value}`, axis === 'Z' ? feedrateZ.value : feedrateXY.value)
}
</script>

<template>
    <div class="flex flex-col gap-3">
        <div class="@sm:grid-cols-2 grid grid-cols-1 gap-3">
            <!-- DIRECTION PAD: XY cross on the left three columns, Z on the fourth -->
            <div class="grid grid-cols-4 gap-1">
                <div />
                <Button
                    variant="outline"
                    size="sm"
                    class="px-0"
                    :disabled="!yAxisHomed || noStep || isPrinting"
                    aria-label="Y plus"
                    @click="jog('Y', true, control.reverseY)">
                    <MdiIcon :path="mdiChevronUp" class="size-5" />
                </Button>
                <div />
                <Button
                    variant="outline"
                    size="sm"
                    class="px-0"
                    :disabled="!zAxisHomed || noStep || isPrinting"
                    aria-label="Z plus"
                    @click="jog('Z', true, control.reverseZ)">
                    <MdiIcon :path="mdiChevronUp" class="size-5" />
                </Button>

                <Button
                    variant="outline"
                    size="sm"
                    class="px-0"
                    :disabled="!xAxisHomed || noStep || isPrinting"
                    aria-label="X minus"
                    @click="jog('X', false, control.reverseX)">
                    <MdiIcon :path="mdiChevronLeft" class="size-5" />
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    class="px-0"
                    :disabled="!yAxisHomed || noStep || isPrinting"
                    aria-label="Y minus"
                    @click="jog('Y', false, control.reverseY)">
                    <MdiIcon :path="mdiChevronDown" class="size-5" />
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    class="px-0"
                    :disabled="!xAxisHomed || noStep || isPrinting"
                    aria-label="X plus"
                    @click="jog('X', true, control.reverseX)">
                    <MdiIcon :path="mdiChevronRight" class="size-5" />
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    class="px-0"
                    :disabled="!zAxisHomed || noStep || isPrinting"
                    aria-label="Z minus"
                    @click="jog('Z', false, control.reverseZ)">
                    <MdiIcon :path="mdiChevronDown" class="size-5" />
                </Button>
            </div>

            <!-- HOME BLOCK -->
            <div class="flex flex-col justify-center gap-1">
                <div class="grid grid-cols-2 gap-1">
                    <button
                        type="button"
                        class="seg-btn rounded-md"
                        :data-state="homedAxes.includes('xyz') ? 'homed' : 'unhomed'"
                        :disabled="isPrinting || isLoading('homeAll')"
                        @click="doHome">
                        <MdiIcon :path="mdiHome" class="size-4" />
                        ALL
                    </button>

                    <button
                        v-if="actionButton === 'qgl'"
                        type="button"
                        class="seg-btn rounded-md"
                        :data-state="qglState === 'ok' ? 'homed' : 'unhomed'"
                        :disabled="isPrinting || isLoading('qgl')"
                        @click="doQGL">
                        QGL
                    </button>
                    <button
                        v-else-if="actionButton === 'ztilt'"
                        type="button"
                        class="seg-btn rounded-md"
                        :data-state="zTiltState === 'ok' ? 'homed' : 'unhomed'"
                        :disabled="isPrinting || isLoading('zTilt')"
                        @click="doZtilt">
                        Z-Tilt
                    </button>
                    <button
                        v-else
                        type="button"
                        class="seg-btn rounded-md"
                        :data-state="homedAxes !== '' ? 'homed' : 'unhomed'"
                        :disabled="isPrinting"
                        aria-label="Motors off"
                        @click="doMotorsOff">
                        <MdiIcon :path="mdiEngineOff" class="size-4" />
                    </button>
                </div>

                <div class="seg-group">
                    <template v-if="!enableXYHoming">
                        <button
                            type="button"
                            class="seg-btn"
                            :data-state="homedAxes.includes('x') ? 'homed' : 'unhomed'"
                            :disabled="isPrinting || isLoading('homeX')"
                            @click="doHomeX">
                            X
                        </button>
                        <button
                            type="button"
                            class="seg-btn"
                            :data-state="homedAxes.includes('y') ? 'homed' : 'unhomed'"
                            :disabled="isPrinting || isLoading('homeY')"
                            @click="doHomeY">
                            Y
                        </button>
                    </template>
                    <button
                        v-else
                        type="button"
                        class="seg-btn"
                        :data-state="homedAxes.includes('xy') ? 'homed' : 'unhomed'"
                        :disabled="isPrinting || isLoading('homeXY')"
                        @click="doHomeXY">
                        XY
                    </button>
                    <button
                        type="button"
                        class="seg-btn"
                        :data-state="homedAxes.includes('z') ? 'homed' : 'unhomed'"
                        :disabled="isPrinting || isLoading('homeZ')"
                        @click="doHomeZ">
                        Z
                    </button>
                </div>
            </div>
        </div>

        <!-- STEP SIZE PICKER -->
        <div v-if="steps.length" class="seg-group" role="radiogroup" aria-label="Step size">
            <button
                v-for="(step, index) of steps"
                :key="`step-${step}`"
                type="button"
                role="radio"
                :aria-checked="selectedIndex === index"
                class="seg-btn"
                :data-state="selectedIndex === index ? 'homed' : undefined"
                :disabled="isPrinting"
                @click="selectedIndex = index">
                {{ step }}
            </button>
        </div>
        <p v-else class="bg-warn text-background rounded-md p-2 text-sm font-semibold">
            Please configure the step sizes in
            <RouterLink to="/settings" class="underline">Settings &rarr; Interface &rarr; Control</RouterLink>
            .
        </p>
    </div>
</template>
