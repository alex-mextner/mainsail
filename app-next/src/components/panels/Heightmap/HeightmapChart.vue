<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { VisualMapComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { Grid3DComponent } from 'echarts-gl/components'
import { SurfaceChart } from 'echarts-gl/charts'
import { usePrinterStore } from '@/stores/printer'
import { useGuiStore } from '@/stores/gui'
import { useTheme } from '@/composables/useTheme'
import { useBedmesh } from '@/composables/useBedmesh'
import { colorSchemeList, HEIGHTMAP_ORIENTATIONS, type HeightmapOrientation } from '@/lib/heightmapColors'

/**
 * The bed as a 3D surface -- Mainsail's `components/charts/HeightmapChart.vue`.
 *
 * 🔴 THIS IS THE ONLY WebGL IN THE APP, AND IT IS LAZY ON PURPOSE
 * --------------------------------------------------------------
 * echarts-gl's `surface` series has no canvas fallback -- it is WebGL or
 * nothing. The imports stay inside this component so Vite puts echarts-gl in
 * the /heightmap route chunk: the dashboard, which most sessions never leave,
 * does not pay ~900 kB for a chart it will not draw.
 *
 * Registration goes through `use()` from `echarts/core`, never the `echarts`
 * barrel -- the same rule TemperatureChart follows. Mixing the barrel's
 * auto-registration with tree-shaken `use()` is how a series silently renders
 * as an empty box.
 *
 * 🔴 `LegendComponent` IS LOAD-BEARING, EVEN THOUGH NO LEGEND IS DRAWN.
 * Upstream registers neither it nor `TooltipComponent` -- it gets away with it
 * because the Vue 2 tree pulls in the echarts barrel elsewhere, which
 * auto-registers everything. Ported literally into a tree-shaken build, the
 * four Probed/Mesh/Flat/Wireframe checkboxes silently did NOTHING: hiding a
 * series is done through `legend.selected`, and with no legend component
 * registered echarts drops the whole key. Caught by echarts' own console
 * warning during the first rig run, not by reading.
 */
use([CanvasRenderer, VisualMapComponent, TooltipComponent, LegendComponent, Grid3DComponent, SurfaceChart])

/**
 * The Z half-height comes in as a PROP rather than being read from the store
 * here, because the panel clamps it to the mesh's own extremes and the slider,
 * the readout and this box have to agree on one number. Reading the raw stored
 * value here is how a 0.7 mm bed ends up drawn in a +/-0.5 box with the surface
 * poking out of the top.
 */
const props = defineProps<{ scaleZMax: number }>()

const printer = usePrinterStore()
const gui = useGuiStore()
const { resolved: theme } = useTheme()
const { probedMatrix, meshMatrix, meshMin, meshMax, isActive } = useBedmesh()

const chart = shallowRef<InstanceType<typeof VChart> | null>(null)

const view = computed(() => gui.state.view.heightmap)

/**
 * Axis and label colours, matched to the theme by hand rather than read from
 * CSS variables: echarts-gl draws into WebGL, where a `var(--foreground)` is
 * just an unparsable string, and a failed parse there is an invisible axis
 * rather than a console error.
 */
const ink = computed(() => {
    const dark = theme.value === 'dark'

    return {
        hi: dark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.85)',
        mid: dark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)',
        low: dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)',
        tooltipBg: dark ? 'rgba(20,20,25,0.92)' : 'rgba(255,255,255,0.94)',
    }
})

/**
 * Turn a Klipper matrix into echarts `[x, y, z]` triples.
 *
 * The step is derived per matrix, not shared: `probed_matrix` is what the probe
 * touched, `mesh_matrix` is Klipper's interpolation of it, and with a non-zero
 * `mesh_x_pps` the two have different dimensions over the SAME bed area. One
 * shared step would stretch the interpolated surface past the probed one.
 */
function surfaceFrom(matrix: number[][]): { data: number[][]; shape: number[] } {
    const yCount = matrix.length
    const xCount = matrix[0]?.length ?? 0
    if (!xCount || !yCount) return { data: [], shape: [0, 0] }

    const [xMin, yMin] = [meshMin.value[0], meshMin.value[1]]
    const [xMax, yMax] = [meshMax.value[0], meshMax.value[1]]
    // A 1-wide mesh has no span to divide; guard rather than emit NaN
    // coordinates, which echarts-gl draws as nothing at all.
    const xStep = xCount > 1 ? (xMax - xMin) / (xCount - 1) : 0
    const yStep = yCount > 1 ? (yMax - yMin) / (yCount - 1) : 0

    const data: number[][] = []
    matrix.forEach((row, y) => row.forEach((value, x) => data.push([xMin + xStep * x, yMin + yStep * y, value])))

    return { data, shape: [yCount, xCount] }
}

/**
 * The zero plane: where the bed WOULD be if it were flat, drawn from the
 * configured probe grid rather than from any measurement.
 *
 * It reads `configfile.settings.bed_mesh` directly because that is the only
 * place the configured extent lives -- the live `bed_mesh` object describes the
 * mesh that was actually probed, which may be a smaller adaptive area.
 */
const flatSurface = computed(() => {
    const config = printer.config['bed_mesh'] as Record<string, unknown> | undefined
    if (!config) return { data: [], shape: [0, 0] }

    // `probe_count` arrives as "5,5", as [5,5], or as a bare 5 depending on how
    // it was written; `round_probe_count` is the delta-printer spelling.
    let probeCount: number[] = [1, 1]
    if (typeof config.probe_count === 'string') probeCount = config.probe_count.split(',').map(Number)
    else if (Array.isArray(config.probe_count))
        probeCount = config.probe_count.length < 2 ? [config.probe_count[0], config.probe_count[0]] : config.probe_count
    else if (typeof config.probe_count === 'number') probeCount = [config.probe_count, config.probe_count]
    else if (typeof config.round_probe_count === 'number')
        probeCount = [config.round_probe_count, config.round_probe_count]

    let min = (config.mesh_min as number[]) ?? [0, 0]
    let max = (config.mesh_max as number[]) ?? [200, 200]

    // Delta beds declare a radius instead of a rectangle.
    if (typeof config.mesh_radius === 'number') {
        min = [-config.mesh_radius, -config.mesh_radius]
        max = [config.mesh_radius, config.mesh_radius]
    }

    const [xCount, yCount] = [Number(probeCount[0]), Number(probeCount[1])]
    if (!(xCount > 1) || !(yCount > 1)) return { data: [], shape: [0, 0] }

    const [xMin, yMin] = [Number(min[0]), Number(min[1])]
    const xStep = (Number(max[0]) - xMin) / (xCount - 1)
    const yStep = (Number(max[1]) - yMin) / (yCount - 1)

    const data: number[][] = []
    for (let y = 0; y < yCount; y++) for (let x = 0; x < xCount; x++) data.push([xMin + xStep * x, yMin + yStep * y, 0])

    return { data, shape: [yCount, xCount] }
})

/**
 * Bed extents from the toolhead limits.
 *
 * 🔴 Both indexes are guarded. Upstream guards `rangeY` with `?? [0, 0]` and
 * forgets the same guard on `rangeX` four lines above, so a Klipper that has
 * not published `toolhead` yet -- every page load, for a beat -- throws on
 * `undefined[0]`. Exactly the shape of the `undefined !== null` load-ring bug
 * caught on the Machine page.
 */
const axisRange = computed(() => {
    const limits = printer.objects.toolhead as { axis_minimum?: number[]; axis_maximum?: number[] } | undefined
    const lo = limits?.axis_minimum ?? [0, 0]
    const hi = limits?.axis_maximum ?? [0, 0]

    return { x: [lo[0] ?? 0, hi[0] ?? 0], y: [lo[1] ?? 0, hi[1] ?? 0] }
})

/**
 * Box proportions, so a 245x190 bed is drawn 245x190 and not as a square. The
 * shorter axis is the unit; the longer one is stretched by its ratio.
 */
const boxScale = computed(() => {
    const spanX = axisRange.value.x[1] - axisRange.value.x[0]
    const spanY = axisRange.value.y[1] - axisRange.value.y[0]
    const shortest = Math.min(spanX, spanY)
    if (shortest <= 0) return { x: 1, y: 1 }

    return { x: spanX / shortest, y: spanY / shortest }
})

/**
 * Range the colour ramp spans.
 *
 * Off (the default) it is a FIXED +/-0.1 mm, which is the point: the same
 * colour means the same deviation between two meshes, so a bed that got worse
 * looks worse. On, it stretches to the actual extremes, which reveals shape in
 * a very flat bed at the cost of comparability.
 */
const visualMapRange = computed<number[]>(() => {
    if (!view.value.scaleGradient) return [-0.1, 0.1]

    const points: number[] = []
    if (view.value.probed) points.push(...probedMatrix.value.flat())
    if (view.value.mesh) points.push(...meshMatrix.value.flat())
    if (!points.length) return [-0.1, 0.1]

    return [Math.min(0, ...points), Math.max(0, ...points)]
})

/** Which series the ramp colours: probed if shown, else mesh, else nothing. */
const visualMapSeriesIndex = computed<number[]>(() => {
    if (view.value.probed) return [0]
    if (view.value.mesh) return [1]
    return []
})

const orientation = computed(
    () => HEIGHTMAP_ORIENTATIONS[gui.state.heightmap.defaultOrientation as HeightmapOrientation] ?? HEIGHTMAP_ORIENTATIONS.rightFront
)

const series = computed(() => {
    if (!isActive.value && !flatSurface.value.data.length) return []

    const probed = surfaceFrom(probedMatrix.value)
    const mesh = surfaceFrom(meshMatrix.value)
    const flat = flatSurface.value

    return [
        {
            type: 'surface',
            name: 'probed',
            data: probed.data,
            dataShape: probed.shape,
            itemStyle: { opacity: 1 },
            wireframe: { show: view.value.wireframe },
        },
        {
            type: 'surface',
            name: 'mesh',
            data: mesh.data,
            dataShape: mesh.shape,
            itemStyle: { opacity: 1 },
            wireframe: { show: view.value.wireframe },
        },
        {
            type: 'surface',
            name: 'flat',
            data: flat.data,
            dataShape: flat.shape,
            // White at half opacity: it has to read as a reference plane the
            // measured surface passes through, not as a fourth measurement.
            itemStyle: { color: [1, 1, 1, 1], opacity: 0.5 },
            wireframe: { show: view.value.wireframe },
        },
    ]
})

function tooltipFormatter(params: { seriesName?: string; encode?: Record<string, number[]>; data?: number[] }): string {
    const { encode, data } = params
    if (!encode || !data) return ''

    const rows = Object.keys(encode)
        .sort()
        .map((axis) => {
            const value = data[encode[axis][0]]
            // Z gets three decimals because that is the resolution people
            // actually adjust a bed to; X and Y get one, they are positions.
            return `<b>${axis.toUpperCase()}</b>: ${value.toFixed(axis === 'z' ? 3 : 1)} mm`
        })

    return [`<b>${params.seriesName ?? ''}</b>`, ...rows].join('<br />')
}

const option = computed(() => ({
    animation: false,
    darkMode: theme.value === 'dark',
    tooltip: {
        backgroundColor: ink.value.tooltipBg,
        borderWidth: 0,
        padding: 12,
        textStyle: { color: ink.value.hi, fontSize: 13 },
        formatter: tooltipFormatter,
    },
    // The legend is never drawn; it exists solely because `selected` is how
    // echarts hides a series without dropping it from the option, which keeps
    // the series INDEXES stable for `visualMap.seriesIndex` above.
    legend: {
        show: false,
        selected: { probed: view.value.probed, mesh: view.value.mesh, flat: view.value.flat },
    },
    visualMap: {
        show: true,
        min: visualMapRange.value[0],
        max: visualMapRange.value[1],
        calculable: true,
        dimension: 2,
        inRange: { color: [...colorSchemeList(gui.state.heightmap.activecolorscheme)] },
        seriesIndex: visualMapSeriesIndex.value,
        left: 10,
        top: 20,
        bottom: 20,
        itemWidth: 14,
        // Left as a fraction of the fixed 600px canvas rather than a constant:
        // upstream's 550 was hardcoded against the same 600, and a shorter bar
        // on a phone is better than one clipped by the frame.
        itemHeight: 380,
        precision: 3,
        textStyle: { color: ink.value.hi, fontSize: 12 },
    },
    xAxis3D: { type: 'value', name: 'X', nameTextStyle: { color: ink.value.mid }, min: axisRange.value.x[0], max: axisRange.value.x[1], minInterval: 1 },
    yAxis3D: { type: 'value', name: 'Y', nameTextStyle: { color: ink.value.mid }, min: axisRange.value.y[0], max: axisRange.value.y[1] },
    zAxis3D: {
        type: 'value',
        name: 'Z',
        nameTextStyle: { color: ink.value.mid },
        min: -props.scaleZMax,
        max: props.scaleZMax,
        axisPointer: { label: { formatter: (value: string | number) => Number(value).toFixed(2) } },
    },
    grid3D: {
        axisLabel: { textStyle: { color: ink.value.mid } },
        axisLine: { lineStyle: { color: ink.value.low } },
        axisTick: { lineStyle: { color: ink.value.low } },
        splitLine: { lineStyle: { color: ink.value.low } },
        axisPointer: { lineStyle: { color: ink.value.hi }, label: { textStyle: { color: ink.value.hi } } },
        boxWidth: 100 * boxScale.value.x,
        boxDepth: 100 * boxScale.value.y,
        // The 3D box gets its own viewport, inset on the left so the Z axis
        // labels clear the colour bar and narrowed on the right so the Y axis
        // labels are not cut off by the canvas edge. Both found by measuring,
        // at 1400px: "-0.100" overprinted "-0.6" with the default full-width
        // viewport, and "120" rendered as "12" once only `left` was set.
        //
        // The left inset is a PERCENTAGE and the right one is PIXELS, and the
        // mismatch is deliberate. On the left the colour bar scales with the
        // panel, so a fraction is right. On the right the thing that overflows
        // is a Y axis LABEL at a fixed 12px, so it needs the same absolute
        // clearance whatever the panel width -- as a percentage it fitted at
        // 1400px and cut "90" down to "9" at 560px.
        left: '12%',
        right: 44,
        viewControl: { distance: 200, ...orientation.value },
    },
    series: series.value,
}))
</script>

<template>
    <VChart
        ref="chart"
        :option="option"
        :init-options="{ renderer: 'canvas' }"
        class="w-full overflow-hidden"
        style="height: 600px"
        autoresize />
</template>
