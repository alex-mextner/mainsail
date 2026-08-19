<script setup lang="ts">
import { computed } from 'vue'
import { useMmu, GATE_UNKNOWN, TOOL_GATE_UNKNOWN } from '@/composables/useMmu'

/**
 * The tool-to-gate map -- Mainsail's five `Mmu/MmuTtgMap*.vue` files as one.
 *
 * Reads left to right: `T0 ──▶ #3` says slicer tool 0 pulls from gate 3. The
 * lines cross when the map is not the identity, which is the entire point of
 * the graphic -- a table of the same numbers makes a swapped pair invisible.
 *
 * The five files are merged because four of them are a `<text>` or a `<path>`
 * with three computed properties each, all reading the same constants. Nothing
 * is lost: the geometry constants below are upstream's, unchanged.
 *
 * The right-hand brackets are ENDLESS SPOOL GROUPS -- gates that feed each
 * other when one runs out, labelled A, B, C. Groups of one are dropped, since
 * a bracket around a single gate says nothing.
 */
const props = withDefaults(
    defineProps<{
        selectedTool?: number
        selectedGate?: number
        /** When set, only these tool->gate pairs are drawn (used by the print's own map). */
        filteredTtgMap?: { tool: number; gate: number }[] | null
    }>(),
    { selectedTool: TOOL_GATE_UNKNOWN, selectedGate: GATE_UNKNOWN, filteredTtgMap: null }
)

defineEmits<{ click: [] }>()

const mmu = useMmu()

// Upstream's layout constants, verbatim.
const START_X = 10
const START_Y = 8
const VERTICAL_SPACING = 12
const GROUP_SPACING = 12
const MAP_SPACE = 80
const LEADER = 10

const numGates = computed(() => mmu.numGates.value)
const ttgMap = computed(() => mmu.ttgMap.value)
const groups = computed(() => mmu.endlessSpoolGroups.value)

const gateX = START_X + LEADER + MAP_SPACE + LEADER + 40
const groupX = gateX + 10

/**
 * Endless-spool groups, keyed by group number, single-gate groups removed.
 * Also dropped entirely when a filtered map is in play and does not cover
 * every gate -- the brackets would point at rows that are not drawn.
 */
const printGroups = computed<Record<number, number[]>>(() => {
    if (props.filteredTtgMap !== null && props.filteredTtgMap.length !== numGates.value) return {}

    const result: Record<number, number[]> = {}
    groups.value.forEach((group, index) => {
        result[group] = result[group] ?? []
        result[group].push(index)
    })

    for (const key of Object.keys(result)) {
        if (result[+key].length <= 1) delete result[+key]
    }

    return result
})

const width = computed(() => groupX + Object.keys(printGroups.value).length * GROUP_SPACING)
const height = computed(() => START_Y + numGates.value * VERTICAL_SPACING + 6)
const viewBox = computed(() => `0 0 ${width.value} ${height.value}`)

/**
 * 🔴 The selected tool is drawn LAST, not skipped and re-added for tidiness:
 * SVG has no z-index, so paint order is stacking order. Drawn in sequence, the
 * highlighted line would be buried under every later one.
 */
const toolsArray = computed(() => {
    const array: number[] = []
    for (let tool = 0; tool < numGates.value; tool++) {
        if (tool === props.selectedTool) continue
        if (props.filteredTtgMap !== null && !props.filteredTtgMap.some((entry) => entry.tool === tool)) continue
        array.push(tool)
    }
    if (props.selectedTool >= 0) array.push(props.selectedTool)

    return array
})

const currentGroup = computed(() => {
    if (props.selectedGate !== GATE_UNKNOWN) return groups.value[props.selectedGate]
    if (props.selectedTool !== TOOL_GATE_UNKNOWN) {
        const gate = ttgMap.value[props.selectedTool]
        if (gate !== GATE_UNKNOWN) return groups.value[gate]
    }
    return -1
})

const rowY = (index: number) => START_Y + index * VERTICAL_SPACING + 8
const gateOf = (tool: number) => ttgMap.value[tool] ?? TOOL_GATE_UNKNOWN

/** Tool row to gate row: out, diagonally across, then in. */
const linePath = (tool: number) => {
    const y1 = START_Y + tool * VERTICAL_SPACING + 4
    const x1 = START_X + 28
    const tX = x1 + LEADER
    const gX = tX + MAP_SPACE
    const gateY = START_Y + gateOf(tool) * VERTICAL_SPACING + 4

    return `M ${x1} ${y1} L ${tX} ${y1} L ${gX - LEADER} ${gateY} L ${gX} ${gateY}`
}

const groupPath = (gates: number[], index: number) => {
    const tick = 5
    const x = groupX + index * GROUP_SPACING
    const y1 = START_Y + 4

    const paths: string[] = []
    let previousY: number | null = null
    for (const gate of gates) {
        const y = y1 + gate * VERTICAL_SPACING
        paths.push(`M ${x + tick} ${y} L ${x} ${y}`)
        if (previousY !== null) paths.push(`M ${x + tick} ${previousY} L ${x + tick} ${y}`)
        previousY = y
    }

    return paths.join(' ')
}

const groupChar = (group: number) => String.fromCharCode(group + 65)
</script>

<template>
    <svg
        :viewBox="viewBox"
        preserveAspectRatio="xMidYMid meet"
        class="text-foreground w-full cursor-pointer"
        data-testid="mmu-ttg-map"
        @click="$emit('click')">
        <defs>
            <marker
                id="squareStart"
                fill="context-stroke"
                markerWidth="7"
                markerHeight="7"
                refX="7"
                refY="3.5"
                orient="auto"
                markerUnits="userSpaceOnUse">
                <rect x="0" y="0" width="7" height="7" stroke-width="2" />
            </marker>
            <marker
                id="arrowEnd"
                fill="context-stroke"
                markerWidth="7"
                markerHeight="7"
                refX="0"
                refY="3.5"
                orient="auto"
                markerUnits="userSpaceOnUse">
                <polygon points="0 0, 7 3.5, 0 7" stroke-width="1" />
            </marker>
        </defs>

        <g v-for="tool in toolsArray" :key="tool">
            <text
                :x="START_X + 14"
                :y="rowY(tool)"
                text-anchor="end"
                font-size="10px"
                :class="tool === selectedTool ? 'fill-primary font-bold' : 'fill-current'">
                T{{ tool }}
            </text>
            <text
                :x="gateX"
                :y="rowY(tool)"
                text-anchor="end"
                font-size="10px"
                :class="tool === selectedGate ? 'fill-primary font-bold' : 'fill-current'">
                #{{ tool }}
            </text>
            <path
                :d="linePath(tool)"
                :stroke-width="tool === selectedTool ? 4 : 2"
                :class="tool === selectedTool ? 'stroke-primary' : 'stroke-muted-foreground'"
                fill="none"
                marker-start="url(#squareStart)"
                marker-end="url(#arrowEnd)" />
        </g>

        <g v-for="([key, gates], index) in Object.entries(printGroups)" :key="'group_' + key">
            <path
                :d="groupPath(gates, index)"
                stroke-width="2"
                stroke-linecap="round"
                fill="none"
                :class="+key === currentGroup ? 'stroke-primary' : 'stroke-muted-foreground'" />
            <text
                :x="groupX + index * GROUP_SPACING"
                :y="START_Y + numGates * VERTICAL_SPACING + 2"
                stroke-width="0"
                font-size="8px"
                :class="+key === currentGroup ? 'fill-primary font-bold' : 'fill-muted-foreground'">
                {{ groupChar(+key) }}
            </text>
        </g>
    </svg>
</template>
