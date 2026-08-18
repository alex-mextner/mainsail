<script setup lang="ts">
import { computed } from 'vue'
import { mdiChartAreaspline } from '@mdi/js'
import Panel from '@/components/ui/Panel.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import HistoryStatusChart from './History/HistoryStatusChart.vue'
import HistoryBarChart from './History/HistoryBarChart.vue'
import { groupSmallSlices, statusSlices, type StatsValue } from './History/historyStats'
import { formatFilamentLength, formatPrintTime } from '@/lib/format'
import { useHistoryStore } from '@/stores/history'
import { useGuiStore } from '@/stores/gui'

/**
 * Print statistics -- upstream's `HistoryStatisticsPanel.vue`.
 *
 * Three blocks, upstream's own: lifetime totals, the outcome breakdown as a
 * donut or a table, and one of two bar charts.
 *
 * 🔴 THE TOTALS COME FROM `server.history.totals`, NOT FROM SUMMING THE LIST
 * Moonraker maintains lifetime counters independently of the job records, and
 * they survive jobs being deleted. Summing whatever the page happens to have
 * paged in would silently report "total print time" for the last 100 jobs while
 * calling it the total. The CHARTS below do fold the list, which is correct --
 * they are explicitly about a two-week window and about the jobs on screen.
 */
const history = useHistoryStore()
const gui = useGuiStore()

const settings = computed(() => gui.state.view.history)

const totals = computed(() => {
    const t = history.totals

    return [
        { label: 'Total jobs', value: t ? String(Math.round(t.total_jobs)) : '—' },
        { label: 'Total print time', value: t ? formatPrintTime(t.total_print_time) : '—' },
        { label: 'Longest print', value: t ? formatPrintTime(t.longest_print) : '—' },
        {
            label: 'Average print time',
            // Guarded rather than assumed: a machine whose history has been
            // cleared reports 0 jobs, and 0/0 renders as NaN.
            value: t && t.total_jobs > 0 ? formatPrintTime(t.total_print_time / t.total_jobs) : '—',
        },
        { label: 'Total filament used', value: t ? formatFilamentLength(t.total_filament_used) : '—' },
    ]
})

/** The table variant of the donut: same slices, same order, as numbers. */
const slices = computed(() => groupSmallSlices(statusSlices(history.pageJobs, settings.value.statusValue)))

const formatSlice = (amount: number): string => {
    if (settings.value.statusValue === 'filament') return formatFilamentLength(amount)
    if (settings.value.statusValue === 'time') return formatPrintTime(amount)
    return String(amount)
}

const setSetting = (key: string, value: string) => gui.saveSetting(`view.history.${key}`, value)
</script>

<template>
    <Panel panel-name="history-statistics" title="Statistics" :icon="mdiChartAreaspline" collapsible>
        <!--
            Three columns on a wide panel, stacked below. A container query, not
            a window breakpoint: this panel is full width on /history today but
            is the same component wherever it is put, and a chart deciding its
            layout from the window is how a 340px column ends up with a 3-up
            grid in it.
        -->
        <div class="grid grid-cols-1 gap-6 @2xl:grid-cols-3">
            <div>
                <table class="w-full text-sm">
                    <tbody>
                        <tr v-for="row in totals" :key="row.label" class="border-border/60 border-b last:border-0">
                            <td class="text-muted-foreground py-1.5 pr-2">{{ row.label }}</td>
                            <td class="tabular py-1.5 text-right font-medium">{{ row.value }}</td>
                        </tr>
                    </tbody>
                </table>
                <p class="text-muted-foreground mt-2 text-xs">
                    Lifetime totals, as counted by Moonraker — not a sum of the rows below.
                </p>
            </div>

            <div class="flex flex-col items-center gap-3">
                <HistoryStatusChart
                    v-if="settings.statusView === 'chart'"
                    :jobs="history.pageJobs"
                    :value="settings.statusValue" />

                <table v-else class="w-full text-sm">
                    <tbody>
                        <tr v-for="slice in slices" :key="slice.name" class="border-border/60 border-b last:border-0">
                            <td class="py-1.5 pr-2">
                                <span class="inline-flex items-center gap-2">
                                    <span
                                        class="inline-block size-2.5 rounded-full"
                                        :style="{ backgroundColor: slice.color }" />
                                    {{ slice.label }}
                                </span>
                            </td>
                            <td class="tabular py-1.5 text-right font-medium">{{ formatSlice(slice.value) }}</td>
                        </tr>
                        <tr v-if="!slices.length">
                            <td class="text-muted-foreground py-6 text-center text-sm italic" colspan="2">
                                No jobs yet.
                            </td>
                        </tr>
                    </tbody>
                </table>

                <div class="flex flex-wrap justify-center gap-2">
                    <SegmentedControl
                        :model-value="settings.statusView"
                        :options="[
                            { value: 'chart', label: 'Chart' },
                            { value: 'table', label: 'Table' },
                        ]"
                        @update:model-value="setSetting('statusView', $event)" />
                    <SegmentedControl
                        :model-value="settings.statusValue"
                        :options="[
                            { value: 'jobs', label: 'Jobs' },
                            { value: 'filament', label: 'Filament' },
                            { value: 'time', label: 'Time' },
                        ]"
                        @update:model-value="setSetting('statusValue', $event)" />
                </div>
            </div>

            <div class="flex flex-col items-center gap-3">
                <HistoryBarChart :jobs="history.pageJobs" :kind="settings.chart" />
                <SegmentedControl
                    :model-value="settings.chart"
                    :options="[
                        { value: 'filament_usage', label: 'Filament usage' },
                        { value: 'printtime_avg', label: 'Print time' },
                    ]"
                    @update:model-value="setSetting('chart', $event)" />
            </div>
        </div>
    </Panel>
</template>
