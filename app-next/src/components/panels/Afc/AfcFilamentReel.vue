<script setup lang="ts">
import { computed } from 'vue'

/**
 * A filament spool drawn as an SVG, filling up with the remaining weight --
 * Mainsail's `panels/Afc/AfcFilamentReel.vue`, paths copied verbatim.
 *
 * The only moving part is `filament_base`, scaled on Y about the spool centre.
 * Upstream's 37% floor is kept and it is not arbitrary: at 0% the path would
 * collapse to a line and the spool would look broken rather than empty, so an
 * empty reel still shows a visible core of filament-coloured nothing.
 */
const props = withDefaults(defineProps<{ color?: string; percent?: number }>(), {
    color: '#ff0',
    percent: 100,
})

const SPOOL_COLOR = '#c08f4f'
const SPOOL_HOLE_COLOR = '#231a0f'
const SPOOL_TUBE_COLOR = '#594226'
const SPOOL_RIM_COLOR = '#9b7242'

const MIN_SCALE = 0.37

const reelStyle = computed(() => {
    const base = {
        fill: 'transparent',
        stroke: 'black',
        strokeWidth: '0',
        transformOrigin: '128px 250px',
        transform: `scale(1, ${MIN_SCALE})`,
    }

    if (props.percent <= 0) return base

    return {
        ...base,
        fill: props.color,
        transform: `scale(1, ${MIN_SCALE + (props.percent / 100) * (1 - MIN_SCALE)})`,
    }
})
</script>

<template>
    <svg
        xmlns="http://www.w3.org/2000/svg"
        x="0"
        y="0"
        viewBox="0 0 256 500"
        xml:space="preserve"
        width="100"
        height="80"
        role="img"
        aria-label="Filament spool">
        <path
            id="spool_right_rim"
            d="M202.1,0.3h-5v2.3C179,19,165,123.6,165,250s14,231.1,32.2,247.5v2.3h5
          c20.5,0,37.2-111.9,37.2-249.8S222.7,0.3,202.1,0.3z"
            :style="{ fill: SPOOL_RIM_COLOR }" />
        <path
            id="spool_right"
            d="M197.1,0.3c20.5,0,37.2,111.9,37.2,249.8s-16.7,249.8-37.2,249.8S160,387.9,160,250
          S176.6,0.3,197.1,0.3z"
            :style="{ fill: SPOOL_COLOR }" />
        <path
            id="spool_tube"
            d="M194.6,166.9L194.6,166.9L49.1,167l0,0c6.9,0,12.4,37.2,12.4,83.2c0,44.1-5.1,80.3-11.6,83
          l144.7,0l0,0c6.9,0,12.4-37.2,12.4-83.2C207,204.2,201.4,166.9,194.6,166.9z"
            :style="{ fill: SPOOL_TUBE_COLOR }" />
        <path
            id="filament_base"
            d="M35,31c18.8-12.1,138-10.4,162.1,0c24.9,10.4,41.1,398.9,0,438.1
          c-37.2,12.2-147.7,11.4-162.1,0C22,458.8,16.2,43,35,31z"
            :style="reelStyle" />
        <path
            id="spool_left_rim"
            d="M42.5,0.3h-5v2.3C19.3,19,5.3,123.6,5.3,250s14,231.1,32.2,247.5v2.3h5
          c20.5,0,37.2-111.9,37.2-249.8S63,0.3,42.5,0.3z"
            :style="{ fill: SPOOL_RIM_COLOR }" />
        <path
            id="spool_left"
            d="M37.5,0.3C58,0.3,74.6,112.2,74.6,250S58,499.8,37.5,499.8S0.3,387.9,0.3,250
          S16.9,0.3,37.5,0.3z"
            :style="{ fill: SPOOL_COLOR }" />
        <path
            id="spool_hole"
            d="M35.5,171.6c6.5,0,11.6,35.1,11.6,78.4s-5.3,78.4-11.6,78.4S23.9,293.3,23.9,250
          S29,171.6,35.5,171.6z"
            :style="{ fill: SPOOL_HOLE_COLOR }" />
    </svg>
</template>
