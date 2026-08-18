<script setup lang="ts">
import { computed, useId } from 'vue'

/**
 * A filament spool seen end-on -- Mainsail's `ui/SpoolIcon.vue`.
 *
 * The dark spool body is upstream's path verbatim (its two arms and the rim are
 * what make the disc read as a spool rather than a dot); the filament colour is
 * the disc behind it, and the grey circle is the core.
 *
 * Multi-colour filament is drawn the way Spoolman describes it: `coaxial` means
 * strands laid side by side around the core, so wedges; `longitudinal` means
 * colours that change along the filament, so a gradient. Both are ported --
 * picking one and quietly drawing the other would misdescribe the spool the
 * user is looking at, which is the entire job of this icon.
 */
const props = withDefaults(
    defineProps<{
        color?: string
        multiColorHexes?: string
        multiColorDirection?: 'coaxial' | 'longitudinal'
    }>(),
    { color: '#000000', multiColorHexes: '', multiColorDirection: undefined }
)

const CENTER = 243.52
const OUTER_R = 243.52

/** Spoolman packs them as bare hex separated by commas: "FF0000,00FF00". */
const colors = computed(() =>
    props.multiColorHexes
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => (entry.startsWith('#') ? entry : `#${entry}`))
)

const isCoaxial = computed(() => colors.value.length > 1 && props.multiColorDirection === 'coaxial')
const isLongitudinal = computed(() => colors.value.length > 1 && props.multiColorDirection === 'longitudinal')

/** Unique per instance: two spools on one page must not share a gradient id. */
const gradientId = `spool-gradient-${useId()}`

const gradientStops = computed(() =>
    colors.value.flatMap((color, index) => {
        const span = 100 / colors.value.length
        // Two stops per colour, so the bands are hard edges rather than a blur:
        // longitudinal filament changes colour, it does not fade.
        return [
            { offset: `${index * span}%`, color },
            { offset: `${(index + 1) * span}%`, color },
        ]
    })
)

const wedges = computed(() => {
    const count = colors.value.length
    const step = (2 * Math.PI) / count
    // Upstream starts the first boundary at 12 o'clock.
    const rotate = -Math.PI / 2

    return colors.value.map((color, index) => {
        const from = rotate + index * step
        const to = from + step

        const x1 = CENTER + OUTER_R * Math.cos(from)
        const y1 = CENTER + OUTER_R * Math.sin(from)
        const x2 = CENTER + OUTER_R * Math.cos(to)
        const y2 = CENTER + OUTER_R * Math.sin(to)
        const largeArc = step > Math.PI ? 1 : 0

        return {
            color,
            d: `M ${CENTER} ${CENTER} L ${x1} ${y1} A ${OUTER_R} ${OUTER_R} 0 ${largeArc} 1 ${x2} ${y2} Z`,
        }
    })
})

const SPOOL_BODY =
    'M0,243.52c0,134.42,109.1,243.52,243.52,243.52,134.42,0,243.52-109.1,243.52-243.52S377.95,0,243.52,0C109.1,0,0,109.1,0,243.52Zm115.73,181.78c-52.4-39.5-86.52-98.59-94.52-163.72v-.09c-.68-5.43,1-10.89,4.6-15,3.6-4.12,8.79-6.51,14.26-6.57l118.36-1.33c18.99-.21,36.63,9.83,46.12,26.29,9.5,16.45,9.38,36.74-.3,53.09l-60.29,101.76c-2.8,4.73-7.48,8.03-12.87,9.1-5.39,1.06-10.98-.22-15.36-3.52ZM450.22,238.8c5.49,.06,10.7,2.46,14.31,6.59,3.62,4.13,5.3,9.61,4.63,15.06-8.01,65.13-42.12,124.22-94.52,163.72l-.07,.05c-4.37,3.29-9.93,4.57-15.3,3.51-5.37-1.06-10.03-4.36-12.82-9.06l-60.33-101.84c-9.68-16.34-9.8-36.64-.3-53.09,9.5-16.45,27.13-26.5,46.12-26.29l118.27,1.33ZM338.12,40.02c5.04,2.14,8.92,6.32,10.69,11.49,1.77,5.18,1.24,10.86-1.44,15.63l-58.03,103.17c-9.31,16.56-26.83,26.8-45.83,26.8-19,0-36.51-10.25-45.83-26.8l-57.99-103.09c-2.69-4.79-3.22-10.49-1.45-15.69,1.77-5.2,5.68-9.4,10.73-11.54,60.41-25.63,128.64-25.63,189.05,0l.08,.04Z'
</script>

<template>
    <svg viewBox="0 0 487.04 487.04" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
            <linearGradient v-if="isLongitudinal" :id="gradientId" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop v-for="(stop, index) in gradientStops" :key="index" :offset="stop.offset" :stop-color="stop.color" />
            </linearGradient>
        </defs>

        <template v-if="isCoaxial">
            <path v-for="(wedge, index) in wedges" :key="index" :fill="wedge.color" :d="wedge.d" />
        </template>
        <circle v-else-if="isLongitudinal" :fill="`url(#${gradientId})`" :cx="CENTER" :cy="CENTER" :r="OUTER_R" />
        <circle v-else :fill="color" :cx="CENTER" :cy="CENTER" :r="OUTER_R" />

        <circle fill="#bebebe" :cx="CENTER" :cy="CENTER" r="112.5" />
        <path fill="#343434" :d="SPOOL_BODY" />
    </svg>
</template>
