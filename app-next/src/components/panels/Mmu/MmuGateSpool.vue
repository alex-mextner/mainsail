<script setup lang="ts">
import { computed } from 'vue'
import { useMmu, GATE_EMPTY, GATE_AVAILABLE, FILAMENT_POS_LOADED, TOOL_GATE_BYPASS, NO_FILAMENT_COLOR, formColorString } from '@/composables/useMmu'
import { useGuiStore } from '@/stores/gui'
import { useSpoolmanStore } from '@/stores/spoolman'
import { filamentTextColor } from '@/lib/color'

/**
 * One spool, seen end-on -- Mainsail's `Mmu/MmuUnitGateSpool.vue`, SVG copied
 * verbatim.
 *
 * 🔴 THE SPOOL IS A GAUGE, NOT A PICTURE. The filament path is scaled on both
 * axes by the remaining percentage, so a nearly-empty gate is visibly a thin
 * ring on the hub and a full one nearly fills the flange. Upstream's two
 * ranges (0.28..0.4 and 1.65..3.5) are kept exactly, because they are what
 * makes the difference legible at 40px wide.
 *
 * `filamentAmount` has THREE meanings and they are not interchangeable:
 *    > 0   a real percentage from Spoolman, printed on the spool
 *    = 0   the gate is empty -- no filament drawn at all
 *    < 0   there IS filament but nobody knows how much (no Spoolman, or the
 *          spool has no weights), so it is drawn FULL and no number is shown
 * Collapsing -1 into 0 would render every gate on a machine without Spoolman
 * as empty, which is the common case.
 */
const props = withDefaults(
    defineProps<{
        gateIndex: number
        showDetails?: boolean
        isSelected?: boolean
        unhighlightSpools?: boolean
        spoolWheelColor?: string
    }>(),
    { showDetails: false, isSelected: false, unhighlightSpools: false, spoolWheelColor: '#AD8762' }
)

const mmu = useMmu()
const gui = useGuiStore()
const spoolman = useSpoolmanStore()

const showUnavailableSpoolColor = computed(() => gui.state.view.mmu.showUnavailableSpoolColor)

/**
 * The bypass has no gate_status of its own -- it is "available" exactly when
 * filament is actually loaded through it.
 */
const status = computed(() => {
    if (props.gateIndex === TOOL_GATE_BYPASS) {
        return mmu.filamentPos.value === FILAMENT_POS_LOADED ? GATE_AVAILABLE : GATE_EMPTY
    }
    return mmu.mmu.value?.gate_status?.[props.gateIndex] ?? GATE_EMPTY
})

const spoolId = computed(() => mmu.mmu.value?.gate_spool_id?.[props.gateIndex] ?? -1)
const spool = computed(() => spoolman.spools.find((entry) => entry.id === spoolId.value) ?? null)

const filamentColor = computed(() => formColorString(mmu.mmu.value?.gate_color?.[props.gateIndex]))

const filamentAmount = computed(() => {
    if (status.value === GATE_EMPTY && !(showUnavailableSpoolColor.value && filamentColor.value !== NO_FILAMENT_COLOR))
        return 0

    if (!spool.value || mmu.spoolmanSupport.value === 'off') return -1

    const remaining = spool.value.remaining_weight ?? null
    const total = spool.value.filament?.weight ?? null
    if (remaining === null || total === null) return -1

    return Math.ceil(Math.max(0, Math.min(100, (remaining / total) * 100)))
})

const isNotEmpty = computed(() => filamentAmount.value !== 0 || status.value !== GATE_EMPTY)

const filamentTransform = computed(() => {
    const lerp = (start: number, end: number) =>
        filamentAmount.value < 0 ? end : start + (end - start) * (filamentAmount.value / 100)

    return `matrix(${lerp(0.28, 0.4)},0,0,${lerp(1.65, 3.5)},197,250)`
})

const contrastColor = computed(() => filamentTextColor(filamentColor.value))

const material = computed(() => mmu.mmu.value?.gate_material?.[props.gateIndex] || 'Unknown')
const temperature = computed(() => mmu.mmu.value?.gate_temperature?.[props.gateIndex] ?? -1)
const spoolName = computed(() => spool.value?.filament?.name || mmu.mmu.value?.gate_filament_name?.[props.gateIndex] || 'Unknown')

/**
 * eSpooler arrows (rewind / assist).
 *
 * Two firmware generations again: current Happy Hare reports an array with one
 * entry per gate, older builds report a single `espooler_active` that applies
 * only to the SELECTED gate. Dropping the legacy branch would silently stop
 * showing the arrows on those machines rather than fail loudly.
 */
const espoolerState = computed(() => {
    const perGate = mmu.mmu.value?.espooler
    if (perGate) return perGate[props.gateIndex]

    return props.gateIndex === mmu.gate.value ? mmu.mmu.value?.espooler_active : undefined
})

const tooltip = computed(() => {
    if (status.value === GATE_EMPTY) return 'Empty'

    const lines = [spoolName.value]
    lines.push(material.value + (temperature.value > 0 ? ` | ${temperature.value}°C` : ''))

    if (filamentColor.value !== NO_FILAMENT_COLOR) {
        const alpha = filamentColor.value.length > 7 ? filamentColor.value.substring(7, 9) : 'FF'
        lines.push(`Color: ${filamentColor.value.substring(0, 7)}${alpha.toUpperCase() !== 'FF' ? alpha : ''}`)
    }
    if (spoolId.value > 0) lines.push(`Spool ID: ${spoolId.value}`)

    return lines.join('\n')
})
</script>

<template>
    <svg
        viewBox="0 0 248 500"
        preserveAspectRatio="xMidYMid meet"
        :width="mmu.spoolWidth.value"
        class="mmu-spool"
        :class="{ 'is-selected': isSelected, unhighlighted: !isSelected && unhighlightSpools }"
        :data-gate-spool="gateIndex"
        :data-filament-amount="filamentAmount"
        :title="showDetails ? tooltip : undefined">
        <defs>
            <path
                id="oval"
                d="M 0 -63 C 35 -63 63 -35 63 0 C 63 35 35 63 0 63 C -35 63 -63 35 -63 0 C -63 -35 -35 -63 0 -63 z"
                vector-effect="non-scaling-stroke" />
            <path
                id="center"
                d="M 0 -63 C 35 -63 63 -35 63 0 C 63 35 35 63 0 63 L -624 63 L -624 -63 z"
                vector-effect="non-scaling-stroke" />
            <path
                id="espool"
                d="M 89.561 35.5 L 60.333 15.734 c -0.308 -0.208 -0.704 -0.229 -1.029 -0.055 c -0.327 0.173 -0.531 0.513 -0.531 0.883 v 7.987 c -12.038 0.262 -26.306 5.201 -37.501 13.023 C 7.554 47.155 0 59.894 0 73.438 c 0 0.471 0.329 0.878 0.79 0.978 C 0.86 74.432 0.931 74.438 1 74.438 c 0.386 0 0.747 -0.225 0.911 -0.588 c 7.823 -17.312 26.952 -26.183 56.861 -26.376 v 8.62 c 0 0.37 0.204 0.71 0.531 0.883 c 0.325 0.173 0.722 0.153 1.029 -0.055 l 29.228 -19.766 C 89.835 36.971 90 36.661 90 36.329 S 89.835 35.686 89.561 35.5 z"
                stroke-width="3"
                stroke="#CCCCCC"
                fill="#808080"
                opacity="0.7" />
            <radialGradient id="spotlight" cx="50%" cy="70%" r="50%" fx="50%" fy="100%">
                <stop offset="0%" style="stop-color: rgba(255, 255, 255, 0.9); stop-opacity: 1" />
                <stop offset="100%" style="stop-color: rgba(255, 255, 0, 0); stop-opacity: 0" />
            </radialGradient>
            <filter id="blur_wheel2" width="1.3" height="1.16">
                <feGaussianBlur in="SourceAlpha" stdDeviation="3" />
                <feOffset dx="18" dy="0" result="oBlur" />
                <feFlood flood-color="#000" flood-opacity=".67" />
                <feComposite in2="oBlur" operator="in" />
                <feMerge>
                    <feMergeNode />
                    <feMergeNode in="SourceGraphic" />
                </feMerge>
            </filter>
        </defs>

        <g transform="matrix(0.59,0,0,3.95,197,250)">
            <use href="#oval" style="filter: url(#blur_wheel2)" :fill="spoolWheelColor" />
            <use href="#oval" transform="scale(0.41)" style="filter: url(#blur_wheel2)" :fill="spoolWheelColor" />
            <use href="#center" transform="scale(0.41)" :fill="spoolWheelColor" />
        </g>
        <path
            v-if="isNotEmpty"
            d="M 0 -63 C 35 -63 63 -35 63 0 C 63 35 35 63 0 63 L -424 63 L -424 -63 z"
            vector-effect="non-scaling-stroke"
            :fill="filamentColor"
            :transform="filamentTransform" />
        <g transform="matrix(0.59,0,0,3.95,37,250)">
            <use href="#oval" style="filter: url(#blur_wheel2)" :fill="spoolWheelColor" />
            <use href="#oval" transform="scale(0.41)" fill="#111111" />
        </g>
        <rect v-if="isSelected" x="0" y="260" width="258" height="186" fill="url(#spotlight)" />

        <g v-if="showDetails">
            <text
                v-if="filamentAmount > 0"
                x="152"
                y="270"
                text-anchor="middle"
                font-weight="bold"
                font-size="56px"
                :fill="contrastColor">
                {{ filamentAmount }}%
            </text>
            <!--
                Filament is present but its weight is unknown AND the gate is
                not empty: upstream shows a red "!" rather than a number it
                would have to invent.
            -->
            <text
                v-else-if="filamentAmount === 0 && status !== GATE_EMPTY"
                x="140"
                y="310"
                text-anchor="middle"
                font-weight="bold"
                font-size="160px"
                style="fill: red; stroke: #111111; stroke-width: 6; stroke-linecap: round; stroke-linejoin: round">
                !
            </text>
            <use
                v-if="espoolerState === 'rewind'"
                href="#espool"
                transform="translate(225,0) rotate(90) scale(2,2)" />
            <use
                v-if="espoolerState === 'assist'"
                href="#espool"
                transform="translate(225,480) rotate(270) scale(2,-2)" />
        </g>
    </svg>
</template>

<style scoped>
.mmu-spool {
    outline: none;
    transition:
        transform 0.2s,
        opacity 0.2s;
}

.mmu-spool.unhighlighted {
    opacity: 0.4;
}

.mmu-spool.is-selected {
    transform: translateY(-8px) !important;
    opacity: 1 !important;
}

.mmu-spool:hover {
    transform: translateY(-4px);
}
</style>
