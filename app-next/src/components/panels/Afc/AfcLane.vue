<script setup lang="ts">
import { ref, computed } from 'vue'
import { mdiArrowDownBold, mdiArrowUpBold, mdiEject } from '@mdi/js'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import { afcIconInfintiy as afcInfinityIcon } from '@/lib/afcIcons'
import AfcFilamentReel from './AfcFilamentReel.vue'
import AfcLaneMappingDialog from './AfcLaneMappingDialog.vue'
import AfcLaneInfiniteDialog from './AfcLaneInfiniteDialog.vue'
import { useAfc } from '@/composables/useAfc'
import { useConnectionStore } from '@/stores/connection'
import { usePrinterStore } from '@/stores/printer'
import { useGuiStore } from '@/stores/gui'
import { useSpoolmanStore } from '@/stores/spoolman'

/**
 * One lane of an AFC unit -- Mainsail's `AfcPanelUnitLane` plus the four files
 * it delegates to (`...Header`, `...Body`, `...Actions`, `...Empty`).
 *
 * Merged into one component because the split upstream needs does not exist
 * here: each of those files re-derived `lane` from the mixin and Vue 2 had no
 * cheap way to share it. One `<script setup>` computes it once.
 *
 * THE THREE STATES ARE NOT A STYLE CHOICE, they are what the two sensors say:
 *   prep=false            nothing inserted     -> "Empty"
 *   prep=true, load=false inserted, not gripped-> "Prep detected" + eject
 *   prep=true, load=true  ready                -> the spool, and load/unload
 * Upstream's `laneReady = load && prep`, kept exactly: a lane that reports
 * `load` without `prep` is mid-eject, and showing it as ready would offer a
 * "load" button for filament that is on its way out.
 */
const props = defineProps<{ name: string }>()

const afc = useAfc()
const connection = useConnectionStore()
const printer = usePrinterStore()
const gui = useGuiStore()
const spoolman = useSpoolmanStore()

const showMapping = ref(false)
const showInfinite = ref(false)

const lane = computed(() => afc.laneObject(props.name))

const isPrintingOnly = computed(() => printer.printerState === 'printing')

const laneActive = computed(() => afc.currentLane.value?.name === props.name)
const laneReady = computed(() => Boolean(lane.value.load && lane.value.prep))
const prep = computed(() => lane.value.prep ?? false)
const toolLoaded = computed(() => lane.value.tool_loaded ?? false)

/** Upstream: the active lane, highlighted red when AFC is in an error state. */
const borderClass = computed(() => {
    if (!laneActive.value) return 'border-border'
    return afc.errorState.value ? 'border-destructive' : 'border-primary'
})

const mappedTool = computed(() => {
    const map = lane.value.map
    if (!map || map.length === 0) return 'NONE'
    return Array.isArray(map) ? map.join(', ') : map
})

const runoutLane = computed(() => lane.value.runout_lane ?? 'NONE')

// ---- the spool ------------------------------------------------------------
// Every figure prefers the Spoolman record and falls back to what AFC itself
// stores on the lane, which is upstream's order and the useful one: Spoolman
// knows the filament, the lane knows what was actually spooled onto it.
const spool = computed(() => afc.laneSpool(props.name))

const showTd1Color = computed(() => gui.state.view.afc.showTd1Color)
const hasTd = computed(() => (lane.value.td1_td ?? null) !== null)
const tdValue = computed(() => lane.value.td1_td || '--')
const tdColor = computed(() => lane.value.td1_color || '------')

const spoolColor = computed(() => {
    if (hasTd.value && showTd1Color.value) return `#${tdColor.value}`
    return lane.value.color || '#000000'
})

const remainingWeight = computed(() => spool.value?.remaining_weight ?? lane.value.weight ?? undefined)
const fullWeight = computed(() => spool.value?.filament?.weight ?? lane.value.initial_weight ?? undefined)

const spoolPercent = computed(() => {
    if (remainingWeight.value === undefined || fullWeight.value === undefined) return 100
    if (fullWeight.value === 0) return 100
    return Math.round((remainingWeight.value / fullWeight.value) * 100)
})

const remainingWeightOutput = computed(() =>
    remainingWeight.value === undefined ? '--' : `${Math.round(remainingWeight.value)}g`
)

const material = computed(() => spool.value?.filament?.material ?? lane.value.material ?? '')
const materialOutput = computed(() => material.value || '--')
const filamentName = computed(() => spool.value?.filament?.name || lane.value.filament_name || 'Unknown')
const vendor = computed(() => spool.value?.filament?.vendor?.name)

const spoolTitle = computed(() => {
    const head = [`#${lane.value.spool_id ?? 0}`, vendor.value].filter(Boolean).join(' | ')
    const details = [materialOutput.value]
    if (spool.value?.filament?.settings_extruder_temp) details.push(`${spool.value.filament.settings_extruder_temp}°C`)
    if (spool.value?.filament?.settings_bed_temp) details.push(`${spool.value.filament.settings_bed_temp}°C`)

    const lines = [head, filamentName.value, details.join(' | ')]
    if (remainingWeight.value !== undefined) {
        const weights = [`${Math.round(remainingWeight.value)}g remaining`]
        if (spool.value?.used_weight !== undefined) weights.push(`${Math.round(spool.value.used_weight)}g used`)
        lines.push(weights.join(' | '))
    }

    return lines.filter(Boolean).join('\n')
})

const spoolUrl = computed(() => {
    const id = lane.value.spool_id
    if (!spoolman.managerUrl || !id) return undefined
    return `${spoolman.managerUrl.replace(/\/$/, '')}/spool/show/${id}`
})

const showFilamentName = computed(() => gui.state.view.afc.showFilamentName)
const showLaneInfinite = computed(() => gui.state.view.afc.showLaneInfinite)

// ---- actions --------------------------------------------------------------
const loadLane = () => connection.sendGcode(`CHANGE_TOOL LANE=${props.name}`)
const unloadLane = () => connection.sendGcode(`TOOL_UNLOAD LANE=${props.name}`)
const ejectLane = () => connection.sendGcode(`LANE_UNLOAD LANE=${props.name}`)
</script>

<template>
    <div
        class="bg-muted flex min-w-[9rem] flex-1 basis-0 flex-col rounded-lg border"
        :class="borderClass"
        :data-lane="name"
        :data-lane-state="laneReady ? 'ready' : prep ? 'prep' : 'empty'">
        <!-- Header: which tool this lane answers to. Opens the mapping dialog. -->
        <div class="px-4 pt-4 pb-2">
            <button
                type="button"
                class="bg-secondary text-secondary-foreground hover:bg-secondary/80 focus-visible:ring-ring h-8 w-full rounded-md text-xs font-medium focus-visible:ring-2 focus-visible:outline-none"
                :aria-label="`Map lane ${name} to a tool`"
                @click="showMapping = true">
                {{ mappedTool }} &gt; {{ name }}
            </button>
            <AfcLaneMappingDialog v-model="showMapping" :name="name" />
        </div>

        <template v-if="laneReady">
            <div class="flex items-start justify-between gap-2 px-4 py-1">
                <span class="flex cursor-help items-center justify-center" :title="spoolTitle">
                    <AfcFilamentReel :percent="spoolPercent" :color="spoolColor" class="max-w-[38px]" />
                </span>
                <div class="flex flex-col items-end gap-1 text-right">
                    <button
                        v-if="showLaneInfinite"
                        type="button"
                        class="bg-secondary text-secondary-foreground hover:bg-secondary/80 inline-flex h-5 min-w-8 items-center justify-center rounded px-1.5 text-[0.65rem] font-medium"
                        :aria-label="`Infinite spool for lane ${name}`"
                        @click="showInfinite = true">
                        <!-- No runout partner is not an error, but upstream
                             colours it like one so an unconfigured lane is
                             visible at a glance across eight of them. -->
                        <MdiIcon v-if="runoutLane === 'NONE'" :path="afcInfinityIcon" class="text-destructive size-3" />
                        <template v-else>{{ runoutLane }}</template>
                    </button>
                    <AfcLaneInfiniteDialog v-model="showInfinite" :name="name" />
                    <span class="text-sm font-semibold">{{ materialOutput }}</span>
                    <span class="text-muted-foreground text-xs">{{ remainingWeightOutput }}</span>
                    <span v-if="hasTd" class="text-muted-foreground text-xs" :title="`Color: #${tdColor}`">
                        TD: {{ tdValue }}
                    </span>
                </div>
            </div>

            <div v-if="showFilamentName" class="px-4 pt-1">
                <a
                    v-if="spoolUrl"
                    :href="spoolUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="block truncate text-center text-xs hover:underline">
                    {{ filamentName }}
                </a>
                <span v-else class="text-muted-foreground block truncate text-center text-xs">{{ filamentName }}</span>
            </div>

            <!-- Load / unload, then eject. Upstream disables all of it mid-print. -->
            <div class="mt-auto px-4 pt-3 pb-4">
                <div class="flex w-full">
                    <button
                        v-if="toolLoaded"
                        type="button"
                        class="border-border hover:bg-accent inline-flex h-7 flex-1 items-center justify-center rounded-l-md border disabled:pointer-events-none disabled:opacity-50"
                        :disabled="isPrintingOnly"
                        :aria-label="`Unload lane ${name} from the toolhead`"
                        title="Unload lane"
                        @click="unloadLane">
                        <MdiIcon :path="mdiArrowUpBold" class="size-4" />
                    </button>
                    <button
                        v-else
                        type="button"
                        class="border-border hover:bg-accent inline-flex h-7 flex-1 items-center justify-center rounded-l-md border disabled:pointer-events-none disabled:opacity-50"
                        :disabled="isPrintingOnly"
                        :aria-label="`Load lane ${name} into the toolhead`"
                        title="Load lane"
                        @click="loadLane">
                        <MdiIcon :path="mdiArrowDownBold" class="size-4" />
                    </button>
                    <button
                        type="button"
                        class="border-border hover:bg-accent inline-flex h-7 flex-1 items-center justify-center rounded-r-md border border-l-0 disabled:pointer-events-none disabled:opacity-50"
                        :disabled="toolLoaded"
                        :aria-label="`Eject filament from lane ${name}`"
                        title="Eject filament"
                        @click="ejectLane">
                        <MdiIcon :path="mdiEject" class="size-4" />
                    </button>
                </div>
            </div>
        </template>

        <!-- Empty, or inserted but not yet gripped. -->
        <div v-else class="flex flex-1 flex-col">
            <div class="text-muted-foreground flex-1 content-center px-4 py-3 text-center text-sm">
                {{ prep ? 'Prep detected' : 'Empty' }}
            </div>
            <div v-if="prep" class="px-4 pb-4">
                <button
                    type="button"
                    class="border-border hover:bg-accent inline-flex h-7 w-full items-center justify-center rounded-md border"
                    :aria-label="`Eject filament from lane ${name}`"
                    title="Eject filament"
                    @click="ejectLane">
                    <MdiIcon :path="mdiEject" class="size-4" />
                </button>
            </div>
        </div>
    </div>
</template>
